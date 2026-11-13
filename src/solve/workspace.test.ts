import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLineDiff, redactLogText, WorkspaceSnapshot } from './workspace';

test('WorkspaceSnapshot indexes files and performs fast full-repo search', () => {
  const ws = new WorkspaceSnapshot('acme-corp/payments-api');
  const index = ws.indexFiles();
  assert.ok(index.length >= 6);
  assert.ok(index.some((f) => f.path === 'src/webhooks/verifyStripeSignature.ts'));

  const matches = ws.searchCode('timingSafeEqual');
  assert.equal(matches.length, 0);

  const hmacMatches = ws.searchCode('createHmac');
  assert.equal(hmacMatches.length, 1);
  assert.equal(hmacMatches[0].path, 'src/webhooks/verifyStripeSignature.ts');
});

test('WorkspaceSnapshot returns recoverable diagnostics on anchor mismatch instead of throwing', () => {
  const ws = new WorkspaceSnapshot('acme-corp/payments-api');
  const bad = ws.applyEdit({
    path: 'src/webhooks/verifyStripeSignature.ts',
    replacements: [{ before: 'nonexistent anchor line', after: 'new line' }],
  });

  assert.equal(bad.ok, false);
  assert.match(bad.recoverableError || '', /Anchor #1 not found/);
  assert.equal(ws.hasChanges(), false);

  const missing = ws.readLines('src/does-not-exist.ts', 1, 20);
  assert.equal(missing.ok, false);
  assert.match(missing.error || '', /does not exist/);
});

test('WorkspaceSnapshot applies exact anchor edits and computes accurate line diffs', () => {
  const ws = new WorkspaceSnapshot('acme-corp/payments-api');
  const applied = ws.applyEdit({
    path: 'src/webhooks/verifyStripeSignature.ts',
    summary: 'Switch comparison to timingSafeEqual',
    replacements: [
      {
        before: '  return sig === expected;',
        after: '  return sig !== undefined && sig === expected;',
      },
    ],
  });

  assert.equal(applied.ok, true);
  assert.equal(ws.hasChanges(), true);

  const diffs = ws.computeChangedFiles();
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].path, 'src/webhooks/verifyStripeSignature.ts');
  assert.ok(diffs[0].lines.some((l) => l.type === 'del' && l.content.includes('sig === expected')));
  assert.ok(diffs[0].lines.some((l) => l.type === 'add' && l.content.includes('sig !== undefined')));
});

test('computeLineDiff and redactLogText preserve line numbers and scrub secrets', () => {
  const diff = computeLineDiff('a\nb\nc', 'a\nb2\nc\nd');
  assert.equal(diff.filter((l) => l.type === 'add').length, 2);
  assert.equal(diff.filter((l) => l.type === 'del').length, 1);

  const scrubbed = redactLogText('Authorization: Bearer ghp_1234567890abcdef token sk_live_9999999999');
  assert.doesNotMatch(scrubbed, /ghp_1234567890abcdef/);
  assert.doesNotMatch(scrubbed, /sk_live_9999999999/);
});
