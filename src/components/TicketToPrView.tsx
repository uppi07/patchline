import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  FileCode2,
  FlaskConical,
  GitBranch,
  Play,
  RotateCw,
  ScanSearch,
} from 'lucide-react';
import { resolveTargetRepository } from '../solve/repoResolver';
import { computeDiffStats } from '../utils/diffParser';
import { DiffViewer } from './DiffViewer';
import { HumanMergeGate } from './HumanMergeGate';
import { SolvePipelinePanel } from './SolvePipelinePanel';
import type {
  JiraTicket,
  MergeStrategy,
  PullRequest,
  RepositoryConfig,
  SolveExecutionMode,
  SolveRun,
} from '../types';

interface TicketToPrViewProps {
  ticket: JiraTicket;
  repositories: RepositoryConfig[];
  pinnedSha: string;
  upstreamHeadSha?: string;
  scopeRevision: number;
  linkedPr?: PullRequest;
  solveRun?: SolveRun;
  executionMode: SolveExecutionMode;
  budgetLimit: 3 | 12;
  isReviewLoading: boolean;
  errorMessage: string | null;
  onChangeExecutionMode: (mode: SolveExecutionMode) => void;
  onChangeBudgetLimit: (limit: 3 | 12) => void;
  onStartSolve: (ticket: JiraTicket, guidance: string) => void;
  onResolveAmbiguousTarget: (repo: string, baseBranch: string, packagePath?: string) => void;
  onSyncToLatestSha: (ticketId: string) => void;
  onCancelSolve: (runId: string) => void;
  onRerunTests: (prId: string) => void;
  onRunAiReview: (prId: string) => void;
  onOpenInReviewTab: (prId: string) => void;
  onAcceptFix: (prId: string, findingId: string) => void;
  onResolveFinding: (prId: string, findingId: string) => void;
  onDismissFinding: (prId: string, findingId: string) => void;
  onApprovePr: (prId: string, comment: string) => void;
  onRequestChanges: (prId: string, comment: string) => void;
  onChangeMergeStrategy: (prId: string, strategy: MergeStrategy) => void;
  onMergePr: (prId: string) => void;
}

