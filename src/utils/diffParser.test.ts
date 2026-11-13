import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySuggestedFix,
  codeSnippetToDiffLines,
  computeDiffStats,
  parseUnifiedDiff,
} from './diffParser';
import type { ChangedFile, ReviewFinding } from '../types';

test('parseUnifiedDiff tracks old and new line numbers accurately', () => {
  const raw = [
    '@@ -10,4 +10,5 @@',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 3;',
    '+const c = 4;',
    ' return a + b;',
  ].join('\n');

  const lines = parseUnifiedDiff(raw);
  assert.equal(lines.length, 5);
  assert.deepEqual(lines[0], { type: 'context', oldLine: 10, newLine: 10, content: 'const a = 1;' });
  assert.deepEqual(lines[1], { type: 'del', oldLine: 11, content: 'const b = 2;' });
  assert.deepEqual(lines[2], { type: 'add', newLine: 11, content: 'const b = 3;' });
  assert.deepEqual(lines[3], { type: 'add', newLine: 12, content: 'const c = 4;' });
  assert.deepEqual(lines[4], { type: 'context', oldLine: 12, newLine: 13, content: 'return a + b;' });
});

test('computeDiffStats counts files, additions, and deletions', () => {
  const files: ChangedFile[] = [
    {
      path: 'src/a.ts',
      language: 'ts',
      summary: 'Update A',
      lines: [
        { type: 'add', newLine: 1, content: 'x' },
        { type: 'add', newLine: 2, content: 'y' },
        { type: 'del', oldLine: 1, content: 'z' },
      ],
    },
    {
      path: 'src/b.ts',
      language: 'ts',
      summary: 'Update B',
      lines: [{ type: 'context', oldLine: 1, newLine: 1, content: 'ok' }],
    },
  ];

  assert.deepEqual(computeDiffStats(files), {
    filesChanged: 2,
    additions: 2,
    deletions: 1,
  });
});

test('applySuggestedFix replaces targeted newLine and renumbers cleanly', () => {
  const file: ChangedFile = {
    path: 'src/auth.ts',
    language: 'ts',
    summary: 'Auth handler',
    lines: [
      { type: 'context', oldLine: 1, newLine: 1, content: 'function verify(a: string, b: string) {' },
      { type: 'add', newLine: 2, content: '  return a === b;' },
      { type: 'context', oldLine: 3, newLine: 3, content: '}' },
    ],
  };

  const finding: ReviewFinding = {
    id: 'f1',
    filePath: 'src/auth.ts',
    line: 2,
    severity: 'critical',
    title: 'Use constant-time comparison',
    rationale: 'Prevents timing side-channel attacks.',
    status: 'open',
    suggestedCode: '  return timingSafeEqual(Buffer.from(a), Buffer.from(b));',
  };

  const updated = applySuggestedFix(file, finding);
  assert.equal(updated.lines.length, 4);
  assert.equal(updated.lines[1].type, 'del');
  assert.equal(updated.lines[1].content, '  return a === b;');
  assert.equal(updated.lines[2].type, 'add');
  assert.equal(updated.lines[2].newLine, 2);
  assert.equal(updated.lines[3].newLine, 3);
});

test('codeSnippetToDiffLines numbers plain snippet sequentially', () => {
  const lines = codeSnippetToDiffLines('const x = 1;\nconst y = 2;');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].newLine, 1);
  assert.equal(lines[1].newLine, 2);
  assert.equal(lines[1].type, 'add');
});
