import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  JiraTicket,
  PublishCheckpoint,
  PullRequest,
  SolveExecutionMode,
  SolvePlan,
  SolveRun,
  SolveStageId,
  SolveToolCallEvent,
} from '../types.ts';
import { slugifyAgentBranchName } from '../utils/workflowRules.ts';
import {
  formatGeminiErrorMessage,
  getActiveQuotaCooldown,
  isQuotaExhaustedError,
  markQuotaCooldownFromError,
} from './quotaGuard.ts';
import { runBaselineComparison, runIsolatedVerification } from './verifier.ts';
import { WorkspaceSnapshot } from './workspace.ts';

export interface StartSolveParams {
  runId: string;
  ticket: JiraTicket;
  baseSha: string;
  scopeRevision: number;
  executionMode: SolveExecutionMode;
  maxModelCalls: number | null;
  testCommand: string;
  guidance?: string;
  nextPrNumber: number;
  geminiApiKey?: string;
  signal?: AbortSignal;
  onUpdate?: (run: SolveRun) => void;
  /** Optional model override for deterministic unit testing */
  modelDriver?: SolveModelDriver;
}

export interface SolveEditInstruction {
  path: string;
  summary: string;
  replacements?: Array<{ before: string; after: string }>;
  createContent?: string;
}

export interface SolveModelPlanOutput {
  kind: 'needs_info' | 'plan';
  questions?: string[];
  plan?: SolvePlan;
}

export interface SolveModelPatchOutput {
  prTitle: string;
  prSummary: string;
  edits: SolveEditInstruction[];
}

export interface SolveModelDriver {
  generatePlan(input: {
    ticket: JiraTicket;
    indexedFiles: Array<{ path: string; lines: number }>;
    fileSnippets: Array<{ path: string; content: string }>;
    guidance?: string;
  }): Promise<SolveModelPlanOutput>;
  generatePatch(input: {
    ticket: JiraTicket;
    plan: SolvePlan;
    fileSnippets: Array<{ path: string; content: string }>;
    repairFeedback?: string;
    guidance?: string;
  }): Promise<SolveModelPatchOutput>;
}

const STAGE_ORDER: SolveStageId[] = [
  'indexing',
  'planning',
  'solving',
  'verifying',
  'publishing',
];

function nowIso(): string {
  return new Date().toISOString();
}

function makeShortSha(): string {
  return crypto.randomBytes(20).toString('hex');
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createGeminiDriver(apiKey: string): SolveModelDriver {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  return {
    async generatePlan({ ticket, indexedFiles, fileSnippets, guidance }) {
      const prompt = [
        `You are Stage 2 (Planning) of a Jira-to-GitHub Solve agent.`,
        `Ticket: ${ticket.key} - ${ticket.title}`,
        `Description: ${ticket.description}`,
        `Acceptance Criteria:\n${ticket.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
        guidance ? `Engineer Guidance: ${guidance}` : '',
        `Indexed Files:\n${indexedFiles.map((f) => `- ${f.path} (${f.lines} lines)`).join('\n')}`,
        `Inspected Source Files:\n${fileSnippets.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n')}`,
        `If requirements are genuinely ambiguous or missing critical business rules, return kind="needs_info" with 1-3 concrete questions. Otherwise return kind="plan" with targetFiles, concrete steps, and notes.`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Output strictly valid JSON matching the schema. Be concise. Only choose kind="needs_info" if the ticket lacks actionable requirements.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              kind: { type: Type.STRING },
              questions: { type: Type.ARRAY, items: { type: Type.STRING } },
              summary: { type: Type.STRING },
              targetFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
              steps: { type: Type.ARRAY, items: { type: Type.STRING } },
              notes: { type: Type.STRING },
            },
            required: ['kind', 'summary', 'targetFiles', 'steps', 'notes'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (parsed.kind === 'needs_info' && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        return { kind: 'needs_info', questions: parsed.questions };
      }
      return {
        kind: 'plan',
        plan: {
          summary: parsed.summary || `Implementation plan for ${ticket.key}`,
          targetFiles: Array.isArray(parsed.targetFiles) ? parsed.targetFiles : [],
          steps: Array.isArray(parsed.steps) ? parsed.steps : [],
          notes: parsed.notes || '',
        },
      };
    },

    async generatePatch({ ticket, plan, fileSnippets, repairFeedback, guidance }) {
      const prompt = [
        `You are Stage 3 (Edit & Test) of a Jira-to-GitHub Solve agent.`,
        `Ticket: ${ticket.key} - ${ticket.title}`,
        `Description: ${ticket.description}`,
        `Acceptance Criteria:\n${ticket.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
        `Approved Plan:\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
        guidance ? `Engineer Guidance: ${guidance}` : '',
        repairFeedback
          ? `PREVIOUS VERIFICATION FAILED — FIX THE CODE BELOW:\n${repairFeedback}`
          : '',
        `Current Pinned Source Files (use exact line content for replacements or createContent for new files):\n${fileSnippets
          .map((f) => `--- ${f.path} ---\n${f.content}`)
          .join('\n\n')}`,
        `IMPORTANT: Any test files (*.test.ts) MUST import assertions from "vitest" (describe, expect, it) and import target functions with relative paths, and must be 100% valid runnable TypeScript so our isolated Node sandbox executes them cleanly.`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Output strictly valid JSON matching the schema. For existing files, provide exact substring replacements[{before, after}] matching the provided source text verbatim, OR provide full createContent for new/rewritten files. Keep unit tests self-contained (use in-memory fakes/mocks, no external network).',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              prTitle: { type: Type.STRING },
              prSummary: { type: Type.STRING },
              edits: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    path: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    replacements: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          before: { type: Type.STRING },
                          after: { type: Type.STRING },
                        },
                        required: ['before', 'after'],
                      },
                    },
                    createContent: { type: Type.STRING },
                  },
                  required: ['path', 'summary'],
                },
              },
            },
            required: ['prTitle', 'prSummary', 'edits'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      return {
        prTitle: parsed.prTitle || `feat(${ticket.key.toLowerCase()}): ${ticket.title}`,
        prSummary: parsed.prSummary || `Implements ${ticket.key}.`,
        edits: Array.isArray(parsed.edits) ? parsed.edits : [],
      };
    },
  };
}

