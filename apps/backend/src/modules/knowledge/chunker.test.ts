import assert from 'node:assert/strict';
import test from 'node:test';
import { splitMarkdown } from './chunker.js';

test('tracks heading hierarchy and ignores fenced headings', async () => {
  const source = [
    '---',
    'fund: DAW',
    '---',
    '# Fund',
    'intro',
    '## Section',
    '```markdown',
    '# This is code',
    '```',
    'evidence',
  ].join('\n');
  const result = await splitMarkdown(source);

  assert.deepEqual(
    result.chunks.map((chunk) => chunk.headingPath),
    [['Fund'], ['Fund', 'Section']],
  );
  assert.deepEqual(result.frontmatter, { fund: 'DAW' });
  for (const chunk of result.chunks) {
    assert.equal(source.slice(chunk.startChar, chunk.endChar), chunk.content);
    assert.ok(chunk.startLine <= chunk.endLine);
  }
});

test('splits oversized Markdown sections with overlap', async () => {
  const source = `# Long section\n\n${'word '.repeat(500)}`;
  const result = await splitMarkdown(source);

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.every((chunk) => chunk.content.length <= 800));
  assert.equal(
    source.slice(result.chunks[0].startChar, result.chunks[0].endChar),
    result.chunks[0].content,
  );
});

test('keeps heading paths dense when levels are skipped', async () => {
  const result = await splitMarkdown('# Root\n### Skipped level\ntext');

  assert.deepEqual(
    result.chunks.map((chunk) => chunk.headingPath),
    [['Root'], ['Root', 'Skipped level']],
  );
  assert.ok(result.chunks.every((chunk) => chunk.headingPath.every(Boolean)));
});
