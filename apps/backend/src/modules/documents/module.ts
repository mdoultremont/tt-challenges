import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/client.js';
import { documents, funds, portcos } from '../../db/schema.js';
import { createDocumentIngestionHandler } from './consumer.js';
import { createElasticMqConsumer, createElasticMqQueue, type DocumentQueue } from './queue.js';
import { createMinioStorage, type DocumentStorage } from './storage.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxDocumentBytes = 5 * 1024 * 1024;
const markdownExtensions = new Set(['.md', '.markdown', '.mdown']);
const plainTextExtensions = new Set(['.txt']);
const supportedMimeTypes = new Set(['text/markdown', 'text/plain', 'text/x-markdown']);

export type DocumentSummary = {
  id: string;
  fundId: string;
  portcoId: string | null;
  title: string;
  filename: string;
  mimeType: string;
  sourceKind: 'seed' | 'uploaded' | 'generated';
  status: 'queued' | 'processing' | 'ready' | 'failed';
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};
export type DocumentDetails = DocumentSummary & {
  metadata: Record<string, unknown>;
  content: string;
};
export type CreateDocumentInput = {
  fundId: string;
  portcoId?: string | null;
  title?: string | null;
  filename: string;
  mimeType: string;
  body: Uint8Array;
};
export type DocumentScope = { fundId: string; portcoId?: string | null };
export type DocumentErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'unsupported_type'
  | 'too_large'
  | 'queue_unavailable'
  | 'storage_unavailable'
  | 'conflict';

export class DocumentModuleError extends Error {
  constructor(
    message: string,
    readonly code: DocumentErrorCode,
  ) {
    super(message);
    this.name = 'DocumentModuleError';
  }
}

type DocumentDatabase = typeof defaultDb;
type WorkerConsumer = ReturnType<typeof createElasticMqConsumer>;
export type DocumentsModule = ReturnType<typeof createDocumentsModuleInternal>;

const assertUuid = (value: string, label: string) => {
  if (!uuidPattern.test(value)) throw new DocumentModuleError(`Invalid ${label}`, 'invalid_input');
};
const extensionOf = (filename: string) => {
  const i = filename.lastIndexOf('.');
  return i < 0 ? '' : filename.slice(i).toLowerCase();
};
const contentTypeFor = (filename: string, mimeType: string) => {
  const normalized = mimeType.split(';', 1)[0].trim().toLowerCase();
  const extension = extensionOf(filename);
  if (supportedMimeTypes.has(normalized))
    return normalized === 'text/x-markdown' ? 'text/markdown' : normalized;
  if (markdownExtensions.has(extension)) return 'text/markdown';
  if (plainTextExtensions.has(extension)) return 'text/plain';
  throw new DocumentModuleError(
    'Only Markdown and plain text files are supported',
    'unsupported_type',
  );
};
const titleFromFilename = (filename: string) => filename.replace(/\.[^.]+$/, '').trim();

