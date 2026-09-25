/**
 * history.mjs — read one person's AI chat history for one repository.
 *
 * This is the only part of a harvest that has to happen on a participant's own machine:
 * transcripts live in their home directory, never in the repo. Everything else — files,
 * git history — a facilitator can read from the pushed repository. So the participant-side
 * command runs this and nothing else, and it is kept free of the repo harvester so it can
 * be bundled into one small downloadable file (see scripts/build-collector.mjs).
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { harvestClaudeCode } from './adapters/claude-code.mjs';
import { harvestCodex } from './adapters/codex.mjs';
import { harvestCopilot } from './adapters/copilot.mjs';
import { harvestCursor } from './adapters/cursor.mjs';
import { makeIsInRepo, makeRepoFrom } from './shared.mjs';

/** Same contract as evidence.json's `chat` block, so merge.mjs can union it unchanged. */
export const HISTORY_SCHEMA_VERSION = 3;

/** Where a history file goes, relative to the repository root. */
export const HISTORY_DIR = '.vibecheck';
export const HISTORY_PREFIX = 'history-';

/**
 * Does a recorded working directory belong to this repository — by either spelling?
 *
 * The root comes from `git rev-parse --show-toplevel`, which resolves symlinks, while an AI
 * tool records whatever path the person had open. On macOS `/var` is itself a symlink to
 * `/private/var`, and a project reached through a symlinked folder is common anywhere. A
 * plain comparison would find nothing and report a team as having no history. So both the
 * root and the recorded path are also compared in their resolved form.
 */
/**
 * `makeRepoFrom` for the root in its given and its resolved spelling, and for the recorded
 * path in both: a workspace opened above a symlinked or case-differing repo still counts.
 */
export function repoFromMatcher(repo) {
  const roots = [repo];
  try { const real = realpathSync.native(repo); if (!roots.includes(real)) roots.push(real); } catch { /* gone */ }
  const froms = roots.map((root) => makeRepoFrom(root));
  return (candidate) => {
    for (const from of froms) { const rel = from(candidate); if (rel) return rel; }
    let real;
    try { real = realpathSync.native(candidate); } catch { return null; }
    for (const from of froms) { const rel = from(real); if (rel) return rel; }
    return null;
  };
}

export function repoMatcher(repo) {
  const roots = [resolve(repo)];
  try {
    const real = realpathSync.native(repo);
    if (!roots.includes(real)) roots.push(real);
  } catch { /* the folder is gone; the given spelling is all there is */ }
  const checks = roots.map((root) => makeIsInRepo(root));
  return (candidate) => {
    if (checks.some((inRepo) => inRepo(candidate))) return true;
    if (typeof candidate !== 'string' || !candidate) return false;
    let real;
    try { real = realpathSync.native(candidate); } catch { return false; }
    return checks.some((inRepo) => inRepo(real));
  };
}

/** Every chat adapter, run concurrently: they share nothing but the repo to match against. */
export async function harvestChat(repo) {
  const isInRepo = repoMatcher(repo);
  const [claudeCode, copilot, codex, cursor] = await Promise.all([
    harvestClaudeCode({ isInRepo }),
    harvestCopilot({ isInRepo }),
    harvestCodex({ isInRepo, repoFrom: repoFromMatcher(repo) }),
    harvestCursor({ isInRepo }),
  ]);
  return { claudeCode, copilot, codex, cursor };
}

/**
 * The repository root for a path, so running from `src/` still matches sessions started at
 * the root. Falls back to the path itself: a folder that is not a git repo is still a
 * folder people worked in.
 */
export function repoRootOf(path) {
  const start = resolve(path);
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: start, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (top) return realpathSync.native(top);
  } catch { /* not a git repo, or no git — the folder given is the root */ }
  return start;
}

/** Who is at this keyboard, for the filename only. Never used for scoring. */
export function whoAmI(repo) {
  try {
    const name = execFileSync('git', ['config', 'user.name'],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (name) return name;
  } catch { /* no git, or no name configured — the OS user will do */ }
  try { return userInfo().username; } catch { return 'member'; }
}

/** A filename-safe slug. */
export function slug(text) {
  return String(text ?? '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** `.vibecheck/history-<person>.json`, one per person so teammates never conflict on merge. */
export function historyFileName(member) {
  return HISTORY_PREFIX + (slug(member) || 'member') + '.json';
}

/**
 * One person's history for one repository, in the shape merge.mjs reads.
 *
 * Deliberately carries no repository state, no test output and no local paths: those come
 * from the pushed repo on the facilitator's side, and a path on a laptop is not something
 * that belongs in a file committed to a shared repository.
 */
export async function collectHistory(repoPath, { member } = {}) {
  const repo = resolve(repoPath);
  const groups = await harvestChat(repo);
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    kind: 'history',
    harvestedAt: new Date().toISOString(),
    member: member ?? null,
    repo: { name: basename(repo) },
    sources: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, g.source])),
    chat: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, g.sessions])),
  };
}
