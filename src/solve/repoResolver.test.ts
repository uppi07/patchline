import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_REPOSITORIES } from '../data/seedData.ts';
import type { JiraTicket } from '../types.ts';
import {
  buildIdempotencyKey,
  detectUpstreamDrift,
  getJiraTransitionLabel,
  resolveTargetRepository,
} from './repoResolver.ts';

function makeTicket(overrides: Partial<JiraTicket> = {}): JiraTicket {
  return {
    id: 'tkt-test',
    key: 'ENG-500',
    title: 'Sample ticket',
    description: 'Sample description',
    acceptanceCriteria: ['Pass unit tests'],
    repo: 'auto',
    baseBranch: 'main',
    repoResolution: 'auto',
    targetFiles: [],
    priority: 'High',
    storyPoints: 3,
    status: 'ready',
    assignee: 'Marcus Vance',
    updatedAt: 'just now',
    ...overrides,
  };
}

test('Level 1: resolves immediately from structured Jira repo:, branch:, and pkg: labels', () => {
  const result = resolveTargetRepository(
    makeTicket({
      key: 'PLAT-901',
      labels: ['repo:acme-corp/platform-monorepo', 'branch:release/v2.4', 'pkg:packages/retry-policy'],
    }),
    SEED_REPOSITORIES
  );

  assert.equal(result.status, 'resolved');
  assert.equal(result.level, 1);
  assert.equal(result.strategy, 'jira_label');
  assert.equal(result.resolvedRepo, 'acme-corp/platform-monorepo');
  assert.equal(result.baseBranch, 'release/v2.4');
  assert.equal(result.packagePath, 'packages/retry-policy');
});

test('Level 2: resolves uniquely from Jira project key and component binding', () => {
  const result = resolveTargetRepository(
    makeTicket({
      key: 'AUTH-112',
      jiraProject: 'AUTH',
      components: ['oauth'],
    }),
    SEED_REPOSITORIES
  );

  assert.equal(result.status, 'resolved');
  assert.equal(result.level, 2);
  assert.equal(result.strategy, 'project_component');
  assert.equal(result.resolvedRepo, 'acme-corp/auth-service');
  assert.equal(result.baseBranch, 'main');
});

test('Level 3: resolves from target file path and Python runtime hints', () => {
  const result = resolveTargetRepository(
    makeTicket({
      key: 'OPS-301',
      title: 'Fix asyncio invoice batch error handling',
      description: 'Update pytest coverage for worker/invoice_uploader.py',
      targetFiles: ['worker/invoice_uploader.py'],
    }),
    SEED_REPOSITORIES
  );

  assert.equal(result.status, 'resolved');
  assert.equal(result.resolvedRepo, 'acme-corp/billing-worker');
});

test('Level 4 Ambiguity Gate: stops as ambiguous when two repos tie closely', () => {
  const result = resolveTargetRepository(
    makeTicket({
      key: 'PLAT-431',
      jiraProject: 'PLAT',
      title: 'Standardize retry backoff jitter across webhook and invoice worker queues',
      description: 'Shared retry policy affects both webhooks and invoice worker queue retries.',
      components: ['webhooks', 'invoice'],
    }),
    SEED_REPOSITORIES
  );

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.level, 4);
  assert.equal(result.strategy, 'ambiguous_gate');
  assert.ok(result.candidates.length >= 2);
});

test('Idempotency key, upstream SHA drift, and Jira transition helpers behave deterministically', () => {
  assert.equal(
    buildIdempotencyKey('ENG-412', 2, 'a4f9c2e8b10d'),
    'ENG-412@rev2@a4f9c2e'
  );
  assert.deepEqual(detectUpstreamDrift('a4f9c2e', 'a4f9c2e'), {
    drifted: false,
    headSha: 'a4f9c2e',
  });
  assert.deepEqual(detectUpstreamDrift('a4f9c2e', 'ff00aa1'), {
    drifted: true,
    headSha: 'ff00aa1',
  });
  assert.equal(getJiraTransitionLabel(SEED_REPOSITORIES[0], 'pr_opened'), 'In Review');
});
