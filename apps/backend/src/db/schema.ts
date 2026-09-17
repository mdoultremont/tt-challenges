import {
  type AnyPgColumn,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
/**
 * The embedding provider is deliberately not chosen by the database layer.
 * 384 is the provisional width for a small local embedding model; change this
 * constant and the migration together when the provider is selected.
 */
export const EMBEDDING_DIMENSIONS = 384;

export const documentStatus = pgEnum('document_status', [
  'queued',
  'processing',
  'ready',
  'failed',
]);

export const documentSourceKind = pgEnum('document_source_kind', ['seed', 'uploaded', 'generated']);

export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system']);

export const artifactType = pgEnum('artifact_type', [
  'candidate_profile',
  'search_comparison',
  'exec_brief',
  'portco_brief',
]);

export const funds = pgTable(
  'funds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('funds_slug_unique').on(table.slug),
    index('funds_name_id_idx').on(table.name, table.id),
  ],
);

export const portcos = pgTable(
  'portcos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fundId: uuid('fund_id')
      .notNull()
      .references(() => funds.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('portcos_fund_code_unique').on(table.fundId, table.code),
    uniqueIndex('portcos_fund_slug_unique').on(table.fundId, table.slug),
    unique('portcos_fund_id_unique').on(table.fundId, table.id),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fundId: uuid('fund_id')
      .notNull()
      .references(() => funds.id, { onDelete: 'cascade' }),
    /** Null means this is a fund-level document. */
    portcoId: uuid('portco_id'),
    title: text('title').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sourceKind: documentSourceKind('source_kind').notNull().default('uploaded'),
    storageKey: text('storage_key').notNull(),
    status: documentStatus('status').notNull().default('queued'),
    errorMessage: text('error_message'),
    attemptCount: integer('attempt_count').notNull().default(0),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    // A portco document must belong to a portco in the same fund.
    foreignKey({
      columns: [table.fundId, table.portcoId],
      foreignColumns: [portcos.fundId, portcos.id],
      name: 'documents_fund_portco_fk',
    }),
    index('documents_fund_created_idx').on(table.fundId, table.createdAt, table.id),
    index('documents_fund_portco_created_idx').on(
      table.fundId,
      table.portcoId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    headingPath: text('heading_path').array().notNull().default([]),
    startLine: integer('start_line'),
    endLine: integer('end_line'),
    startChar: integer('start_char'),
    endChar: integer('end_char'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('document_chunks_document_index_unique').on(table.documentId, table.chunkIndex),
    index('document_chunks_document_idx').on(table.documentId),
  ],
);

export const chats = pgTable(
  'chats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fundId: uuid('fund_id')
      .notNull()
      .references(() => funds.id, { onDelete: 'cascade' }),
    /** Null means the chat is at fund scope and may retrieve all portcos. */
    portcoId: uuid('portco_id'),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.fundId, table.portcoId],
      foreignColumns: [portcos.fundId, portcos.id],
      name: 'chats_fund_portco_fk',
    }),
    index('chats_scope_updated_idx').on(table.fundId, table.portcoId, table.updatedAt, table.id),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    content: text('content').notNull(),
    /** Set when this assistant message delivered a generated artifact. */
    artifactId: uuid('artifact_id').references((): AnyPgColumn => artifacts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('messages_chat_created_idx').on(table.chatId, table.createdAt, table.id)],
);

export const messageCitations = pgTable(
  'message_citations',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id')
      .notNull()
      .references(() => documentChunks.id, { onDelete: 'restrict' }),
    citationOrder: integer('citation_order').notNull(),
    excerpt: text('excerpt').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.chunkId] }),
    uniqueIndex('message_citations_order_unique').on(table.messageId, table.citationOrder),
  ],
);

export const artifacts = pgTable('artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id')
    .notNull()
    .unique()
    .references(() => documents.id, { onDelete: 'cascade' }),
  chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
  type: artifactType('type').notNull(),
  promptVersion: text('prompt_version'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
});

export const artifactCitations = pgTable(
  'artifact_citations',
  {
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id')
      .notNull()
      .references(() => documentChunks.id, { onDelete: 'restrict' }),
    citationOrder: integer('citation_order').notNull(),
    claim: text('claim'),
    excerpt: text('excerpt').notNull(),
  },
  (table) => [
    // One row per claim-to-passage link: a passage can support several claims in a brief.
    primaryKey({ columns: [table.artifactId, table.citationOrder] }),
    index('artifact_citations_chunk_idx').on(table.chunkId),
  ],
);
