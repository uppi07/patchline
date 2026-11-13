import test from 'node:test';
import assert from 'node:assert/strict';
import type { JiraTicket } from '../types';
import { runSolvePipeline, type SolveModelDriver } from './orchestrator';

function makeTicket(overrides: Partial<JiraTicket> = {}): JiraTicket {
  return {
    id: 'tkt-412',
    key: 'ENG-412',
    title: 'Enforce constant-time Stripe webhook signature & replay window check',
    description: 'Enforce 300s replay tolerance and timingSafeEqual digest checks.',
    acceptanceCriteria: [
      'Reject headers missing t= or v1=',
      'Reject timestamps older than 300s',
    ],
    repo: 'acme-corp/payments-api',
    baseBranch: 'main',
    pinnedSha: 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
    targetFiles: [
      'src/webhooks/verifyStripeSignature.ts',
      'src/webhooks/verifyStripeSignature.test.ts',
    ],
    priority: 'Urgent',
    storyPoints: 3,
    status: 'ready',
    assignee: 'Marcus Vance',
    updatedAt: 'just now',
    ...overrides,
  };
}

test('5-stage Solve pipeline keeps Jira Ready during Plan, moves In Progress on Edit, verifies in sandbox, and opens Draft PR in In Review', async () => {
  const seenStages: string[] = [];
  const jiraTransitions: string[] = [];

  const run = await runSolvePipeline({
    runId: 'run-1',
    ticket: makeTicket(),
    baseSha: 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
    scopeRevision: 1,
    executionMode: 'bounded',
    maxModelCalls: 3,
    testCommand: 'npx vitest run',
    nextPrNumber: 1082,
    onUpdate: (snapshot) => {
      if (!seenStages.includes(snapshot.currentStage)) {
        seenStages.push(snapshot.currentStage);
      }
      if (jiraTransitions.at(-1) !== snapshot.jiraStatusCurrent) {
        jiraTransitions.push(snapshot.jiraStatusCurrent);
      }
    },
  });

  assert.equal(run.status, 'succeeded');
  assert.deepEqual(run.completedStages, ['indexing', 'planning', 'solving', 'verifying', 'publishing']);
  assert.deepEqual(jiraTransitions, ['ready', 'in_progress', 'in_review']);
  assert.equal(run.verification?.status, 'passed');
  assert.equal(run.verification?.exitCode, 0);
  assert.equal(run.prResult?.draft, true);
  assert.equal(run.prResult?.status, 'draft');
  assert.equal(run.prResult?.headBranch, 'agent/eng-412-a4f9c2e');
  assert.equal(run.checkpoints.length, 10);
});

test('Ambiguous ticket stops cleanly in needs_info without moving Jira to In Progress', async () => {
  const ambiguousDriver: SolveModelDriver = {
    async generatePlan() {
      return {
        kind: 'needs_info',
        questions: ['Which HTTP status code should be returned for expired tokens?'],
      };
    },
    async generatePatch() {
      throw new Error('Should never generate patch when needs_info');
    },
  };

  const run = await runSolvePipeline({
    runId: 'run-ambiguous',
    ticket: makeTicket(),
    baseSha: 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
    scopeRevision: 1,
    executionMode: 'bounded',
    maxModelCalls: 3,
    testCommand: 'npx vitest run',
    nextPrNumber: 1083,
    modelDriver: ambiguousDriver,
  });

  assert.equal(run.status, 'needs_info');
  assert.equal(run.jiraStatusCurrent, 'ready');
  assert.equal(run.prResult, undefined);
  assert.equal(run.questions?.length, 1);
});

