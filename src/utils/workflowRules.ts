import type {
  JiraTicket,
  NewTicketInput,
  PullRequest,
  ReviewFinding,
  TicketStatus,
} from '../types';

export interface TicketValidationResult {
  valid: boolean;
  errors: Partial<Record<keyof NewTicketInput, string>>;
}

export function validateNewTicket(input: NewTicketInput): TicketValidationResult {
  const errors: Partial<Record<keyof NewTicketInput, string>> = {};

  if (!input.title || input.title.trim().length < 5) {
    errors.title = 'Title must be at least 5 characters.';
  }

  if (!input.repo || (input.repo !== 'auto' && !input.repo.includes('/'))) {
    errors.repo = 'Select Auto-resolve or specify owner/name.';
  }

  if (!input.description || input.description.trim().length < 10) {
    errors.description = 'Description must explain the problem (10+ characters).';
  }

  const criteriaLines = input.acceptanceCriteriaText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (criteriaLines.length === 0) {
    errors.acceptanceCriteriaText = 'Add at least one acceptance criterion.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function filterTickets(
  tickets: JiraTicket[],
  query: string,
  statusFilter: 'all' | TicketStatus
): JiraTicket[] {
  const normalized = query.trim().toLowerCase();
  return tickets.filter((ticket) => {
    if (statusFilter !== 'all' && ticket.status !== statusFilter) {
      return false;
    }
    if (!normalized) return true;
    return (
      ticket.key.toLowerCase().includes(normalized) ||
      ticket.title.toLowerCase().includes(normalized) ||
      ticket.repo.toLowerCase().includes(normalized) ||
      ticket.assignee.toLowerCase().includes(normalized)
    );
  });
}

export interface ReviewSummary {
  total: number;
  open: number;
  resolved: number;
  dismissed: number;
  criticalOpen: number;
  suggestionOpen: number;
  nitpickOpen: number;
}

export function getReviewSummary(findings: ReviewFinding[]): ReviewSummary {
  let open = 0;
  let resolved = 0;
  let dismissed = 0;
  let criticalOpen = 0;
  let suggestionOpen = 0;
  let nitpickOpen = 0;

  for (const f of findings) {
    if (f.status === 'resolved') {
      resolved += 1;
    } else if (f.status === 'dismissed') {
      dismissed += 1;
    } else {
      open += 1;
      if (f.severity === 'critical') criticalOpen += 1;
      if (f.severity === 'suggestion') suggestionOpen += 1;
      if (f.severity === 'nitpick') nitpickOpen += 1;
    }
  }

  return {
    total: findings.length,
    open,
    resolved,
    dismissed,
    criticalOpen,
    suggestionOpen,
    nitpickOpen,
  };
}

export interface MergeGateResult {
  allowed: boolean;
  reasons: string[];
}

/**
 * Enforces human-in-the-loop merge safety:
 * AI can draft PRs and flag code issues, but a developer must explicitly approve
 * and resolve critical findings with all tests passing before merge is unlocked.
 */
export function canMergePullRequest(pr: PullRequest): MergeGateResult {
  const reasons: string[] = [];

  if (pr.status === 'merged') {
    reasons.push('Pull request is already merged.');
  }

  const failingTests = pr.testSuite.filter((t) => t.status === 'failed');
  if (pr.testSuite.length === 0) {
    reasons.push('At least one automated test check must run.');
  } else if (failingTests.length > 0) {
    reasons.push(`${failingTests.length} test case(s) failing.`);
  }

  const openCritical = pr.findings.filter(
    (f) => f.severity === 'critical' && f.status === 'open'
  );
  if (openCritical.length > 0) {
    reasons.push(`${openCritical.length} critical finding(s) must be resolved or dismissed.`);
  }

  if (pr.humanReviewStatus !== 'approved') {
    reasons.push('Developer approval is required before merging.');
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}

export interface ChecklistItem {
  id: string;
  label: string;
  detail: string;
  satisfied: boolean;
  blocking: boolean;
}

export function getMergeReadinessChecklist(pr: PullRequest): ChecklistItem[] {
  const passedCount = pr.testSuite.filter((t) => t.status === 'passed').length;
  const totalTests = pr.testSuite.length;
  const testsPassing = totalTests > 0 && passedCount === totalTests;

  const summary = getReviewSummary(pr.findings);
  const noCritical = summary.criticalOpen === 0;

  return [
    {
      id: 'tests',
      label: 'Automated test suite',
      detail:
        totalTests > 0
          ? `${passedCount}/${totalTests} checks passing`
          : 'No tests executed',
      satisfied: testsPassing,
      blocking: !testsPassing,
    },
    {
      id: 'ai-review',
      label: 'AI code review findings',
      detail: !pr.aiReviewRan
        ? 'Not run yet (optional)'
        : summary.total === 0
        ? '0 issues flagged'
        : `${summary.resolved + summary.dismissed}/${summary.total} addressed · ${summary.criticalOpen} critical open`,
      satisfied: noCritical,
      blocking: !noCritical,
    },
    {
      id: 'human-approval',
      label: 'Developer sign-off',
      detail:
        pr.humanReviewStatus === 'approved'
          ? 'Approved by reviewer'
          : pr.humanReviewStatus === 'changes_requested'
          ? 'Changes requested'
          : 'Awaiting your review decision',
      satisfied: pr.humanReviewStatus === 'approved',
      blocking: pr.humanReviewStatus !== 'approved',
    },
  ];
}

export function slugifyBranchName(key: string, title: string): string {
  const cleanKey = key.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const cleanTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-');
  return `feat/${cleanKey}-${cleanTitle || 'update'}`;
}

export function slugifyAgentBranchName(key: string, baseSha: string): string {
  const cleanKey = key.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const shortSha = (baseSha || 'head').slice(0, 7).toLowerCase();
  return `agent/${cleanKey}-${shortSha}`;
}