export const createDocumentsModuleInternal = ({
  db = defaultDb,
  storage = createMinioStorage(),
  queue = createElasticMqQueue(),
  consumer = createElasticMqConsumer(),
  createId = randomUUID,
}: {
  db?: DocumentDatabase;
  storage?: DocumentStorage;
  queue?: DocumentQueue;
  consumer?: WorkerConsumer;
  createId?: () => string;
} = {}) => {
  const validateScope = async ({ fundId, portcoId }: DocumentScope) => {
    assertUuid(fundId, 'fund id');
    if (portcoId) assertUuid(portcoId, 'portco id');
    const [fund] = await db.select({ id: funds.id }).from(funds).where(eq(funds.id, fundId));
    if (!fund) throw new DocumentModuleError('Fund not found', 'not_found');
    if (portcoId) {
      const [portco] = await db
        .select({ id: portcos.id })
        .from(portcos)
        .where(and(eq(portcos.id, portcoId), eq(portcos.fundId, fundId)));
      if (!portco) throw new DocumentModuleError('Portco not found for fund', 'not_found');
    }
  };

  const createDocument = async (input: CreateDocumentInput): Promise<DocumentSummary> => {
    await validateScope(input);
    if (!input.filename.trim())
      throw new DocumentModuleError('Filename is required', 'invalid_input');
    if (input.body.byteLength > maxDocumentBytes)
      throw new DocumentModuleError('Document exceeds the 5 MB limit', 'too_large');
    const mimeType = contentTypeFor(input.filename, input.mimeType);
    const title = input.title?.trim() || titleFromFilename(input.filename);
    if (!title) throw new DocumentModuleError('A non-empty title is required', 'invalid_input');
    const id = createId();
    const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const storageKey = `${input.fundId}/${input.portcoId ?? 'fund'}/${id}-${safeFilename}`;
    await storage.ensureBucket();
    await storage.put(storageKey, input.body, mimeType);
    let document: DocumentSummary;
    try {
      const [inserted] = await db
        .insert(documents)
        .values({
          id,
          fundId: input.fundId,
          portcoId: input.portcoId ?? null,
          title,
          filename: input.filename,
          mimeType,
          sourceKind: 'uploaded',
          storageKey,
          status: 'queued',
        })
        .returning({
          id: documents.id,
          fundId: documents.fundId,
          portcoId: documents.portcoId,
          title: documents.title,
          filename: documents.filename,
          mimeType: documents.mimeType,
          sourceKind: documents.sourceKind,
          status: documents.status,
          errorMessage: documents.errorMessage,
          createdAt: documents.createdAt,
          updatedAt: documents.updatedAt,
          completedAt: documents.completedAt,
        });
      if (!inserted) throw new Error('Document insert returned no row');
      document = inserted as DocumentSummary;
    } catch (error) {
      try {
        await storage.remove(storageKey);
      } catch (cleanupError) {
        console.error('Unable to remove orphaned document object', cleanupError);
      }
      throw error;
    }
    try {
      await queue.publish(id);
    } catch (error) {
      const queueMessage = error instanceof Error ? error.message : 'unknown queue error';
      try {
        const completedAt = new Date();
        await db
          .update(documents)
          .set({
            status: 'failed',
            errorMessage: `Queue publication failed: ${queueMessage}`.slice(0, 500),
            completedAt,
            updatedAt: completedAt,
          })
          .where(eq(documents.id, id));
      } catch (markFailedError) {
        console.error('Unable to mark document queue failure', markFailedError);
      }
      throw new DocumentModuleError(
        'Document ingestion could not be scheduled',
        'queue_unavailable',
      );
    }
    return document;
  };

  const listDocuments = async ({ fundId, portcoId }: DocumentScope) => {
    await validateScope({ fundId, portcoId });
    return db
      .select({
        id: documents.id,
        fundId: documents.fundId,
        portcoId: documents.portcoId,
        title: documents.title,
        filename: documents.filename,
        mimeType: documents.mimeType,
        sourceKind: documents.sourceKind,
        status: documents.status,
        errorMessage: documents.errorMessage,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        completedAt: documents.completedAt,
      })
      .from(documents)
      .where(
        portcoId
          ? and(eq(documents.fundId, fundId), eq(documents.portcoId, portcoId))
          : eq(documents.fundId, fundId),
      )
      .orderBy(desc(documents.createdAt), desc(documents.id));
  };

  const findDocument = async ({
    documentId,
    fundId,
    portcoId,
  }: { documentId: string } & DocumentScope) => {
    assertUuid(documentId, 'document id');
    await validateScope({ fundId, portcoId });
    const [document] = await db
      .select({
        id: documents.id,
        fundId: documents.fundId,
        portcoId: documents.portcoId,
        title: documents.title,
        filename: documents.filename,
        mimeType: documents.mimeType,
        sourceKind: documents.sourceKind,
        status: documents.status,
        errorMessage: documents.errorMessage,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        completedAt: documents.completedAt,
        metadata: documents.metadata,
        storageKey: documents.storageKey,
      })
      .from(documents)
      .where(
        portcoId
          ? and(
              eq(documents.id, documentId),
              eq(documents.fundId, fundId),
              eq(documents.portcoId, portcoId),
            )
          : and(eq(documents.id, documentId), eq(documents.fundId, fundId)),
      );
    if (!document) throw new DocumentModuleError('Document not found', 'not_found');
    return document;
  };
  const getDocument = async (
    scope: { documentId: string } & DocumentScope,
  ): Promise<DocumentDetails> => {
    const { storageKey, metadata, ...summary } = await findDocument(scope);
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(
        await storage.read(storageKey),
      );
      return { ...summary, metadata, content };
    } catch (error) {
      console.error(`Unable to read object for document ${summary.id}`, error);
      throw new DocumentModuleError('Document content is unavailable', 'storage_unavailable');
    }
  };
  const deleteDocument = async (scope: { documentId: string } & DocumentScope) => {
    const document = await findDocument(scope);
    try {
      const deleted = await db
        .delete(documents)
        .where(eq(documents.id, document.id))
        .returning({ id: documents.id });
      if (!deleted[0]) throw new DocumentModuleError('Document not found', 'not_found');
    } catch (error) {
      if (error instanceof DocumentModuleError) throw error;
      if ((error as { code?: string }).code === '23503') {
        throw new DocumentModuleError('Document cannot be deleted because it is cited', 'conflict');
      }
      throw error;
    }
    try {
      await storage.remove(document.storageKey);
    } catch (error) {
      console.error(`Unable to remove object for deleted document ${document.id}`, error);
    }
  };

  const runIngestionWorker = async ({ signal }: { signal: AbortSignal }) => {
    const handler = createDocumentIngestionHandler({ db });
    const sleep = (milliseconds: number) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    while (!signal.aborted) {
      let messages;
      try {
        messages = await consumer.receive(signal);
      } catch (error) {
        if (signal.aborted) break;
        console.error('Document worker receive failed', error);
        await sleep(1000);
        continue;
      }
      for (const message of messages) {
        if (signal.aborted) break;
        if (!message.receiptHandle) continue;
        try {
          await handler.handle(message.body ?? '');
          await consumer.acknowledge(message.receiptHandle);
        } catch (error) {
          console.error(
            `Document worker left message ${message.messageId ?? 'unknown'} unacknowledged`,
            error,
          );
        }
      }
    }
  };

  return {
    createDocument,
    listDocuments,
    getDocument,
    deleteDocument,
    runIngestionWorker,
  };
};