function createDeterministicDriver(): SolveModelDriver {
  return {
    async generatePlan({ ticket, indexedFiles, guidance }) {
      const lower = `${ticket.title} ${ticket.description}`.toLowerCase();
      if (lower.includes('[ambiguous]') || ticket.acceptanceCriteria.length === 0) {
        return {
          kind: 'needs_info',
          questions: [
            'Which exact edge cases or error status codes should be returned when validation fails?',
            'Should existing callers remain backward-compatible with previous return signatures?',
          ],
        };
      }

      const targets =
        ticket.targetFiles.length > 0
          ? ticket.targetFiles
          : indexedFiles
              .filter((f) => f.path.startsWith('src/'))
              .slice(0, 2)
              .map((f) => f.path);

      return {
        kind: 'plan',
        plan: {
          summary: `Scoped implementation plan for ${ticket.key} across ${targets.join(', ')}.`,
          targetFiles: targets,
          steps: [
            `Inspect ${targets[0] || 'target source module'} and verify existing contract.`,
            ...ticket.acceptanceCriteria.slice(0, 3),
            `Add/update automated unit tests covering ${ticket.key} acceptance criteria.`,
          ],
          notes: guidance
            ? `Apply guidance: ${guidance}`
            : 'Preserve existing exports and validate all edge cases inside isolated tests.',
        },
      };
    },

    async generatePatch({ ticket, fileSnippets, guidance }) {
      if (ticket.key === 'ENG-412') {
        return {
          prTitle: `feat(webhooks): enforce constant-time Stripe signature & 300s replay window (${ticket.key})`,
          prSummary: `Implements strict Stripe webhook verification for ${ticket.key}. Rejects malformed headers, enforces a 300-second replay tolerance window, and compares HMAC-SHA256 digests with crypto.timingSafeEqual.${guidance ? ` Note: ${guidance}` : ''}`,
          edits: [
            {
              path: 'src/webhooks/verifyStripeSignature.ts',
              summary: 'Enforce 300s replay window and constant-time digest comparison',
              replacements: [
                {
                  before: [
                    'export function verifyStripeSignature(payload: string, header: string, secret: string): boolean {',
                    '  const sig = header.split("v1=")[1];',
                    '  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");',
                    '  return sig === expected;',
                    '}',
                  ].join('\n'),
                  after: [
                    'const DEFAULT_TOLERANCE_SECONDS = 300;',
                    '',
                    'export class WebhookSignatureError extends Error {}',
                    '',
                    'export function verifyStripeSignature(payload: string, header: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {',
                    '  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=")));',
                    '  const timestamp = Number(parts.t);',
                    '  const receivedHex = parts.v1;',
                    '  if (!Number.isFinite(timestamp) || !receivedHex) {',
                    '    throw new WebhookSignatureError("Missing t or v1 signature component");',
                    '  }',
                    '  if (Math.abs(nowSec - timestamp) > DEFAULT_TOLERANCE_SECONDS) {',
                    '    throw new WebhookSignatureError("Webhook timestamp outside 300s tolerance window");',
                    '  }',
                    '  const signedPayload = `${timestamp}.${payload}`;',
                    '  const expectedBuf = crypto.createHmac("sha256", secret).update(signedPayload).digest();',
                    '  const receivedBuf = Buffer.from(receivedHex, "hex");',
                    '  if (expectedBuf.length !== receivedBuf.length) {',
                    '    return false;',
                    '  }',
                    '  return crypto.timingSafeEqual(expectedBuf, receivedBuf);',
                    '}',
                  ].join('\n'),
                },
              ],
            },
            {
              path: 'src/webhooks/verifyStripeSignature.test.ts',
              summary: 'Add unit tests covering valid signatures, expired replay window, and length mismatch',
              createContent: [
                'import { describe, expect, it } from "vitest";',
                'import crypto from "node:crypto";',
                'import { verifyStripeSignature, WebhookSignatureError } from "./verifyStripeSignature";',
                '',
                'describe("verifyStripeSignature", () => {',
                '  const secret = "whsec_test_secret";',
                '  it("accepts valid signature inside 300s tolerance window", () => {',
                '    const now = 1700000000;',
                '    const body = JSON.stringify({ id: "evt_1" });',
                '    const sig = crypto.createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");',
                '    expect(verifyStripeSignature(body, `t=${now},v1=${sig}`, secret, now)).toBe(true);',
                '  });',
                '  it("throws WebhookSignatureError when timestamp exceeds 300s", () => {',
                '    expect(() => verifyStripeSignature("{}", "t=1000,v1=abcd", secret, 1500)).toThrow(WebhookSignatureError);',
                '  });',
                '  it("returns false for mismatched digest buffer length", () => {',
                '    const now = 1700000000;',
                '    expect(verifyStripeSignature("{}", `t=${now},v1=deadbeef`, secret, now)).toBe(false);',
                '  });',
                '});',
              ].join('\n'),
            },
          ],
        };
      }

      if (ticket.key === 'ENG-418') {
        return {
          prTitle: `feat(charges): enforce Idempotency-Key deduplication and conflict detection (${ticket.key})`,
          prSummary: `Implements payload-hashed Idempotency-Key deduplication for POST /v1/charges with 400 missing-header and 409 conflict safeguards.`,
          edits: [
            {
              path: 'src/middleware/idempotency.ts',
              summary: 'Implement 24h TTL deduplication and payload mismatch 409 check',
              createContent: [
                'import crypto from "node:crypto";',
                '',
                'export interface IdempotencyRecord {',
                '  key: string;',
                '  payloadHash: string;',
                '  statusCode: number;',
                '  body: unknown;',
                '  createdAt: number;',
                '}',
                '',
                'export function hashPayload(body: unknown): string {',
                '  return crypto.createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");',
                '}',
                '',
                'export function checkIdempotency(',
                '  store: Map<string, IdempotencyRecord>,',
                '  key: string | undefined,',
                '  body: unknown,',
                '  nowMs = Date.now()',
                '): { status: "missing_key" | "conflict" | "replay" | "proceed"; record?: IdempotencyRecord } {',
                '  if (!key || !key.trim()) return { status: "missing_key" };',
                '  const existing = store.get(key);',
                '  if (!existing || nowMs - existing.createdAt > 86_400_000) return { status: "proceed" };',
                '  const nextHash = hashPayload(body);',
                '  if (existing.payloadHash !== nextHash) return { status: "conflict" };',
                '  return { status: "replay", record: existing };',
                '}',
              ].join('\n'),
            },
            {
              path: 'src/middleware/idempotency.test.ts',
              summary: 'Verify missing key, identical replay, and 409 payload mismatch',
              createContent: [
                'import { describe, expect, it } from "vitest";',
                'import { checkIdempotency, hashPayload } from "./idempotency";',
                '',
                'describe("idempotency middleware", () => {',
                '  it("rejects missing Idempotency-Key header", () => {',
                '    const res = checkIdempotency(new Map(), undefined, { amount: 500 });',
                '    expect(res.status).toBe("missing_key");',
                '  });',
                '  it("replays cached response for identical payload", () => {',
                '    const store = new Map();',
                '    store.set("k1", { key: "k1", payloadHash: hashPayload({ amount: 500 }), statusCode: 200, body: { ok: true }, createdAt: 1000 });',
                '    const res = checkIdempotency(store, "k1", { amount: 500 }, 2000);',
                '    expect(res.status).toBe("replay");',
                '  });',
                '  it("flags 409 conflict when payload differs", () => {',
                '    const store = new Map();',
                '    store.set("k1", { key: "k1", payloadHash: hashPayload({ amount: 500 }), statusCode: 200, body: { ok: true }, createdAt: 1000 });',
                '    const res = checkIdempotency(store, "k1", { amount: 900 }, 2000);',
                '    expect(res.status).toBe("conflict");',
                '  });',
                '});',
              ].join('\n'),
            },
          ],
        };
      }

      if (ticket.key === 'ENG-425') {
        return {
          prTitle: `fix(checkout): add synchronous ref lock to prevent double-submit race (${ticket.key})`,
          prSummary: `Guards handleConfirmPayment with a synchronous ref lock so rapid double-clicks cannot dispatch duplicate payment confirmations.`,
          edits: [
            {
              path: 'src/components/ConfirmPaymentForm.tsx',
              summary: 'Add synchronous submittingRef guard in handleConfirmPayment',
              replacements: [
                {
                  before: 'import { useState } from "react";',
                  after: 'import { useRef, useState } from "react";',
                },
                {
                  before: [
                    '  const [submitting, setSubmitting] = useState(false);',
                    '  const [error, setError] = useState<string | null>(null);',
                    '',
                    '  const handleConfirmPayment = async () => {',
                    '    setSubmitting(true);',
                    '    setError(null);',
                    '    try {',
                    '      await onConfirm();',
                    '    } catch (err) {',
                    '      setError(err instanceof Error ? err.message : "Payment failed");',
                    '      setSubmitting(false);',
                    '    }',
                    '  };',
                  ].join('\n'),
                  after: [
                    '  const [submitting, setSubmitting] = useState(false);',
                    '  const [error, setError] = useState<string | null>(null);',
                    '  const lockRef = useRef(false);',
                    '',
                    '  const handleConfirmPayment = async () => {',
                    '    if (lockRef.current) return;',
                    '    lockRef.current = true;',
                    '    setSubmitting(true);',
                    '    setError(null);',
                    '    try {',
                    '      await onConfirm();',
                    '    } catch (err) {',
                    '      setError(err instanceof Error ? err.message : "Payment failed");',
                    '      setSubmitting(false);',
                    '      lockRef.current = false;',
                    '    }',
                    '  };',
                  ].join('\n'),
                },
              ],
            },
            {
              path: 'src/components/ConfirmPaymentForm.test.tsx',
              summary: 'Verify synchronous lock blocks concurrent invocations',
              createContent: [
                'import { describe, expect, it } from "vitest";',
                'import { ConfirmPaymentForm } from "./ConfirmPaymentForm";',
                '',
                'describe("ConfirmPaymentForm", () => {',
                '  it("blocks concurrent handleConfirmPayment calls", async () => {',
                '    let calls = 0;',
                '    const form = ConfirmPaymentForm({ onConfirm: async () => { calls++; } });',
                '    await Promise.all([form.handleConfirmPayment(), form.handleConfirmPayment()]);',
                '    expect(calls).toBe(1);',
                '  });',
                '});',
              ].join('\n'),
            },
          ],
        };
      }

      const primaryFile =
        ticket.targetFiles[0] || fileSnippets[0]?.path || 'src/index.ts';
      const testFile =
        ticket.targetFiles.find((p) => p.includes('.test.')) ||
        primaryFile.replace(/\.(tsx?|js)$/, '.test.ts');
      const fnName = `solve_${ticket.key.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

      return {
        prTitle: `feat(${ticket.key.toLowerCase()}): ${ticket.title.slice(0, 62)}`,
        prSummary: `Implements ${ticket.key}: ${ticket.description}${guidance ? ` Guidance: ${guidance}` : ''}`,
        edits: [
          {
            path: primaryFile,
            summary: `Implement core logic for ${ticket.key}`,
            createContent: [
              `// Implementation for ${ticket.key}: ${ticket.title}`,
              `export function ${fnName}(input: Record<string, unknown>) {`,
              '  if (!input || Object.keys(input).length === 0) {',
              '    throw new Error("ValidationError: non-empty input payload required");',
              '  }',
              `  return { ok: true, ticket: "${ticket.key}", input };`,
              '}',
            ].join('\n'),
          },
          {
            path: testFile,
            summary: `Add automated test coverage for ${ticket.key}`,
            createContent: [
              'import { describe, expect, it } from "vitest";',
              `import { ${fnName} } from "./${primaryFile.split('/').pop()?.replace(/\.(tsx?|js)$/, '')}";`,
              '',
              `describe("${ticket.key}", () => {`,
              '  it("accepts valid payload and returns ticket key", () => {',
              `    const res = ${fnName}({ requestId: "req_1" });`,
              '    expect(res.ok).toBe(true);',
              `    expect(res.ticket).toBe("${ticket.key}");`,
              '  });',
              '  it("rejects empty input cleanly", () => {',
              `    expect(() => ${fnName}({})).toThrow("ValidationError");`,
              '  });',
              '});',
            ].join('\n'),
          },
        ],
      };
    },
  };
}

