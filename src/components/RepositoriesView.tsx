import { useState, type FormEvent } from 'react';
import { GitCommitHorizontal, Plus, ShieldCheck } from 'lucide-react';
import type { RepositoryConfig } from '../types';

interface RepositoriesViewProps {
  repositories: RepositoryConfig[];
  onToggleAutoReview: (repoId: string) => void;
  onUpdateTestCommand: (repoId: string, command: string) => void;
  onSimulateUpstreamPush: (repoId: string) => void;
  onAddRepository: (repo: Omit<RepositoryConfig, 'id' | 'openPrCount'>) => void;
}

export function RepositoriesView({
  repositories,
  onToggleAutoReview,
  onUpdateTestCommand,
  onSimulateUpstreamPush,
  onAddRepository,
}: RepositoriesViewProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [language, setLanguage] = useState('TypeScript');
  const [testCommand, setTestCommand] = useState('npx vitest run');
  const [jiraProjectsText, setJiraProjectsText] = useState('APP');
  const [jiraComponentsText, setJiraComponentsText] = useState('api, ui');
  const [monorepoPackagesText, setMonorepoPackagesText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const handleCreateRepo = (e: FormEvent) => {
    e.preventDefault();
    const cleanName = fullName.trim();
    if (!cleanName.includes('/')) {
      setFormError('Enter repository as owner/repo (e.g. uppi07/patchline).');
      return;
    }
    const shaSeed = Array.from(cleanName)
      .map((c) => c.charCodeAt(0).toString(16))
      .join('')
      .padEnd(40, 'a1b2c3d4e5')
      .slice(0, 40);

    onAddRepository({
      fullName: cleanName,
      defaultBranch: defaultBranch.trim() || 'main',
      pinnedSha: shaSeed,
      upstreamHeadSha: shaSeed,
      language: language.trim() || 'TypeScript',
      testCommand: testCommand.trim() || 'npx vitest run',
      jiraProjects: jiraProjectsText
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
      jiraComponents: jiraComponentsText
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      monorepoPackages: monorepoPackagesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      jiraReviewTransition: 'In Review',
      requireHumanApproval: true,
      autoRunAiReview: true,
    });

    setFullName('');
    setMonorepoPackagesText('');
    setFormError(null);
    setShowAddForm(false);
  };

  return (
    <div className="mx-auto max-w-[1320px] space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
            Connected Repositories &amp; Jira Routing
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Bind Jira projects, components, monorepo scopes, language test runners, and pinned base SHAs for deterministic multi-repo resolution.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{showAddForm ? 'Close Form' : 'Register Repository'}</span>
        </button>
      </div>

      {showAddForm && (
        <form
          onSubmit={handleCreateRepo}
          className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Add Repository &amp; Jira Project Binding
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Repository (owner/name)
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="uppi07/patchline"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Default Base Branch
              </label>
              <input
                type="text"
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                placeholder="main"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Runtime / Language
              </label>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="TypeScript"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Jira Projects (comma-separated)
              </label>
              <input
                type="text"
                value={jiraProjectsText}
                onChange={(e) => setJiraProjectsText(e.target.value)}
                placeholder="APP, CORE"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Jira Components (comma-separated)
              </label>
              <input
                type="text"
                value={jiraComponentsText}
                onChange={(e) => setJiraComponentsText(e.target.value)}
                placeholder="auth, billing"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Test Command
              </label>
              <input
                type="text"
                value={testCommand}
                onChange={(e) => setTestCommand(e.target.value)}
                placeholder="npx vitest run"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Monorepo Package Paths (optional, comma-separated)
              </label>
              <input
                type="text"
                value={monorepoPackagesText}
                onChange={(e) => setMonorepoPackagesText(e.target.value)}
                placeholder="packages/retry-policy, apps/edge-gateway"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>
          {formError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{formError}</p>
          )}
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Save Repository Binding
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {repositories.map((repo) => {
          const hasDrift =
            Boolean(repo.upstreamHeadSha) && repo.upstreamHeadSha !== repo.pinnedSha;

          return (
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

              <div className="mt-3 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                <div>
                  Jira Projects:{' '}
                  <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                    {repo.jiraProjects?.join(', ') || 'None'}
                  </span>
                  <span aria-hidden="true"> · </span>
                  Review State:{' '}
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {repo.jiraReviewTransition || 'In Review'}
                  </span>
                </div>
                <div>
                  Components:{' '}
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {repo.jiraComponents?.join(', ') || 'Any'}
                  </span>
                </div>
                {repo.monorepoPackages && repo.monorepoPackages.length > 0 && (
                  <div>
                    Monorepo Scopes:{' '}
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {repo.monorepoPackages.join(' · ')}
                    </span>
                  </div>
                )}
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

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Upstream Head:{' '}
                    <span
                      className={`font-mono font-medium ${
                        hasDrift
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {(repo.upstreamHeadSha || repo.pinnedSha).slice(0, 7)}
                      {hasDrift ? ' (ahead of pinned SHA)' : ' (in sync)'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSimulateUpstreamPush(repo.id)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Simulate Upstream Push</span>
                  </button>
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
          );
        })}
      </div>
    </div>
  );
}
