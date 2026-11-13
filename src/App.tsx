import { useEffect, useRef, useState } from 'react';
import { CodeReviewView } from './components/CodeReviewView';
import { NewTicketModal } from './components/NewTicketModal';
import { PullRequestsTable } from './components/PullRequestsTable';
import { RepositoriesView } from './components/RepositoriesView';
import { TicketToPrView } from './components/TicketToPrView';
import { TopBar } from './components/TopBar';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import {
  SEED_PULL_REQUESTS,
  SEED_REPOSITORIES,
  SEED_TICKETS,
} from './data/seedData';
import { applySuggestedFix } from './utils/diffParser';
import { canMergePullRequest } from './utils/workflowRules';
import type {
  JiraTicket,
  MergeStrategy,
  NewTicketInput,
  PullRequest,
  RepositoryConfig,
  SolveExecutionMode,
  SolveRun,
  WorkspaceTab,
} from './types';

const STORAGE_KEY = 'patchline_workbench_v2';
const TERMINAL_SOLVE_STATUSES = new Set(['succeeded', 'needs_info', 'failed', 'cancelled']);

let auditSeq = 0;
function nextAuditId(prefix: string): string {
  auditSeq += 1;
  return `${prefix}-${Date.now()}-${auditSeq}`;
}

interface PersistedState {
  tickets: JiraTicket[];
  pullRequests: PullRequest[];
  repositories: RepositoryConfig[];
  theme: 'light' | 'dark';
}

function hydrateRepositories(repos: RepositoryConfig[]): RepositoryConfig[] {
  return repos.map((repo) => {
    const seedMatch = SEED_REPOSITORIES.find((s) => s.fullName === repo.fullName);
    const pinnedSha =
      repo.pinnedSha || seedMatch?.pinnedSha || 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901';
    return {
      ...seedMatch,
      ...repo,
      pinnedSha,
      upstreamHeadSha: repo.upstreamHeadSha || seedMatch?.upstreamHeadSha || pinnedSha,
    };
  });
}

function hydrateTickets(
  tickets: JiraTicket[],
  repos: RepositoryConfig[]
): JiraTicket[] {
  return tickets.map((t) => {
    const repoMatch = repos.find((r) => r.fullName === t.repo);
    return {
      ...t,
      pinnedSha: t.pinnedSha || repoMatch?.pinnedSha || 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
    };
  });
}

function loadInitialState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (
        Array.isArray(parsed.tickets) &&
        Array.isArray(parsed.pullRequests) &&
        Array.isArray(parsed.repositories)
      ) {
        const repositories = hydrateRepositories(parsed.repositories);
        return {
          tickets: hydrateTickets(parsed.tickets, repositories),
          pullRequests: parsed.pullRequests,
          repositories,
          theme: parsed.theme === 'dark' ? 'dark' : 'light',
        };
      }
    }
  } catch {
    // Ignore invalid storage state
  }
  return {
    tickets: SEED_TICKETS,
    pullRequests: SEED_PULL_REQUESTS,
    repositories: SEED_REPOSITORIES,
    theme: 'light',
  };
}

