import { useState } from 'react';
import {
  AlertCircle,
  Check,
  GitBranch,
  Lightbulb,
  Loader2,
  MessageSquare,
  ScanSearch,
  Sparkles,
  X,
} from 'lucide-react';
import { codeSnippetToDiffLines, computeDiffStats, parseUnifiedDiff } from '../utils/diffParser';
import { getReviewSummary } from '../utils/workflowRules';
import { DiffViewer } from './DiffViewer';
import { HumanMergeGate } from './HumanMergeGate';
import type { ChangedFile, MergeStrategy, PullRequest, ReviewFinding } from '../types';

interface CodeReviewViewProps {
  mode: 'pr' | 'custom';
  pr: PullRequest;
  isReviewLoading: boolean;
  errorMessage: string | null;
  onRunAiReview: (prId: string) => void;
  onAcceptFix: (prId: string, findingId: string) => void;
  onResolveFinding: (prId: string, findingId: string) => void;
  onDismissFinding: (prId: string, findingId: string) => void;
  onApprovePr: (prId: string, comment: string) => void;
  onRequestChanges: (prId: string, comment: string) => void;
  onChangeMergeStrategy: (prId: string, strategy: MergeStrategy) => void;
  onMergePr: (prId: string) => void;
}

const DEFAULT_CUSTOM_SNIPPET = `export async function issueRefund(orderId: string, amountCents: number, db: Database) {
  const order = await db.orders.findUnique({ where: { id: orderId } });
  if (order.refundedAmount + amountCents > order.totalCents) {
    throw new Error("Refund exceeds order total");
  }
  const gatewayRes = await stripe.refunds.create({ charge: order.chargeId, amount: amountCents });
  await db.orders.update({
    where: { id: orderId },
    data: { refundedAmount: order.refundedAmount + amountCents },
  });
  return gatewayRes;
}`;

