import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { validator } from 'hono/validator';
import { ArtifactModuleError, createArtifactsModule } from './modules/artifacts/index.js';
import { ChatModuleError, createChatsModule } from './modules/chats/index.js';
import { DocumentModuleError, createDocumentsModule } from './modules/documents/index.js';
import { ScopeModuleError, createScopesModule } from './modules/scopes/index.js';

const maxRequestBytes = 5 * 1024 * 1024 + 64 * 1024;
const documents = createDocumentsModule();
const scopes = createScopesModule();
const chats = createChatsModule();
const artifacts = createArtifactsModule();

type DomainError = DocumentModuleError | ScopeModuleError | ChatModuleError | ArtifactModuleError;
type HttpStatus = 400 | 404 | 409 | 413 | 415 | 422 | 503;
const statusFor = (error: DomainError): HttpStatus => {
  if (error.code === 'not_found') return 404;
  if (error.code === 'conflict') return 409;
  if (error.code === 'unsupported_type') return 415;
  if (error.code === 'too_large') return 413;
  if (error.code === 'queue_unavailable' || error.code === 'storage_unavailable') return 503;
  if (error.code === 'model_unavailable') return 503;
  if (error.code === 'insufficient_evidence') return 422;
  return 400;
};
const domainError = (error: unknown): error is DomainError =>
  error instanceof DocumentModuleError ||
  error instanceof ScopeModuleError ||
  error instanceof ChatModuleError ||
  error instanceof ArtifactModuleError;

const scopeQuery = validator('query', (value: { fundId?: string; portcoId?: string }, c) => {
  const { fundId, portcoId } = value;
  if (typeof fundId !== 'string' || !fundId) {
    return c.json({ error: 'fundId is required' }, 400);
  }
  if (portcoId !== undefined && typeof portcoId !== 'string') {
    return c.json({ error: 'portcoId must be a single value' }, 400);
  }
  return { fundId, portcoId };
});

