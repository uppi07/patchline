import crypto from 'node:crypto';
import type { ChangedFile, DiffLine } from '../types.ts';
import { getSnapshotSeed, type SnapshotFileSeed } from './repoSnapshots.ts';

export interface IndexedFileEntry {
  path: string;
  language: string;
  lines: number;
  bytes: number;
  sha: string;
}

export interface SearchCodeMatch {
  path: string;
  line: number;
  preview: string;
}

export interface ReadLinesResult {
  ok: boolean;
  path: string;
  sha?: string;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
  numberedContent?: string;
  error?: string;
}

export interface EditReplacement {
  before: string;
  after: string;
}

export interface ApplyEditInput {
  path: string;
  language?: string;
  summary?: string;
  replacements?: EditReplacement[];
  createContent?: string;
}

export interface ApplyEditResult {
  ok: boolean;
  path: string;
  sha?: string;
  recoverableError?: string;
}

function sha1Hex(text: string): string {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex');
}

export function inferLanguage(filePath: string): string {
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.toml')) return 'toml';
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) return 'typescript';
  if (filePath.endsWith('.jsx') || filePath.endsWith('.js')) return 'javascript';
  return 'text';
}

export function redactLogText(raw: string): string {
  return raw
    .replace(/\b(sk_live_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{12,}|AIza[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_SECRET]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [REDACTED_TOKEN]')
    .slice(0, 4000);
}

/**
 * Computes line-level unified diff entries between original and modified text
 * so line numbers and +/- markers always reflect real staged edits.
 */
export function computeLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const a = beforeText === '' ? [] : beforeText.split('\n');
  const b = afterText === '' ? [] : afterText.split('\n');
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLn = 1;
  let newLn = 1;

  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push({ type: 'context', oldLine: oldLn++, newLine: newLn++, content: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'del', oldLine: oldLn++, content: a[i] });
      i++;
    } else {
      lines.push({ type: 'add', newLine: newLn++, content: b[j] });
      j++;
    }
  }

  while (i < m) {
    lines.push({ type: 'del', oldLine: oldLn++, content: a[i] });
    i++;
  }
  while (j < n) {
    lines.push({ type: 'add', newLine: newLn++, content: b[j] });
    j++;
  }

  return lines;
}

export class WorkspaceSnapshot {
  public readonly repo: string;
  public readonly baseBranch: string;
  public readonly baseSha: string;
  public readonly testCommand: string;

  private readonly baseFiles = new Map<string, SnapshotFileSeed>();
  private readonly stagedFiles = new Map<string, SnapshotFileSeed>();
  private readonly fileSummaries = new Map<string, string>();

  constructor(
    repo: string,
    overrideBaseSha?: string,
    extraSeedPaths: string[] = []
  ) {
    const seed = getSnapshotSeed(repo);
    this.repo = seed.fullName;
    this.baseBranch = seed.defaultBranch;
    this.baseSha = overrideBaseSha || seed.baseSha;
    this.testCommand = seed.testCommand;

    for (const file of seed.files) {
      this.baseFiles.set(file.path, { ...file });
    }

    for (const extraPath of extraSeedPaths) {
      const clean = extraPath.trim();
      if (clean && !this.baseFiles.has(clean)) {
        // Ensure target paths hinted on custom tickets are discoverable or creatable
        // without blocking workspace creation.
        if (clean.endsWith('.test.ts') || clean.endsWith('.spec.ts')) {
          continue;
        }
      }
    }
  }

  indexFiles(): IndexedFileEntry[] {
    const paths = new Set([...this.baseFiles.keys(), ...this.stagedFiles.keys()]);
    return [...paths]
      .sort((a, b) => a.localeCompare(b))
      .map((filePath) => {
        const file = this.stagedFiles.get(filePath) ?? this.baseFiles.get(filePath)!;
        return {
          path: file.path,
          language: file.language,
          lines: file.content.split('\n').length,
          bytes: Buffer.byteLength(file.content, 'utf8'),
          sha: sha1Hex(file.content),
        };
      });
  }

  getCurrentContent(filePath: string): string | undefined {
    return (this.stagedFiles.get(filePath) ?? this.baseFiles.get(filePath))?.content;
  }

  getAllCurrentFiles(): SnapshotFileSeed[] {
    const paths = new Set([...this.baseFiles.keys(), ...this.stagedFiles.keys()]);
    return [...paths]
      .sort((a, b) => a.localeCompare(b))
      .map((p) => this.stagedFiles.get(p) ?? this.baseFiles.get(p)!);
  }

  /**
   * Fast full-workspace search across all indexed files (replaces 8-file API paging).
   */
  searchCode(query: string, pathPrefix?: string, maxResults = 25): SearchCodeMatch[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const matches: SearchCodeMatch[] = [];

    for (const entry of this.indexFiles()) {
      if (pathPrefix && !entry.path.startsWith(pathPrefix)) continue;
      const content = this.getCurrentContent(entry.path) ?? '';
      const lines = content.split('\n');
      for (let idx = 0; idx < lines.length; idx++) {
        if (lines[idx].toLowerCase().includes(needle)) {
          matches.push({
            path: entry.path,
            line: idx + 1,
            preview: lines[idx].trim().slice(0, 180),
          });
          if (matches.length >= maxResults) return matches;
        }
      }
    }
    return matches;
  }

