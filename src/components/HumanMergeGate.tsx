import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  Loader2,
  ScanSearch,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import avatarReviewerDev from '../assets/images/avatar_reviewer_dev_1794537126221.jpg';
import {
  canMergePullRequest,
  getMergeReadinessChecklist,
} from '../utils/workflowRules';
import type { MergeStrategy, PullRequest } from '../types';

interface HumanMergeGateProps {
  pr: PullRequest;
  isReviewLoading: boolean;
  onRunAiReview: () => void;
  onApprovePr: (comment: string) => void;
  onRequestChanges: (comment: string) => void;
  onChangeMergeStrategy: (strategy: MergeStrategy) => void;
  onMergePr: () => void;
}

export function HumanMergeGate({
  pr,
  isReviewLoading,
  onRunAiReview,
  onApprovePr,
  onRequestChanges,
  onChangeMergeStrategy,
  onMergePr,
}: HumanMergeGateProps) {
  const [comment, setComment] = useState(pr.reviewComment || '');
  const [avatarFailed, setAvatarFailed] = useState(false);

  const checklist = getMergeReadinessChecklist(pr);
  const mergeGate = canMergePullRequest(pr);
  const isMerged = pr.status === 'merged';

  return (
    <aside
      aria-label="Human review and merge gate"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Gate header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Developer Review &amp; Merge Gate
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Developers retain final authority over approval and merge.
          </p>
        </div>
        <ShieldCheck
          className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400"
          aria-hidden="true"
        />
      </div>

      {/* Reviewer sign-off row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {avatarFailed ? (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              ER
            </div>
          ) : (
            <img
              src={avatarReviewerDev}
              alt="Elena Rostova"
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
              className="h-8 w-8 shrink-0 rounded-full object-cover border border-slate-200 dark:border-slate-700"
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
              Elena Rostova
            </div>
            <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              Code Owner · Principal Architect
            </div>
          </div>
        </div>

        <span
          className={`text-xs font-semibold shrink-0 ${
            isMerged
              ? 'text-purple-700 dark:text-purple-400'
              : pr.humanReviewStatus === 'approved'
              ? 'text-emerald-700 dark:text-emerald-400'
              : pr.humanReviewStatus === 'changes_requested'
              ? 'text-amber-700 dark:text-amber-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {isMerged
            ? 'Merged'
            : pr.humanReviewStatus === 'approved'
            ? 'Approved'
            : pr.humanReviewStatus === 'changes_requested'
            ? 'Changes Requested'
            : pr.draft || pr.status === 'draft'
            ? 'Draft · Pending Review'
            : 'Pending Review'}
        </span>
      </div>

      {/* Readiness checklist */}
      <div className="space-y-2.5 border-y border-slate-200 py-4 dark:border-slate-800">
        {checklist.map((item) => (
          <div key={item.id} className="flex items-start gap-2.5">
            {item.satisfied ? (
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
            ) : item.blocking ? (
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
            ) : (
              <XCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                {item.label}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {item.detail}
              </div>
            </div>
          </div>
        ))}

        {!isMerged && (
          <button
            type="button"
            onClick={onRunAiReview}
            disabled={isReviewLoading}
            className="mt-1 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            {isReviewLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>Running AI Code Review...</span>
              </>
            ) : (
              <>
                <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{pr.aiReviewRan ? 'Re-run AI Code Review' : 'Run One-Click AI Code Review'}</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Developer Decision Form */}
      {!isMerged ? (
        <div className="space-y-3">
          <div>
            <label
              htmlFor={`review-note-${pr.id}`}
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Final Review Note
            </label>
            <textarea
              id={`review-note-${pr.id}`}
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Leave architectural notes or merge verification..."
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:bg-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onApprovePr(comment)}
              className={`inline-flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-semibold whitespace-nowrap transition-colors ${
                pr.humanReviewStatus === 'approved'
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              Approve PR
            </button>
            <button
              type="button"
              onClick={() => onRequestChanges(comment)}
              className={`inline-flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-semibold whitespace-nowrap transition-colors ${
                pr.humanReviewStatus === 'changes_requested'
                  ? 'border-amber-600 bg-amber-600 text-white'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              Request Changes
            </button>
          </div>

          {/* Merge Strategy + Final Merge Button */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={`merge-strategy-${pr.id}`}
                className="text-xs font-medium text-slate-600 dark:text-slate-400"
              >
                Merge strategy
              </label>
              <select
                id={`merge-strategy-${pr.id}`}
                value={pr.mergeStrategy}
                onChange={(e) =>
                  onChangeMergeStrategy(e.target.value as MergeStrategy)
                }
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="squash">Squash and merge</option>
                <option value="merge">Create merge commit</option>
                <option value="rebase">Rebase and merge</option>
              </select>
            </div>

            <button
              type="button"
              disabled={!mergeGate.allowed}
              onClick={onMergePr}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 whitespace-nowrap dark:bg-blue-600 dark:hover:bg-blue-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              <GitMerge className="h-4 w-4" aria-hidden="true" />
              <span>Merge Pull Request</span>
            </button>

            {!mergeGate.allowed && (
              <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Blocked: {mergeGate.reasons[0]}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
          <div className="font-semibold">Pull request merged into {pr.baseBranch}</div>
          <div className="mt-0.5 text-[11px] opacity-80">
            Strategy: {pr.mergeStrategy} · {pr.mergedAt || 'Just now'}
          </div>
        </div>
      )}

      {/* Audit Trail */}
      <div className="border-t border-slate-200 pt-3.5 dark:border-slate-800">
        <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
          Activity Log
        </div>
        <ul className="space-y-2">
          {pr.auditTrail.slice(0, 5).map((entry) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-2 text-[11px] leading-snug"
            >
              <span className="text-slate-600 dark:text-slate-300">
                <strong className="font-medium text-slate-900 dark:text-slate-100">
                  {entry.actor}
                </strong>{' '}
                {entry.action}
              </span>
              <span className="shrink-0 font-mono text-slate-400 tabular-nums">
                {entry.timestamp}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
