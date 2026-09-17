import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db as defaultDb } from '../../db/client.js';
import {
  artifacts as artifactsTable,
  chats,
  documentChunks,
  documents,
  messageCitations,
  messages,
} from '../../db/schema.js';
import {
  ArtifactModuleError,
  createArtifactsModule,
  type ArtifactsModule,
} from '../artifacts/index.js';
import {
  getChunksFromQuery as defaultGetChunksFromQuery,
  type KnowledgeChunk,
} from '../knowledge/index.js';
import { createScopesModule, type ScopesModule } from '../scopes/index.js';
import {
  answerSystemPrompt,
  briefAmbiguousReply,
  briefCreatedReply,
  briefNoMentionReply,
  buildRetrievalQuery,
  chooseBriefPortco,
  createAnthropicAnswerModel,
  insufficientEvidenceAnswer,
  validateGroundedAnswer,
  type AnswerModel,
  type ExecBriefRequest,
} from './answer.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxInitialMessageBytes = 20_000;
const maxTitleLength = 120;

export type ChatSummary = {
  id: string;
  fundId: string;
  portcoId: string | null;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type MessageCitation = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  headingPath: string[];
  startLine: number | null;
  endLine: number | null;
  citationOrder: number;
  excerpt: string;
};
export type MessageArtifact = {
  id: string;
  type: 'candidate_profile' | 'search_comparison' | 'exec_brief' | 'portco_brief';
  documentId: string;
  title: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
};
export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
  citations: MessageCitation[];
  artifact: MessageArtifact | null;
};
export type ChatDetails = ChatSummary & { messages: Message[] };
export type ChatScope = { fundId: string; portcoId?: string | null };
export type CreateChatInput = ChatScope & { initialMessage: string; title?: string | null };
export type ChatErrorCode = 'invalid_input' | 'not_found' | 'conflict' | 'model_unavailable';

export class ChatModuleError extends Error {
  constructor(
    message: string,
    readonly code: ChatErrorCode,
  ) {
    super(message);
    this.name = 'ChatModuleError';
  }
}

type ChatDatabase = typeof defaultDb;
export type ChatsModule = ReturnType<typeof createChatsModuleInternal>;

const assertUuid = (value: string, label: string) => {
  if (!uuidPattern.test(value)) throw new ChatModuleError(`Invalid ${label}`, 'invalid_input');
};
const compactTitle = (message: string) => {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.slice(0, maxTitleLength) || null;
};

