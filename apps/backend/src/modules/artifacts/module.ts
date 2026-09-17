import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, ne } from 'drizzle-orm';
import { db as defaultDb } from '../../db/client.js';
import {
  artifactCitations,
  artifacts,
  chats,
  documentChunks,
  documents,
  portcos,
} from '../../db/schema.js';
import { createElasticMqQueue, type DocumentQueue } from '../documents/queue.js';
import { createMinioStorage, type DocumentStorage } from '../documents/storage.js';
import { getChunksFromQuery as defaultGetChunksFromQuery } from '../knowledge/index.js';
import {
  assembleExecBrief,
  buildExecBriefPrompt,
  createAnthropicBriefModel,
  execBriefPromptVersion,
  execBriefSections,
  execBriefTitle,
  hasSupportedClaims,
  mergeRetrievedChunks,
  renderExecBriefMarkdown,
  type BriefModel,
  type ExecBrief,
} from './brief.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxSubjectLength = 120;
const chunksPerSection = 6;
const maxEvidenceChunks = 40;

export type ArtifactScope = { fundId: string; portcoId?: string | null };
export type GenerateExecBriefInput = {
  fundId: string;
  portcoId: string;
  subjectName: string;
  role?: string | null;
  /** The chat the brief was requested from, when there is one. */
  chatId?: string | null;
};
export type ArtifactSummary = {
  id: string;
  type: 'candidate_profile' | 'search_comparison' | 'exec_brief' | 'portco_brief';
  chatId: string | null;
  generatedAt: Date;
  document: {
    id: string;
    fundId: string;
    portcoId: string | null;
    title: string;
    status: 'queued' | 'processing' | 'ready' | 'failed';
    errorMessage: string | null;
  };
};
export type ArtifactDetails = ArtifactSummary & { brief: ExecBrief };
export type ArtifactErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'insufficient_evidence'
  | 'model_unavailable'
  | 'storage_unavailable';

export class ArtifactModuleError extends Error {
  constructor(
    message: string,
    readonly code: ArtifactErrorCode,
  ) {
    super(message);
    this.name = 'ArtifactModuleError';
  }
}

type ArtifactDatabase = typeof defaultDb;
export type ArtifactsModule = ReturnType<typeof createArtifactsModuleInternal>;

const assertUuid = (value: string, label: string) => {
  if (!uuidPattern.test(value)) throw new ArtifactModuleError(`Invalid ${label}`, 'invalid_input');
};
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);
const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .slice(0, 60) || 'executive';

