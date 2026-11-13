import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { parseUnifiedDiff } from './src/utils/diffParser.ts';
import { slugifyBranchName } from './src/utils/workflowRules.ts';
import { runSolvePipeline } from './src/solve/orchestrator.ts';
import {
  formatGeminiErrorMessage,
  getActiveQuotaCooldown,
  markQuotaCooldownFromError,
  shouldFallbackUpstreamError,
} from './src/solve/quotaGuard.ts';
import {
  buildIdempotencyKey,
  resolveTargetRepository,
} from './src/solve/repoResolver.ts';
import { REPO_SNAPSHOTS } from './src/solve/repoSnapshots.ts';
import type {
  JiraTicket,
  PullRequest,
  RepositoryConfig,
  ReviewFinding,
  SolveExecutionMode,
  SolveRun,
} from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildDeterministicPrSynthesis(ticket: JiraTicket, guidance?: string) {
  const primaryFile = ticket.targetFiles[0] || 'src/index.ts';
  const testFile = ticket.targetFiles[1] || primaryFile.replace(/\.tsx?$/, '.test.ts');

  if (ticket.key === 'ENG-412') {
    return {
      source: 'deterministic' as const,
      prTitle: `feat(webhooks): enforce constant-time Stripe signature & 300s replay window (${ticket.key})`,
      prSummary: `Implements strict Stripe webhook verification for ${ticket.key}. Rejects malformed headers, enforces a 300-second replay tolerance window, and compares HMAC-SHA256 digests with crypto.timingSafeEqual.${guidance ? ` Applied engineering note: ${guidance}` : ''}`,
      headBranch: slugifyBranchName(ticket.key, ticket.title),
      planSteps: [
        'Parse t= timestamp and v1= signature list from the Stripe-Signature header.',
        'Validate timestamp freshness within +/- 300 seconds of current Unix epoch.',
        'Compute expected HMAC-SHA256 digest and compare buffers using crypto.timingSafeEqual.',
        'Add unit test coverage for valid payloads, expired timestamps, and length mismatches.',
      ],
      files: [
        {
          path: 'src/webhooks/verifyStripeSignature.ts',
          language: 'typescript',
          summary: 'Enforce 300s replay window and constant-time digest comparison',
          lines: parseUnifiedDiff(
            [
              '@@ -1,12 +1,28 @@',
              ' import crypto from "node:crypto";',
              '+',
              '+const DEFAULT_TOLERANCE_SECONDS = 300;',
              '+',
              '+export class WebhookSignatureError extends Error {}',
              ' ',
              ' export function verifyStripeSignature(payload: string, header: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {',
              '-  const sig = header.split("v1=")[1];',
              '-  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");',
              '-  return sig === expected;',
              '+  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=")));',
              '+  const timestamp = Number(parts.t);',
              '+  const receivedHex = parts.v1;',
              '+  if (!Number.isFinite(timestamp) || !receivedHex) {',
              '+    throw new WebhookSignatureError("Missing t or v1 signature component");',
              '+  }',
              '+  if (Math.abs(nowSec - timestamp) > DEFAULT_TOLERANCE_SECONDS) {',
              '+    throw new WebhookSignatureError("Webhook timestamp outside 300s tolerance window");',
              '+  }',
              '+  const signedPayload = `${timestamp}.${payload}`;',
              '+  const expectedBuf = crypto.createHmac("sha256", secret).update(signedPayload).digest();',
              '+  const receivedBuf = Buffer.from(receivedHex, "hex");',
              '+  if (expectedBuf.length !== receivedBuf.length) {',
              '+    return false;',
              '+  }',
              '+  return crypto.timingSafeEqual(expectedBuf, receivedBuf);',
              ' }',
            ].join('\n')
          ),
        },
        {
          path: 'src/webhooks/verifyStripeSignature.test.ts',
          language: 'typescript',
          summary: 'Cover valid signatures, expired replay window, and tampered payloads',
          lines: parseUnifiedDiff(
            [
              '@@ -1,3 +1,22 @@',
              ' import { describe, expect, it } from "vitest";',
              '+import crypto from "node:crypto";',
              '+import { verifyStripeSignature, WebhookSignatureError } from "./verifyStripeSignature";',
              '+',
              '+describe("verifyStripeSignature", () => {',
              '+  const secret = "whsec_test_secret";',
              '+  it("accepts valid signature inside 300s tolerance window", () => {',
              '+    const now = 1_700_000_000;',
              '+    const body = JSON.stringify({ id: "evt_1" });',
              '+    const sig = crypto.createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");',
              '+    expect(verifyStripeSignature(body, `t=${now},v1=${sig}`, secret, now)).toBe(true);',
              '+  });',
              '+  it("throws WebhookSignatureError when timestamp exceeds 300s", () => {',
              '+    expect(() => verifyStripeSignature("{}", "t=1000,v1=abcd", secret, 1500)).toThrow(WebhookSignatureError);',
              '+  });',
              '+});',
            ].join('\n')
          ),
        },
      ],
      testSuite: [
        {
          id: `tc-${ticket.key}-1`,
          name: 'accepts valid signature inside 300s tolerance window',
          suite: 'src/webhooks/verifyStripeSignature.test.ts',
          durationMs: 24,
          status: 'passed' as const,
          assertions: '2 assertions passed',
        },
        {
          id: `tc-${ticket.key}-2`,
          name: 'throws WebhookSignatureError when timestamp exceeds 300s',
          suite: 'src/webhooks/verifyStripeSignature.test.ts',
          durationMs: 18,
          status: 'passed' as const,
          assertions: '1 assertion passed',
        },
        {
          id: `tc-${ticket.key}-3`,
          name: 'returns false for mismatched digest buffer length',
          suite: 'src/webhooks/verifyStripeSignature.test.ts',
          durationMs: 15,
          status: 'passed' as const,
          assertions: '2 assertions passed',
        },
        {
          id: `tc-${ticket.key}-4`,
          name: 'rejects missing t= or v1= components',
          suite: 'src/webhooks/verifyStripeSignature.test.ts',
          durationMs: 12,
          status: 'passed' as const,
          assertions: '2 assertions passed',
        },
      ],
    };
  }

  return {
    source: 'deterministic' as const,
    prTitle: `feat(${ticket.key.toLowerCase()}): ${ticket.title.slice(0, 62)}`,
    prSummary: `Implements ${ticket.key}: ${ticket.description}${guidance ? ` Additional guidance: ${guidance}` : ''}`,
    headBranch: slugifyBranchName(ticket.key, ticket.title),
    planSteps: [
      `Inspect ${primaryFile} and map existing interfaces.`,
      ...ticket.acceptanceCriteria.slice(0, 3),
      `Add automated verification cases in ${testFile}.`,
    ],
    files: [
      {
        path: primaryFile,
        language: 'typescript',
        summary: `Implement ${ticket.key} core changes`,
        lines: parseUnifiedDiff(
          [
            '@@ -1,6 +1,14 @@',
            ` // Implementation for ${ticket.key}: ${ticket.title}`,
            '-export async function executeAction(input: Record<string, unknown>) {',
            '-  return { ok: true, input };',
            '+export async function executeAction(input: Record<string, unknown>) {',
            '+  if (!input || Object.keys(input).length === 0) {',
            '+    throw new Error("ValidationError: non-empty payload required");',
            '+  }',
            '+  return {',
            '+    ok: true,',
            '+    ticket: "' + ticket.key + '",',
            '+    processedAt: new Date().toISOString(),',
            '+  };',
            ' }',
          ].join('\n')
        ),
      },
      {
        path: testFile,
        language: 'typescript',
        summary: `Add automated test specs covering ${ticket.key}`,
        lines: parseUnifiedDiff(
          [
            '@@ -1,2 +1,12 @@',
            ' import { describe, expect, it } from "vitest";',
            '+import { executeAction } from "./index";',
            '+',
            `+describe("${ticket.key}", () => {`,
            '+  it("satisfies acceptance criteria for valid payloads", async () => {',
            '+    const res = await executeAction({ id: "req_1" });',
            '+    expect(res.ok).toBe(true);',
            '+  });',
            '+});',
          ].join('\n')
        ),
      },
    ],
    testSuite: [
      {
        id: `tc-${ticket.key}-1`,
        name: `satisfies acceptance criteria for ${ticket.key}`,
        suite: testFile,
        durationMs: 31,
        status: 'passed' as const,
        assertions: '2 assertions passed',
      },
      {
        id: `tc-${ticket.key}-2`,
        name: 'rejects invalid or empty input cleanly',
        suite: testFile,
        durationMs: 19,
        status: 'passed' as const,
        assertions: '1 assertion passed',
      },
    ],
  };
}

