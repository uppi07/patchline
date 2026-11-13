import { useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { computeDiffStats } from '../utils/diffParser';
import type { PullRequest } from '../types';

interface PullRequestsTableProps {
  pullRequests: PullRequest[];
  onOpenPr: (prId: string) => void;
}

export function PullRequestsTable({
  pullRequests,
  onOpenPr,
}: PullRequestsTableProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'approved' | 'merged'>('all');

  const filtered = pullRequests.filter((pr) => {
    if (filter === 'open' && pr.status === 'merged') return false;
    if (filter === 'approved' && pr.humanReviewStatus !== 'approved') return false;
    if (filter === 'merged' && pr.status !== 'merged') return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      pr.title.toLowerCase().includes(q) ||
      pr.repo.toLowerCase().includes(q) ||
      `#${pr.number}`.includes(q) ||
      (pr.linkedTicketKey?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div className="mx-auto max-w-[1320px] space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end dark:border-slate-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
            Pull Requests
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Track generated and open GitHub pull requests, test verification, and developer sign-off gates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <label htmlFor="pr-table-search" className="sr-only">
              Search pull requests
            </label>
            <input
              id="pr-table-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search PR, repo, or ticket..."
              className="h-9 w-56 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div
            role="group"
            aria-label="Filter pull requests"
            className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'open', label: 'Open' },
                { id: 'approved', label: 'Approved' },
                { id: 'merged', label: 'Merged' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                  filter === opt.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">PR</th>
                <th className="px-4 py-3 font-medium">Pull Request &amp; Repository</th>
                <th className="px-4 py-3 font-medium">Jira</th>
                <th className="px-4 py-3 font-medium text-right">Diff</th>
                <th className="px-4 py-3 font-medium">Tests</th>
                <th className="px-4 py-3 font-medium">Developer Gate</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400"
                  >
                    No pull requests match your current filter.
                  </td>
                </tr>
              ) : (
                filtered.map((pr) => {
                  const stats = computeDiffStats(pr.files);
                  const passed = pr.testSuite.filter((t) => t.status === 'passed').length;

                  return (
                    <tr
                      key={pr.id}
                      className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                        #{pr.number}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {pr.title}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {pr.repo} · {pr.headBranch} · {pr.createdAt}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                        {pr.linkedTicketKey || '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <span className="text-emerald-700 dark:text-emerald-400">
                          +{stats.additions}
                        </span>{' '}
                        <span className="text-red-600 dark:text-red-400">
                          -{stats.deletions}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-emerald-700 tabular-nums whitespace-nowrap dark:text-emerald-400">
                        {passed}/{pr.testSuite.length} passed
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`font-medium ${
                            pr.status === 'merged'
                              ? 'text-purple-700 dark:text-purple-400'
                              : pr.humanReviewStatus === 'approved'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : pr.humanReviewStatus === 'changes_requested'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {pr.status === 'merged'
                            ? 'Merged'
                            : pr.humanReviewStatus === 'approved'
                            ? 'Approved'
                            : pr.humanReviewStatus === 'changes_requested'
                            ? 'Changes Requested'
                            : pr.draft || pr.status === 'draft'
                            ? 'Draft · Pending'
                            : 'Pending Review'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onOpenPr(pr.id)}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                        >
                          <span>Review</span>
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
