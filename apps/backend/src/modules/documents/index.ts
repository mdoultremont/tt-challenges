import { createDocumentsModuleInternal } from './module.js';

export const createDocumentsModule = () => createDocumentsModuleInternal();

export {
  DocumentModuleError,
  type CreateDocumentInput,
  type DocumentErrorCode,
  type DocumentDetails,
  type DocumentScope,
  type DocumentSummary,
  type DocumentsModule,
} from './module.js';