function wrapDriverWithQuotaFallback(
  primary: SolveModelDriver,
  fallback: SolveModelDriver,
  geminiApiKey: string | undefined,
  onFallback: (reason: string) => void
): SolveModelDriver {
  let switchedToFallback = false;

  const triggerFallback = (err: unknown) => {
    const reason = geminiApiKey
      ? markQuotaCooldownFromError(err, geminiApiKey)
      : formatGeminiErrorMessage(err);
    switchedToFallback = true;
    onFallback(reason);
  };

  return {
    async generatePlan(input) {
      if (switchedToFallback) {
        return fallback.generatePlan(input);
      }
      try {
        return await primary.generatePlan(input);
      } catch (err) {
        if (isQuotaExhaustedError(err)) {
          triggerFallback(err);
          return fallback.generatePlan(input);
        }
        throw err;
      }
    },
    async generatePatch(input) {
      if (switchedToFallback) {
        return fallback.generatePatch(input);
      }
      try {
        return await primary.generatePatch(input);
      } catch (err) {
        if (isQuotaExhaustedError(err)) {
          triggerFallback(err);
          return fallback.generatePatch(input);
        }
        throw err;
      }
    },
  };
}

/**
 * Executes the 5-stage Ticket-Solve pipeline:
 * 1. Materialize & Index pinned repo SHA (Jira stays Ready/To Do)
 * 2. Plan & Ambiguity Check (stops cleanly as needs_info if ambiguous without mutating Jira)
 * 3. Edit & In-Loop Test + Recoverable Self-Repair (moves Jira to In Progress only when editing begins)
 * 4. Clean-Room Verification (runs baseline comparison only if verification fails)
 * 5. Idempotent Draft PR Publication & Jira sync (In Progress -> In Review, never Done)
 */
