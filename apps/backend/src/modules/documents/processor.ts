import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/client.js';
import { documentChunks, documents, EMBEDDING_DIMENSIONS } from '../../db/schema.js';
import { embedTexts, splitMarkdown } from '../knowledge/index.js';
import type { DocumentStorage } from './storage.js';

export class DocumentProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentProcessingError';
  }
}

type DocumentDatabase = typeof defaultDb;

const decodeUtf8 = (bytes: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentProcessingError('Document is not valid UTF-8');
  }
};

export const createDocumentProcessor = ({
  db = defaultDb,
  storage,
  embed = embedTexts,
}: {
  db?: DocumentDatabase;
  storage: DocumentStorage;
  embed?: (texts: string[]) => Promise<number[][]>;
}) => ({
  async process(documentId: string) {
    const [document] = await db
      .select({
        id: documents.id,
        title: documents.title,
        storageKey: documents.storageKey,
        metadata: documents.metadata,
      })
      .from(documents)
      .where(eq(documents.id, documentId));
    if (!document) throw new DocumentProcessingError('Document no longer exists');

    const source = decodeUtf8(await storage.read(document.storageKey));
    let parsed;
    try {
      parsed = await splitMarkdown(source);
    } catch (error) {
      if (error instanceof DocumentProcessingError) throw error;
      throw new DocumentProcessingError(
        error instanceof Error ? error.message.slice(0, 300) : 'Invalid Markdown document',
      );
    }
    const contextualTexts = parsed.chunks.map(
      (chunk) => `${document.title}\n${chunk.headingPath.join(' > ')}\n${chunk.content}`,
    );
    const vectors = await embed(contextualTexts);
    if (
      vectors.length !== parsed.chunks.length ||
      vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)
    ) {
      throw new DocumentProcessingError('Embedding dimensions did not match the schema');
    }

    const completedAt = new Date();
    await db.transaction(async (tx) => {
      await tx.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
      await tx.insert(documentChunks).values(
        parsed.chunks.map((chunk, index) => ({
          documentId,
          chunkIndex: index,
          content: chunk.content,
          headingPath: chunk.headingPath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
          embedding: vectors[index],
          metadata: { ...chunk.metadata, documentTitle: document.title },
        })),
      );
      await tx
        .update(documents)
        .set({
          status: 'ready',
          metadata: { ...document.metadata, frontmatter: parsed.frontmatter },
          errorMessage: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(documents.id, documentId));
    });
  },
});
