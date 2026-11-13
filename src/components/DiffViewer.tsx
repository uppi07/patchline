import { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Lightbulb,
  MessageSquare,
  Sparkles,
  X,
} from 'lucide-react';
import type { ChangedFile, ReviewFinding, ReviewSeverity } from '../types';

interface DiffViewerProps {
  files: ChangedFile[];
  findings: ReviewFinding[];
  focusedFindingId?: string | null;
  onAcceptFix?: (findingId: string) => void;
  onResolveFinding?: (findingId: string) => void;
  onDismissFinding?: (findingId: string) => void;
}

const SEVERITY_STYLES: Record<
  ReviewSeverity,
  { label: string; colorClass: string; Icon: typeof AlertCircle }
> = {
  critical: {
    label: 'Critical',
    colorClass: 'text-red-700 dark:text-red-400',
    Icon: AlertCircle,
  },
  suggestion: {
    label: 'Suggestion',
    colorClass: 'text-amber-700 dark:text-amber-400',
    Icon: Lightbulb,
  },
  nitpick: {
    label: 'Nitpick',
    colorClass: 'text-slate-600 dark:text-slate-400',
    Icon: MessageSquare,
  },
};

export function DiffViewer({
  files,
  findings,
  focusedFindingId,
  onAcceptFix,
  onResolveFinding,
  onDismissFinding,
}: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const toggleCollapse = (path: string) => {
    setCollapsedFiles((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1600);
    } catch {
      // Clipboard unavailable in headless browser; fail silently
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-600 dark:text-slate-400">
          Showing <span className="font-mono font-medium text-slate-900 tabular-nums dark:text-slate-200">{files.length}</span> changed {files.length === 1 ? 'file' : 'files'}
        </div>

        <div
          role="group"
          aria-label="Diff view mode"
          className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
        >
          <button
            type="button"
            onClick={() => setViewMode('unified')}
            className={`rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
              viewMode === 'unified'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Unified
          </button>
          <button
            type="button"
            onClick={() => setViewMode('split')}
            className={`rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
              viewMode === 'split'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Split
          </button>
        </div>
      </div>

      {files.map((file) => {
        const isCollapsed = Boolean(collapsedFiles[file.path]);
        const additions = file.lines.filter((l) => l.type === 'add').length;
        const deletions = file.lines.filter((l) => l.type === 'del').length;
        const fileFindings = findings.filter((f) => f.filePath === file.path);

        return (
          <section
            key={file.path}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          >
            {/* File header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleCollapse(file.path)}
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${file.path}`}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
                <span className="truncate font-mono text-xs font-medium text-slate-900 dark:text-slate-100">
                  {file.path}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyPath(file.path)}
                  aria-label={`Copy path ${file.path}`}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {copiedPath === file.path ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              <div className="flex items-center gap-3 font-mono text-xs tabular-nums shrink-0">
                <span className="text-emerald-700 dark:text-emerald-400">+{additions}</span>
                <span className="text-red-600 dark:text-red-400">-{deletions}</span>
                {fileFindings.length > 0 && (
                  <span className="font-sans text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    · {fileFindings.filter((f) => f.status === 'open').length} open review
                  </span>
                )}
              </div>
            </div>

            {!isCollapsed && (
              <div className="overflow-x-auto">
                {viewMode === 'unified' ? (
                  <table className="w-full border-collapse font-mono text-xs leading-5">
                    <tbody>
                      {file.lines.map((line, idx) => {
                        const rowBg =
                          line.type === 'add'
                            ? 'bg-emerald-50/80 dark:bg-emerald-950/35'
                            : line.type === 'del'
                            ? 'bg-red-50/80 dark:bg-red-950/35'
                            : '';

                        const lineFindings = fileFindings.filter(
                          (f) => f.line === line.newLine && line.type !== 'del'
                        );

                        return (
                          <FragmentRow
                            key={`${file.path}-${idx}`}
                            line={line}
                            rowBg={rowBg}
                            lineFindings={lineFindings}
                            focusedFindingId={focusedFindingId}
                            onAcceptFix={onAcceptFix}
                            onResolveFinding={onResolveFinding}
                            onDismissFinding={onDismissFinding}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <SplitDiffTable
                    file={file}
                    findings={fileFindings}
                    focusedFindingId={focusedFindingId}
                    onAcceptFix={onAcceptFix}
                    onResolveFinding={onResolveFinding}
                    onDismissFinding={onDismissFinding}
                  />
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

interface FragmentRowProps {
  line: ChangedFile['lines'][number];
  rowBg: string;
  lineFindings: ReviewFinding[];
  focusedFindingId?: string | null;
  onAcceptFix?: (findingId: string) => void;
  onResolveFinding?: (findingId: string) => void;
  onDismissFinding?: (findingId: string) => void;
}

function FragmentRow({
  line,
  rowBg,
  lineFindings,
  focusedFindingId,
  onAcceptFix,
  onResolveFinding,
  onDismissFinding,
}: FragmentRowProps) {
  const symbol = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
  const symbolColor =
    line.type === 'add'
      ? 'text-emerald-700 dark:text-emerald-400'
      : line.type === 'del'
      ? 'text-red-600 dark:text-red-400'
      : 'text-slate-400';

  return (
    <>
      <tr className={rowBg}>
        <td className="w-10 select-none border-r border-slate-100 px-2 py-0.5 text-right text-[11px] text-slate-400 tabular-nums dark:border-slate-800/80 dark:text-slate-500">
          {line.oldLine ?? ''}
        </td>
        <td className="w-10 select-none border-r border-slate-100 px-2 py-0.5 text-right text-[11px] text-slate-400 tabular-nums dark:border-slate-800/80 dark:text-slate-500">
          {line.newLine ?? ''}
        </td>
        <td className={`w-6 select-none px-2 py-0.5 text-center font-semibold ${symbolColor}`}>
          {symbol}
        </td>
        <td className="whitespace-pre pr-4 py-0.5 text-slate-800 dark:text-slate-200">
          {line.content}
        </td>
      </tr>
      {lineFindings.map((finding) => (
        <tr key={finding.id} className="bg-slate-50/90 dark:bg-slate-950/70">
          <td colSpan={4} className="px-4 py-3 border-y border-slate-200 dark:border-slate-800">
            <InlineFindingCard
              finding={finding}
              isFocused={focusedFindingId === finding.id}
              onAcceptFix={onAcceptFix}
              onResolveFinding={onResolveFinding}
              onDismissFinding={onDismissFinding}
            />
          </td>
        </tr>
      ))}
    </>
  );
}

function SplitDiffTable({
  file,
  findings,
  focusedFindingId,
  onAcceptFix,
  onResolveFinding,
  onDismissFinding,
}: {
  file: ChangedFile;
  findings: ReviewFinding[];
  focusedFindingId?: string | null;
  onAcceptFix?: (findingId: string) => void;
  onResolveFinding?: (findingId: string) => void;
  onDismissFinding?: (findingId: string) => void;
}) {
  const leftRows = file.lines.filter((l) => l.type !== 'add');
  const rightRows = file.lines.filter((l) => l.type !== 'del');
  const rowCount = Math.max(leftRows.length, rightRows.length);

  return (
    <table className="w-full border-collapse font-mono text-xs leading-5">
      <tbody>
        {Array.from({ length: rowCount }).map((_, i) => {
          const left = leftRows[i];
          const right = rightRows[i];
          const rightFindings = right?.newLine
            ? findings.filter((f) => f.line === right.newLine)
            : [];

          return (
            <SplitRowPair
              key={`${file.path}-split-${i}`}
              left={left}
              right={right}
              rightFindings={rightFindings}
              focusedFindingId={focusedFindingId}
              onAcceptFix={onAcceptFix}
              onResolveFinding={onResolveFinding}
              onDismissFinding={onDismissFinding}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function SplitRowPair({
  left,
  right,
  rightFindings,
  focusedFindingId,
  onAcceptFix,
  onResolveFinding,
  onDismissFinding,
}: {
  left?: ChangedFile['lines'][number];
  right?: ChangedFile['lines'][number];
  rightFindings: ReviewFinding[];
  focusedFindingId?: string | null;
  onAcceptFix?: (findingId: string) => void;
  onResolveFinding?: (findingId: string) => void;
  onDismissFinding?: (findingId: string) => void;
}) {
  return (
    <>
      <tr>
        <td
          className={`w-10 select-none border-r border-slate-100 px-2 py-0.5 text-right text-[11px] text-slate-400 tabular-nums dark:border-slate-800 ${
            left?.type === 'del' ? 'bg-red-50/80 dark:bg-red-950/35' : ''
          }`}
        >
          {left?.oldLine ?? ''}
        </td>
        <td
          className={`w-1/2 whitespace-pre border-r border-slate-200 px-3 py-0.5 text-slate-800 dark:border-slate-800 dark:text-slate-200 ${
            left?.type === 'del' ? 'bg-red-50/80 dark:bg-red-950/35' : ''
          }`}
        >
          {left?.content ?? ''}
        </td>
        <td
          className={`w-10 select-none border-r border-slate-100 px-2 py-0.5 text-right text-[11px] text-slate-400 tabular-nums dark:border-slate-800 ${
            right?.type === 'add' ? 'bg-emerald-50/80 dark:bg-emerald-950/35' : ''
          }`}
        >
          {right?.newLine ?? ''}
        </td>
        <td
          className={`w-1/2 whitespace-pre px-3 py-0.5 text-slate-800 dark:text-slate-200 ${
            right?.type === 'add' ? 'bg-emerald-50/80 dark:bg-emerald-950/35' : ''
          }`}
        >
          {right?.content ?? ''}
        </td>
      </tr>
      {rightFindings.map((finding) => (
        <tr key={finding.id} className="bg-slate-50/90 dark:bg-slate-950/70">
          <td colSpan={4} className="border-y border-slate-200 px-4 py-3 dark:border-slate-800">
            <InlineFindingCard
              finding={finding}
              isFocused={focusedFindingId === finding.id}
              onAcceptFix={onAcceptFix}
              onResolveFinding={onResolveFinding}
              onDismissFinding={onDismissFinding}
            />
          </td>
        </tr>
      ))}
    </>
  );
}

function InlineFindingCard({
  finding,
  isFocused,
  onAcceptFix,
  onResolveFinding,
  onDismissFinding,
}: {
  finding: ReviewFinding;
  isFocused: boolean;
  onAcceptFix?: (findingId: string) => void;
  onResolveFinding?: (findingId: string) => void;
  onDismissFinding?: (findingId: string) => void;
}) {
  const { label, colorClass, Icon } = SEVERITY_STYLES[finding.severity];
  const isClosed = finding.status !== 'open';

  return (
    <div
      className={`rounded-lg border p-3.5 font-sans transition-colors ${
        isFocused
          ? 'border-blue-600 bg-white dark:border-blue-500 dark:bg-slate-900'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
      } ${isClosed ? 'opacity-70' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-flex items-center gap-1 font-semibold ${colorClass}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </span>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
            ·
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {finding.title}
          </span>
          {isClosed && (
            <>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                ·
              </span>
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                {finding.appliedFix ? 'Fix applied' : finding.status === 'resolved' ? 'Resolved' : 'Dismissed'}
              </span>
            </>
          )}
        </div>

        <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
          Line {finding.line}
        </span>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        {finding.rationale}
      </p>

      {finding.suggestedCode && (
        <pre className="mt-2.5 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
          {finding.suggestedCode}
        </pre>
      )}

      {finding.status === 'open' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {finding.suggestedCode && onAcceptFix && (
            <button
              type="button"
              aria-label={`Accept and apply fix for ${finding.title}`}
              onClick={() => onAcceptFix(finding.id)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Accept &amp; Apply Fix</span>
            </button>
          )}
          {onResolveFinding && (
            <button
              type="button"
              aria-label={`Resolve ${finding.title}`}
              onClick={() => onResolveFinding(finding.id)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Resolve</span>
            </button>
          )}
          {onDismissFinding && (
            <button
              type="button"
              aria-label={`Dismiss ${finding.title}`}
              onClick={() => onDismissFinding(finding.id)}
              className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Dismiss</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
