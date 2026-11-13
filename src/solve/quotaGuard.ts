import crypto from 'node:crypto';

interface CooldownEntry {
  untilMs: number;
  reason: string;
}

const quotaCooldowns = new Map<string, CooldownEntry>();

function cooldownKey(apiKey: string | undefined, model: string): string {
  const digest = apiKey
    ? crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12)
    : 'anon';
  return `${digest}:${model}`;
}

export function isQuotaExhaustedError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;
    if (record.status === 429 || record.code === 429) return true;
    const nested = record.error as Record<string, unknown> | undefined;
    if (nested && (nested.code === 429 || nested.status === 'RESOURCE_EXHAUSTED')) {
      return true;
    }
  }
  const text =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : JSON.stringify(err);
  const lower = text.toLowerCase();
  return (
    lower.includes('resource_exhausted') ||
    lower.includes('quota exceeded') ||
    lower.includes('generate_content_free_tier_requests') ||
    lower.includes('"code":429') ||
    lower.includes('status 429') ||
    /\b429\b.*quota/.test(lower)
  );
}

export function isTransientUpstreamError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;
    if (record.status === 503 || record.code === 503 || record.status === 502 || record.status === 504) {
      return true;
    }
    const nested = record.error as Record<string, unknown> | undefined;
    if (nested && (nested.code === 503 || nested.status === 'UNAVAILABLE' || nested.code === 502 || nested.code === 504)) {
      return true;
    }
  }
  const text =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : JSON.stringify(err);
  const lower = text.toLowerCase();
  return (
    lower.includes('high demand') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('"code":503') ||
    lower.includes('status 503') ||
    lower.includes('try again later') ||
    lower.includes('timed out') ||
    lower.includes('timeout')
  );
}

export function shouldFallbackUpstreamError(err: unknown): boolean {
  return isQuotaExhaustedError(err) || isTransientUpstreamError(err);
}

export function parseRetryDelaySeconds(err: unknown): number | null {
  const text =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : JSON.stringify(err);

  const jsonMatch = text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  if (jsonMatch) {
    return Math.max(1, Math.ceil(Number(jsonMatch[1])));
  }

  const proseMatch = text.match(/retry in\s+(?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
  if (proseMatch) {
    const hours = Number(proseMatch[1] || 0);
    const mins = Number(proseMatch[2] || 0);
    const secs = Number(proseMatch[3] || 0);
    return Math.max(1, Math.ceil(hours * 3600 + mins * 60 + secs));
  }

  return null;
}

export function formatDurationShort(totalSeconds: number): string {
  if (totalSeconds >= 3600) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.round((totalSeconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (totalSeconds >= 60) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${totalSeconds}s`;
}

export function formatGeminiErrorMessage(err: unknown): string {
  if (isQuotaExhaustedError(err)) {
    const delay = parseRetryDelaySeconds(err);
    const retryNote = delay ? ` (resets in ~${formatDurationShort(delay)})` : '';
    return `Gemini Free Tier daily quota reached${retryNote} — switched to built-in engine.`;
  }

  if (isTransientUpstreamError(err)) {
    return 'Gemini upstream temporarily busy (503 high demand) — switched to built-in engine.';
  }

  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : 'Unexpected upstream model error.';

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) {
      return parsed.error.message.split('\n')[0].trim();
    }
  } catch {
    // Plain error string
  }

  return raw.split('\n')[0].trim() || 'Unexpected upstream model error.';
}

export function markQuotaCooldownFromError(
  err: unknown,
  apiKey?: string,
  model = 'gemini-4-hydrogen'
): string {
  const retrySec = parseRetryDelaySeconds(err);
  const boundedSec = isQuotaExhaustedError(err)
    ? retrySec
      ? Math.min(retrySec, 4 * 3600)
      : 15 * 60
    : retrySec
    ? Math.min(retrySec, 5 * 60)
    : 90;
  const reason = formatGeminiErrorMessage(err);
  quotaCooldowns.set(cooldownKey(apiKey, model), {
    untilMs: Date.now() + boundedSec * 1000,
    reason,
  });
  return reason;
}

export function getActiveQuotaCooldown(
  apiKey?: string,
  model = 'gemini-4-hydrogen'
): { active: boolean; reason: string; retryAfterSeconds: number } | null {
  const key = cooldownKey(apiKey, model);
  const entry = quotaCooldowns.get(key);
  if (!entry) return null;
  const remainingMs = entry.untilMs - Date.now();
  if (remainingMs <= 0) {
    quotaCooldowns.delete(key);
    return null;
  }
  return {
    active: true,
    reason: entry.reason,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
  };
}

export function clearQuotaCooldowns(): void {
  quotaCooldowns.clear();
}
