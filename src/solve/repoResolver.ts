import type {
  JiraTicket,
  RepoResolutionCandidate,
  RepoResolutionResult,
  RepositoryConfig,
} from '../types.ts';
import { REPO_SNAPSHOTS } from './repoSnapshots.ts';

function extractLabelValue(labels: string[] | undefined, prefix: string): string | undefined {
  if (!labels || labels.length === 0) return undefined;
  const match = labels.find((l) => l.toLowerCase().startsWith(prefix.toLowerCase()));
  if (!match) return undefined;
  return match.slice(prefix.length).trim() || undefined;
}

function inferMonorepoPackage(
  ticket: JiraTicket,
  repoConfig: RepositoryConfig | undefined,
  labelPkg?: string
): string | undefined {
  const explicitPkg = (ticket.packagePath || labelPkg)?.replace(/^\/+|\/+$/g, '');
  if (explicitPkg) return explicitPkg;
  const pkgs = repoConfig?.monorepoPackages || [];
  if (pkgs.length === 0) return undefined;

  for (const target of ticket.targetFiles || []) {
    const matched = pkgs.find((pkg) => target.startsWith(`${pkg}/`));
    if (matched) return matched;
  }

  const haystack = `${ticket.title} ${ticket.description}`.toLowerCase();
  return pkgs.find((pkg) => {
    const leaf = pkg.split('/').pop()?.toLowerCase() || '';
    return haystack.includes(pkg.toLowerCase()) || (leaf && haystack.includes(leaf));
  });
}

function findRepoConfig(
  repositories: RepositoryConfig[],
  repoName: string
): RepositoryConfig | undefined {
  return repositories.find(
    (r) => r.fullName.toLowerCase() === repoName.toLowerCase()
  );
}

/**
 * 4-Level Deterministic Repository & Branch Resolver:
 * - Level 1: Explicit override OR `repo:` / `branch:` / `pkg:` Jira labels
 * - Level 2: Jira Project key & Component registry bindings
 * - Level 3: Target file path, snapshot symbol, & language hint scoring
 * - Level 4: Ambiguity Gate — stops in `needs_info` instead of guessing
 */
