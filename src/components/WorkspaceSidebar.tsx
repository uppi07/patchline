import { useState } from 'react';
import { Code2, FileDiff, GitPullRequest, Moon, Search, Sun, X } from 'lucide-react';
import avatarLeadEngineer from '../assets/images/avatar_lead_engineer_1794537124712.jpg';
import { filterTickets } from '../utils/workflowRules';
import type { JiraTicket, PullRequest, TicketStatus, WorkspaceTab } from '../types';

interface WorkspaceSidebarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  tickets: JiraTicket[];
  selectedTicketId: string;
  onSelectTicket: (ticketId: string) => void;
  pullRequests: PullRequest[];
  selectedPrId: string;
  reviewTargetMode: 'pr' | 'custom';
  onSelectReviewPr: (prId: string) => void;
  onSelectCustomReview: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  activeSolveTicketId?: string;
  showDesktopRail: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  ready: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

const PRIORITY_COLOR: Record<JiraTicket['priority'], string> = {
  Urgent: 'text-red-600 dark:text-red-400',
  High: 'text-amber-700 dark:text-amber-400',
  Medium: 'text-slate-600 dark:text-slate-400',
  Low: 'text-slate-500 dark:text-slate-500',
};

export function WorkspaceSidebar({
  activeTab,
  onSelectTab,
  tickets,
  selectedTicketId,
  onSelectTicket,
  pullRequests,
  selectedPrId,
  reviewTargetMode,
  onSelectReviewPr,
  onSelectCustomReview,
  theme,
  onToggleTheme,
  activeSolveTicketId,
  showDesktopRail,
  mobileOpen,
  onCloseMobile,
}: WorkspaceSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TicketStatus>('all');
  const [avatarFailed, setAvatarFailed] = useState(false);

  const visibleTickets = filterTickets(tickets, searchQuery, statusFilter);
  const filteredPrs = pullRequests.filter((pr) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      pr.title.toLowerCase().includes(q) ||
      pr.repo.toLowerCase().includes(q) ||
      `#${pr.number}`.includes(q) ||
      (pr.linkedTicketKey && pr.linkedTicketKey.toLowerCase().includes(q))
    );
  });

  const isReviewSidebar = activeTab === 'code-review';

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900">
      {/* Mobile navigation links */}
      <div className="border-b border-slate-200 p-3 md:hidden dark:border-slate-800">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Workspace
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation drawer"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              { id: 'ticket-to-pr', label: 'Ticket to PR' },
              { id: 'code-review', label: 'Code Review' },
              { id: 'pull-requests', label: 'Pull Requests' },
              { id: 'repositories', label: 'Repositories' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                onCloseMobile();
              }}
              className={`rounded-md px-2.5 py-2 text-left text-xs font-medium whitespace-nowrap ${
                activeTab === item.id
                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Queue Header & Search */}
      <div className="border-b border-slate-200 p-4 dark:border-slate-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {isReviewSidebar ? 'Review Queue' : 'Jira Backlog'}
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
            {isReviewSidebar ? filteredPrs.length : visibleTickets.length}
          </span>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <label htmlFor="sidebar-queue-search" className="sr-only">
            {isReviewSidebar ? 'Search pull requests' : 'Search Jira tickets'}
          </label>
          <input
            id="sidebar-queue-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              isReviewSidebar ? 'Filter PR # or repo...' : 'Filter key, title, repo...'
            }
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:bg-slate-900"
          />
        </div>

        {!isReviewSidebar && (
          <div
            role="group"
            aria-label="Filter tickets by status"
            className="mt-2.5 grid grid-cols-5 gap-0.5 rounded-lg bg-slate-100 p-1 dark:bg-slate-950"
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'ready', label: 'To Do' },
                { id: 'in_progress', label: 'Active' },
                { id: 'in_review', label: 'Review' },
                { id: 'done', label: 'Done' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setStatusFilter(opt.id)}
                className={`rounded-md py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                  statusFilter === opt.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scrollable Queue Items */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {isReviewSidebar ? (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => {
                onSelectCustomReview();
                onCloseMobile();
              }}
              className={`flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                reviewTargetMode === 'custom'
                  ? 'border-blue-600/40 bg-blue-50/70 dark:border-blue-500/40 dark:bg-blue-950/30'
                  : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100/70 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:bg-slate-800/50'
              }`}
            >
              <Code2
                className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Custom Diff / Snippet
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Paste any diff or file for one-click AI review
                </div>
              </div>
            </button>

            <div className="px-1 pt-2 pb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              GitHub Pull Requests
            </div>

            {filteredPrs.map((pr) => {
              const selected =
                reviewTargetMode === 'pr' && pr.id === selectedPrId;
              return (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => {
                    onSelectReviewPr(pr.id);
                    onCloseMobile();
                  }}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? 'border-slate-300 bg-slate-100/90 dark:border-slate-700 dark:bg-slate-800/80'
                      : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      <GitPullRequest
                        className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400"
                        aria-hidden="true"
                      />
                      #{pr.number}
                    </span>
                    <span
                      className={`text-[11px] font-medium ${
                        pr.status === 'merged'
                          ? 'text-purple-700 dark:text-purple-400'
                          : pr.humanReviewStatus === 'approved'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {pr.status === 'merged'
                        ? 'Merged'
                        : pr.humanReviewStatus === 'approved'
                        ? 'Approved'
                        : pr.draft || pr.status === 'draft'
                        ? 'Draft'
                        : 'Open'}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs font-medium leading-snug text-slate-800 dark:text-slate-200">
                    {pr.title}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="truncate">{pr.repo.split('/')[1]}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {pr.aiReviewRan
                        ? `${pr.findings.filter((f) => f.status === 'open').length} open`
                        : 'Unreviewed'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : visibleTickets.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No matching Jira tickets found.
          </div>
        ) : (
          <div className="space-y-1">
            {visibleTickets.map((ticket) => {
              const selected = ticket.id === selectedTicketId;
              return (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => {
                    onSelectTicket(ticket.id);
                    if (activeTab !== 'ticket-to-pr') {
                      onSelectTab('ticket-to-pr');
                    }
                    onCloseMobile();
                  }}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? 'border-slate-300 bg-slate-100/90 dark:border-slate-700 dark:bg-slate-800/80'
                      : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      {ticket.key}
                    </span>
                    <span className={`text-[11px] font-medium ${PRIORITY_COLOR[ticket.priority]}`}>
                      {ticket.priority}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs font-medium leading-snug text-slate-800 dark:text-slate-200">
                    {ticket.title}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="truncate">
                      {ticket.repo === 'auto'
                        ? 'auto-resolve'
                        : ticket.repo.split('/')[1] || ticket.repo}
                    </span>
                    <span aria-hidden="true">·</span>
                    {ticket.id === activeSolveTicketId ? (
                      <span className="shrink-0 font-medium text-blue-600 dark:text-blue-400">
                        Solving...
                      </span>
                    ) : (
                      <span className="shrink-0">{STATUS_LABEL[ticket.status]}</span>
                    )}
                    {ticket.linkedPrId && (
                      <>
                        <span aria-hidden="true">·</span>
                        <FileDiff className="h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400" aria-label="PR linked" />
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer: Engineer Profile & Theme Toggle */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2.5">
          {avatarFailed ? (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              MV
            </div>
          ) : (
            <img
              src={avatarLeadEngineer}
              alt="Marcus Vance"
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
              className="h-8 w-8 shrink-0 rounded-full object-cover border border-slate-200 dark:border-slate-700"
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
              Marcus Vance
            </div>
            <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              Staff Engineer
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      {showDesktopRail && (
        <aside
          aria-label="Workspace queue"
          className="hidden w-[272px] shrink-0 border-r border-slate-200 lg:block dark:border-slate-800"
        >
          {sidebarContent}
        </aside>
      )}

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full w-72 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