test('Recoverable anchor mismatch triggers automatic self-repair instead of aborting', async () => {
  let patchAttempt = 0;
  const selfRepairDriver: SolveModelDriver = {
    async generatePlan() {
      return {
        kind: 'plan',
        plan: {
          summary: 'Update Stripe verification',
          targetFiles: ['src/webhooks/verifyStripeSignature.ts'],
          steps: ['Update equality check'],
          notes: 'Keep export intact',
        },
      };
    },
    async generatePatch({ repairFeedback }) {
      patchAttempt++;
      if (patchAttempt === 1) {
        return {
          prTitle: 'feat: bad anchor first',
          prSummary: 'Attempt 1',
          edits: [
            {
              path: 'src/webhooks/verifyStripeSignature.ts',
              summary: 'First attempt with stale anchor',
              replacements: [{ before: 'NONEXISTENT_LINE()', after: 'FIXED()' }],
            },
          ],
        };
      }
      assert.match(repairFeedback || '', /Anchor #1 not found/);
      return {
        prTitle: 'feat: self-repaired patch',
        prSummary: 'Attempt 2 after recoverable diagnostic',
        edits: [
          {
            path: 'src/webhooks/verifyStripeSignature.ts',
            summary: 'Self-repaired exact anchor',
            replacements: [
              {
                before: '  return sig === expected;',
                after: '  return Boolean(sig) && sig === expected;',
              },
            ],
          },
        ],
      };
    },
  };

  const run = await runSolvePipeline({
    runId: 'run-repair',
    ticket: makeTicket(),
    baseSha: 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
    scopeRevision: 1,
    executionMode: 'bounded',
    maxModelCalls: 12,
    testCommand: 'npx vitest run',
    nextPrNumber: 1084,
    modelDriver: selfRepairDriver,
  });

  assert.equal(run.status, 'succeeded');
  assert.equal(run.repairAttempts, 1);
  assert.ok(run.toolEvents.some((e) => e.tool === 'apply_edit' && e.ok === false && e.recoverableError));
  assert.ok(run.toolEvents.some((e) => e.tool === 'apply_edit' && e.ok === true));
});

test('Failed verification runs baselineCheck on baseSha and blocks PR publication', async () => {
  const brokenTestDriver: SolveModelDriver = {
    async generatePlan() {
      return {
        kind: 'plan',
        plan: {
          summary: 'Broken test plan',
          targetFiles: ['src/webhooks/verifyStripeSignature.test.ts'],
          steps: ['Add failing assertion'],
          notes: '',
        },
      };
    },
    async generatePatch() {
      return {
        prTitle: 'feat: broken tests',
        prSummary: 'Should fail verification',
        edits: [
          {
            path: 'src/webhooks/verifyStripeSignature.test.ts',
            summary: 'Intentional assertion failure',
            createContent: [
              'import { describe, expect, it } from "vitest";',
              'describe("broken", () => {',
              '  it("fails assertion", () => {',
              '    expect(1).toBe(2);',
              '  });',
              '});',
            ].join('\n'),
          },
        ],
      };
    },
  };

  const run = await runSolvePipeline({
    runId: 'run-fail-verify',
    ticket: makeTicket(),
    baseSha: 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
    scopeRevision: 1,
    executionMode: 'bounded',
    maxModelCalls: 12,
    testCommand: 'npx vitest run',
    nextPrNumber: 1085,
    modelDriver: brokenTestDriver,
  });

  assert.equal(run.status, 'failed');
  assert.equal(run.verification?.status, 'failed');
  assert.equal(run.verification?.baselineCheck?.status, 'passed');
  assert.equal(run.prResult, undefined);
  assert.equal(run.checkpoints.length, 0);
});

const SAMPLE_429_ERROR = JSON.stringify({
  error: {
    code: 429,
    message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 20.',
    status: 'RESOURCE_EXHAUSTED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '16564s' }],
  },
});

test('Stage 2 429 quota error falls back cleanly to built-in engine and opens Draft PR', async () => {
  const quotaStage2Driver: SolveModelDriver = {
    async generatePlan() {
      throw new Error(SAMPLE_429_ERROR);
    },
    async generatePatch() {
      throw new Error('Should use deterministic fallback after Stage 2 quota error');
    },
  };

  const run = await runSolvePipeline({
    runId: 'run-quota-stage2',
    ticket: makeTicket(),
    baseSha: 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
    scopeRevision: 1,
    executionMode: 'bounded',
    maxModelCalls: 3,
    testCommand: 'npx vitest run',
    nextPrNumber: 1086,
    modelDriver: quotaStage2Driver,
  });

  assert.equal(run.status, 'succeeded');
  assert.equal(run.source, 'deterministic');
  assert.match(run.fallbackReason || '', /Gemini Free Tier daily quota reached/);
  assert.equal(run.jiraStatusCurrent, 'in_review');
  assert.equal(run.prResult?.draft, true);
  assert.equal(run.prResult?.number, 1086);
});

test('Mid-run Stage 3 429 quota error after Stage 2 plan succeeds falls back cleanly to built-in engine', async () => {
  const quotaStage3Driver: SolveModelDriver = {
    async generatePlan() {
      return {
        kind: 'plan',
        plan: {
          summary: 'Plan created by Gemini before quota limit hit in Stage 3',
          targetFiles: [
            'src/webhooks/verifyStripeSignature.ts',
            'src/webhooks/verifyStripeSignature.test.ts',
          ],
          steps: ['Enforce 300s tolerance window', 'Use crypto.timingSafeEqual'],
          notes: 'Preserve exported signature',
        },
      };
    },
    async generatePatch() {
      throw new Error(SAMPLE_429_ERROR);
    },
  };

  const run = await runSolvePipeline({
    runId: 'run-quota-stage3',
    ticket: makeTicket(),
    baseSha: 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
    scopeRevision: 1,
    executionMode: 'bounded',
    maxModelCalls: 3,
    testCommand: 'npx vitest run',
    nextPrNumber: 1087,
    modelDriver: quotaStage3Driver,
  });

  assert.equal(run.status, 'succeeded');
  assert.equal(run.source, 'deterministic');
  assert.match(run.fallbackReason || '', /Gemini Free Tier daily quota reached/);
  assert.equal(run.verification?.status, 'passed');
  assert.equal(run.jiraStatusCurrent, 'in_review');
  assert.equal(run.prResult?.number, 1087);
});

test('Ambiguous auto-resolved ticket stops at Stage 0 needs_info and monorepo packagePath scopes indexing cleanly', async () => {
  const { SEED_REPOSITORIES } = await import('../data/seedData');

  const ambiguousRun = await runSolvePipeline({
    runId: 'run-ambiguous-repo',
    ticket: makeTicket({
      id: 'tkt-plat-431',
      key: 'PLAT-431',
      repo: 'auto',
      repoResolution: 'auto',
      jiraProject: 'PLAT',
      components: ['webhooks', 'invoice'],
      title: 'Standardize retry backoff across webhook and invoice worker queues',
      description: 'Shared retry policy affects both webhooks and invoice worker queue retries.',
      targetFiles: [],
    }),
    baseSha: '9d42f18a6b7e3c01d529a4f8e1c6b03d2a7e5190',
    scopeRevision: 1,
    executionMode: 'bounded',
    maxModelCalls: 3,
    testCommand: 'npx vitest run',
    nextPrNumber: 1088,
    repositories: SEED_REPOSITORIES,
  });

  assert.equal(ambiguousRun.status, 'needs_info');
  assert.equal(ambiguousRun.jiraStatusCurrent, 'ready');
  assert.equal(ambiguousRun.repoResolution?.status, 'ambiguous');
  assert.ok((ambiguousRun.repoResolution?.candidates.length || 0) >= 2);

  // Confirming target monorepo + package scopes indexing and passes verification
  const scopedRun = await runSolvePipeline({
    runId: 'run-scoped-monorepo',
    ticket: makeTicket({
      id: 'tkt-plat-431',
      key: 'PLAT-431',
      repo: 'acme-corp/platform-monorepo',
      baseBranch: 'main',
      repoResolution: 'explicit',
      packagePath: 'packages/retry-policy',
      title: 'Add bounded full-jitter exponential backoff',
      description: 'Add jitterRatio option to computeBackoffDelay inside retry-policy.',
      targetFiles: [
        'packages/retry-policy/src/backoff.ts',
        'packages/retry-policy/src/backoff.test.ts',
      ],
    }),
    baseSha: '9d42f18a6b7e3c01d529a4f8e1c6b03d2a7e5190',
    scopeRevision: 2,
    executionMode: 'bounded',
    maxModelCalls: 3,
    testCommand: 'pnpm --filter @acme/retry-policy test',
    nextPrNumber: 1088,
    repositories: SEED_REPOSITORIES,
  });

  assert.equal(scopedRun.status, 'succeeded');
  assert.equal(scopedRun.packagePath, 'packages/retry-policy');
  assert.equal(scopedRun.indexedFilesCount, 4);
  assert.equal(scopedRun.prResult?.packagePath, 'packages/retry-policy');
  assert.equal(scopedRun.prResult?.number, 1088);
});

test('Re-running with existing open Draft PR on identical headBranch updates idempotently', async () => {
  const firstRun = await runSolvePipeline({
    runId: 'run-idem-1',
    ticket: makeTicket(),
    baseSha: 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
    scopeRevision: 1,
    executionMode: 'bounded',
    maxModelCalls: 3,
    testCommand: 'npx vitest run',
    nextPrNumber: 1089,
  });

  assert.equal(firstRun.status, 'succeeded');
  assert.ok(firstRun.prResult);

  const secondRun = await runSolvePipeline({
    runId: 'run-idem-2',
    ticket: makeTicket(),
    baseSha: 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
    scopeRevision: 2,
    executionMode: 'bounded',
    maxModelCalls: 3,
    testCommand: 'npx vitest run',
    nextPrNumber: 1099,
    existingOpenPr: firstRun.prResult,
  });

  assert.equal(secondRun.status, 'succeeded');
  assert.equal(secondRun.reusedExistingPr, true);
  assert.equal(secondRun.prResult?.number, 1089);
});


