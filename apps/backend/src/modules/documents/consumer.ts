import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/client.js';
import { documents } from '../../db/schema.js';
import { createDocumentProcessor, DocumentProcessingError } from './processor.js';
import { createMinioStorage } from './storage.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const parseIngestionMessage = (body: string) => {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (
      parsed.version !== 1 ||
      parsed.type !== 'document.ingestion.requested' ||
      typeof parsed.documentId !== 'string' ||
      !uuidPattern.test(parsed.documentId)
    ) {
      return null;
    }
    return {
      version: 1 as const,
      type: 'document.ingestion.requested' as const,
      documentId: parsed.documentId,
    };
  } catch {
    return null;
  }
};

type DocumentDatabase = typeof defaultDb;
const processingLeaseMs = 4 * 60 * 1000;

export type DocumentClaimResult = 'claimed' | 'acknowledged';

export const createDocumentIngestionHandler = ({
  db = defaultDb,
  processor = createDocumentProcessor({ db, storage: createMinioStorage() }),
}: {
  db?: DocumentDatabase;
  processor?: { process: (documentId: string) => Promise<void> };
} = {}) => ({
  async handle(body: string): Promise<DocumentClaimResult> {
    const message = parseIngestionMessage(body);
    if (!message) {
      console.warn('Acknowledging malformed document ingestion message');
      return 'acknowledged';
    }

    const now = new Date();
    const staleBefore = new Date(now.getTime() - processingLeaseMs);
    const [claimed] = await db
      .update(documents)
      .set({
        status: 'processing',
        processingStartedAt: now,
        updatedAt: now,
        attemptCount: sql`${documents.attemptCount} + 1`,
        errorMessage: null,
        completedAt: null,
      })
      .where(
        and(
          eq(documents.id, message.documentId),
          or(
            eq(documents.status, 'queued'),
            and(
              eq(documents.status, 'processing'),
              or(
                isNull(documents.processingStartedAt),
                lt(documents.processingStartedAt, staleBefore),
              ),
            ),
          ),
        ),
      )
      .returning({ id: documents.id });

    if (claimed) {
      try {
        await processor.process(message.documentId);
      } catch (error) {
        if (!(error instanceof DocumentProcessingError)) throw error;
        const completedAt = new Date();
        await db
          .update(documents)
          .set({
            status: 'failed',
            errorMessage: error.message.slice(0, 500),
            completedAt,
            updatedAt: completedAt,
          })
          .where(eq(documents.id, message.documentId));
      }
      return 'claimed';
    }

    const [existing] = await db
      .select({ id: documents.id, status: documents.status })
      .from(documents)
      .where(eq(documents.id, message.documentId));
    if (!existing)
      console.warn(`Acknowledging ingestion message for missing document ${message.documentId}`);
    return 'acknowledged';
  },
});