export const app = new Hono()
  .use('*', cors({ origin: 'http://localhost:3000' }))
  .get('/health', (c) => c.json({ status: 'ok' }))
  .get('/funds', async (c) => c.json({ data: await scopes.listFunds() }))
  .get('/funds/:fundId/portcos', async (c) => {
    try {
      return c.json({ data: await scopes.listPortcos(c.req.param('fundId')) });
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .get('/scopes/:type/:slug', async (c) => {
    try {
      return c.json({ data: await scopes.resolveScope(c.req.param('type'), c.req.param('slug')) });
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .post(
    '/documents',
    bodyLimit({
      maxSize: maxRequestBytes,
      onError: (c) => c.json({ error: 'Document exceeds the 5 MB limit' }, 413),
    }),
    async (c) => {
      let form: FormData;
      try {
        form = await c.req.raw.formData();
      } catch {
        return c.json({ error: 'Expected multipart form data' }, 400);
      }
      const file = form.get('file');
      const fundId = form.get('fundId');
      const portcoId = form.get('portcoId');
      const title = form.get('title');
      if (!(file instanceof File)) return c.json({ error: 'A file is required' }, 400);
      if (typeof fundId !== 'string' || (portcoId !== null && typeof portcoId !== 'string'))
        return c.json({ error: 'fundId and portcoId must be text fields' }, 400);
      if (title !== null && typeof title !== 'string')
        return c.json({ error: 'title must be a text field' }, 400);
      try {
        const document = await documents.createDocument({
          fundId,
          portcoId: portcoId || null,
          title,
          filename: file.name,
          mimeType: file.type,
          body: new Uint8Array(await file.arrayBuffer()),
        });
        return c.json({ data: document }, 201);
      } catch (error) {
        if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
        throw error;
      }
    },
  )
  .get('/documents', async (c) => {
    const fundId = c.req.query('fundId');
    if (!fundId) return c.json({ error: 'fundId is required' }, 400);
    try {
      return c.json({
        data: await documents.listDocuments({ fundId, portcoId: c.req.query('portcoId') }),
      });
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .get('/documents/:documentId', scopeQuery, async (c) => {
    const { fundId, portcoId } = c.req.valid('query');
    try {
      return c.json({
        data: await documents.getDocument({
          documentId: c.req.param('documentId'),
          fundId,
          portcoId,
        }),
      });
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .delete('/documents/:documentId', scopeQuery, async (c) => {
    const { fundId, portcoId } = c.req.valid('query');
    try {
      await documents.deleteDocument({
        documentId: c.req.param('documentId'),
        fundId,
        portcoId,
      });
      return c.body(null, 204);
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .get('/chats', scopeQuery, async (c) => {
    const { fundId, portcoId } = c.req.valid('query');
    try {
      return c.json({
        data: await chats.listChats({ fundId, portcoId }),
      });
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .post('/chats', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Expected a JSON body' }, 400);
    }
    if (!body || typeof body !== 'object') return c.json({ error: 'Expected a JSON object' }, 400);
    const input = body as Record<string, unknown>;
    if (typeof input.fundId !== 'string' || typeof input.initialMessage !== 'string') {
      return c.json({ error: 'fundId and initialMessage are required text fields' }, 400);
    }
    if (
      input.portcoId !== undefined &&
      input.portcoId !== null &&
      typeof input.portcoId !== 'string'
    ) {
      return c.json({ error: 'portcoId must be a text field' }, 400);
    }
    if (input.title !== undefined && input.title !== null && typeof input.title !== 'string') {
      return c.json({ error: 'title must be a text field' }, 400);
    }
    try {
      return c.json(
        {
          data: await chats.createChat({
            fundId: input.fundId,
            portcoId: (input.portcoId as string | null | undefined) ?? null,
            initialMessage: input.initialMessage,
            title: (input.title as string | null | undefined) ?? null,
          }),
        },
        201,
      );
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .get('/chats/:chatId', scopeQuery, async (c) => {
    const { fundId, portcoId } = c.req.valid('query');
    try {
      return c.json({
        data: await chats.getChat({
          chatId: c.req.param('chatId'),
          fundId,
          portcoId,
        }),
      });
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .post('/chats/:chatId/answer', scopeQuery, async (c) => {
    const { fundId, portcoId } = c.req.valid('query');
    try {
      return c.json({
        data: await chats.answerChat({
          chatId: c.req.param('chatId'),
          fundId,
          portcoId,
        }),
      });
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .post(
    '/chats/:chatId/messages',
    scopeQuery,
    validator('json', (value: { content?: string }, c) => {
      if (!value || typeof value !== 'object' || typeof value.content !== 'string') {
        return c.json({ error: 'content is required as a text field' }, 400);
      }
      return { content: value.content };
    }),
    async (c) => {
      const { fundId, portcoId } = c.req.valid('query');
      const { content } = c.req.valid('json');
      try {
        return c.json({
          data: await chats.sendMessage({
            chatId: c.req.param('chatId'),
            fundId,
            portcoId,
            content,
          }),
        });
      } catch (error) {
        if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
        throw error;
      }
    },
  )
  .delete('/chats/:chatId', scopeQuery, async (c) => {
    const { fundId, portcoId } = c.req.valid('query');
    try {
      await chats.deleteChat({
        chatId: c.req.param('chatId'),
        fundId,
        portcoId,
      });
      return c.body(null, 204);
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .post(
    '/artifacts',
    validator(
      'json',
      (
        value: {
          type?: string;
          fundId?: string;
          portcoId?: string;
          subjectName?: string;
          role?: string | null;
          chatId?: string | null;
        },
        c,
      ) => {
        if (!value || typeof value !== 'object') {
          return c.json({ error: 'Expected a JSON object' }, 400);
        }
        if (value.type !== 'exec_brief') {
          return c.json({ error: 'type must be exec_brief' }, 400);
        }
        if (
          typeof value.fundId !== 'string' ||
          typeof value.portcoId !== 'string' ||
          typeof value.subjectName !== 'string'
        ) {
          return c.json(
            { error: 'fundId, portcoId and subjectName are required text fields' },
            400,
          );
        }
        if (value.role != null && typeof value.role !== 'string') {
          return c.json({ error: 'role must be a text field' }, 400);
        }
        if (value.chatId != null && typeof value.chatId !== 'string') {
          return c.json({ error: 'chatId must be a text field' }, 400);
        }
        return {
          fundId: value.fundId,
          portcoId: value.portcoId,
          subjectName: value.subjectName,
          role: value.role ?? null,
          chatId: value.chatId ?? null,
        };
      },
    ),
    async (c) => {
      try {
        return c.json({ data: await artifacts.generateExecBrief(c.req.valid('json')) }, 201);
      } catch (error) {
        if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
        throw error;
      }
    },
  )
  .get('/artifacts', scopeQuery, async (c) => {
    try {
      return c.json({ data: await artifacts.listArtifacts(c.req.valid('query')) });
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .get('/artifacts/:artifactId', scopeQuery, async (c) => {
    try {
      return c.json({
        data: await artifacts.getArtifact({
          artifactId: c.req.param('artifactId'),
          ...c.req.valid('query'),
        }),
      });
    } catch (error) {
      if (domainError(error)) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  })
  .get('/dump', (c) =>
    c.json({
      message: 'Frontend-to-backend RPC is working.',
      service: 'second-brain-api',
      checkedAt: new Date().toISOString(),
    }),
  )
  .notFound((c) => c.json({ error: 'Not found' }, 404))
  .onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Internal server error' }, 500);
  });

export type AppType = typeof app;
