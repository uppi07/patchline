export type TicketPriority = 'Urgent' | 'High' | 'Medium' | 'Low';
export type TicketStatus = 'ready' | 'in_progress' | 'in_review' | 'done';

export type PrStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'merged';
export type HumanReviewDecision = 'pending' | 'approved' | 'changes_requested';
export type MergeStrategy = 'squash' | 'merge' | 'rebase';

export type ReviewSeverity = 'critical' | 'suggestion' | 'nitpick';
export type FindingStatus = 'open' | 'resolved' | 'dismissed';

export type WorkspaceTab = 'ticket-to-pr' | 'code-review' | 'pull-requests' | 'repositories';

export type SolveStageId =
  | 'indexing'
  | 'planning'
  | 'solving'
  | 'verifying'
  | 'publishing';

export type SolveRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'needs_info'
  | 'failed'
  | 'cancelled';

export type SolveExecutionMode = 'bounded' | 'continuous';

export interface SolveToolCallEvent {
  id: string;
  step: number;
  tool: 'search_code' | 'read_lines' | 'apply_edit' | 'run_sandbox_check';
  summary: string;
  ok: boolean;
  recoverableError?: string;
  durationMs: number;
  timestamp: string;
}

export interface PublishCheckpoint {
  stage: 'blob' | 'tree' | 'commit' | 'branch' | 'pullRequest';
  phase: 'before' | 'after';
  detail: string;
  timestamp: string;
}

export interface VerificationBaselineCheck {
  status: 'passed' | 'failed';
  command: string;
  exitCode: number;
  summary: string;
}

export interface VerificationReport {
  status: 'passed' | 'failed' | 'unavailable';
  command: string;
  exitCode: number;
  durationMs: number;
  log: string;
  baselineCheck?: VerificationBaselineCheck;
}

export interface SolvePlan {
  summary: string;
  targetFiles: string[];
  steps: string[];
  notes: string;
}

export interface SolveRun {
  id: string;
  ticketId: string;
  ticketKey: string;
  repo: string;
  baseBranch: string;
  baseSha: string;
  scopeRevision: number;
  executionMode: SolveExecutionMode;
  maxModelCalls: number | null;
  modelCallsUsed: number;
  repairAttempts: number;
  status: SolveRunStatus;
  currentStage: SolveStageId;
  completedStages: SolveStageId[];
  jiraStatusAtStart: TicketStatus;
  jiraStatusCurrent: TicketStatus;
  indexedFilesCount: number;
  source: 'gemini' | 'deterministic';
  fallbackReason?: string;
  plan?: SolvePlan;
  questions?: string[];
  toolEvents: SolveToolCallEvent[];
  verification?: VerificationReport;
  checkpoints: PublishCheckpoint[];
  prResult?: PullRequest;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiffLine {
  type: 'context' | 'add' | 'del';
  oldLine?: number;
  newLine?: number;
  content: string;
}

export interface ChangedFile {
  path: string;
  language: string;
  summary: string;
  lines: DiffLine[];
}

export interface TestCaseResult {
  id: string;
  name: string;
  suite: string;
  durationMs: number;
  status: 'passed' | 'failed';
  assertions: string;
}

export interface ReviewFinding {
  id: string;
  filePath: string;
  line: number;
  severity: ReviewSeverity;
  title: string;
  rationale: string;
  status: FindingStatus;
  suggestedCode?: string;
  originalSnippet?: string;
  appliedFix?: boolean;
  replyNote?: string;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  timestamp: string;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  summary: string;
  repo: string;
  baseBranch: string;
  baseSha?: string;
  headBranch: string;
  commitSha?: string;
  draft?: boolean;
  linkedTicketKey?: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
  status: PrStatus;
  humanReviewStatus: HumanReviewDecision;
  reviewComment: string;
  mergeStrategy: MergeStrategy;
  mergedAt?: string;
  planSteps: string[];
  files: ChangedFile[];
  testCommand: string;
  testSuite: TestCaseResult[];
  aiReviewRan: boolean;
  aiReviewSummary?: string;
  findings: ReviewFinding[];
  auditTrail: AuditEntry[];
}

export interface JiraTicket {
  id: string;
  key: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  repo: string;
  baseBranch: string;
  pinnedSha?: string;
  targetFiles: string[];
  priority: TicketPriority;
  storyPoints: number;
  status: TicketStatus;
  assignee: string;
  updatedAt: string;
  linkedPrId?: string;
}

export interface RepositoryConfig {
  id: string;
  fullName: string;
  defaultBranch: string;
  pinnedSha: string;
  language: string;
  testCommand: string;
  requireHumanApproval: boolean;
  autoRunAiReview: boolean;
  openPrCount: number;
}

export interface NewTicketInput {
  key?: string;
  title: string;
  description: string;
  repo: string;
  priority: TicketPriority;
  acceptanceCriteriaText: string;
  targetFilesText: string;
}
