import assert from 'node:assert/strict';
import test from 'node:test';
import { KnowledgeModuleError, createKnowledgeModuleInternal } from './module.js';

const fundId = '00000000-0000-4000-8000-000000000001';

const fakeDatabase = (rows: Array<Record<string, unknown>> = []) => {
  let selection = 0;
  return {
    select() {
      selection += 1;
      if (selection === 1) {
        return {
          from: () => ({ where: async () => [{ id: fundId }] }),
        };
      }
      return {
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: () => ({ limit: async () => rows }),
            }),
          }),
        }),
      };
    },
  };
};

test('rejects a blank query before accessing dependencies', async () => {
  let embedded = false;
  const module = createKnowledgeModuleInternal({
    db: {
      select: () => {
        throw new Error('database should not be accessed');
      },
    } as never,
    embedQuery: async () => {
      embedded = true;
      return [];
    },
  });

  await assert.rejects(
    module.getChunksFromQuery({ fundId }, '   '),
    (error: unknown) => error instanceof KnowledgeModuleError && error.code === 'invalid_input',
  );
  assert.equal(embedded, false);
});

test('embeds the normalized query and returns ranked chunks', async () => {
  const embeddedQueries: string[] = [];
  const rows = [
    {
      chunkId: 'chunk-1',
      documentId: 'document-1',
      documentTitle: 'Investment memo',
      content: 'Relevant evidence',
      headingPath: ['Summary'],
      startLine: 4,
      endLine: 7,
      similarity: '0.81',
    },
  ];
  const module = createKnowledgeModuleInternal({
    db: fakeDatabase(rows) as never,
    embedQuery: async (query) => {
      embeddedQueries.push(query);
      return [0.1, 0.2];
    },
  });

  const chunks = await module.getChunksFromQuery({ fundId }, '  succession plan  ');

  assert.deepEqual(embeddedQueries, ['succession plan']);
  assert.deepEqual(chunks, [{ ...rows[0], similarity: 0.81 }]);
});
