import { Menu, Plus } from 'lucide-react';
import type { WorkspaceTab } from '../types';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onOpenNewTicket: () => void;
  onToggleMobileNav: () => void;
}

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'ticket-to-pr', label: 'Ticket to PR' },
  { id: 'code-review', label: 'Code Review' },
  { id: 'pull-requests', label: 'Pull Requests' },
  { id: 'repositories', label: 'Repositories' },
];

export function TopBar({
  activeTab,
  onSelectTab,
  onOpenNewTicket,
  onToggleMobileNav,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-8 border-b border-slate-200 bg-white px-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onToggleMobileNav}
          aria-label="Toggle workspace queue"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <Menu className="h-4 w-4" />
        </button>

        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('ticket-to-pr');
          }}
          className="flex items-center gap-2.5 text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 dark:text-white"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="text-blue-600 dark:text-blue-500 shrink-0"
          >
            <rect
              x="3"
              y="3"
              width="18"
              height="18"
              rx="4"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M8 8v8M16 8v3a3 3 0 0 1-3 3H8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <span>Patchline</span>
        </a>
      </div>

      <nav
        aria-label="Primary workspace navigation"
        className="hidden md:flex items-center gap-6 overflow-x-auto"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative py-4 text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                isActive
                  ? 'text-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {item.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 dark:bg-blue-500"
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onOpenNewTicket}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:ring-offset-slate-900"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>New Ticket</span>
        </button>
      </div>
    </header>
  );
}
