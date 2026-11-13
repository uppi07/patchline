import { ShieldCheck } from 'lucide-react';
import type { RepositoryConfig } from '../types';

interface RepositoriesViewProps {
  repositories: RepositoryConfig[];
  onToggleAutoReview: (repoId: string) => void;
  onUpdateTestCommand: (repoId: string, command: string) => void;
}

export function RepositoriesView({
  repositories,
  onToggleAutoReview,
  onUpdateTestCommand,
}: RepositoriesViewProps) {
  return (
    <div className="mx-auto max-w-[1320px] space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="border-b border-slate-200 pb-5 dark:border-slate-800">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
          Connected Repositories
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Configure repository test runners, automated AI review behavior, and mandatory human approval branch protections.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {repositories.map((repo) => (
          <section
            key={repo.id}
            className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                  {repo.fullName}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>{repo.language}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {repo.defaultBranch} @{' '}
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {(repo.pinnedSha || 'a4f9c2e').slice(0, 7)}
                    </span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{repo.openPrCount} open PRs</span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Protected
              </span>
            </div>

            <div className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div>
                <label
                  htmlFor={`test-cmd-${repo.id}`}
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Verification Test Command
                </label>
                <input
                  id={`test-cmd-${repo.id}`}
                  type="text"
                  value={repo.testCommand}
                  onChange={(e) => onUpdateTestCommand(repo.id, e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <div>
                  <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                    Auto-run AI Code Review on new PRs
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Developers still approve and merge manually.
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={repo.autoRunAiReview}
                  aria-label={`Toggle auto AI review for ${repo.fullName}`}
                  onClick={() => onToggleAutoReview(repo.id)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                    repo.autoRunAiReview
                      ? 'bg-blue-600'
                      : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      repo.autoRunAiReview ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
