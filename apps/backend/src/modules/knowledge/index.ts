import { createKnowledgeModuleInternal } from './module.js';

const knowledge = createKnowledgeModuleInternal();

export const getChunksFromQuery = knowledge.getChunksFromQuery;

export { splitMarkdown, CHUNK_OVERLAP, CHUNK_SIZE, type MarkdownChunk } from './chunker.js';
export { embedQuery, embedTexts } from './embeddings.js';
export {
  KnowledgeModuleError,
  type KnowledgeChunk,
  type KnowledgeErrorCode,
  type KnowledgeModule,
  type KnowledgeScope,
  type RetrievalOptions,
} from './module.js';
