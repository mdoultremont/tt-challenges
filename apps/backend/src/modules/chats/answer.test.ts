import assert from 'node:assert/strict';
import test from 'node:test';
import {
  briefCreatedReply,
  buildRetrievalQuery,
  chooseBriefPortco,
  insufficientEvidenceAnswer,
  renumberCitationMarkers,
  validateGroundedAnswer,
} from './answer.js';

test('falls back when any citation label was not supplied as evidence', () => {
  const result = validateGroundedAnswer(
    { answer: 'Supported claim', citationIds: ['S1', 'S9'], insufficientEvidence: false },
    new Set(['S1', 'S2']),
  );
  assert.equal(result.answer, insufficientEvidenceAnswer);
  assert.deepEqual(result.citationIds, []);
});

test('deduplicates valid citation labels while preserving order', () => {
  const result = validateGroundedAnswer(
    { answer: 'Supported claim', citationIds: ['S2', 'S1', 'S2'], insufficientEvidence: false },
    new Set(['S1', 'S2']),
  );
  assert.equal(result.answer, 'Supported claim');
  assert.deepEqual(result.citationIds, ['S2', 'S1']);
});

test('replaces sufficient prose without valid citations with insufficient evidence', () => {
  const result = validateGroundedAnswer(
    { answer: 'Unsupported claim', citationIds: ['S9'], insufficientEvidence: false },
    new Set(['S1']),
  );
  assert.equal(result.answer, insufficientEvidenceAnswer);
  assert.deepEqual(result.citationIds, []);
});

test('retrieval query uses every user turn, newest first', () => {
  const query = buildRetrievalQuery([
    { role: 'user', content: 'Who leads finance at Cascade?' },
    { role: 'assistant', content: 'The CFO is Jane Doe [S1].' },
    { role: 'user', content: '  How long has she been in the role?  ' },
  ]);
  assert.equal(query, 'How long has she been in the role?\nWho leads finance at Cascade?');
});

test('retrieval query ignores assistant and blank turns', () => {
  const query = buildRetrievalQuery([
    { role: 'assistant', content: 'Earlier answer' },
    { role: 'user', content: '   ' },
    { role: 'user', content: 'Only question' },
  ]);
  assert.equal(query, 'Only question');
});

test('renumbers evidence labels to follow citation order', () => {
  assert.equal(
    renumberCitationMarkers('Joined in 2021 [S3]. Leads integration [S1, S3] and (S1).', [
      'S3',
      'S1',
    ]),
    'Joined in 2021 [1]. Leads integration [2][1] and [2].',
  );
});

test('removes labels that were not kept as citations', () => {
  assert.equal(renumberCitationMarkers('Claim [S2] [S5].', ['S2']), 'Claim [1].');
});

const vantage = { id: 'p1', code: 'PC1', name: 'Vantage Managed Services' };
const cascade = { id: 'p2', code: 'PC2', name: 'Cascade Care Group' };

test('brief portco resolves when one company names the executive', () => {
  assert.deepEqual(chooseBriefPortco([cascade]), { kind: 'resolved', portco: cascade });
  assert.deepEqual(chooseBriefPortco([]), { kind: 'none' });
});

test('brief portco asks when several companies name the executive', () => {
  assert.deepEqual(chooseBriefPortco([vantage, cascade]), {
    kind: 'ambiguous',
    portcos: [vantage, cascade],
  });
});

test('a named portco narrows candidates but cannot add one without evidence', () => {
  assert.deepEqual(chooseBriefPortco([vantage, cascade], 'cascade'), {
    kind: 'resolved',
    portco: cascade,
  });
  assert.deepEqual(chooseBriefPortco([vantage, cascade], 'PC1'), {
    kind: 'resolved',
    portco: vantage,
  });
  // Never silently switch to another company: that is how two executives get merged.
  assert.deepEqual(chooseBriefPortco([vantage], 'Ridgeline'), {
    kind: 'ambiguous',
    portcos: [vantage],
  });
});

test('brief reply summarizes evidence strength', () => {
  const reply = briefCreatedReply({
    subject: { name: 'Priya Nair' },
    portco: { name: 'Cascade Care Group' },
    sections: [{ strength: 'corroborated' }, { strength: 'single_source' }, { strength: 'gap' }],
    flags: [{}, {}],
    droppedClaimCount: 1,
  });
  assert.match(reply, /Evidence by section: 1 corroborated, 1 single source, 1 gap/);
  assert.match(reply, /Flags for the reader: 2/);
});