export function TicketToPrView({
  ticket,
  repositories,
  pinnedSha,
  upstreamHeadSha,
  scopeRevision,
  linkedPr,
  solveRun,
  executionMode,
  budgetLimit,
  isReviewLoading,
  errorMessage,
  onChangeExecutionMode,
  onChangeBudgetLimit,
  onStartSolve,
  onResolveAmbiguousTarget,
  onSyncToLatestSha,
  onCancelSolve,
  onRerunTests,
  onRunAiReview,
  onOpenInReviewTab,
  onAcceptFix,
  onResolveFinding,
  onDismissFinding,
  onApprovePr,
  onRequestChanges,
  onChangeMergeStrategy,
  onMergePr,
}: TicketToPrViewProps) {
  const [guidance, setGuidance] = useState('');
  const [prSubTab, setPrSubTab] = useState<'files' | 'tests' | 'plan' | 'trace'>('files');

  const isSolving =
    solveRun?.status === 'queued' || solveRun?.status === 'running';

  const resolutionPreview = resolveTargetRepository(ticket, repositories);
  const resolvedRepoDisplay =
    resolutionPreview.resolvedRepo ||
    (ticket.repo === 'auto' ? 'Auto-resolve (Needs Confirm)' : ticket.repo);
  const resolvedBranchDisplay =
    resolutionPreview.baseBranch || ticket.baseBranch || 'main';
  const hasUpstreamDrift =
    Boolean(upstreamHeadSha) && upstreamHeadSha !== pinnedSha;
  const hasPrDrift =
    Boolean(upstreamHeadSha && linkedPr?.baseSha) &&
    upstreamHeadSha !== linkedPr?.baseSha;

  const diffStats = linkedPr ? computeDiffStats(linkedPr.files) : null;
  const passedTests = linkedPr
    ? linkedPr.testSuite.filter((t) => t.status === 'passed').length
    : 0;
  const totalTestMs = linkedPr
    ? linkedPr.testSuite.reduce((sum, t) => sum + t.durationMs, 0)
    : 0;

  const activeBudgetChoice =
    executionMode === 'continuous'
      ? 'continuous'
      : budgetLimit === 12
      ? 'extended'
      : 'bounded';

  return (
    <div className="mx-auto max-w-[1320px] space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Contextual Header & Breadcrumb */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start dark:border-slate-800">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
              {ticket.repo}
            </span>
            <span aria-hidden="true">/</span>
            <span className="font-mono font-semibold text-slate-900 dark:text-white">
              {ticket.key}
            </span>
            <span aria-hidden="true">·</span>
            <span>{ticket.priority} priority</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{ticket.storyPoints} pts</span>
            <span aria-hidden="true">·</span>
            <span>Assignee: {ticket.assignee}</span>
          </div>

          <h1 className="text-xl font-bold tracking-tight text-slate-900 text-balance sm:text-2xl dark:text-white">
            {ticket.title}
          </h1>
        </div>

        {linkedPr && !isSolving && (
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onOpenInReviewTab(linkedPr.id)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Open in Code Review</span>
            </button>
            {linkedPr.status !== 'merged' && (
              <button
                type="button"
                onClick={() => onStartSolve(ticket, guidance)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Re-run Solve</span>
              </button>
            )}
          </div>
        )}
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        >
          {errorMessage}
        </div>
      )}

      {/* Live 5-Stage Solve Pipeline when running OR before a PR exists */}
      {solveRun && (isSolving || !linkedPr) && (
        <SolvePipelinePanel
          run={solveRun}
          onCancel={onCancelSolve}
          onRetry={() => onStartSolve(ticket, guidance)}
          onResolveAmbiguousTarget={onResolveAmbiguousTarget}
        />
      )}

      {/* State A: Ticket Specification & Solve Configuration (when not actively solving and no PR yet) */}
      {!linkedPr && !isSolving && (
        <div className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Ticket Specification
              </h2>
              <p className="mt-2.5 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {ticket.description}
              </p>

              <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Acceptance Criteria
                </h3>
                <ul className="mt-3 space-y-2.5">
                  {ticket.acceptanceCriteria.map((criterion, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300"
                    >
                      <span className="mt-0.5 font-mono text-xs text-slate-400 tabular-nums">
                        {String(idx + 1).padStart(2, '0')}.
                      </span>
                      <span>{criterion}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Target Context Files
                </h3>
                {ticket.targetFiles.length > 0 ? (
                  <ul className="mt-2.5 space-y-1.5">
                    {ticket.targetFiles.map((filePath) => (
                      <li
                        key={filePath}
                        className="flex items-center gap-2 font-mono text-xs text-slate-600 dark:text-slate-300"
                      >
                        <FileCode2 className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        <span>{filePath}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Auto-indexed across the pinned repository snapshot during Stage 1.
                  </p>
                )}
              </div>

              {(ticket.labels?.length || ticket.crossRepoDependencies?.length || ticket.packagePath) && (
                <div className="mt-5 space-y-1.5 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  {ticket.labels && ticket.labels.length > 0 && (
                    <div>
                      Jira Labels:{' '}
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {ticket.labels.join(' · ')}
                      </span>
                    </div>
                  )}
                  {ticket.packagePath && (
                    <div>
                      Monorepo Scope:{' '}
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {ticket.packagePath}
                      </span>
                    </div>
                  )}
                  {ticket.crossRepoDependencies && ticket.crossRepoDependencies.length > 0 && (
                    <div>
                      Cross-Repo Links:{' '}
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {ticket.crossRepoDependencies.join(' · ')}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4 xl:col-span-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Solve Pipeline Controls
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Indexes the pinned commit, plans changes before moving Jira, repairs edit/test mismatches in a sandbox, and opens a Draft PR only after verification passes.
              </p>

              {/* Execution Budget Selector */}
              <div className="mt-4">
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Execution Budget
                </span>
                <div
                  role="group"
                  aria-label="Solve execution budget"
                  className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-950"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onChangeExecutionMode('bounded');
                      onChangeBudgetLimit(3);
                    }}
                    className={`rounded-md py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors ${
                      activeBudgetChoice === 'bounded'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    Bounded · 3
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onChangeExecutionMode('bounded');
                      onChangeBudgetLimit(12);
                    }}
                    className={`rounded-md py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors ${
                      activeBudgetChoice === 'extended'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    Extended · 12
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeExecutionMode('continuous')}
                    className={`rounded-md py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors ${
                      activeBudgetChoice === 'continuous'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    Continuous
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <label
                  htmlFor="ticket-guidance-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  {solveRun?.status === 'needs_info'
                    ? 'Clarification & Engineering Guidance'
                    : 'Engineering Guidance (Optional)'}
                </label>
                <textarea
                  id="ticket-guidance-input"
                  rows={3}
                  value={guidance}
                  onChange={(e) => setGuidance(e.target.value)}
                  placeholder={
                    solveRun?.status === 'needs_info'
                      ? 'Answer the clarification questions above to unblock planning...'
                      : 'e.g., Use constant-time comparison and keep existing exports...'
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:bg-slate-900"
                />
              </div>

              <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
                <div className="flex items-center justify-between gap-2">
                  <span>Repo resolver</span>
                  <span
                    className={`font-mono font-medium ${
                      resolutionPreview.status === 'ambiguous'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-slate-900 dark:text-slate-200'
                    }`}
                  >
                    L{resolutionPreview.level} · {resolutionPreview.strategy}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Target repo</span>
                  <span className="truncate font-mono text-slate-900 dark:text-slate-200">
                    {resolvedRepoDisplay}
                  </span>
                </div>
                {resolutionPreview.packagePath && (
                  <div className="flex items-center justify-between gap-2">
                    <span>Monorepo scope</span>
                    <span className="font-mono text-slate-900 dark:text-slate-200">
                      {resolutionPreview.packagePath}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span>Pinned snapshot</span>
                  <span className="font-mono text-slate-900 tabular-nums dark:text-slate-200">
                    {resolvedBranchDisplay} @ {pinnedSha.slice(0, 7)}
                  </span>
                </div>
                {hasUpstreamDrift && upstreamHeadSha && (
                  <div className="flex items-center justify-between gap-2 text-[11px] text-amber-700 dark:text-amber-400">
                    <span>Upstream moved to {upstreamHeadSha.slice(0, 7)}</span>
                    <button
                      type="button"
                      onClick={() => onSyncToLatestSha(ticket.id)}
                      className="font-semibold underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-300"
                    >
                      Sync SHA
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span>Scope revision</span>
                  <span className="font-mono text-slate-900 tabular-nums dark:text-slate-200">
                    Rev {scopeRevision}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Jira progression</span>
                  <span className="font-medium text-slate-900 dark:text-slate-200">
                    To Do → In Progress → In Review
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onStartSolve(ticket, guidance)}
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap"
              >
                <span>
                  {solveRun?.status === 'needs_info'
                    ? 'Submit Clarification & Re-run'
                    : 'Start Solve Run'}
                </span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* State B: Generated Pull Request + Tests + Solve Trace + Human Merge Gate */}
      {linkedPr && !isSolving && (
        <div className="grid gap-6 xl:grid-cols-12">
          <div className="min-w-0 space-y-5 xl:col-span-8">
            {/* PR Summary Banner */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-semibold text-slate-900 tabular-nums dark:text-white">
                    {linkedPr.draft || linkedPr.status === 'draft'
                      ? `Draft PR #${linkedPr.number}`
                      : `PR #${linkedPr.number}`}
                  </span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                    ·
                  </span>
                  <span
                    className={`font-semibold ${
                      linkedPr.status === 'merged'
                        ? 'text-purple-700 dark:text-purple-400'
                        : linkedPr.humanReviewStatus === 'approved'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-blue-700 dark:text-blue-400'
                    }`}
                  >
                    {linkedPr.status === 'merged'
                      ? 'Merged'
                      : linkedPr.humanReviewStatus === 'approved'
                      ? 'Approved'
                      : 'Open for Review'}
                  </span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono text-slate-600 dark:text-slate-300">
                    <GitBranch className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    {linkedPr.baseBranch}
                    {linkedPr.baseSha ? ` (${linkedPr.baseSha.slice(0, 7)})` : ''} ← {linkedPr.headBranch}
                  </span>
                </div>

                {diffStats && (
                  <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                    <span className="text-slate-600 dark:text-slate-400">
                      {diffStats.filesChanged} files
                    </span>
                    <span className="text-emerald-700 dark:text-emerald-400">
                      +{diffStats.additions}
                    </span>
                    <span className="text-red-600 dark:text-red-400">
                      -{diffStats.deletions}
                    </span>
                  </div>
                )}
              </div>

              <h2 className="mt-2.5 text-base font-bold text-slate-900 dark:text-white">
                {linkedPr.title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {linkedPr.summary}
              </p>

              {(linkedPr.packagePath || linkedPr.idempotencyKey || ticket.crossRepoDependencies?.length) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {linkedPr.packagePath && <span>Scope: {linkedPr.packagePath}</span>}
                  {linkedPr.idempotencyKey && <span>Key: {linkedPr.idempotencyKey}</span>}
                  {ticket.crossRepoDependencies && ticket.crossRepoDependencies.length > 0 && (
                    <span>Deps: {ticket.crossRepoDependencies.join(', ')}</span>
                  )}
                </div>
              )}

              {hasPrDrift && upstreamHeadSha && linkedPr.status !== 'merged' && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                  <span>
                    Base branch <code className="font-mono">{linkedPr.baseBranch}</code> advanced to{' '}
                    <code className="font-mono">{upstreamHeadSha.slice(0, 7)}</code> (verified on{' '}
                    <code className="font-mono">{linkedPr.baseSha?.slice(0, 7)}</code>).
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onSyncToLatestSha(ticket.id);
                      onStartSolve(
                        { ...ticket, pinnedSha: upstreamHeadSha },
                        guidance
                      );
                    }}
                    className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                  >
                    Re-verify on {upstreamHeadSha.slice(0, 7)}
                  </button>
                </div>
              )}

              {/* Segmented sub-tabs */}
              <div
                role="tablist"
                aria-label="Pull request artifacts"
                className="mt-5 inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={prSubTab === 'files'}
                  onClick={() => setPrSubTab('files')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    prSubTab === 'files'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Changed Files ({linkedPr.files.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={prSubTab === 'tests'}
                  onClick={() => setPrSubTab('tests')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    prSubTab === 'tests'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Test Suite ({passedTests}/{linkedPr.testSuite.length} Passed)
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={prSubTab === 'plan'}
                  onClick={() => setPrSubTab('plan')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    prSubTab === 'plan'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Implementation Plan
                </button>
                {solveRun && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={prSubTab === 'trace'}
                    onClick={() => setPrSubTab('trace')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      prSubTab === 'trace'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    Solve Trace
                  </button>
                )}
              </div>
            </section>

            {/* Tab 1: Changed Files Diff */}
            {prSubTab === 'files' && (
              <DiffViewer
                files={linkedPr.files}
                findings={linkedPr.findings}
                onAcceptFix={(findingId) => onAcceptFix(linkedPr.id, findingId)}
                onResolveFinding={(findingId) => onResolveFinding(linkedPr.id, findingId)}
                onDismissFinding={(findingId) => onDismissFinding(linkedPr.id, findingId)}
              />
            )}

            {/* Tab 2: Automated Test Suite Results */}
            {prSubTab === 'tests' && (
              <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <FlaskConical
                        className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                      />
                      <span>Automated Test Execution</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      <span>$ {linkedPr.testCommand}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {passedTests}/{linkedPr.testSuite.length} passed
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{totalTestMs}ms</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRerunTests(linkedPr.id)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    <Play className="h-3 w-3" aria-hidden="true" />
                    <span>Re-run Tests</span>
                  </button>
                </div>

                <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                  {linkedPr.testSuite.map((tc) => (
                    <li
                      key={tc.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <CheckCircle2
                          className={`mt-0.5 h-4 w-4 shrink-0 ${
                            tc.status === 'passed'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {tc.name}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {tc.suite} · {tc.assertions}
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                        {tc.durationMs}ms
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Tab 3: Implementation Plan & Jira Acceptance Mapping */}
            {prSubTab === 'plan' && (
              <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Architecture &amp; Execution Plan
                </h3>
                <ol className="mt-3 space-y-2.5">
                  {linkedPr.planSteps.map((step, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300"
                    >
                      <span className="mt-0.5 font-mono text-xs font-semibold text-slate-400 tabular-nums">
                        {String(i + 1).padStart(2, '0')}.
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>

                <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Linked Jira Acceptance Criteria ({ticket.key})
                  </h4>
                  <ul className="mt-2.5 space-y-2">
                    {ticket.acceptanceCriteria.map((ac, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300"
                      >
                        <CheckCircle2
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                          aria-hidden="true"
                        />
                        <span>{ac}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* Tab 4: Complete 5-Stage Solve Trace */}
            {prSubTab === 'trace' && solveRun && (
              <SolvePipelinePanel
                run={solveRun}
                onCancel={onCancelSolve}
                onRetry={() => onStartSolve(ticket, guidance)}
                onResolveAmbiguousTarget={onResolveAmbiguousTarget}
              />
            )}
          </div>

          {/* Right Column: Human Review & Merge Gate */}
          <div className="xl:col-span-4">
            <HumanMergeGate
              key={linkedPr.id}
              pr={linkedPr}
              isReviewLoading={isReviewLoading}
              onRunAiReview={() => onRunAiReview(linkedPr.id)}
              onApprovePr={(comment) => onApprovePr(linkedPr.id, comment)}
              onRequestChanges={(comment) => onRequestChanges(linkedPr.id, comment)}
              onChangeMergeStrategy={(strategy) =>
                onChangeMergeStrategy(linkedPr.id, strategy)
              }
              onMergePr={() => onMergePr(linkedPr.id)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