export default function App() {
  const [initial] = useState(loadInitialState);
  const [tickets, setTickets] = useState<JiraTicket[]>(initial.tickets);
  const [pullRequests, setPullRequests] = useState<PullRequest[]>(initial.pullRequests);
  const [repositories, setRepositories] = useState<RepositoryConfig[]>(
    initial.repositories
  );
  const [theme, setTheme] = useState<'light' | 'dark'>(initial.theme);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('ticket-to-pr');
  const [selectedTicketId, setSelectedTicketId] = useState<string>(
    initial.tickets[0]?.id || ''
  );
  const [selectedPrId, setSelectedPrId] = useState<string>(
    initial.pullRequests[0]?.id || ''
  );
  const [reviewTargetMode, setReviewTargetMode] = useState<'pr' | 'custom'>('pr');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [newTicketModalOpen, setNewTicketModalOpen] = useState(false);

  const [solveRunsByTicket, setSolveRunsByTicket] = useState<Record<string, SolveRun>>({});
  const [scopeRevisionByTicket, setScopeRevisionByTicket] = useState<Record<string, number>>({});
  const [executionMode, setExecutionMode] = useState<SolveExecutionMode>('bounded');
  const [budgetLimit, setBudgetLimit] = useState<3 | 12>(3);

  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const appliedPrRunsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    try {
      const payload: PersistedState = {
        tickets,
        pullRequests,
        repositories,
        theme,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage quota fallback
    }
  }, [tickets, pullRequests, repositories, theme]);

  useEffect(() => {
    const streams = eventSourcesRef.current;
    return () => {
      for (const es of streams.values()) {
        es.close();
      }
      streams.clear();
    };
  }, []);

  const selectedTicket =
    tickets.find((t) => t.id === selectedTicketId) || tickets[0];
  const selectedRepoConfig = selectedTicket
    ? repositories.find((r) => r.fullName === selectedTicket.repo)
    : undefined;
  const selectedPinnedSha =
    selectedTicket?.pinnedSha ||
    selectedRepoConfig?.pinnedSha ||
    'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901';
  const linkedPr = selectedTicket?.linkedPrId
    ? pullRequests.find((pr) => pr.id === selectedTicket.linkedPrId)
    : undefined;
  const activeReviewPr =
    pullRequests.find((pr) => pr.id === selectedPrId) || pullRequests[0];

  const activeSolveRun = (Object.values(solveRunsByTicket) as SolveRun[]).find(
    (r) => r.status === 'queued' || r.status === 'running'
  );

  const handleSelectTab = (tab: WorkspaceTab) => {
    setErrorMessage(null);
    setActiveTab(tab);
  };

  const applyRunUpdate = (updatedRun: SolveRun) => {
    setSolveRunsByTicket((prev) => ({
      ...prev,
      [updatedRun.ticketId]: updatedRun,
    }));

    const generatedPr = updatedRun.prResult;
    if (
      updatedRun.status === 'succeeded' &&
      generatedPr &&
      !appliedPrRunsRef.current.has(updatedRun.id)
    ) {
      appliedPrRunsRef.current.add(updatedRun.id);

      setTickets((prev) =>
        prev.map((t) => {
          if (t.id !== updatedRun.ticketId) return t;
          const oldPrId = t.linkedPrId;
          setPullRequests((prs) => [
            generatedPr,
            ...prs.filter((p) => p.id !== oldPrId && p.id !== generatedPr.id),
          ]);
          return {
            ...t,
            status: 'in_review',
            linkedPrId: generatedPr.id,
            updatedAt: 'Just now',
          };
        })
      );
      setSelectedPrId(generatedPr.id);
    } else {
      setTickets((prev) =>
        prev.map((t) => {
          if (t.id !== updatedRun.ticketId || t.status === 'done') return t;
          if (t.status === updatedRun.jiraStatusCurrent) return t;
          return {
            ...t,
            status: updatedRun.jiraStatusCurrent,
            updatedAt: 'Just now',
          };
        })
      );
    }
  };

  const handleStartSolve = async (ticket: JiraTicket, guidance: string) => {
    setErrorMessage(null);
    const repoConfig = repositories.find((r) => r.fullName === ticket.repo);
    const baseSha =
      ticket.pinnedSha ||
      repoConfig?.pinnedSha ||
      'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901';
    const nextScopeRev = (scopeRevisionByTicket[ticket.id] || 0) + 1;
    setScopeRevisionByTicket((prev) => ({
      ...prev,
      [ticket.id]: nextScopeRev,
    }));

    const existingOpenPr = ticket.linkedPrId
      ? pullRequests.find((p) => p.id === ticket.linkedPrId && p.status !== 'merged')
      : undefined;

    const nextPrNumber =
      Math.max(1081, ...pullRequests.map((p) => p.number)) + 1;

    try {
      const res = await fetch('/api/solve/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket,
          baseSha,
          scopeRevision: nextScopeRev,
          executionMode,
          maxModelCalls: executionMode === 'continuous' ? null : budgetLimit,
          testCommand: repoConfig?.testCommand || 'npx vitest run',
          guidance,
          nextPrNumber,
          repositories,
          existingOpenPr,
          upstreamHeadSha: repoConfig?.upstreamHeadSha,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start Solve run.');
      }

      const initialRun = data.run as SolveRun;
      applyRunUpdate(initialRun);

      const existingStream = eventSourcesRef.current.get(ticket.id);
      if (existingStream) {
        existingStream.close();
      }

      const stream = new EventSource(`/api/solve/runs/${initialRun.id}/stream`);
      eventSourcesRef.current.set(ticket.id, stream);

      stream.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as SolveRun;
          applyRunUpdate(parsed);
          if (TERMINAL_SOLVE_STATUSES.has(parsed.status)) {
            stream.close();
            if (eventSourcesRef.current.get(ticket.id) === stream) {
              eventSourcesRef.current.delete(ticket.id);
            }
          }
        } catch {
          // Ignore malformed SSE frame
        }
      };

      stream.onerror = async () => {
        stream.close();
        if (eventSourcesRef.current.get(ticket.id) === stream) {
          eventSourcesRef.current.delete(ticket.id);
        }
        try {
          const pollRes = await fetch(`/api/solve/runs/${initialRun.id}`);
          if (pollRes.ok) {
            const pollData = await pollRes.json();
            if (pollData.run) {
              applyRunUpdate(pollData.run as SolveRun);
            }
          }
        } catch {
          // Ignore fallback poll error
        }
      };
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to start the 5-stage Solve pipeline.'
      );
    }
  };

  const handleCancelSolve = async (runId: string) => {
    try {
      const res = await fetch(`/api/solve/runs/${runId}/cancel`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.run) {
          applyRunUpdate(data.run as SolveRun);
        }
      }
    } catch {
      setErrorMessage('Failed to cancel active Solve run.');
    }
  };

  const handleRunAiReview = async (prId: string) => {
    const targetPr = pullRequests.find((p) => p.id === prId);
    if (!targetPr) return;

    setErrorMessage(null);
    setIsReviewLoading(true);
    try {
      const res = await fetch('/api/ai/review-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: targetPr.title,
          summary: targetPr.summary,
          files: targetPr.files,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to run AI code review.');
      }

      const findings = data.findings || [];
      setPullRequests((prev) =>
        prev.map((p) =>
          p.id === prId
            ? {
                ...p,
                aiReviewRan: true,
                aiReviewSummary: data.summary,
                findings,
                auditTrail: [
                  {
                    id: nextAuditId('aud-rev'),
                    actor: 'AI Code Review',
                    action: `Completed review (${findings.length} findings)`,
                    timestamp: 'Just now',
                  },
                  ...p.auditTrail,
                ],
              }
            : p
        )
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to complete AI code review.'
      );
    } finally {
      setIsReviewLoading(false);
    }
  };

  const handleRerunTests = (prId: string) => {
    setPullRequests((prev) =>
      prev.map((p) => {
        if (p.id !== prId) return p;
        const updatedTests = p.testSuite.map((tc) => ({
          ...tc,
          status: 'passed' as const,
          durationMs: Math.max(11, tc.durationMs + ((Date.now() % 7) - 3)),
        }));
        return {
          ...p,
          testSuite: updatedTests,
          auditTrail: [
            {
              id: nextAuditId('aud-test'),
              actor: 'Test Runner',
              action: `Re-ran ${updatedTests.length}/${updatedTests.length} tests — all passing`,
              timestamp: 'Just now',
            },
            ...p.auditTrail,
          ],
        };
      })
    );
  };

  const handleAcceptFix = (prId: string, findingId: string) => {
    setPullRequests((prev) =>
      prev.map((p) => {
        if (p.id !== prId) return p;
        const targetFinding = p.findings.find((f) => f.id === findingId);
        if (!targetFinding) return p;

        const updatedFiles = p.files.map((file) =>
          file.path === targetFinding.filePath
            ? applySuggestedFix(file, targetFinding)
            : file
        );

        const updatedFindings = p.findings.map((f) =>
          f.id === findingId
            ? { ...f, status: 'resolved' as const, appliedFix: true }
            : f
        );

        return {
          ...p,
          files: updatedFiles,
          findings: updatedFindings,
          auditTrail: [
            {
              id: nextAuditId('aud-fix'),
              actor: 'Elena Rostova',
              action: `Accepted & applied fix for "${targetFinding.title}"`,
              timestamp: 'Just now',
            },
            ...p.auditTrail,
          ],
        };
      })
    );
  };

  const handleResolveFinding = (prId: string, findingId: string) => {
    setPullRequests((prev) =>
      prev.map((p) =>
        p.id === prId
          ? {
              ...p,
              findings: p.findings.map((f) =>
                f.id === findingId ? { ...f, status: 'resolved' as const } : f
              ),
            }
          : p
      )
    );
  };

  const handleDismissFinding = (prId: string, findingId: string) => {
    setPullRequests((prev) =>
      prev.map((p) =>
        p.id === prId
          ? {
              ...p,
              findings: p.findings.map((f) =>
                f.id === findingId ? { ...f, status: 'dismissed' as const } : f
              ),
            }
          : p
      )
    );
  };

  const handleApprovePr = (prId: string, comment: string) => {
    setPullRequests((prev) =>
      prev.map((p) =>
        p.id === prId
          ? {
              ...p,
              status: p.status === 'merged' ? 'merged' : 'approved',
              humanReviewStatus: 'approved',
              reviewComment: comment,
              auditTrail: [
                {
                  id: nextAuditId('aud-app'),
                  actor: 'Elena Rostova',
                  action: comment.trim()
                    ? `Approved PR #${p.number}: "${comment.trim()}"`
                    : `Approved PR #${p.number} for merge`,
                  timestamp: 'Just now',
                },
                ...p.auditTrail,
              ],
            }
          : p
      )
    );
  };

  const handleRequestChanges = (prId: string, comment: string) => {
    setPullRequests((prev) =>
      prev.map((p) =>
        p.id === prId
          ? {
              ...p,
              status: 'changes_requested',
              humanReviewStatus: 'changes_requested',
              reviewComment: comment,
              auditTrail: [
                {
                  id: nextAuditId('aud-chg'),
                  actor: 'Elena Rostova',
                  action: comment.trim()
                    ? `Requested changes: "${comment.trim()}"`
                    : `Requested changes on PR #${p.number}`,
                  timestamp: 'Just now',
                },
                ...p.auditTrail,
              ],
            }
          : p
      )
    );
  };

  const handleChangeMergeStrategy = (prId: string, strategy: MergeStrategy) => {
    setPullRequests((prev) =>
      prev.map((p) => (p.id === prId ? { ...p, mergeStrategy: strategy } : p))
    );
  };

  const handleMergePr = (prId: string) => {
    const targetPr = pullRequests.find((p) => p.id === prId);
    if (!targetPr || !canMergePullRequest(targetPr).allowed) return;

    setPullRequests((prev) =>
      prev.map((p) =>
        p.id === prId
          ? {
              ...p,
              draft: false,
              status: 'merged',
              mergedAt: 'Just now',
              auditTrail: [
                {
                  id: nextAuditId('aud-mrg'),
                  actor: 'Elena Rostova',
                  action: `Merged PR #${p.number} into ${p.baseBranch} (${p.mergeStrategy})`,
                  timestamp: 'Just now',
                },
                ...p.auditTrail,
              ],
            }
          : p
      )
    );

    if (targetPr.linkedTicketKey) {
      setTickets((prev) =>
        prev.map((t) =>
          t.key === targetPr.linkedTicketKey
            ? { ...t, status: 'done', updatedAt: 'Just now' }
            : t
        )
      );
    }
  };

  const handleResolveAmbiguousTarget = (
    repo: string,
    baseBranch: string,
    packagePath?: string
  ) => {
    if (!selectedTicket) return;
    const repoConfig = repositories.find((r) => r.fullName === repo);
    const updatedTicket: JiraTicket = {
      ...selectedTicket,
      repo,
      baseBranch,
      packagePath,
      pinnedSha:
        repoConfig?.pinnedSha ||
        selectedTicket.pinnedSha ||
        'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
      repoResolution: 'explicit',
      targetFiles:
        repo === 'acme-corp/platform-monorepo' &&
        selectedTicket.targetFiles.length === 0
          ? [
              'packages/retry-policy/src/backoff.ts',
              'packages/retry-policy/src/backoff.test.ts',
            ]
          : selectedTicket.targetFiles,
      updatedAt: 'Just now',
    };

    setTickets((prev) =>
      prev.map((t) => (t.id === updatedTicket.id ? updatedTicket : t))
    );
    void handleStartSolve(updatedTicket, '');
  };

  const handleSyncToLatestSha = (ticketId: string) => {
    const targetTicket = tickets.find((t) => t.id === ticketId);
    if (!targetTicket) return;
    const repoMatch = repositories.find((r) => r.fullName === targetTicket.repo);
    const latestSha = repoMatch?.upstreamHeadSha;
    if (!latestSha) return;

    setRepositories((prev) =>
      prev.map((r) =>
        r.fullName === targetTicket.repo ? { ...r, pinnedSha: latestSha } : r
      )
    );
    setTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId ? { ...t, pinnedSha: latestSha, updatedAt: 'Just now' } : t
      )
    );
  };

  const handleSimulateUpstreamPush = (repoId: string) => {
    const newSha = Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    setRepositories((prev) =>
      prev.map((r) => (r.id === repoId ? { ...r, upstreamHeadSha: newSha } : r))
    );
  };

  const handleAddRepository = (
    repoData: Omit<RepositoryConfig, 'id' | 'openPrCount'>
  ) => {
    const newRepo: RepositoryConfig = {
      ...repoData,
      id: `repo-${Date.now()}`,
      openPrCount: 0,
    };
    setRepositories((prev) => [newRepo, ...prev]);
  };

  const handleCreateTicket = (input: NewTicketInput) => {
    const nextNum = 426 + tickets.length;
    const key = input.key || `ENG-${nextNum}`;
    const repoMatch = repositories.find((r) => r.fullName === input.repo);
    const labels = (input.labelsText || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const newTicket: JiraTicket = {
      id: `tkt-${Date.now()}`,
      key,
      title: input.title.trim(),
      description: input.description.trim(),
      acceptanceCriteria: input.acceptanceCriteriaText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
      repo: input.repo,
      baseBranch: input.baseBranch?.trim() || repoMatch?.defaultBranch || 'main',
      pinnedSha:
        repoMatch?.pinnedSha || 'a4f9c2e8b10d3e7f6a92c4180d5e2b7a1c3f8901',
      jiraProject: key.split('-')[0],
      labels,
      packagePath: input.packagePath,
      repoResolution: input.repoResolution || (input.repo === 'auto' ? 'auto' : 'explicit'),
      targetFiles: input.targetFilesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      priority: input.priority,
      storyPoints: 3,
      status: 'ready',
      assignee: 'Marcus Vance',
      updatedAt: 'Just now',
    };

    setTickets((prev) => [newTicket, ...prev]);
    setSelectedTicketId(newTicket.id);
    setActiveTab('ticket-to-pr');
    setErrorMessage(null);
  };

  const showSidebar = activeTab === 'ticket-to-pr' || activeTab === 'code-review';

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <TopBar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenNewTicket={() => setNewTicketModalOpen(true)}
        onToggleMobileNav={() => setMobileNavOpen((prev) => !prev)}
      />

      <div className="flex flex-1 min-h-0">
        <WorkspaceSidebar
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          tickets={tickets}
          selectedTicketId={selectedTicket?.id || ''}
          onSelectTicket={(id) => {
            setSelectedTicketId(id);
            setErrorMessage(null);
          }}
          pullRequests={pullRequests}
          selectedPrId={activeReviewPr?.id || ''}
          reviewTargetMode={reviewTargetMode}
          onSelectReviewPr={(id) => {
            setReviewTargetMode('pr');
            setSelectedPrId(id);
            setErrorMessage(null);
          }}
          onSelectCustomReview={() => {
            setReviewTargetMode('custom');
            setErrorMessage(null);
          }}
          theme={theme}
          onToggleTheme={() =>
            setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
          }
          activeSolveTicketId={activeSolveRun?.ticketId}
          showDesktopRail={showSidebar}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />

        <main className="min-w-0 flex-1 overflow-y-auto">
          {activeTab === 'ticket-to-pr' && selectedTicket && (
            <TicketToPrView
              key={selectedTicket.id}
              ticket={selectedTicket}
              repositories={repositories}
              pinnedSha={selectedPinnedSha}
              upstreamHeadSha={selectedRepoConfig?.upstreamHeadSha}
              scopeRevision={scopeRevisionByTicket[selectedTicket.id] || 1}
              linkedPr={linkedPr}
              solveRun={solveRunsByTicket[selectedTicket.id]}
              executionMode={executionMode}
              budgetLimit={budgetLimit}
              isReviewLoading={isReviewLoading}
              errorMessage={errorMessage}
              onChangeExecutionMode={setExecutionMode}
              onChangeBudgetLimit={setBudgetLimit}
              onStartSolve={handleStartSolve}
              onResolveAmbiguousTarget={handleResolveAmbiguousTarget}
              onSyncToLatestSha={handleSyncToLatestSha}
              onCancelSolve={handleCancelSolve}
              onRerunTests={handleRerunTests}
              onRunAiReview={handleRunAiReview}
              onOpenInReviewTab={(prId) => {
                setSelectedPrId(prId);
                setReviewTargetMode('pr');
                setActiveTab('code-review');
              }}
              onAcceptFix={handleAcceptFix}
              onResolveFinding={handleResolveFinding}
              onDismissFinding={handleDismissFinding}
              onApprovePr={handleApprovePr}
              onRequestChanges={handleRequestChanges}
              onChangeMergeStrategy={handleChangeMergeStrategy}
              onMergePr={handleMergePr}
            />
          )}

          {activeTab === 'code-review' && activeReviewPr && (
            <CodeReviewView
              mode={reviewTargetMode}
              pr={activeReviewPr}
              isReviewLoading={isReviewLoading}
              errorMessage={errorMessage}
              onRunAiReview={handleRunAiReview}
              onAcceptFix={handleAcceptFix}
              onResolveFinding={handleResolveFinding}
              onDismissFinding={handleDismissFinding}
              onApprovePr={handleApprovePr}
              onRequestChanges={handleRequestChanges}
              onChangeMergeStrategy={handleChangeMergeStrategy}
              onMergePr={handleMergePr}
            />
          )}

          {activeTab === 'pull-requests' && (
            <PullRequestsTable
              pullRequests={pullRequests}
              onOpenPr={(prId) => {
                setSelectedPrId(prId);
                setReviewTargetMode('pr');
                setActiveTab('code-review');
              }}
            />
          )}

          {activeTab === 'repositories' && (
            <RepositoriesView
              repositories={repositories}
              onToggleAutoReview={(repoId) =>
                setRepositories((prev) =>
                  prev.map((r) =>
                    r.id === repoId
                      ? { ...r, autoRunAiReview: !r.autoRunAiReview }
                      : r
                  )
                )
              }
              onUpdateTestCommand={(repoId, command) =>
                setRepositories((prev) =>
                  prev.map((r) =>
                    r.id === repoId ? { ...r, testCommand: command } : r
                  )
                )
              }
              onSimulateUpstreamPush={handleSimulateUpstreamPush}
              onAddRepository={handleAddRepository}
            />
          )}
        </main>
      </div>

      <NewTicketModal
        open={newTicketModalOpen}
        repositories={repositories}
        nextNumber={426 + tickets.length}
        onClose={() => setNewTicketModalOpen(false)}
        onCreateTicket={handleCreateTicket}
      />
    </div>
  );
}