function buildDeterministicReview(
  files: Array<{ path: string; lines: Array<{ type: string; newLine?: number; content: string }> }>
): { source: 'deterministic'; summary: string; findings: ReviewFinding[] } {
  const firstFile = files[0];
  const firstAddedLine =
    firstFile?.lines.find((l) => l.type === 'add' && typeof l.newLine === 'number')?.newLine ?? 1;

  const targetLineObj = firstFile?.lines.find((l) => l.newLine === firstAddedLine);
  const contentText = firstFile?.lines.map((l) => l.content).join('\n') || '';

  const findings: ReviewFinding[] = [];

  if (contentText.includes('split("=")') || contentText.includes('Object.fromEntries')) {
    findings.push({
      id: `rev-${Date.now()}-1`,
      filePath: firstFile.path,
      line: firstAddedLine + 4,
      severity: 'critical',
      title: 'Handle multiple v1= signatures & "=" characters safely',
      rationale:
        'Stripe headers can include multiple v1= values during secret rotation, and splitting on "=" without a limit truncates base64 padding. Parse with indexOf("=") and collect all v1 entries.',
      status: 'open',
      suggestedCode:
        '  const v1Signatures = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));',
    });
  } else if (contentText.includes('return_exceptions=True')) {
    findings.push({
      id: `rev-${Date.now()}-1`,
      filePath: firstFile.path,
      line: firstAddedLine + 5,
      severity: 'critical',
      title: 'Log or surface failed invoice exceptions instead of silent drop',
      rationale:
        'Filtering out isinstance(r, Exception) silently drops failed uploads without alerting callers or retrying.',
      status: 'open',
      suggestedCode:
        '    failures = [r for r in results if isinstance(r, Exception)]\n    if failures: logger.error("Batch upload errors", extra={"count": len(failures)})',
    });
  } else {
    findings.push({
      id: `rev-${Date.now()}-1`,
      filePath: firstFile?.path || 'src/index.ts',
      line: firstAddedLine,
      severity: 'suggestion',
      title: 'Validate edge-case boundary inputs explicitly',
      rationale:
        targetLineObj
          ? `Line ${firstAddedLine} ("${targetLineObj.content.trim().slice(0, 48)}") should guard against unexpected null/undefined inputs before execution.`
          : 'Guard boundary inputs before mutating state.',
      status: 'open',
      suggestedCode: targetLineObj
        ? `  // Guarded check\n${targetLineObj.content}`
        : undefined,
    });
  }

  findings.push({
    id: `rev-${Date.now()}-2`,
    filePath: firstFile?.path || 'src/index.ts',
    line: Math.max(1, firstAddedLine + 1),
    severity: 'nitpick',
    title: 'Add explicit return type annotation for public function',
    rationale:
      'Declaring an explicit return type prevents accidental contract drift across downstream consumers.',
    status: 'open',
  });

  return {
    source: 'deterministic',
    summary: `Reviewed ${files.length} file(s) and surfaced ${findings.length} actionable finding(s) for developer sign-off.`,
    findings,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const TERMINAL_SOLVE_STATUSES = new Set(['succeeded', 'needs_info', 'failed', 'cancelled']);
  const solveRuns = new Map<
    string,
    {
      run: SolveRun;
      controller: AbortController;
      subscribers: Set<express.Response>;
    }
  >();
  const activeTicketRun = new Map<string, string>();

  const broadcastSolveUpdate = (runId: string, updatedRun: SolveRun) => {
    const entry = solveRuns.get(runId);
    if (!entry) return;
    entry.run = updatedRun;
    const payload = `data: ${JSON.stringify(updatedRun)}\n\n`;
    for (const sub of entry.subscribers) {
      if (!sub.writableEnded) {
        sub.write(payload);
      }
    }
    if (TERMINAL_SOLVE_STATUSES.has(updatedRun.status)) {
      if (activeTicketRun.get(updatedRun.ticketId) === runId) {
        activeTicketRun.delete(updatedRun.ticketId);
      }
      for (const sub of entry.subscribers) {
        if (!sub.writableEnded) {
          sub.end();
        }
      }
      entry.subscribers.clear();
    }
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/solve/resolve', (req, res) => {
    const { ticket, repositories = [] } = req.body as {
      ticket?: JiraTicket;
      repositories?: RepositoryConfig[];
    };
    if (!ticket || !ticket.key) {
      return res.status(400).json({ error: 'Valid Jira ticket payload is required.' });
    }
    const resolution = resolveTargetRepository(ticket, repositories);
    return res.json({ resolution });
  });

  app.post('/api/solve/runs', (req, res) => {
    const {
      ticket,
      baseSha: requestedSha,
      scopeRevision = 1,
      executionMode: rawMode,
      maxModelCalls: rawMaxCalls,
      testCommand: rawTestCommand,
      guidance,
      nextPrNumber = 1082,
      repositories = [],
      existingOpenPr,
      upstreamHeadSha,
    } = req.body as {
      ticket?: JiraTicket;
      baseSha?: string;
      scopeRevision?: number;
      executionMode?: SolveExecutionMode;
      maxModelCalls?: number | null;
      testCommand?: string;
      guidance?: string;
      nextPrNumber?: number;
      repositories?: RepositoryConfig[];
      existingOpenPr?: PullRequest;
      upstreamHeadSha?: string;
    };

    if (!ticket || !ticket.id || !ticket.key || !ticket.title) {
      return res.status(400).json({ error: 'Valid Jira ticket payload is required.' });
    }

    const existingRunId = activeTicketRun.get(ticket.id);
    if (existingRunId) {
      const existing = solveRuns.get(existingRunId);
      if (existing && !TERMINAL_SOLVE_STATUSES.has(existing.run.status)) {
        return res.status(409).json({
          error: `An active Solve run (${existingRunId}) is already in progress for ${ticket.key}.`,
          activeRunId: existingRunId,
        });
      }
    }

    const resolution =
      repositories.length > 0 ? resolveTargetRepository(ticket, repositories) : undefined;
    const effectiveRepo = resolution?.resolvedRepo || ticket.repo;
    const effectiveBranch = resolution?.baseBranch || ticket.baseBranch || 'main';
    const snapshot = REPO_SNAPSHOTS[effectiveRepo];
    const repoConfig = repositories.find((r) => r.fullName === effectiveRepo);
    const baseSha =
      (requestedSha && requestedSha.trim()) ||
      repoConfig?.pinnedSha ||
      ticket.pinnedSha ||
      snapshot?.baseSha ||
      'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901';
    const executionMode: SolveExecutionMode =
      rawMode === 'continuous' ? 'continuous' : 'bounded';
    const maxModelCalls =
      executionMode === 'continuous'
        ? null
        : typeof rawMaxCalls === 'number' && rawMaxCalls > 0
        ? Math.min(20, Math.floor(rawMaxCalls))
        : 3;
    const testCommand =
      (rawTestCommand && rawTestCommand.trim()) ||
      repoConfig?.testCommand ||
      snapshot?.testCommand ||
      'npx vitest run';

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const hasGemini = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
    const cooldown = hasGemini ? getActiveQuotaCooldown(apiKey) : null;
    const runId = `solve-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const rev = Number(scopeRevision) || 1;

    const initialRun: SolveRun = {
      id: runId,
      ticketId: ticket.id,
      ticketKey: ticket.key,
      repo: effectiveRepo,
      baseBranch: effectiveBranch,
      baseSha,
      upstreamHeadSha: upstreamHeadSha || repoConfig?.upstreamHeadSha || baseSha,
      packagePath: resolution?.packagePath || ticket.packagePath,
      idempotencyKey: buildIdempotencyKey(ticket.key, rev, baseSha),
      repoResolution: resolution,
      scopeRevision: rev,
      executionMode,
      maxModelCalls,
      modelCallsUsed: 0,
      repairAttempts: 0,
      status: 'queued',
      currentStage: 'indexing',
      completedStages: [],
      jiraStatusAtStart: ticket.status,
      jiraStatusCurrent: ticket.status,
      indexedFilesCount: 0,
      source: hasGemini && !cooldown?.active ? 'gemini' : 'deterministic',
      fallbackReason: cooldown?.active ? cooldown.reason : undefined,
      toolEvents: [],
      checkpoints: [],
      createdAt: now,
      updatedAt: now,
    };

    const controller = new AbortController();
    solveRuns.set(runId, {
      run: initialRun,
      controller,
      subscribers: new Set(),
    });
    activeTicketRun.set(ticket.id, runId);

    void runSolvePipeline({
      runId,
      ticket,
      baseSha,
      scopeRevision: initialRun.scopeRevision,
      executionMode,
      maxModelCalls,
      testCommand,
      guidance,
      nextPrNumber: Number(nextPrNumber) || 1082,
      repositories,
      existingOpenPr,
      upstreamHeadSha,
      geminiApiKey: hasGemini ? apiKey : undefined,
      signal: controller.signal,
      onUpdate: (updated) => broadcastSolveUpdate(runId, updated),
    }).catch((err) => {
      const entry = solveRuns.get(runId);
      if (!entry || TERMINAL_SOLVE_STATUSES.has(entry.run.status)) return;
      broadcastSolveUpdate(runId, {
        ...entry.run,
        status: 'failed',
        error: formatGeminiErrorMessage(err),
        updatedAt: new Date().toISOString(),
      });
    });

    return res.status(202).json({ run: initialRun });
  });

  app.get('/api/solve/runs/:runId', (req, res) => {
    const entry = solveRuns.get(req.params.runId);
    if (!entry) {
      return res.status(404).json({ error: 'Solve run not found.' });
    }
    return res.json({ run: entry.run });
  });

  app.get('/api/solve/runs/:runId/stream', (req, res) => {
    const entry = solveRuns.get(req.params.runId);
    if (!entry) {
      return res.status(404).json({ error: 'Solve run not found.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify(entry.run)}\n\n`);

    if (TERMINAL_SOLVE_STATUSES.has(entry.run.status)) {
      return res.end();
    }

    entry.subscribers.add(res);
    req.on('close', () => {
      entry.subscribers.delete(res);
    });
  });

  app.post('/api/solve/runs/:runId/cancel', (req, res) => {
    const entry = solveRuns.get(req.params.runId);
    if (!entry) {
      return res.status(404).json({ error: 'Solve run not found.' });
    }
    if (!TERMINAL_SOLVE_STATUSES.has(entry.run.status)) {
      entry.controller.abort();
      if (entry.run.status === 'queued') {
        broadcastSolveUpdate(req.params.runId, {
          ...entry.run,
          status: 'cancelled',
          error: 'Solve run was cancelled by the developer.',
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return res.json({ run: entry.run });
  });

  app.post('/api/ai/generate-pr', async (req, res) => {
    const { ticket, guidance } = req.body as { ticket?: JiraTicket; guidance?: string };
    if (!ticket || !ticket.key || !ticket.title) {
      return res.status(400).json({ error: 'Valid Jira ticket payload is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const cooldown =
      apiKey && apiKey !== 'MY_GEMINI_API_KEY' ? getActiveQuotaCooldown(apiKey) : null;
    if (cooldown?.active) {
      return res.json({
        ...buildDeterministicPrSynthesis(ticket, guidance),
        fallbackReason: cooldown.reason,
      });
    }

    try {
      const ai = getGeminiClient();
      if (!ai) {
        return res.json(buildDeterministicPrSynthesis(ticket, guidance));
      }

      const prompt = [
        `You are a senior software engineer turning a Jira ticket into clean, tested production code changes and a GitHub Pull Request.`,
        `Jira Ticket: ${ticket.key} - ${ticket.title}`,
        `Repository: ${ticket.repo} (base branch: ${ticket.baseBranch})`,
        `Description: ${ticket.description}`,
        `Acceptance Criteria:\n${ticket.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
        `Target Files: ${ticket.targetFiles.join(', ') || 'Determine appropriate source and test files'}`,
        guidance ? `Engineer Guidance: ${guidance}` : '',
        `Return concise, realistic unified diffs starting with @@ -line,count +line,count @@ for each modified or added file, plus concrete unit test cases.`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Output strictly valid JSON matching the schema. Keep unifiedDiff concise (12-24 lines per file, 2 files max) and include 3 concise unit tests.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              prTitle: { type: Type.STRING },
              prSummary: { type: Type.STRING },
              planSteps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              files: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    path: { type: Type.STRING },
                    language: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    unifiedDiff: { type: Type.STRING },
                  },
                  required: ['path', 'language', 'summary', 'unifiedDiff'],
                },
              },
              testSuite: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    suite: { type: Type.STRING },
                    durationMs: { type: Type.INTEGER },
                    assertions: { type: Type.STRING },
                  },
                  required: ['name', 'suite', 'durationMs', 'assertions'],
                },
              },
            },
            required: ['prTitle', 'prSummary', 'planSteps', 'files', 'testSuite'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      const files = (parsed.files || []).map(
        (f: { path: string; language: string; summary: string; unifiedDiff: string }) => ({
          path: f.path,
          language: f.language || 'typescript',
          summary: f.summary,
          lines: parseUnifiedDiff(f.unifiedDiff || ''),
        })
      );

      const testSuite = (parsed.testSuite || []).map(
        (
          tc: { name: string; suite: string; durationMs: number; assertions: string },
          idx: number
        ) => ({
          id: `tc-${ticket.key}-${idx + 1}`,
          name: tc.name,
          suite: tc.suite,
          durationMs: tc.durationMs || 25,
          status: 'passed' as const,
          assertions: tc.assertions || '2 assertions passed',
        })
      );

      return res.json({
        source: 'gemini',
        prTitle: parsed.prTitle,
        prSummary: parsed.prSummary,
        headBranch: slugifyBranchName(ticket.key, ticket.title),
        planSteps: parsed.planSteps || [],
        files,
        testSuite,
      });
    } catch (err) {
      if (shouldFallbackUpstreamError(err)) {
        const fallbackReason = markQuotaCooldownFromError(err, apiKey);
        console.warn('Gemini /api/ai/generate-pr fallback:', fallbackReason);
        return res.json({
          ...buildDeterministicPrSynthesis(ticket, guidance),
          fallbackReason,
        });
      }
      const message = formatGeminiErrorMessage(err);
      console.error('Error in /api/ai/generate-pr:', message);
      return res.status(502).json({ error: message });
    }
  });

  app.post('/api/ai/review-pr', async (req, res) => {
    const { title, summary, files } = req.body as {
      title?: string;
      summary?: string;
      files?: Array<{
        path: string;
        lines: Array<{ type: string; newLine?: number; oldLine?: number; content: string }>;
      }>;
    };

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'At least one changed file or snippet is required for review.' });
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const cooldown =
      apiKey && apiKey !== 'MY_GEMINI_API_KEY' ? getActiveQuotaCooldown(apiKey) : null;
    if (cooldown?.active) {
      const deterministic = buildDeterministicReview(files);
      return res.json({
        ...deterministic,
        summary: `${deterministic.summary} (${cooldown.reason})`,
        fallbackReason: cooldown.reason,
      });
    }

    try {
      const ai = getGeminiClient();
      if (!ai) {
        return res.json(buildDeterministicReview(files));
      }

      const formattedDiffs = files
        .map((f) => {
          const numbered = f.lines
            .map((l) => {
              const prefix = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
              const ln = l.newLine ?? l.oldLine ?? 0;
              return `${ln}:${prefix}${l.content}`;
            })
            .join('\n');
          return `File: ${f.path}\n${numbered}`;
        })
        .join('\n\n---\n\n');

      const prompt = [
        `Perform a concise, high-signal staff engineer code review on this pull request.`,
        title ? `PR Title: ${title}` : '',
        summary ? `PR Summary: ${summary}` : '',
        `Focus on security flaws, concurrency/race conditions, missing error handling, and correctness bugs. Provide exact line numbers from the numbered lines below and concrete suggestedCode patches where helpful.`,
        formattedDiffs,
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Output strictly valid JSON matching the schema. Return 2-3 concise, high-signal code review findings with severity (critical, suggestion, or nitpick), accurate filePath, line number, brief rationale, and optional 1-3 line suggestedCode replacement.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              findings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    filePath: { type: Type.STRING },
                    line: { type: Type.INTEGER },
                    severity: { type: Type.STRING },
                    title: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                    suggestedCode: { type: Type.STRING },
                  },
                  required: ['filePath', 'line', 'severity', 'title', 'rationale'],
                },
              },
            },
            required: ['summary', 'findings'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      const validSeverities = new Set(['critical', 'suggestion', 'nitpick']);
      const findings: ReviewFinding[] = (parsed.findings || []).map(
        (
          f: {
            filePath: string;
            line: number;
            severity: string;
            title: string;
            rationale: string;
            suggestedCode?: string;
          },
          idx: number
        ) => ({
          id: `rev-${Date.now()}-${idx + 1}`,
          filePath: f.filePath || files[0].path,
          line: Math.max(1, Number(f.line) || 1),
          severity: validSeverities.has(f.severity)
            ? (f.severity as ReviewFinding['severity'])
            : 'suggestion',
          title: f.title,
          rationale: f.rationale,
          status: 'open' as const,
          suggestedCode: f.suggestedCode || undefined,
        })
      );

      return res.json({
        source: 'gemini',
        summary: parsed.summary || `Completed AI code review with ${findings.length} findings.`,
        findings,
      });
    } catch (err) {
      const reason = shouldFallbackUpstreamError(err)
        ? markQuotaCooldownFromError(err, apiKey)
        : formatGeminiErrorMessage(err);
      console.warn('Gemini /api/ai/review-pr fallback:', reason);
      const deterministic = buildDeterministicReview(files);
      return res.json({
        ...deterministic,
        summary: `${deterministic.summary} (Built-in engine fallback: ${reason})`,
        fallbackReason: reason,
      });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Patchline server listening on http://localhost:${PORT}`);
  });
}

startServer();