  readLines(filePath: string, startLine = 1, endLine = 200): ReadLinesResult {
    const content = this.getCurrentContent(filePath);
    if (content === undefined) {
      return {
        ok: false,
        path: filePath,
        error: `File "${filePath}" does not exist in pinned snapshot ${this.baseSha.slice(0, 7)}. Use createContent in apply_edit to add a new file, or search_code to locate existing paths.`,
      };
    }

    const lines = content.split('\n');
    const safeStart = Math.max(1, startLine);
    const safeEnd = Math.min(lines.length, Math.max(safeStart, endLine));
    const numberedContent = lines
      .slice(safeStart - 1, safeEnd)
      .map((text, idx) => `${safeStart + idx}: ${text}`)
      .join('\n');

    return {
      ok: true,
      path: filePath,
      sha: sha1Hex(content),
      totalLines: lines.length,
      startLine: safeStart,
      endLine: safeEnd,
      numberedContent,
    };
  }

  /**
   * Recoverable edit primitive: never throws on anchor mismatch; returns
   * diagnostic context so the agent loop can inspect lines and self-correct.
   */
  applyEdit(input: ApplyEditInput): ApplyEditResult {
    const filePath = input.path.trim();
    if (!filePath || filePath.startsWith('/') || filePath.includes('..')) {
      return {
        ok: false,
        path: filePath,
        recoverableError: `Invalid relative path "${filePath}". Provide a repository-relative path without ".." or leading "/".`,
      };
    }

    if (typeof input.createContent === 'string') {
      const cleanContent = input.createContent.replace(/\r\n/g, '\n');
      this.stagedFiles.set(filePath, {
        path: filePath,
        language: input.language || inferLanguage(filePath),
        content: cleanContent,
      });
      if (input.summary) this.fileSummaries.set(filePath, input.summary);
      return { ok: true, path: filePath, sha: sha1Hex(cleanContent) };
    }

    const current = this.getCurrentContent(filePath);
    if (current === undefined) {
      return {
        ok: false,
        path: filePath,
        recoverableError: `Cannot apply replacements to missing file "${filePath}". Pass createContent to create it, or call search_code first.`,
      };
    }

    if (!input.replacements || input.replacements.length === 0) {
      return {
        ok: false,
        path: filePath,
        recoverableError: `No replacements provided for "${filePath}".`,
      };
    }

    let nextContent = current;
    for (let idx = 0; idx < input.replacements.length; idx++) {
      const { before, after } = input.replacements[idx];
      if (!before) {
        return {
          ok: false,
          path: filePath,
          recoverableError: `Replacement #${idx + 1} has empty "before" anchor.`,
        };
      }
      const firstIdx = nextContent.indexOf(before);
      if (firstIdx === -1) {
        const preview = nextContent
          .split('\n')
          .slice(0, 35)
          .map((l, i) => `${i + 1}: ${l}`)
          .join('\n');
        return {
          ok: false,
          path: filePath,
          recoverableError: `Anchor #${idx + 1} not found in "${filePath}". Re-read the file and match exact text:\n${preview}`,
        };
      }
      const secondIdx = nextContent.indexOf(before, firstIdx + before.length);
      if (secondIdx !== -1) {
        return {
          ok: false,
          path: filePath,
          recoverableError: `Anchor #${idx + 1} matched multiple locations in "${filePath}". Include more surrounding lines so the anchor is unique.`,
        };
      }
      nextContent =
        nextContent.slice(0, firstIdx) +
        after +
        nextContent.slice(firstIdx + before.length);
    }

    this.stagedFiles.set(filePath, {
      path: filePath,
      language: input.language || inferLanguage(filePath),
      content: nextContent,
    });
    if (input.summary) this.fileSummaries.set(filePath, input.summary);
    return { ok: true, path: filePath, sha: sha1Hex(nextContent) };
  }

  hasChanges(): boolean {
    for (const [filePath, staged] of this.stagedFiles.entries()) {
      const base = this.baseFiles.get(filePath);
      if (!base || base.content !== staged.content) return true;
    }
    return false;
  }

  computeChangedFiles(): ChangedFile[] {
    const changed: ChangedFile[] = [];
    for (const [filePath, staged] of this.stagedFiles.entries()) {
      const base = this.baseFiles.get(filePath);
      const beforeText = base?.content ?? '';
      if (beforeText === staged.content) continue;
      changed.push({
        path: filePath,
        language: staged.language,
        summary:
          this.fileSummaries.get(filePath) ||
          (base ? `Updated ${filePath}` : `Created ${filePath}`),
        lines: computeLineDiff(beforeText, staged.content),
      });
    }
    return changed.sort((a, b) => a.path.localeCompare(b.path));
  }

  resetOverlay(): void {
    this.stagedFiles.clear();
    this.fileSummaries.clear();
  }
}
