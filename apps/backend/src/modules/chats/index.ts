import { createChatsModuleInternal } from './module.js';

export const createChatsModule = () => createChatsModuleInternal();

export {
  ChatModuleError,
  type ChatDetails,
  type ChatErrorCode,
  type ChatScope,
  type ChatSummary,
  type ChatsModule,
  type CreateChatInput,
  type Message,
  type MessageArtifact,
  type MessageCitation,
} from './module.js';