export function resolveTargetRepository(
  ticket: JiraTicket,
  repositories: RepositoryConfig[]
): RepoResolutionResult {
  const labels = ticket.labels || [];
  const labelRepo = extractLabelValue(labels, 'repo:');
  const labelBranch = extractLabelValue(labels, 'branch:');
  const labelPkg = extractLabelValue(labels, 'pkg:');

  // Level 1a: Structured Jira `repo:` label
  if (labelRepo) {
    const matchedConfig = findRepoConfig(repositories, labelRepo);
    const resolvedRepo = matchedConfig?.fullName || labelRepo;
    const baseBranch =
      labelBranch || ticket.baseBranch || matchedConfig?.defaultBranch || 'main';
    const packagePath = inferMonorepoPackage(ticket, matchedConfig, labelPkg);

    return {
      status: 'resolved',
      level: 1,
      strategy: 'jira_label',
      resolvedRepo,
      baseBranch,
      packagePath,
      confidence: 'exact',
      summary: `Resolved via Jira label repo:${resolvedRepo} (branch: ${baseBranch}${packagePath ? `, scope: ${packagePath}` : ''}).`,
      candidates: [
        {
          repo: resolvedRepo,
          baseBranch,
          packagePath,
          score: 100,
          matchedBy: `label repo:${resolvedRepo}`,
        },
      ],
    };
  }

  // Level 1b: Explicit repository selection (when ticket is NOT set to auto-resolve)
  const isAuto =
    ticket.repoResolution === 'auto' ||
    !ticket.repo ||
    ticket.repo.toLowerCase() === 'auto';

  if (!isAuto && ticket.repo) {
    const matchedConfig = findRepoConfig(repositories, ticket.repo);
    const resolvedRepo = matchedConfig?.fullName || ticket.repo;
    const baseBranch =
      labelBranch || ticket.baseBranch || matchedConfig?.defaultBranch || 'main';
    const packagePath = inferMonorepoPackage(ticket, matchedConfig, labelPkg);

    return {
      status: 'resolved',
      level: 1,
      strategy: 'explicit_override',
      resolvedRepo,
      baseBranch,
      packagePath,
      confidence: 'exact',
      summary: `Explicit target ${resolvedRepo} @ ${baseBranch}${packagePath ? ` (scoped: ${packagePath})` : ''}.`,
      candidates: [
        {
          repo: resolvedRepo,
          baseBranch,
          packagePath,
          score: 100,
          matchedBy: 'explicit ticket repository',
        },
      ],
    };
  }

  // Level 2 & Level 3 Scoring across Registered Repositories
  const projectCode = (
    ticket.jiraProject ||
    ticket.key.split('-')[0] ||
    ''
  )
    .trim()
    .toUpperCase();
  const ticketComponents = (ticket.components || []).map((c) => c.toLowerCase());
  const haystack = `${ticket.title} ${ticket.description} ${(ticket.acceptanceCriteria || []).join(' ')}`.toLowerCase();

  const candidates: RepoResolutionCandidate[] = [];

  for (const repo of repositories) {
    let score = 0;
    const reasons: string[] = [];

    const repoProjects = (repo.jiraProjects || []).map((p) => p.toUpperCase());
    if (projectCode && repoProjects.includes(projectCode)) {
      score += 4;
      reasons.push(`project ${projectCode}`);
    }

    const repoComponents = (repo.jiraComponents || []).map((c) => c.toLowerCase());
    const matchedComps = ticketComponents.filter((c) => repoComponents.includes(c));
    if (matchedComps.length > 0) {
      score += matchedComps.length * 4;
      reasons.push(`component ${matchedComps.join(', ')}`);
    }

    const snapshot = REPO_SNAPSHOTS[repo.fullName];
    const snapshotPaths = snapshot ? snapshot.files.map((f) => f.path) : [];

    // Target file exact or directory matches
    for (const target of ticket.targetFiles || []) {
      const clean = target.trim();
      if (!clean) continue;
      if (snapshotPaths.includes(clean)) {
        score += 5;
        reasons.push(`file ${clean}`);
      } else if (
        repo.monorepoPackages?.some((pkg) => clean.startsWith(`${pkg}/`))
      ) {
        score += 5;
        reasons.push(`monorepo path ${clean}`);
      } else if (clean.endsWith('.py') && repo.language.toLowerCase().includes('python')) {
        score += 3;
        reasons.push('python extension');
      }
    }

    // Keyword / snapshot path stem hits
    const shortName = repo.fullName.split('/')[1]?.toLowerCase() || '';
    if (shortName && haystack.includes(shortName)) {
      score += 3;
      reasons.push(`name "${shortName}"`);
    }
    for (const comp of repoComponents) {
      if (!matchedComps.includes(comp) && haystack.includes(comp)) {
        score += 2;
        reasons.push(`keyword "${comp}"`);
      }
    }
    if (repo.language.toLowerCase().includes('python') && /\b(python|pytest|asyncio|pip|pyproject)\b/.test(haystack)) {
      score += 2;
      reasons.push('python runtime hint');
    }

    if (score > 0) {
      const baseBranch = labelBranch || repo.defaultBranch || 'main';
      const packagePath = inferMonorepoPackage(ticket, repo, labelPkg);
      candidates.push({
        repo: repo.fullName,
        baseBranch,
        packagePath,
        score,
        matchedBy: reasons.slice(0, 3).join(' + '),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.repo.localeCompare(b.repo));

  if (candidates.length === 0) {
    return {
      status: 'ambiguous',
      level: 4,
      strategy: 'ambiguous_gate',
      confidence: 'ambiguous',
      summary: `No registered repository matched Jira project "${projectCode || 'unknown'}" or ticket path hints. Confirm target repo & branch before indexing.`,
      candidates: repositories.slice(0, 4).map((r) => ({
        repo: r.fullName,
        baseBranch: labelBranch || r.defaultBranch || 'main',
        score: 0,
        matchedBy: `${r.language} · ${r.defaultBranch}`,
      })),
    };
  }

  const top = candidates[0];
  const second = candidates[1];

  // Clear single winner or >= 3 point lead over runner-up
  if (!second || top.score - second.score >= 3) {
    const usedProjectOrComponent =
      top.matchedBy.includes('project ') || top.matchedBy.includes('component ');
    return {
      status: 'resolved',
      level: usedProjectOrComponent ? 2 : 3,
      strategy: usedProjectOrComponent ? 'project_component' : 'path_hint',
      resolvedRepo: top.repo,
      baseBranch: top.baseBranch,
      packagePath: top.packagePath,
      confidence: usedProjectOrComponent ? 'high' : 'medium',
      summary: `Resolved to ${top.repo} (${top.baseBranch}${top.packagePath ? ` · ${top.packagePath}` : ''}) via ${top.matchedBy}.`,
      candidates,
    };
  }

  // Close tie -> Level 4 Ambiguity Gate (never guess!)
  return {
    status: 'ambiguous',
    level: 4,
    strategy: 'ambiguous_gate',
    confidence: 'ambiguous',
    summary: `Ambiguous target across ${candidates.slice(0, 3).map((c) => c.repo).join(' and ')} (close score ${top.score} vs ${second.score}). Confirm target repo & branch before writing code.`,
    candidates: candidates.slice(0, 4),
  };
}

export function buildIdempotencyKey(
  ticketKey: string,
  scopeRevision: number,
  baseSha: string
): string {
  return `${ticketKey}@rev${scopeRevision}@${baseSha.slice(0, 7)}`;
}

export function detectUpstreamDrift(
  pinnedSha: string,
  upstreamHeadSha?: string
): { drifted: boolean; headSha: string } {
  const head = upstreamHeadSha || pinnedSha;
  return {
    drifted: Boolean(upstreamHeadSha && upstreamHeadSha !== pinnedSha),
    headSha: head,
  };
}

export function getJiraTransitionLabel(
  repoConfig: RepositoryConfig | undefined,
  phase: 'editing' | 'pr_opened'
): string {
  if (phase === 'editing') return 'In Progress';
  return repoConfig?.jiraReviewTransition || 'In Review';
}
