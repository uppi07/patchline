import type { ChangedFile, DiffLine, ReviewFinding } from '../types';

/**
 * Parses a unified diff string (with @@ -old,count +new,count @@ headers)
 * into structured DiffLine records with accurate line numbering.
 */
export function parseUnifiedDiff(rawDiff: string): DiffLine[] {
  const rawLines = rawDiff.split('\n');
  const result: DiffLine[] = [];

  let oldLineNum = 1;
  let newLineNum = 1;
  let sawHunkHeader = false;

  for (const line of rawLines) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      continue;
    }

    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      oldLineNum = Number.parseInt(hunkMatch[1], 10);
      newLineNum = Number.parseInt(hunkMatch[2], 10);
      sawHunkHeader = true;
      continue;
    }

    if (line.startsWith('+')) {
      result.push({
        type: 'add',
        newLine: newLineNum,
        content: line.slice(1),
      });
      newLineNum += 1;
    } else if (line.startsWith('-')) {
      result.push({
        type: 'del',
        oldLine: oldLineNum,
        content: line.slice(1),
      });
      oldLineNum += 1;
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      if (!sawHunkHeader && content === '' && result.length === 0) {
        continue;
      }
      result.push({
        type: 'context',
        oldLine: oldLineNum,
        newLine: newLineNum,
        content,
      });
      oldLineNum += 1;
      newLineNum += 1;
    }
  }

  return result;
}

/**
 * Converts a plain code snippet (non-diff input) into an all-added DiffLine list
 * so standalone code pasted into One-Click Code Review renders cleanly with line numbers.
 */
export function codeSnippetToDiffLines(code: string): DiffLine[] {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  return lines.map((content, idx) => ({
    type: 'add',
    newLine: idx + 1,
    content,
  }));
}

export interface DiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export function computeDiffStats(files: ChangedFile[]): DiffStats {
  let additions = 0;
  let deletions = 0;

  for (const file of files) {
    for (const line of file.lines) {
      if (line.type === 'add') additions += 1;
      if (line.type === 'del') deletions += 1;
    }
  }

  return {
    filesChanged: files.length,
    additions,
    deletions,
  };
}

/**
 * Applies an AI review finding's suggestedCode fix at the target newLine (or matching line)
 * inside a ChangedFile, renumbering subsequent newLine indices deterministically.
 */
export function applySuggestedFix(
  file: ChangedFile,
  finding: ReviewFinding
): ChangedFile {
  if (!finding.suggestedCode) {
    return file;
  }

  const replacementLines = finding.suggestedCode.split('\n');
  const targetIdx = file.lines.findIndex(
    (l) => l.newLine === finding.line && l.type !== 'del'
  );

  if (targetIdx === -1) {
    return file;
  }

  const targetLine = file.lines[targetIdx];
  const updatedLines: DiffLine[] = [
    ...file.lines.slice(0, targetIdx),
    {
      type: 'del',
      oldLine: targetLine.oldLine ?? targetLine.newLine,
      content: targetLine.content,
    },
    ...replacementLines.map((content) => ({
      type: 'add' as const,
      newLine: 0,
      content,
    })),
    ...file.lines.slice(targetIdx + 1),
  ];

  // Re-number newLine sequentially from the first known newLine
  let runningNew =
    file.lines.find((l) => typeof l.newLine === 'number')?.newLine ?? 1;
  const renumbered = updatedLines.map((line) => {
    if (line.type === 'del') {
      return { ...line, newLine: undefined };
    }
    const next = { ...line, newLine: runningNew };
    runningNew += 1;
    return next;
  });

  return {
    ...file,
    lines: renumbered,
  };
}
