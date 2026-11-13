import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canMergePullRequest,
  filterTickets,
  getMergeReadinessChecklist,
  getReviewSummary,
  slugifyAgentBranchName,
  slugifyBranchName,
  validateNewTicket,
} from './workflowRules';
import type { JiraTicket, PullRequest } from '../types';

function makeBasePr(): PullRequest {
  return {
    id: 'pr-1',
    number: 1081,
    title: 'feat(auth): rotate refresh tokens',
    summary: 'Rotates refresh tokens on reuse.',
    repo: 'acme-corp/auth-service',
    baseBranch: 'main',
    headBranch: 'feat/eng-409-rotate-tokens',
    authorName: 'Marcus Vance',
    authorRole: 'Staff Engineer',
    createdAt: '2h ago',
    status: 'in_review',
    humanReviewStatus: 'pending',
    reviewComment: '',
    mergeStrategy: 'squash',
    planSteps: ['Step 1'],
    files: [],
    testCommand: 'npx vitest run',
    testSuite: [
      {
        id: 't1',
        name: 'rotates token on reuse',
        suite: 'auth.test.ts',
        durationMs: 42,
        status: 'passed',
        assertions: '2 assertions',
      },
    ],
    aiReviewRan: true,
    findings: [
      {
        id: 'f1',
        filePath: 'src/auth.ts',
        line: 12,
        severity: 'critical',
        title: 'Missing transaction lock',
        rationale: 'Concurrent refresh can race.',
        status: 'open',
      },
    ],
    auditTrail: [],
  };
}

test('canMergePullRequest blocks merge until human approves and critical findings are resolved', () => {
  const pr = makeBasePr();
  let gate = canMergePullRequest(pr);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reasons.length, 2);

  // Approve without resolving critical finding -> still blocked
  pr.humanReviewStatus = 'approved';
  gate = canMergePullRequest(pr);
  assert.equal(gate.allowed, false);
  assert.match(gate.reasons[0], /critical finding/);

  // Resolve critical finding -> allowed
  pr.findings[0].status = 'resolved';
  gate = canMergePullRequest(pr);
  assert.equal(gate.allowed, true);
  assert.equal(gate.reasons.length, 0);
});

test('canMergePullRequest blocks merge when any test fails', () => {
  const pr = makeBasePr();
  pr.humanReviewStatus = 'approved';
  pr.findings[0].status = 'resolved';
  pr.testSuite[0].status = 'failed';

  const gate = canMergePullRequest(pr);
  assert.equal(gate.allowed, false);
  assert.match(gate.reasons[0], /failing/);
});

test('validateNewTicket rejects incomplete input and accepts valid input', () => {
  const bad = validateNewTicket({
    title: 'Fix',
    description: 'short',
    repo: 'invalidrepo',
    priority: 'High',
    acceptanceCriteriaText: '   ',
    targetFilesText: '',
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.title);
  assert.ok(bad.errors.repo);
  assert.ok(bad.errors.description);
  assert.ok(bad.errors.acceptanceCriteriaText);

  const good = validateNewTicket({
    title: 'Enforce idempotency key header',
    description: 'Require Idempotency-Key on POST /v1/charges and cache responses.',
    repo: 'acme-corp/payments-api',
    priority: 'High',
    acceptanceCriteriaText: 'Returns 400 when header missing\nReplays cached 200 payload',
    targetFilesText: 'src/routes/charges.ts',
  });
  assert.equal(good.valid, true);
});

test('filterTickets matches query and status accurately', () => {
  const tickets: JiraTicket[] = [
    {
      id: '1',
      key: 'ENG-412',
      title: 'Stripe webhook timing check',
      description: 'Desc',
      acceptanceCriteria: ['AC1'],
      repo: 'acme-corp/payments-api',
      baseBranch: 'main',
      targetFiles: [],
      priority: 'High',
      storyPoints: 3,
      status: 'ready',
      assignee: 'Marcus Vance',
      updatedAt: '1h ago',
    },
    {
      id: '2',
      key: 'ENG-409',
      title: 'Refresh token rotation',
      description: 'Desc',
      acceptanceCriteria: ['AC1'],
      repo: 'acme-corp/auth-service',
      baseBranch: 'main',
      targetFiles: [],
      priority: 'Urgent',
      storyPoints: 5,
      status: 'in_review',
      assignee: 'Elena Rostova',
      updatedAt: '2h ago',
    },
  ];

  assert.equal(filterTickets(tickets, '', 'all').length, 2);
  assert.equal(filterTickets(tickets, 'stripe', 'ready').length, 1);
  assert.equal(filterTickets(tickets, 'stripe', 'in_review').length, 0);
  assert.equal(filterTickets(tickets, '', 'in_progress').length, 0);
  assert.equal(filterTickets(tickets, 'ENG-409', 'all')[0].key, 'ENG-409');
});

test('getReviewSummary & getMergeReadinessChecklist compute accurate counts', () => {
  const pr = makeBasePr();
  const summary = getReviewSummary(pr.findings);
  assert.equal(summary.criticalOpen, 1);
  assert.equal(summary.total, 1);

  const checklist = getMergeReadinessChecklist(pr);
  assert.equal(checklist.length, 3);
  assert.equal(checklist[0].satisfied, true);
  assert.equal(checklist[1].satisfied, false);
  assert.equal(checklist[2].satisfied, false);
});

test('slugifyBranchName & slugifyAgentBranchName produce deterministic git branch names', () => {
  assert.equal(
    slugifyBranchName('ENG-412', 'Enforce Constant-Time Stripe Signature Verification!'),
    'feat/eng-412-enforce-constant-time-stripe-signature'
  );
  assert.equal(
    slugifyAgentBranchName('ENG-412', 'a4f9c2e8b10d3e7f6a92'),
    'agent/eng-412-a4f9c2e'
  );
});