export const createChatsModuleInternal = ({
  db = defaultDb,
  scopes = createScopesModule(),
  getChunksFromQuery = defaultGetChunksFromQuery,
  answerModel = createAnthropicAnswerModel(),
  artifacts = createArtifactsModule(),
  createId = randomUUID,
}: {
  db?: ChatDatabase;
  scopes?: ScopesModule;
  getChunksFromQuery?: typeof defaultGetChunksFromQuery;
  answerModel?: AnswerModel;
  artifacts?: Pick<ArtifactsModule, 'generateExecBrief' | 'findPortcosMentioning'>;
  createId?: () => string;
} = {}) => {
  const normalizeScope = async ({ fundId, portcoId }: ChatScope) => {
    assertUuid(fundId, 'fund id');
    if (portcoId) assertUuid(portcoId, 'portco id');
    await scopes.getScope({ fundId, portcoId });
    return { fundId, portcoId: portcoId ?? null };
  };

  const getMessages = async (chatId: string): Promise<Message[]> => {
    const rows = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
        artifactId: artifactsTable.id,
        artifactType: artifactsTable.type,
        artifactDocumentId: documents.id,
        artifactTitle: documents.title,
        artifactStatus: documents.status,
      })
      .from(messages)
      .leftJoin(artifactsTable, eq(messages.artifactId, artifactsTable.id))
      .leftJoin(documents, eq(artifactsTable.documentId, documents.id))
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    if (!rows.length) return [];
    const messageIds = rows.map((row) => row.id);
    const citations = await db
      .select({
        messageId: messageCitations.messageId,
        chunkId: messageCitations.chunkId,
        documentId: documentChunks.documentId,
        documentTitle: documents.title,
        headingPath: documentChunks.headingPath,
        startLine: documentChunks.startLine,
        endLine: documentChunks.endLine,
        citationOrder: messageCitations.citationOrder,
        excerpt: messageCitations.excerpt,
      })
      .from(messageCitations)
      .innerJoin(documentChunks, eq(messageCitations.chunkId, documentChunks.id))
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .where(inArray(messageCitations.messageId, messageIds))
      .orderBy(asc(messageCitations.citationOrder), asc(messageCitations.chunkId));
    const citationsByMessage = new Map<string, MessageCitation[]>();
    for (const citation of citations) {
      const list = citationsByMessage.get(citation.messageId) ?? [];
      list.push({
        chunkId: citation.chunkId,
        documentId: citation.documentId,
        documentTitle: citation.documentTitle,
        headingPath: citation.headingPath,
        startLine: citation.startLine,
        endLine: citation.endLine,
        citationOrder: citation.citationOrder,
        excerpt: citation.excerpt,
      });
      citationsByMessage.set(citation.messageId, list);
    }
    return rows.map(
      ({
        artifactId,
        artifactType,
        artifactDocumentId,
        artifactTitle,
        artifactStatus,
        ...row
      }) => ({
        ...row,
        citations: citationsByMessage.get(row.id) ?? [],
        artifact:
          artifactId && artifactType && artifactDocumentId && artifactTitle && artifactStatus
            ? {
                id: artifactId,
                type: artifactType,
                documentId: artifactDocumentId,
                title: artifactTitle,
                status: artifactStatus,
              }
            : null,
      }),
    );
  };

  const listChats = async (scope: ChatScope): Promise<ChatSummary[]> => {
    const normalized = await normalizeScope(scope);
    const scopeFilter = normalized.portcoId
      ? eq(chats.portcoId, normalized.portcoId)
      : isNull(chats.portcoId);
    return db
      .select({
        id: chats.id,
        fundId: chats.fundId,
        portcoId: chats.portcoId,
        title: chats.title,
        createdAt: chats.createdAt,
        updatedAt: chats.updatedAt,
      })
      .from(chats)
      .where(and(eq(chats.fundId, normalized.fundId), scopeFilter))
      .orderBy(desc(chats.updatedAt), desc(chats.id));
  };

  const createChat = async (input: CreateChatInput): Promise<ChatDetails> => {
    const normalized = await normalizeScope(input);
    const initialMessage = input.initialMessage.trim();
    if (!initialMessage) throw new ChatModuleError('Initial message is required', 'invalid_input');
    if (new TextEncoder().encode(initialMessage).byteLength > maxInitialMessageBytes) {
      throw new ChatModuleError('Initial message is too large', 'invalid_input');
    }
    const title = input.title?.trim() || compactTitle(initialMessage);
    if (title && title.length > maxTitleLength) {
      throw new ChatModuleError(
        `Title must be at most ${maxTitleLength} characters`,
        'invalid_input',
      );
    }
    const chatId = createId();
    const now = new Date();
    return db.transaction(async (tx) => {
      const [chat] = await tx
        .insert(chats)
        .values({ id: chatId, ...normalized, title, createdAt: now, updatedAt: now })
        .returning({
          id: chats.id,
          fundId: chats.fundId,
          portcoId: chats.portcoId,
          title: chats.title,
          createdAt: chats.createdAt,
          updatedAt: chats.updatedAt,
        });
      if (!chat) throw new Error('Chat insert returned no row');
      const [message] = await tx
        .insert(messages)
        .values({ id: createId(), chatId, role: 'user', content: initialMessage, createdAt: now })
        .returning({
          id: messages.id,
          role: messages.role,
          content: messages.content,
          createdAt: messages.createdAt,
        });
      if (!message) throw new Error('Message insert returned no row');
      return { ...chat, messages: [{ ...message, citations: [], artifact: null }] };
    });
  };

  const getChat = async ({
    chatId,
    fundId,
    portcoId,
  }: { chatId: string } & ChatScope): Promise<ChatDetails> => {
    assertUuid(chatId, 'chat id');
    const normalized = await normalizeScope({ fundId, portcoId });
    const scopeFilter = normalized.portcoId
      ? eq(chats.portcoId, normalized.portcoId)
      : isNull(chats.portcoId);
    const [chat] = await db
      .select({
        id: chats.id,
        fundId: chats.fundId,
        portcoId: chats.portcoId,
        title: chats.title,
        createdAt: chats.createdAt,
        updatedAt: chats.updatedAt,
      })
      .from(chats)
      .where(and(eq(chats.id, chatId), eq(chats.fundId, normalized.fundId), scopeFilter));
    if (!chat) throw new ChatModuleError('Chat not found', 'not_found');
    return { ...chat, messages: await getMessages(chat.id) };
  };

  const deleteChat = async ({ chatId, fundId, portcoId }: { chatId: string } & ChatScope) => {
    assertUuid(chatId, 'chat id');
    const normalized = await normalizeScope({ fundId, portcoId });
    const scopeFilter = normalized.portcoId
      ? eq(chats.portcoId, normalized.portcoId)
      : isNull(chats.portcoId);
    const deleted = await db
      .delete(chats)
      .where(and(eq(chats.id, chatId), eq(chats.fundId, normalized.fundId), scopeFilter))
      .returning({ id: chats.id });
    if (!deleted[0]) throw new ChatModuleError('Chat not found', 'not_found');
  };

  /**
   * Generates a brief for the chat's scope. Evidence problems become the reply;
   * model or storage outages fail the answer so the question can be retried.
   * If the answer is then lost to a concurrent reply, the brief stays saved.
   */
  const replyWithExecBrief = async (
    chat: ChatSummary,
    request: ExecBriefRequest,
  ): Promise<{ content: string; artifact: MessageArtifact | null }> => {
    const subjectName = request.subjectName.replace(/\s+/g, ' ').trim();
    let portcoId = chat.portcoId;
    if (!portcoId) {
      const choice = chooseBriefPortco(
        await artifacts.findPortcosMentioning({ fundId: chat.fundId, subjectName }),
        request.portcoName,
      );
      if (choice.kind === 'none')
        return { content: briefNoMentionReply(subjectName), artifact: null };
      if (choice.kind === 'ambiguous') {
        return { content: briefAmbiguousReply(subjectName, choice.portcos), artifact: null };
      }
      portcoId = choice.portco.id;
    }
    try {
      const generated = await artifacts.generateExecBrief({
        fundId: chat.fundId,
        portcoId,
        subjectName,
        role: request.role ?? null,
        chatId: chat.id,
      });
      return {
        content: briefCreatedReply(generated.brief),
        artifact: {
          id: generated.id,
          type: generated.type,
          documentId: generated.document.id,
          title: generated.document.title,
          status: generated.document.status,
        },
      };
    } catch (error) {
      if (!(error instanceof ArtifactModuleError)) throw error;
      if (error.code === 'model_unavailable' || error.code === 'storage_unavailable') {
        throw new ChatModuleError('The brief could not be generated', 'model_unavailable');
      }
      return { content: `I couldn't generate that brief. ${error.message}.`, artifact: null };
    }
  };

  const answerChat = async ({
    chatId,
    fundId,
    portcoId,
  }: { chatId: string } & ChatScope): Promise<Message> => {
    const chat = await getChat({ chatId, fundId, portcoId });
    const pending = chat.messages.at(-1);
    if (!pending || pending.role !== 'user') {
      throw new ChatModuleError('Chat has no pending user message', 'conflict');
    }
    const matches = await getChunksFromQuery(
      { fundId: chat.fundId, portcoId: chat.portcoId },
      buildRetrievalQuery(chat.messages),
    );
    let answer = insufficientEvidenceAnswer;
    let selected: KnowledgeChunk[] = [];
    let artifact: MessageArtifact | null = null;
    if (matches.length) {
      const labeled = matches.map((match, index) => ({ label: `S${index + 1}`, match }));
      const history = chat.messages
        .slice(-10)
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n');
      const sourceText = labeled
        .map(
          ({ label, match }) =>
            `${label} | ${match.documentTitle} | ${match.headingPath.join(' > ') || 'Document'} | lines ${match.startLine ?? '?'}-${match.endLine ?? '?'}\n${match.content}`,
        )
        .join('\n\n');
      let decision;
      try {
        decision = await answerModel.invoke({
          system: answerSystemPrompt,
          user: `Recent conversation:\n${history}\n\nSupplied evidence:\n${sourceText}\n\nCall one tool for the latest user message.`,
        });
      } catch (error) {
        console.error('Grounded chat model failed', error);
        throw new ChatModuleError('The answer model is unavailable', 'model_unavailable');
      }
      if (decision.kind === 'exec_brief') {
        ({ content: answer, artifact } = await replyWithExecBrief(chat, decision.request));
      } else {
        const validated = validateGroundedAnswer(
          decision.answer,
          new Set(labeled.map(({ label }) => label)),
        );
        answer = validated.answer;
        selected = validated.citationIds
          .map((label) => labeled.find((item) => item.label === label)?.match)
          .filter((match): match is KnowledgeChunk => Boolean(match));
      }
    }
    const now = new Date();
    return db.transaction(async (tx) => {
      const [latest] = await tx
        .select({ id: messages.id, role: messages.role })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(1);
      if (!latest || latest.id !== pending.id || latest.role !== 'user') {
        throw new ChatModuleError('Chat no longer has the pending user message', 'conflict');
      }
      const [assistant] = await tx
        .insert(messages)
        .values({
          id: createId(),
          chatId,
          role: 'assistant',
          content: answer,
          artifactId: artifact?.id ?? null,
          createdAt: now,
        })
        .returning({
          id: messages.id,
          role: messages.role,
          content: messages.content,
          createdAt: messages.createdAt,
        });
      if (!assistant) throw new Error('Assistant message insert returned no row');
      if (selected.length) {
        await tx.insert(messageCitations).values(
          selected.map((match, index) => ({
            messageId: assistant.id,
            chunkId: match.chunkId,
            citationOrder: index,
            excerpt: match.content,
          })),
        );
      }
      await tx.update(chats).set({ updatedAt: now }).where(eq(chats.id, chatId));
      return {
        ...assistant,
        citations: selected.map((match, index) => ({
          chunkId: match.chunkId,
          documentId: match.documentId,
          documentTitle: match.documentTitle,
          headingPath: match.headingPath,
          startLine: match.startLine,
          endLine: match.endLine,
          citationOrder: index,
          excerpt: match.content,
        })),
        artifact,
      };
    });
  };

  const sendMessage = async ({
    chatId,
    fundId,
    portcoId,
    content,
  }: { chatId: string } & ChatScope & { content: string }): Promise<Message> => {
    const cleanContent = content.trim();
    if (!cleanContent) throw new ChatModuleError('Message content is required', 'invalid_input');
    if (new TextEncoder().encode(cleanContent).byteLength > maxInitialMessageBytes) {
      throw new ChatModuleError('Message is too large', 'invalid_input');
    }
    await getChat({ chatId, fundId, portcoId });
    const now = new Date();
    await db.transaction(async (tx) => {
      // Lock the chat so concurrent follow-ups cannot both pass the pending check.
      await tx.select({ id: chats.id }).from(chats).where(eq(chats.id, chatId)).for('update');
      const [latest] = await tx
        .select({ role: messages.role })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(1);
      if (latest?.role === 'user') {
        throw new ChatModuleError('Chat has a pending user message', 'conflict');
      }
      await tx
        .insert(messages)
        .values({ id: createId(), chatId, role: 'user', content: cleanContent, createdAt: now });
      await tx.update(chats).set({ updatedAt: now }).where(eq(chats.id, chatId));
    });
    return answerChat({ chatId, fundId, portcoId });
  };

  return { listChats, createChat, getChat, deleteChat, answerChat, sendMessage };
};
