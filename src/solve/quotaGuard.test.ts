import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearQuotaCooldowns,
  formatDurationShort,
  formatGeminiErrorMessage,
  getActiveQuotaCooldown,
  isQuotaExhaustedError,
  isTransientUpstreamError,
  markQuotaCooldownFromError,
  parseRetryDelaySeconds,
  shouldFallbackUpstreamError,
} from './quotaGuard';

const EXACT_429_PAYLOAD = JSON.stringify({
  error: {
    code: 429,
    message:
      'You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-4-hydrogen.\nPlease retry in 4h36m4.300831312s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.RetryInfo',
        retryDelay: '16564s',
      },
    ],
  },
});

test('detects 429 RESOURCE_EXHAUSTED payload and parses retry delay cleanly', () => {
  const err = new Error(EXACT_429_PAYLOAD);
  assert.equal(isQuotaExhaustedError(err), true);
  assert.equal(shouldFallbackUpstreamError(err), true);
  assert.equal(parseRetryDelaySeconds(err), 16564);
  assert.equal(formatDurationShort(16564), '4h 36m');

  const formatted = formatGeminiErrorMessage(err);
  assert.match(formatted, /Gemini Free Tier daily quota reached/);
  assert.match(formatted, /4h 36m/);
  assert.doesNotMatch(formatted, /\{|\}/);
});

test('detects 503 high-demand upstream unavailability and switches cleanly without misclassifying domain errors', () => {
  const busyErr = new Error(
    'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.'
  );
  assert.equal(isQuotaExhaustedError(busyErr), false);
  assert.equal(isTransientUpstreamError(busyErr), true);
  assert.equal(shouldFallbackUpstreamError(busyErr), true);
  assert.match(formatGeminiErrorMessage(busyErr), /503 high demand/);

  const err = new Error('Anchor #1 not found in src/index.ts');
  assert.equal(isQuotaExhaustedError(err), false);
  assert.equal(isTransientUpstreamError(err), false);
  assert.equal(shouldFallbackUpstreamError(err), false);
  assert.equal(formatGeminiErrorMessage(err), 'Anchor #1 not found in src/index.ts');
});

test('records and retrieves active quota cooldown per API key and clears cleanly', () => {
  clearQuotaCooldowns();
  const reason = markQuotaCooldownFromError(new Error(EXACT_429_PAYLOAD), 'test-key-123');
  assert.match(reason, /Gemini Free Tier daily quota reached/);

  const active = getActiveQuotaCooldown('test-key-123');
  assert.ok(active);
  assert.equal(active.active, true);
  assert.ok(active.retryAfterSeconds > 0);
  assert.equal(active.reason, reason);

  assert.equal(getActiveQuotaCooldown('other-key-999'), null);

  clearQuotaCooldowns();
  assert.equal(getActiveQuotaCooldown('test-key-123'), null);
});
