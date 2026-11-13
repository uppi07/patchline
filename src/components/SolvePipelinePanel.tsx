import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  RotateCw,
  Square,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { SolveRun, SolveStageId, TicketStatus } from '../types';

interface SolvePipelinePanelProps {
  run: SolveRun;
  onCancel: (runId: string) => void;
  onRetry: () => void;
}

const STAGES: Array<{ id: SolveStageId; code: string; label: string }> = [
  { id: 'indexing', code: '01', label: 'Index' },
  { id: 'planning', code: '02', label: 'Plan' },
  { id: 'solving', code: '03', label: 'Edit & Test' },
  { id: 'verifying', code: '04', label: 'Verify' },
  { id: 'publishing', code: '05', label: 'Draft PR' },
];

const JIRA_LABEL: Record<TicketStatus, string> = {
  ready: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

export function SolvePipelinePanel({
  run,
  onCancel,
  onRetry,
}: SolvePipelinePanelProps) {
  const [traceTab, setTraceTab] = useState<'plan' | 'tools' | 'verify' | 'checkpoints'>(
    run.verification ? 'verify' : 'tools'
  );

  const isActive = run.status === 'queued' || run.status === 'running';
  const budgetText =
    run.maxModelCalls === null
      ? `${run.modelCallsUsed} / ∞`
      : `${run.modelCallsUsed} / ${run.maxModelCalls}`;

  const statusTone =
    run.status === 'succeeded'
      ? 'text-emerald-700 dark:text-emerald-400'
      : run.status === 'failed'
      ? 'text-red-700 dark:text-red-400'
      : run.status === 'needs_info'
      ? 'text-amber-700 dark:text-amber-400'
      : run.status === 'cancelled'
      ? 'text-slate-500 dark:text-slate-400'
      : 'text-blue-700 dark:text-blue-400';

  const statusLabel =
    run.status === 'succeeded'
      ? 'Completed'
      : run.status === 'failed'
      ? 'Blocked'
      : run.status === 'needs_info'
      ? 'Needs Clarification'
      : run.status === 'cancelled'
      ? 'Cancelled'
      : run.status === 'queued'
      ? 'Queued'
      : 'Running';

  return (
    <section
      aria-label="5-stage ticket solve pipeline"
      className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className={`inline-flex items-center gap-1.5 font-semibold ${statusTone}`}>
              {isActive && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {run.status === 'succeeded' && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
              {run.status === 'failed' && <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
              {run.status === 'needs_info' && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
              <span>{statusLabel}</span>
            </span>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
            <span className="font-mono text-slate-600 tabular-nums dark:text-slate-300">
              {run.baseBranch} @ {run.baseSha.slice(0, 7)}
            </span>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
            <span className="font-mono text-slate-500 tabular-nums dark:text-slate-400">
              Scope Rev {run.scopeRevision}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            <span>
              Jira:{' '}
              <strong className="font-medium text-slate-800 dark:text-slate-200">
                {JIRA_LABEL[run.jiraStatusAtStart]} → {JIRA_LABEL[run.jiraStatusCurrent]}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Budget:{' '}
              <strong className="font-mono font-medium text-slate-800 dark:text-slate-200">
                {budgetText}
              </strong>{' '}
              ({run.executionMode})
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Repairs:{' '}
              <strong className="font-mono font-medium text-slate-800 dark:text-slate-200">
                {run.repairAttempts}/2
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Indexed:{' '}
              <strong className="font-mono font-medium text-slate-800 dark:text-slate-200">
                {run.indexedFilesCount} files
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Engine:{' '}
              <strong className="font-medium text-slate-800 dark:text-slate-200">
                {run.source === 'gemini' ? 'Gemini' : 'Built-in'}
              </strong>
            </span>
          </div>

          {run.fallbackReason && (
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
              {run.fallbackReason}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isActive ? (
            <button
              type="button"
              onClick={() => onCancel(run.id)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <Square className="h-3 w-3 fill-current" aria-hidden="true" />
              <span>Cancel Run</span>
            </button>
          ) : (run.status === 'failed' || run.status === 'cancelled') && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Retry Solve</span>
            </button>
          )}
        </div>
      </div>

      {/* 5-Stage Horizontal Stepper */}
      <ol
        aria-label="Solve stages"
        className="grid grid-cols-2 divide-y divide-slate-200 border-b border-slate-200 sm:grid-cols-5 sm:divide-x sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800"
      >
        {STAGES.map((stage) => {
          const completed = run.completedStages.includes(stage.id);
          const current = run.currentStage === stage.id && !completed;
          const failedHere = current && run.status === 'failed';

          return (
            <li
              key={stage.id}
              className={`flex items-center gap-2.5 px-4 py-3 text-xs ${
                current && isActive
                  ? 'bg-blue-50/50 dark:bg-blue-950/20'
                  : failedHere
                  ? 'bg-red-50/50 dark:bg-red-950/20'
                  : ''
              }`}
            >
              {completed ? (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
              ) : failedHere ? (
                <XCircle
                  className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
                  aria-hidden="true"
                />
              ) : current && isActive ? (
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400"
                  aria-hidden="true"
                />
              ) : current && run.status === 'needs_info' ? (
                <AlertTriangle
                  className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
              ) : (
                <Circle
                  className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-700"
                  aria-hidden="true"
                />
              )}

              <div className="min-w-0">
                <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                  {stage.code}
                </div>
                <div
                  className={`truncate font-medium ${
                    completed
                      ? 'text-slate-900 dark:text-slate-100'
                      : current
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {stage.label}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Needs Info / Error Notice */}
      {run.status === 'needs_info' && run.questions && run.questions.length > 0 && (
        <div className="border-b border-slate-200 bg-amber-50/60 px-5 py-4 dark:border-slate-800 dark:bg-amber-950/20">
          <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            Clarification required before writing code (Jira kept in To Do)
          </div>
          <ul className="mt-2 space-y-1.5 text-xs text-amber-800 dark:text-amber-300">
            {run.questions.map((q, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="font-mono tabular-nums">{idx + 1}.</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
            Add answers in Engineering Guidance and start a new Solve run.
          </p>
        </div>
      )}

      {run.status === 'failed' && run.error && (
        <div className="border-b border-slate-200 bg-red-50/60 px-5 py-3.5 text-xs text-red-800 dark:border-slate-800 dark:bg-red-950/20 dark:text-red-200">
          <div className="font-semibold">{run.error}</div>
          {run.verification?.baselineCheck && (
            <div className="mt-1 font-mono text-[11px] text-red-700 dark:text-red-300">
              Baseline on {run.baseSha.slice(0, 7)}: {run.verification.baselineCheck.summary}
            </div>
          )}
        </div>
      )}

      {/* Trace Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-2.5 dark:border-slate-800">
        <div role="tablist" aria-label="Solve run details" className="inline-flex flex-wrap gap-1">
          {(
            [
              { id: 'tools', label: `Tool Trace (${run.toolEvents.length})` },
              { id: 'plan', label: 'Plan' },
              { id: 'verify', label: 'Verification' },
              { id: 'checkpoints', label: `Checkpoints (${run.checkpoints.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={traceTab === tab.id}
              onClick={() => setTraceTab(tab.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                traceTab === tab.id
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span className="font-mono text-[11px] text-slate-400 tabular-nums">
          Run {run.id}
        </span>
      </div>

      {/* Trace Tab Content */}
      <div className="p-5">
        {traceTab === 'tools' && (
          run.toolEvents.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Waiting for Stage 1 workspace indexing tools...
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {run.toolEvents.map((ev) => (
                <li key={ev.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      {ev.ok ? (
                        <CheckCircle2
                          className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                          aria-hidden="true"
                        />
                      ) : (
                        <Wrench
                          className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-hidden="true"
                        />
                      )}
                      <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        {ev.tool}
                      </span>
                      <span className="truncate text-slate-600 dark:text-slate-300">
                        {ev.summary}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {ev.durationMs}ms
                    </span>
                  </div>
                  {ev.recoverableError && (
                    <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] text-amber-800 dark:bg-slate-950 dark:text-amber-300">
                      {ev.recoverableError}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )
        )}

        {traceTab === 'plan' && (
          run.plan ? (
            <div className="space-y-3 text-xs">
              <p className="font-medium text-slate-800 dark:text-slate-200">
                {run.plan.summary}
              </p>
              {run.plan.targetFiles.length > 0 && (
                <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  Targets: {run.plan.targetFiles.join(' · ')}
                </div>
              )}
              <ol className="space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
                {run.plan.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {String(i + 1).padStart(2, '0')}.
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              {run.plan.notes && (
                <p className="border-t border-slate-200 pt-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  Note: {run.plan.notes}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Planning stage has not produced a plan yet.
            </p>
          )
        )}

        {traceTab === 'verify' && (
          run.verification ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 font-mono text-slate-800 dark:text-slate-200">
                  <Terminal className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>$ {run.verification.command}</span>
                </div>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    run.verification.status === 'passed'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  exit {run.verification.exitCode} · {run.verification.durationMs}ms
                </span>
              </div>
              <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:bg-slate-950 dark:text-slate-200">
                {run.verification.log}
              </pre>
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Isolated test verification runs in Stage 4 before branch or PR publication.
            </p>
          )
        )}

        {traceTab === 'checkpoints' && (
          run.checkpoints.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Publication checkpoints (`blob → tree → commit → branch → pullRequest`) record once verification passes.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {run.checkpoints.map((cp, idx) => (
                <li
                  key={`${cp.stage}-${cp.phase}-${idx}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      {cp.stage}.{cp.phase}
                    </span>
                    <span className="text-slate-600 dark:text-slate-300">{cp.detail}</span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    {cp.timestamp.slice(11, 19)} UTC
                  </span>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </section>
  );
}
