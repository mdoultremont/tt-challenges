import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeChunk } from '../knowledge/index.js';
import {
  assembleExecBrief,
  mergeRetrievedChunks,
  renderExecBriefMarkdown,
  type ExecBriefDraft,
} from './brief.js';

const chunk = (id: string, documentId: string, docType: string): KnowledgeChunk => ({
  chunkId: id,
  documentId,
  documentTitle: `Doc ${documentId}`,
  content: `Passage ${id}`,
  headingPath: ['Priya Nair'],
  startLine: 10,
  endLine: 20,
  similarity: 0.8,
  sourceKind: 'seed',
  documentMetadata: { frontmatter: { doc_type: docType, date: '2026-05-22T00:00:00.000Z' } },
});

const labeled = [
  { label: 'S1', chunk: chunk('c1', 'assessment', 'leadership-assessment') },
  { label: 'S2', chunk: chunk('c2', '360', '360-feedback') },
  { label: 'S3', chunk: chunk('c3', 'assessment', 'leadership-assessment') },
];
const assemble = (draft: ExecBriefDraft) =>
  assembleExecBrief({
    draft,
    labeled,
    subjectName: 'Priya Nair',
    portco: { id: 'p2', code: 'PC2', name: 'Cascade Care Group' },
    generatedAt: new Date('2026-09-17T10:00:00Z'),
    model: 'test-model',
  });

test('drops claims with unknown, missing or empty citations and counts them', () => {
  const brief = assemble({
    role: { text: 'COO [S1]', citationIds: ['S1'] },
    sections: [
      {
        key: 'verdict',
        claims: [
          { text: 'Ready-now CEO successor', citationIds: ['S1'] },
          { text: 'Invented claim', citationIds: ['S9'] },
          { text: 'Partly invented', citationIds: ['S1', 'S9'] },
          { text: 'Uncited claim', citationIds: [] },
        ],
      },
    ],
    flags: [{ text: '   ', citationIds: ['S2'] }],
  });
  assert.equal(brief.subject.role?.text, 'COO');
  assert.deepEqual(brief.sections.find((section) => section.key === 'verdict')?.claims, [
    { text: 'Ready-now CEO successor', citations: [1] },
  ]);
  assert.equal(brief.flags.length, 0);
  assert.equal(brief.droppedClaimCount, 4);
});

test('keeps every section and computes strength from distinct documents', () => {
  const brief = assemble({
    role: null,
    sections: [
      { key: 'verdict', claims: [{ text: 'Scores 4.0', citationIds: ['S1', 'S3'] }] },
      {
        key: 'leadership',
        claims: [
          { text: 'Highest 360 scores', citationIds: ['S2'] },
          { text: 'Builds operators', citationIds: ['S1'] },
        ],
      },
    ],
    flags: [],
  });
  const byKey = new Map(brief.sections.map((section) => [section.key, section]));
  assert.equal(brief.sections.length, 8);
  assert.equal(byKey.get('verdict')?.strength, 'single_source');
  assert.equal(byKey.get('leadership')?.strength, 'corroborated');
  assert.equal(byKey.get('leadership')?.sourceDocumentCount, 2);
  assert.equal(byKey.get('financial')?.strength, 'gap');
});

test('numbers sources by first use and records their provenance', () => {
  const brief = assemble({
    role: null,
    sections: [{ key: 'verdict', claims: [{ text: 'Claim', citationIds: ['S2', 'S1', 'S2'] }] }],
    flags: [{ text: 'Flag', citationIds: ['S1'] }],
  });
  assert.deepEqual(brief.sections[0].claims[0].citations, [1, 2]);
  assert.deepEqual(brief.flags[0].citations, [2]);
  assert.deepEqual(
    brief.sources.map((source) => [source.chunkId, source.provenance, source.documentDate]),
    [
      ['c2', 'Multi-rater 360', '2026-05-22'],
      ['c1', 'Independent assessment', '2026-05-22'],
    ],
  );
});

test('renders gaps visibly and cites every statement', () => {
  const markdown = renderExecBriefMarkdown(
    assemble({
      role: null,
      sections: [{ key: 'verdict', claims: [{ text: 'Scores 4.0', citationIds: ['S1'] }] }],
      flags: [],
    }),
  );
  assert.match(markdown, /^---\ndoc_type: exec-brief\n/);
  assert.match(markdown, /- Scores 4\.0 \[1\]/);
  assert.match(markdown, /## Financial acumen\n\n_Evidence: gap\./);
  assert.match(markdown, /1\. Doc assessment, Priya Nair, lines 10-20 \(Independent assessment/);
});

test('merges per-section results without duplicates, up to the maximum', () => {
  const [a, b, c] = labeled.map((item) => item.chunk);
  const merged = mergeRetrievedChunks([[a, b], [b, c], [a]], 2);
  assert.deepEqual(
    merged.map((item) => item.chunkId),
    ['c1', 'c2'],
  );
});