export const createArtifactsModuleInternal = ({
  db = defaultDb,
  storage = createMinioStorage(),
  queue = createElasticMqQueue(),
  getChunksFromQuery = defaultGetChunksFromQuery,
  briefModel = createAnthropicBriefModel(),
  createId = randomUUID,
}: {
  db?: ArtifactDatabase;
  storage?: DocumentStorage;
  queue?: DocumentQueue;
  getChunksFromQuery?: typeof defaultGetChunksFromQuery;
  briefModel?: BriefModel;
  createId?: () => string;
} = {}) => {
  const summaryColumns = {
    id: artifacts.id,
    type: artifacts.type,
    chatId: artifacts.chatId,
    generatedAt: artifacts.generatedAt,
    documentId: documents.id,
    fundId: documents.fundId,
    portcoId: documents.portcoId,
    title: documents.title,
    status: documents.status,
    errorMessage: documents.errorMessage,
  };
  const toSummary = (row: {
    id: string;
    type: ArtifactSummary['type'];
    chatId: string | null;
    generatedAt: Date;
    documentId: string;
    fundId: string;
    portcoId: string | null;
    title: string;
    status: ArtifactSummary['document']['status'];
    errorMessage: string | null;
  }): ArtifactSummary => ({
    id: row.id,
    type: row.type,
    chatId: row.chatId,
    generatedAt: row.generatedAt,
    document: {
      id: row.documentId,
      fundId: row.fundId,
      portcoId: row.portcoId,
      title: row.title,
      status: row.status,
      errorMessage: row.errorMessage,
    },
  });
  const scopeFilter = ({ fundId, portcoId }: ArtifactScope) =>
    portcoId
      ? and(eq(documents.fundId, fundId), eq(documents.portcoId, portcoId))
      : eq(documents.fundId, fundId);

  const getPortco = async (fundId: string, portcoId: string) => {
    const [portco] = await db
      .select({ id: portcos.id, code: portcos.code, name: portcos.name })
      .from(portcos)
      .where(and(eq(portcos.id, portcoId), eq(portcos.fundId, fundId)));
    if (!portco) throw new ArtifactModuleError('Portco not found for fund', 'not_found');
    return portco;
  };

  /** A fund chat covers every portco in the fund; a portco chat covers only its own. */
  const assertChatCoversPortco = async (chatId: string, fundId: string, portcoId: string) => {
    assertUuid(chatId, 'chat id');
    const [chat] = await db
      .select({ portcoId: chats.portcoId })
      .from(chats)
      .where(and(eq(chats.id, chatId), eq(chats.fundId, fundId)));
    if (!chat || (chat.portcoId !== null && chat.portcoId !== portcoId)) {
      throw new ArtifactModuleError('Chat not found for this portco', 'not_found');
    }
  };

  /** Refuses before calling the model when no primary source in the portco names the executive. */
  const assertSubjectIsMentioned = async (portcoId: string, subjectName: string) => {
    const [mention] = await db
      .select({ id: documentChunks.id })
      .from(documentChunks)
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .where(
        and(
          eq(documents.portcoId, portcoId),
          eq(documents.status, 'ready'),
          ne(documents.sourceKind, 'generated'),
          ilike(documentChunks.content, `%${escapeLike(subjectName)}%`),
        ),
      )
      .limit(1);
    if (!mention) {
      throw new ArtifactModuleError(
        `No ready document in this portco mentions ${subjectName}`,
        'insufficient_evidence',
      );
    }
  };

  /**
   * Finds the portcos whose primary sources name the executive. A fund chat uses
   * this to pick the brief's portco; more than one match must be settled by the user.
   */
  const findPortcosMentioning = async ({
    fundId,
    subjectName,
  }: {
    fundId: string;
    subjectName: string;
  }): Promise<Array<{ id: string; code: string; name: string }>> => {
    assertUuid(fundId, 'fund id');
    const name = subjectName.replace(/\s+/g, ' ').trim();
    if (!name) return [];
    return db
      .selectDistinct({ id: portcos.id, code: portcos.code, name: portcos.name })
      .from(documentChunks)
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .innerJoin(portcos, eq(documents.portcoId, portcos.id))
      .where(
        and(
          eq(documents.fundId, fundId),
          eq(documents.status, 'ready'),
          ne(documents.sourceKind, 'generated'),
          ilike(documentChunks.content, `%${escapeLike(name)}%`),
        ),
      )
      .orderBy(asc(portcos.code));
  };

  const generateExecBrief = async (input: GenerateExecBriefInput): Promise<ArtifactDetails> => {
    assertUuid(input.fundId, 'fund id');
    assertUuid(input.portcoId, 'portco id');
    const subjectName = input.subjectName.replace(/\s+/g, ' ').trim();
    const role = input.role?.replace(/\s+/g, ' ').trim() || null;
    if (!subjectName) throw new ArtifactModuleError('subjectName is required', 'invalid_input');
    if (subjectName.length > maxSubjectLength || (role && role.length > maxSubjectLength)) {
      throw new ArtifactModuleError(
        `subjectName and role must be at most ${maxSubjectLength} characters`,
        'invalid_input',
      );
    }
    const portco = await getPortco(input.fundId, input.portcoId);
    if (input.chatId) await assertChatCoversPortco(input.chatId, input.fundId, portco.id);
    await assertSubjectIsMentioned(portco.id, subjectName);

    const scope = { fundId: input.fundId, portcoId: portco.id };
    const subjectQuery = role ? `${subjectName}, ${role}` : subjectName;
    const resultSets = await Promise.all(
      execBriefSections.map((section) =>
        getChunksFromQuery(scope, `${subjectQuery}: ${section.query}`, {
          limit: chunksPerSection,
          excludeGenerated: true,
        }),
      ),
    );
    const evidence = mergeRetrievedChunks(resultSets, maxEvidenceChunks);
    if (!evidence.length) {
      throw new ArtifactModuleError(
        `No evidence about ${subjectName} was retrieved`,
        'insufficient_evidence',
      );
    }
    const labeled = evidence.map((chunk, index) => ({ label: `S${index + 1}`, chunk }));

    let draft;
    try {
      draft = await briefModel.invoke(
        buildExecBriefPrompt({ subjectName, role, portcoName: portco.name, labeled }),
      );
    } catch (error) {
      console.error('Executive brief model failed', error);
      throw new ArtifactModuleError('The brief model is unavailable', 'model_unavailable');
    }
    const generatedAt = new Date();
    const brief = assembleExecBrief({
      draft,
      labeled,
      subjectName,
      portco,
      generatedAt,
      model: briefModel.modelName,
    });
    if (!hasSupportedClaims(brief)) {
      throw new ArtifactModuleError(
        `The knowledge base does not support a brief on ${subjectName}`,
        'insufficient_evidence',
      );
    }

    const artifactId = createId();
    const documentId = createId();
    const title = execBriefTitle(brief);
    const filename = `exec-brief-${slugify(subjectName)}-${generatedAt.toISOString().slice(0, 10)}.md`;
    const storageKey = `${input.fundId}/${portco.id}/${documentId}-${filename}`;
    try {
      await storage.ensureBucket();
      await storage.put(
        storageKey,
        new TextEncoder().encode(renderExecBriefMarkdown(brief)),
        'text/markdown',
      );
    } catch (error) {
      console.error('Unable to store executive brief', error);
      throw new ArtifactModuleError('The brief could not be stored', 'storage_unavailable');
    }

    const citationRows = [
      ...(brief.subject.role ? [brief.subject.role] : []),
      ...brief.flags,
      ...brief.sections.flatMap((section) => section.claims),
    ].flatMap((claim) =>
      claim.citations.map((number) => ({ claim: claim.text, source: brief.sources[number - 1] })),
    );
    try {
      await db.transaction(async (tx) => {
        await tx.insert(documents).values({
          id: documentId,
          fundId: input.fundId,
          portcoId: portco.id,
          title,
          filename,
          mimeType: 'text/markdown',
          sourceKind: 'generated',
          storageKey,
          status: 'queued',
          metadata: { artifactId, artifactType: 'exec_brief', subjectName },
          createdAt: generatedAt,
          updatedAt: generatedAt,
        });
        await tx.insert(artifacts).values({
          id: artifactId,
          documentId,
          chatId: input.chatId ?? null,
          type: 'exec_brief',
          promptVersion: execBriefPromptVersion,
          generatedAt,
          metadata: brief,
        });
        await tx.insert(artifactCitations).values(
          citationRows.map((row, index) => ({
            artifactId,
            chunkId: row.source.chunkId,
            citationOrder: index,
            claim: row.claim,
            excerpt: row.source.excerpt,
          })),
        );
      });
    } catch (error) {
      try {
        await storage.remove(storageKey);
      } catch (cleanupError) {
        console.error('Unable to remove orphaned brief object', cleanupError);
      }
      throw error;
    }

    // The brief is saved either way; a queue failure is shown on its document status.
    let status: ArtifactSummary['document']['status'] = 'queued';
    let errorMessage: string | null = null;
    try {
      await queue.publish(documentId);
    } catch (error) {
      status = 'failed';
      errorMessage =
        `Queue publication failed: ${error instanceof Error ? error.message : 'unknown queue error'}`.slice(
          0,
          500,
        );
      try {
        const completedAt = new Date();
        await db
          .update(documents)
          .set({ status, errorMessage, completedAt, updatedAt: completedAt })
          .where(eq(documents.id, documentId));
      } catch (markFailedError) {
        console.error('Unable to mark brief queue failure', markFailedError);
      }
    }

    return {
      id: artifactId,
      type: 'exec_brief',
      chatId: input.chatId ?? null,
      generatedAt,
      document: {
        id: documentId,
        fundId: input.fundId,
        portcoId: portco.id,
        title,
        status,
        errorMessage,
      },
      brief,
    };
  };

  const listArtifacts = async (scope: ArtifactScope): Promise<ArtifactSummary[]> => {
    assertUuid(scope.fundId, 'fund id');
    if (scope.portcoId) assertUuid(scope.portcoId, 'portco id');
    const rows = await db
      .select(summaryColumns)
      .from(artifacts)
      .innerJoin(documents, eq(artifacts.documentId, documents.id))
      .where(scopeFilter(scope))
      .orderBy(desc(artifacts.generatedAt), asc(artifacts.id));
    return rows.map(toSummary);
  };

  const getArtifact = async ({
    artifactId,
    ...scope
  }: { artifactId: string } & ArtifactScope): Promise<ArtifactDetails> => {
    assertUuid(artifactId, 'artifact id');
    assertUuid(scope.fundId, 'fund id');
    if (scope.portcoId) assertUuid(scope.portcoId, 'portco id');
    const [row] = await db
      .select({ ...summaryColumns, metadata: artifacts.metadata })
      .from(artifacts)
      .innerJoin(documents, eq(artifacts.documentId, documents.id))
      .where(and(eq(artifacts.id, artifactId), scopeFilter(scope)));
    if (!row) throw new ArtifactModuleError('Artifact not found', 'not_found');
    const { metadata, ...summary } = row;
    return { ...toSummary(summary), brief: metadata as ExecBrief };
  };

  return { generateExecBrief, findPortcosMentioning, listArtifacts, getArtifact };
};
