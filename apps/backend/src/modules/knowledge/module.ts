import { and, cosineDistance, desc, eq, ne, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/client.js';
import { documentChunks, documents, funds, portcos } from '../../db/schema.js';
import { embedQuery as defaultEmbedQuery } from './embeddings.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultChunkLimit = 8;
const maximumChunkLimit = 20;

export type KnowledgeScope = { fundId: string; portcoId?: string | null };
export type RetrievalOptions = {
  /** Overrides RETRIEVAL_LIMIT, still capped at the maximum. */
  limit?: number;
  /** Leaves out generated artifacts so new documents cite primary sources only. */
  excludeGenerated?: boolean;
};

export type KnowledgeChunk = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  headingPath: string[];
  startLine: number | null;
  endLine: number | null;
  similarity: number;
  sourceKind: 'seed' | 'uploaded' | 'generated';
  documentMetadata: Record<string, unknown>;
};

export type KnowledgeErrorCode = 'invalid_input' | 'not_found';

export class KnowledgeModuleError extends Error {
  constructor(
    message: string,
    readonly code: KnowledgeErrorCode,
  ) {
    super(message);
    this.name = 'KnowledgeModuleError';
  }
}

type KnowledgeDatabase = typeof defaultDb;
type EmbedQuery = (query: string) => Promise<number[]>;

const assertUuid = (value: string, label: string) => {
  if (!uuidPattern.test(value)) {
    throw new KnowledgeModuleError(`Invalid ${label}`, 'invalid_input');
  }
};

const retrievalLimit = (requested?: number) => {
  const configured = Number(requested ?? process.env.RETRIEVAL_LIMIT ?? defaultChunkLimit);
  if (!Number.isFinite(configured)) return defaultChunkLimit;
  return Math.max(1, Math.min(maximumChunkLimit, Math.floor(configured)));
};

const minimumSimilarity = () => {
  const configured = Number(process.env.RETRIEVAL_MIN_SIMILARITY ?? 0.25);
  return Number.isFinite(configured) ? Math.max(-1, Math.min(1, configured)) : 0.25;
};

export const createKnowledgeModuleInternal = ({
  db = defaultDb,
  embedQuery = defaultEmbedQuery,
}: {
  db?: KnowledgeDatabase;
  embedQuery?: EmbedQuery;
} = {}) => {
  const validateScope = async ({ fundId, portcoId }: KnowledgeScope) => {
    assertUuid(fundId, 'fund id');
    if (portcoId) assertUuid(portcoId, 'portco id');

    const [fund] = await db.select({ id: funds.id }).from(funds).where(eq(funds.id, fundId));
    if (!fund) throw new KnowledgeModuleError('Fund not found', 'not_found');

    if (portcoId) {
      const [portco] = await db
        .select({ id: portcos.id })
        .from(portcos)
        .where(and(eq(portcos.id, portcoId), eq(portcos.fundId, fundId)));
      if (!portco) throw new KnowledgeModuleError('Portco not found for fund', 'not_found');
    }
  };

  const getChunksFromQuery = async (
    scope: KnowledgeScope,
    query: string,
    options: RetrievalOptions = {},
  ): Promise<KnowledgeChunk[]> => {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      throw new KnowledgeModuleError('Query is required', 'invalid_input');
    }

    await validateScope(scope);

    const queryVector = await embedQuery(cleanQuery);
    const distance = cosineDistance(documentChunks.embedding, queryVector);
    const similarity = sql<number>`(1 - (${distance}))`;
    const scopeFilter = scope.portcoId
      ? eq(documents.portcoId, scope.portcoId)
      : eq(documents.fundId, scope.fundId);

    const rows = await db
      .select({
        chunkId: documentChunks.id,
        documentId: documents.id,
        documentTitle: documents.title,
        content: documentChunks.content,
        headingPath: documentChunks.headingPath,
        startLine: documentChunks.startLine,
        endLine: documentChunks.endLine,
        similarity,
        sourceKind: documents.sourceKind,
        documentMetadata: documents.metadata,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .where(
        and(
          eq(documents.fundId, scope.fundId),
          eq(documents.status, 'ready'),
          scopeFilter,
          options.excludeGenerated ? ne(documents.sourceKind, 'generated') : undefined,
          sql`${similarity} >= ${minimumSimilarity()}`,
        ),
      )
      .orderBy(desc(similarity), desc(documentChunks.id))
      .limit(retrievalLimit(options.limit));

    return rows.map((row) => ({ ...row, similarity: Number(row.similarity) }));
  };

  return { getChunksFromQuery };
};

export type KnowledgeModule = ReturnType<typeof createKnowledgeModuleInternal>;