export function CodeReviewView({
  mode,
  pr,
  isReviewLoading,
  errorMessage,
  onRunAiReview,
  onAcceptFix,
  onResolveFinding,
  onDismissFinding,
  onApprovePr,
  onRequestChanges,
  onChangeMergeStrategy,
  onMergePr,
}: CodeReviewViewProps) {
  const [findingFilter, setFindingFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [focusedFindingId, setFocusedFindingId] = useState<string | null>(null);

  // Custom diff/code review state
  const [customPath, setCustomPath] = useState('src/payments/issueRefund.ts');
  const [customInput, setCustomInput] = useState(DEFAULT_CUSTOM_SNIPPET);
  const [customFiles, setCustomFiles] = useState<ChangedFile[] | null>(null);
  const [customFindings, setCustomFindings] = useState<ReviewFinding[]>([]);
  const [customSummary, setCustomSummary] = useState<string | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const handleRunCustomReview = async () => {
    setCustomError(null);
    if (!customInput.trim()) {
      setCustomError('Paste a unified diff or code snippet before running AI code review.');
      return;
    }

    const isUnifiedDiff =
      customInput.includes('@@ ') ||
      (customInput.includes('\n+') && customInput.includes('\n-'));

    const fileObj: ChangedFile = {
      path: customPath.trim() || 'src/snippet.ts',
      language: 'typescript',
      summary: 'Custom code submitted for one-click review',
      lines: isUnifiedDiff
        ? parseUnifiedDiff(customInput)
        : codeSnippetToDiffLines(customInput),
    };

    setCustomLoading(true);
    try {
      const res = await fetch('/api/ai/review-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Ad-hoc review: ${fileObj.path}`,
          summary: 'Standalone one-click AI code review',
          files: [fileObj],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI code review failed.');
      }
      setCustomFiles([fileObj]);
      setCustomFindings(data.findings || []);
      setCustomSummary(data.summary || 'Review completed.');
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : 'Unable to complete review.');
    } finally {
      setCustomLoading(false);
    }
  };

  if (mode === 'custom') {
    const customStats = customFiles ? computeDiffStats(customFiles) : null;
    const customSummaryCounts = getReviewSummary(customFindings);

    return (
      <div className="mx-auto max-w-[1320px] space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center dark:border-slate-800">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Standalone AI Code Review
            </div>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
              One-Click Review for Any Diff or Snippet
            </h1>
          </div>

          <button
            type="button"
            disabled={customLoading}
            onClick={handleRunCustomReview}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {customLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Analyzing Code...</span>
              </>
            ) : (
              <>
                <ScanSearch className="h-4 w-4" aria-hidden="true" />
                <span>Run AI Code Review</span>
              </>
            )}
          </button>
        </div>

        {customError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
          >
            {customError}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-5 xl:col-span-7">
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="grid gap-4">
                <div>
                  <label
                    htmlFor="custom-review-path"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    File Path
                  </label>
                  <input
                    id="custom-review-path"
                    type="text"
                    value={customPath}
                    onChange={(e) => setCustomPath(e.target.value)}
                    className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor="custom-review-code"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Unified Diff or Source Code
                  </label>
                  <textarea
                    id="custom-review-code"
                    rows={12}
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
            </section>

            {customFiles && (
              <DiffViewer
                files={customFiles}
                findings={customFindings}
                focusedFindingId={focusedFindingId}
                onResolveFinding={(id) =>
                  setCustomFindings((prev) =>
                    prev.map((f) => (f.id === id ? { ...f, status: 'resolved' } : f))
                  )
                }
                onDismissFinding={(id) =>
                  setCustomFindings((prev) =>
                    prev.map((f) => (f.id === id ? { ...f, status: 'dismissed' } : f))
                  )
                }
              />
            )}
          </div>

          <aside className="space-y-4 xl:col-span-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Review Findings
              </h2>
              {customSummary ? (
                <div className="mt-2 space-y-4">
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {customSummary}
                  </p>
                  {customStats && (
                    <div className="flex items-center gap-3 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      <span>{customSummaryCounts.criticalOpen} critical</span>
                      <span aria-hidden="true">·</span>
                      <span>{customSummaryCounts.suggestionOpen} suggestions</span>
                      <span aria-hidden="true">·</span>
                      <span>+{customStats.additions} lines analyzed</span>
                    </div>
                  )}

                  <div className="space-y-2.5 pt-1">
                    {customFindings.map((f) => (
                      <FindingSummaryCard
                        key={f.id}
                        finding={f}
                        onFocus={() => setFocusedFindingId(f.id)}
                        onResolve={() =>
                          setCustomFindings((prev) =>
                            prev.map((item) =>
                              item.id === f.id ? { ...item, status: 'resolved' } : item
                            )
                          )
                        }
                        onDismiss={() =>
                          setCustomFindings((prev) =>
                            prev.map((item) =>
                              item.id === f.id ? { ...item, status: 'dismissed' } : item
                            )
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Paste a diff or function on the left and click Run AI Code Review to inspect security risks, race conditions, and edge cases.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // PR Review Mode
  const stats = computeDiffStats(pr.files);
  const reviewSummary = getReviewSummary(pr.findings);
  const visibleFindings = pr.findings.filter((f) => {
    if (findingFilter === 'open') return f.status === 'open';
    if (findingFilter === 'resolved') return f.status !== 'open';
    return true;
  });

  return (
    <div className="mx-auto max-w-[1320px] space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start dark:border-slate-800">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
              {pr.repo}
            </span>
            <span aria-hidden="true">/</span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums dark:text-white">
              {pr.draft || pr.status === 'draft' ? `Draft PR #${pr.number}` : `PR #${pr.number}`}
            </span>
            {pr.linkedTicketKey && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{pr.linkedTicketKey}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 font-mono">
              <GitBranch className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              {pr.headBranch}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {stats.filesChanged} files (+{stats.additions} -{stats.deletions})
            </span>
          </div>

          <h1 className="text-xl font-bold tracking-tight text-slate-900 text-balance sm:text-2xl dark:text-white">
            {pr.title}
          </h1>
        </div>

        <button
          type="button"
          disabled={isReviewLoading || pr.status === 'merged'}
          onClick={() => onRunAiReview(pr.id)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          {isReviewLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Running AI Code Review...</span>
            </>
          ) : (
            <>
              <ScanSearch className="h-4 w-4" aria-hidden="true" />
              <span>{pr.aiReviewRan ? 'Re-run AI Code Review' : 'Run AI Code Review'}</span>
            </>
          )}
        </button>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        >
          {errorMessage}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-12">
        {/* Left/Main: Diff Viewer */}
        <div className="min-w-0 space-y-5 xl:col-span-8">
          <DiffViewer
            files={pr.files}
            findings={pr.findings}
            focusedFindingId={focusedFindingId}
            onAcceptFix={(findingId) => onAcceptFix(pr.id, findingId)}
            onResolveFinding={(findingId) => onResolveFinding(pr.id, findingId)}
            onDismissFinding={(findingId) => onDismissFinding(pr.id, findingId)}
          />
        </div>

        {/* Right: AI Findings Panel + Human Merge Gate */}
        <div className="space-y-5 xl:col-span-4">
          <section
            aria-label="AI code review findings"
            className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                AI Review Findings
              </h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {reviewSummary.open} open / {reviewSummary.total}
              </span>
            </div>

            {pr.aiReviewRan ? (
              <>
                {pr.aiReviewSummary && (
                  <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {pr.aiReviewSummary}
                  </p>
                )}

                <div className="mt-3 flex items-center gap-3 text-xs font-medium tabular-nums">
                  <span className="text-red-700 dark:text-red-400">
                    {reviewSummary.criticalOpen} Critical
                  </span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-amber-700 dark:text-amber-400">
                    {reviewSummary.suggestionOpen} Suggestions
                  </span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-slate-600 dark:text-slate-400">
                    {reviewSummary.nitpickOpen} Nitpicks
                  </span>
                </div>

                <div
                  role="group"
                  aria-label="Filter findings"
                  className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
                >
                  {(
                    [
                      { id: 'all', label: `All (${reviewSummary.total})` },
                      { id: 'open', label: `Open (${reviewSummary.open})` },
                      {
                        id: 'resolved',
                        label: `Closed (${reviewSummary.resolved + reviewSummary.dismissed})`,
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setFindingFilter(opt.id)}
                      className={`rounded-md py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                        findingFilter === opt.id
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="mt-3 space-y-2.5">
                  {visibleFindings.length === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                      No findings match this filter.
                    </div>
                  ) : (
                    visibleFindings.map((finding) => (
                      <FindingSummaryCard
                        key={finding.id}
                        finding={finding}
                        onFocus={() => setFocusedFindingId(finding.id)}
                        onAcceptFix={
                          finding.suggestedCode
                            ? () => onAcceptFix(pr.id, finding.id)
                            : undefined
                        }
                        onResolve={() => onResolveFinding(pr.id, finding.id)}
                        onDismiss={() => onDismissFinding(pr.id, finding.id)}
                      />
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  AI code review has not been executed on PR #{pr.number} yet. Run a one-click review to check for security issues, edge cases, and concurrency bugs.
                </p>
                <button
                  type="button"
                  disabled={isReviewLoading}
                  onClick={() => onRunAiReview(pr.id)}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Run One-Click AI Code Review</span>
                </button>
              </div>
            )}
          </section>

          <HumanMergeGate
            key={pr.id}
            pr={pr}
            isReviewLoading={isReviewLoading}
            onRunAiReview={() => onRunAiReview(pr.id)}
            onApprovePr={(comment) => onApprovePr(pr.id, comment)}
            onRequestChanges={(comment) => onRequestChanges(pr.id, comment)}
            onChangeMergeStrategy={(strategy) => onChangeMergeStrategy(pr.id, strategy)}
            onMergePr={() => onMergePr(pr.id)}
          />
        </div>
      </div>
    </div>
  );
}

function FindingSummaryCard({
  finding,
  onFocus,
  onAcceptFix,
  onResolve,
  onDismiss,
}: {
  finding: ReviewFinding;
  onFocus: () => void;
  onAcceptFix?: () => void;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const Icon =
    finding.severity === 'critical'
      ? AlertCircle
      : finding.severity === 'suggestion'
      ? Lightbulb
      : MessageSquare;

  const severityColor =
    finding.severity === 'critical'
      ? 'text-red-700 dark:text-red-400'
      : finding.severity === 'suggestion'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-slate-600 dark:text-slate-400';

  return (
    <div
      className={`rounded-lg border border-slate-200 p-3 dark:border-slate-800 ${
        finding.status !== 'open' ? 'opacity-65' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onFocus}
          className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
        >
          <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${severityColor}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="capitalize">{finding.severity}</span>
            <span className="text-slate-400 font-normal">·</span>
            <span className="font-mono text-slate-500 tabular-nums dark:text-slate-400">
              {finding.filePath.split('/').pop()}:{finding.line}
            </span>
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400">
            {finding.title}
          </div>
        </button>
      </div>

      {finding.status === 'open' ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {onAcceptFix && (
            <button
              type="button"
              aria-label={`Accept fix for ${finding.title}`}
              onClick={onAcceptFix}
              className="inline-flex h-7 items-center gap-1 rounded bg-blue-600 px-2 text-[11px] font-medium text-white hover:bg-blue-700 whitespace-nowrap"
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              <span>Accept Fix</span>
            </button>
          )}
          <button
            type="button"
            aria-label={`Resolve ${finding.title}`}
            onClick={onResolve}
            className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Check className="h-3 w-3" aria-hidden="true" />
            <span>Resolve</span>
          </button>
          <button
            type="button"
            aria-label={`Dismiss ${finding.title}`}
            onClick={onDismiss}
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium text-slate-500 hover:bg-slate-100 whitespace-nowrap dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            <span>Dismiss</span>
          </button>
        </div>
      ) : (
        <div className="mt-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          {finding.appliedFix
            ? 'Fix applied to diff'
            : finding.status === 'resolved'
            ? 'Resolved'
            : 'Dismissed'}
        </div>
      )}
    </div>
  );
}
