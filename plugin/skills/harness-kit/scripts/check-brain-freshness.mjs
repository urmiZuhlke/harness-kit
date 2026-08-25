#!/usr/bin/env node
/**
 * check-brain-freshness.mjs — dependency-free staleness check for a repo's "brain" doc
 * (docs/project-context.md). No LLM call: pure file + git inspection.
 *
 * Usage (from inside the target repo, or with --target <path>):
 *   node path/to/harness-kit/scripts/check-brain-freshness.mjs [--target <repo-path>]
 *
 * Output: one line, machine- and human-readable:
 *   MISSING                         — no brain doc found
 *   STALE <n> <since-date>          — n commits since <since-date> touched core paths
 *   FRESH <since-date>              — no core-path commits since the doc was last updated
 *   UNSTAMPED                       — doc exists but has no "Last updated" date to compare
 *
 * Exit code is always 0 (this is a report, not a gate) unless the target path is invalid.
 *
 * "Core paths" are a best-effort default (src, schema, docs) — pass --paths to override,
 * comma-separated, relative to the repo root.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_DOC_CANDIDATES = ['docs/project-context.md', 'docs/business-context.md'];
const DEFAULT_CORE_PATHS = ['src', 'schema', 'docs'];

function parseArgs(argv) {
  const args = { target: '.', paths: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--paths') args.paths = argv[++i].split(',').map(p => p.trim()).filter(Boolean);
  }
  return args;
}

function findDoc(repoRoot) {
  for (const candidate of DEFAULT_DOC_CANDIDATES) {
    const full = join(repoRoot, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

// Matches "_Last updated: <date> ..._" or "Last updated: <date>" (yyyy-mm-dd preferred,
// but anything Date.parse can read is accepted).
function extractLastUpdated(docText) {
  const match = docText.match(/Last updated:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[A-Za-z0-9 ,\-]+)/i);
  if (!match) return null;
  const parsed = new Date(match[1].trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countCommitsSince(repoRoot, sinceDate, corePaths) {
  const sinceIso = sinceDate.toISOString().slice(0, 10);
  const existingPaths = corePaths.filter(p => existsSync(join(repoRoot, p)));
  if (existingPaths.length === 0) return 0;
  try {
    const out = execFileSync(
      'git',
      ['log', `--since=${sinceIso}`, '--oneline', '--', ...existingPaths],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    return out.split('\n').filter(Boolean).length;
  } catch {
    // Not a git repo, or git unavailable — can't count commits; treat as unknown (0).
    return 0;
  }
}

function main() {
  const { target, paths } = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(target);

  if (!existsSync(repoRoot)) {
    console.error(`Target path does not exist: ${repoRoot}`);
    process.exit(1);
  }

  const docPath = findDoc(repoRoot);
  if (!docPath) {
    console.log('MISSING');
    return;
  }

  const docText = readFileSync(docPath, 'utf8');
  const lastUpdated = extractLastUpdated(docText);
  if (!lastUpdated) {
    console.log('UNSTAMPED');
    return;
  }

  const corePaths = paths ?? DEFAULT_CORE_PATHS;
  const commitCount = countCommitsSince(repoRoot, lastUpdated, corePaths);
  const sinceIso = lastUpdated.toISOString().slice(0, 10);

  if (commitCount > 0) {
    console.log(`STALE ${commitCount} ${sinceIso}`);
  } else {
    console.log(`FRESH ${sinceIso}`);
  }
}

main();