export async function runSolvePipeline(params: StartSolveParams): Promise<SolveRun> {
  const {
    runId,
    ticket,
    baseSha,
    scopeRevision,
    executionMode,
    maxModelCalls,
    testCommand,
    guidance,
    nextPrNumber,
    geminiApiKey,
    signal,
    onUpdate,
    modelDriver,
  } = params;

  const hasLiveGemini = Boolean(geminiApiKey && geminiApiKey !== 'MY_GEMINI_API_KEY');
  const activeCooldown =
    !modelDriver && hasLiveGemini ? getActiveQuotaCooldown(geminiApiKey) : null;
  const fallbackDriver = createDeterministicDriver();

  const run: SolveRun = {
    id: runId,
    ticketId: ticket.id,
    ticketKey: ticket.key,
    repo: ticket.repo,
    baseBranch: ticket.baseBranch,
    baseSha,
    scopeRevision,
    executionMode,
    maxModelCalls,
    modelCallsUsed: 0,
    repairAttempts: 0,
    status: 'running',
    currentStage: 'indexing',
    completedStages: [],
    jiraStatusAtStart: ticket.status,
    jiraStatusCurrent: ticket.status,
    indexedFilesCount: 0,
    source:
      !modelDriver && hasLiveGemini && !activeCooldown?.active
        ? 'gemini'
        : 'deterministic',
    fallbackReason: activeCooldown?.active ? activeCooldown.reason : undefined,
    toolEvents: [],
    checkpoints: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const emit = () => {
    run.updatedAt = nowIso();
    onUpdate?.(structuredClone(run));
  };

  const driver: SolveModelDriver = modelDriver
    ? wrapDriverWithQuotaFallback(modelDriver, fallbackDriver, undefined, (reason) => {
        run.source = 'deterministic';
        run.fallbackReason = reason;
        emit();
      })
    : hasLiveGemini && !activeCooldown?.active
    ? wrapDriverWithQuotaFallback(
        createGeminiDriver(geminiApiKey!),
        fallbackDriver,
        geminiApiKey,
        (reason) => {
          run.source = 'deterministic';
          run.fallbackReason = reason;
          emit();
        }
      )
    : fallbackDriver;

  const checkCancelled = () => {
    if (signal?.aborted) {
      throw new DOMException('Solve run cancelled by operator.', 'AbortError');
    }
  };

  const recordTool = (
    tool: SolveToolCallEvent['tool'],
    summary: string,
    ok: boolean,
    durationMs: number,
    recoverableError?: string
  ) => {
    run.toolEvents.push({
      id: `tl-${run.toolEvents.length + 1}`,
      step: run.modelCallsUsed,
      tool,
      summary,
      ok,
      recoverableError,
      durationMs,
      timestamp: nowIso(),
    });
    emit();
  };

  const finishStage = (stage: SolveStageId) => {
    if (!run.completedStages.includes(stage)) {
      run.completedStages.push(stage);
    }
    const nextIdx = STAGE_ORDER.indexOf(stage) + 1;
    if (nextIdx < STAGE_ORDER.length) {
      run.currentStage = STAGE_ORDER[nextIdx];
    }
    emit();
  };

  const checkBudget = () => {
    if (run.maxModelCalls !== null && run.modelCallsUsed >= run.maxModelCalls) {
      throw new Error(
        `Model call budget exhausted (${run.modelCallsUsed}/${run.maxModelCalls}). No further paid requests were sent.`
      );
    }
  };

  try {
    emit();

    // ------------------------------------------------------------------
    // STAGE 1: Materialize & Index pinned SHA (Jira remains To Do)
    // ------------------------------------------------------------------
    checkCancelled();
    const workspace = new WorkspaceSnapshot(ticket.repo, baseSha, ticket.targetFiles);
    const indexedFiles = workspace.indexFiles();
    run.indexedFilesCount = indexedFiles.length;

    const searchQueries = [
      ...ticket.targetFiles.map((p) => p.split('/').pop()?.replace(/\..+$/, '') || ''),
      ...ticket.title.split(/\s+/).filter((w) => w.length > 4).slice(0, 3),
    ].filter(Boolean);

    const searchStart = Date.now();
    const matchedPaths = new Set<string>(ticket.targetFiles);
    for (const q of searchQueries.slice(0, 4)) {
      for (const match of workspace.searchCode(q)) {
        matchedPaths.add(match.path);
      }
    }
    recordTool(
      'search_code',
      `Indexed ${indexedFiles.length} files at ${baseSha.slice(0, 7)}; matched ${matchedPaths.size} candidate file(s)`,
      true,
      Math.max(4, Date.now() - searchStart)
    );

    const fileSnippets: Array<{ path: string; content: string }> = [];
    for (const candidatePath of [...matchedPaths].slice(0, 6)) {
      const rStart = Date.now();
      const read = workspace.readLines(candidatePath, 1, 200);
      if (read.ok && read.numberedContent !== undefined) {
        const raw = workspace.getCurrentContent(candidatePath) || '';
        fileSnippets.push({ path: candidatePath, content: raw });
        recordTool(
          'read_lines',
          `Read ${candidatePath} (lines 1-${read.endLine})`,
          true,
          Math.max(2, Date.now() - rStart)
        );
      } else {
        recordTool(
          'read_lines',
          `Target ${candidatePath} does not exist yet (will create if needed)`,
          true,
          Math.max(2, Date.now() - rStart)
        );
      }
    }
    if (fileSnippets.length === 0) {
      for (const entry of indexedFiles.slice(0, 3)) {
        const raw = workspace.getCurrentContent(entry.path) || '';
        fileSnippets.push({ path: entry.path, content: raw });
      }
    }

    await sleepAbortable(60, signal);
    finishStage('indexing');

    // ------------------------------------------------------------------
    // STAGE 2: Plan Stage (Jira STILL stays To Do until plan clears)
    // ------------------------------------------------------------------
    checkCancelled();
    checkBudget();
    run.modelCallsUsed++;
    emit();

    const planOutcome = await driver.generatePlan({
      ticket,
      indexedFiles: indexedFiles.map((f) => ({ path: f.path, lines: f.lines })),
      fileSnippets,
      guidance,
    });
    checkCancelled();

    if (planOutcome.kind === 'needs_info') {
      run.status = 'needs_info';
      run.questions = planOutcome.questions || ['Please clarify the expected behavior.'];
      run.error = 'Ticket requires clarification before writing code. Jira remained in To Do.';
      emit();
      return run;
    }

    run.plan = planOutcome.plan;
    finishStage('planning');

    // ------------------------------------------------------------------
    // STAGE 3: Edit & In-Loop Test + Recoverable Self-Repair
    // Transition Jira To Do -> In Progress ONLY NOW that coding starts!
    // ------------------------------------------------------------------
    run.jiraStatusCurrent = 'in_progress';
    emit();

    let patchResult: SolveModelPatchOutput | null = null;
    let verificationOutcome = null;
    let repairFeedback: string | undefined;

    for (let attempt = 0; attempt <= 2; attempt++) {
      checkCancelled();
      checkBudget();
      run.modelCallsUsed++;
      if (attempt > 0) {
        run.repairAttempts = attempt;
      }
      emit();

      const currentSnippets = workspace
        .getAllCurrentFiles()
        .filter(
          (f) =>
            matchedPaths.has(f.path) ||
            run.plan?.targetFiles.includes(f.path) ||
            f.path.startsWith('src/')
        )
        .slice(0, 6)
        .map((f) => ({ path: f.path, content: f.content }));

      patchResult = await driver.generatePatch({
        ticket,
        plan: run.plan!,
        fileSnippets: currentSnippets,
        repairFeedback,
        guidance,
      });
      checkCancelled();

      workspace.resetOverlay();
      const editErrors: string[] = [];

      for (const edit of patchResult.edits) {
        const eStart = Date.now();
        const applied = workspace.applyEdit(edit);
        if (applied.ok) {
          recordTool(
            'apply_edit',
            `Staged ${edit.path} (${applied.sha?.slice(0, 7)})`,
            true,
            Math.max(3, Date.now() - eStart)
          );
        } else {
          editErrors.push(applied.recoverableError || `Edit failed on ${edit.path}`);
          recordTool(
            'apply_edit',
            `Recoverable anchor mismatch on ${edit.path}`,
            false,
            Math.max(3, Date.now() - eStart),
            applied.recoverableError
          );
        }
      }

      if (editErrors.length > 0) {
        repairFeedback = `Recoverable edit diagnostics:\n${editErrors.join('\n\n')}`;
        if (attempt < 2) continue;
        throw new Error(`Patch could not be anchored after ${attempt + 1} attempts: ${editErrors[0]}`);
      }

      if (!workspace.hasChanges()) {
        throw new Error('Model produced no net file changes against pinned snapshot.');
      }

      // Run in-loop sandbox check immediately before leaving Stage 3
      const checkStart = Date.now();
      verificationOutcome = await runIsolatedVerification(workspace, testCommand);
      recordTool(
        'run_sandbox_check',
        `In-loop check "${testCommand}" -> exitCode ${verificationOutcome.report.exitCode} (${verificationOutcome.testSuite.filter((t) => t.status === 'passed').length}/${verificationOutcome.testSuite.length} passed)`,
        verificationOutcome.report.status === 'passed',
        Math.max(12, Date.now() - checkStart),
        verificationOutcome.report.status === 'failed' ? verificationOutcome.report.log : undefined
      );

      if (verificationOutcome.report.status === 'passed') {
        break;
      }

      repairFeedback = verificationOutcome.report.log;
      if (attempt >= 2) {
        break;
      }
    }

    finishStage('solving');

    // ------------------------------------------------------------------
    // STAGE 4: Clean-Room Verification (+ Baseline Check ONLY on failure)
    // ------------------------------------------------------------------
    checkCancelled();
    const finalCheck = await runIsolatedVerification(workspace, testCommand);
    run.verification = finalCheck.report;
    emit();

    if (finalCheck.report.status !== 'passed') {
      const baseline = await runBaselineComparison(ticket.repo, baseSha, testCommand);
      run.verification = {
        ...finalCheck.report,
        baselineCheck: baseline,
      };
      run.status = 'failed';
      run.error = `Verification failed (${testCommand}, exit ${finalCheck.report.exitCode}). No branch or PR was published.`;
      emit();
      return run;
    }

    finishStage('verifying');

    // ------------------------------------------------------------------
    // STAGE 5: Idempotent Draft PR Publication & Jira Sync (In Review)
    // ------------------------------------------------------------------
    checkCancelled();
    const changedFiles = workspace.computeChangedFiles();
    const headBranch = slugifyAgentBranchName(ticket.key, baseSha);
    const commitSha = makeShortSha();
    const prId = `pr-${nextPrNumber}`;

    const addCheckpoint = async (
      stage: PublishCheckpoint['stage'],
      phase: PublishCheckpoint['phase'],
      detail: string
    ) => {
      checkCancelled();
      run.checkpoints.push({
        stage,
        phase,
        detail,
        timestamp: nowIso(),
      });
      emit();
      if (phase === 'before') {
        await sleepAbortable(25, signal);
      }
    };

    await addCheckpoint('blob', 'before', `Upload ${changedFiles.length} verified file blob(s)`);
    await addCheckpoint('blob', 'after', `${changedFiles.length} blob SHA(s) confirmed`);

    await addCheckpoint('tree', 'before', `Create Git tree on ${baseSha.slice(0, 7)}`);
    await addCheckpoint('tree', 'after', `Git tree created`);

    await addCheckpoint('commit', 'before', `Commit ${ticket.key} changes`);
    await addCheckpoint('commit', 'after', `Commit ${commitSha.slice(0, 7)} recorded`);

    await addCheckpoint('branch', 'before', `Create ref refs/heads/${headBranch}`);
    await addCheckpoint('branch', 'after', `Branch ${headBranch} created`);

    await addCheckpoint('pullRequest', 'before', `Open Draft PR #${nextPrNumber} -> ${ticket.baseBranch}`);
    await addCheckpoint('pullRequest', 'after', `Draft PR #${nextPrNumber} confirmed`);

    run.jiraStatusCurrent = 'in_review';

    const passedCount = finalCheck.testSuite.filter((t) => t.status === 'passed').length;
    const draftPr: PullRequest = {
      id: prId,
      number: nextPrNumber,
      title: patchResult?.prTitle || `feat(${ticket.key.toLowerCase()}): ${ticket.title}`,
      summary:
        patchResult?.prSummary ||
        `Draft PR generated by Patchline 5-Stage Solve pipeline for ${ticket.key}.`,
      repo: ticket.repo,
      baseBranch: ticket.baseBranch,
      baseSha,
      headBranch,
      commitSha,
      draft: true,
      linkedTicketKey: ticket.key,
      authorName: 'Marcus Vance',
      authorRole: 'Staff Engineer',
      createdAt: 'Just now',
      status: 'draft',
      humanReviewStatus: 'pending',
      reviewComment: '',
      mergeStrategy: 'squash',
      planSteps: run.plan?.steps || [],
      files: changedFiles,
      testCommand,
      testSuite: finalCheck.testSuite,
      aiReviewRan: false,
      findings: [],
      auditTrail: [
        {
          id: `aud-${Date.now()}-1`,
          actor: 'Patchline Solve',
          action: `Opened Draft PR #${nextPrNumber} on ${headBranch} (base ${baseSha.slice(0, 7)})`,
          timestamp: 'Just now',
        },
        {
          id: `aud-${Date.now()}-2`,
          actor: 'Isolated Verifier',
          action: `${passedCount}/${finalCheck.testSuite.length} tests passed (${finalCheck.report.durationMs}ms)`,
          timestamp: 'Just now',
        },
        {
          id: `aud-${Date.now()}-3`,
          actor: 'Jira Sync',
          action: `Moved ${ticket.key} To Do -> In Progress -> In Review (human merge decides Done)`,
          timestamp: 'Just now',
        },
      ],
    };

    run.prResult = draftPr;
    if (!run.completedStages.includes('publishing')) {
      run.completedStages.push('publishing');
    }
    run.status = 'succeeded';
    emit();
    return run;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      run.status = 'cancelled';
      run.error = 'Solve run was cancelled by the developer.';
      emit();
      return run;
    }
    run.status = 'failed';
    run.error = formatGeminiErrorMessage(err);
    emit();
    return run;
  }
}
