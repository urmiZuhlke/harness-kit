/**
 * git.mjs — observe the commit history.
 *
 * The most valuable signal here is timing. A harness written before the code is a harness
 * that was actually used; one committed in the last hour was written for the scorer. That
 * is expensive to fake and cheap to measure, which is exactly the kind of evidence this
 * kit prefers.
 */
import { execFileSync } from 'node:child_process';
import { source } from './shared.mjs';

/**
 * Field separator for `git log --format`. %x1f emits an ASCII unit separator, chosen
 * because it cannot appear in a commit subject, author name or ISO date — unlike any
 * printable delimiter, which a commit message could contain and split a record in two.
 * Built from its char code so the byte is unambiguous in this source file.
 */
const FIELD = String.fromCharCode(31);

const CONVENTIONAL = /^(?:feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(?:\([^)]+\))?!?:\s+\S/;

function git(repo, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (err) {
    if (allowFailure) return null;
    throw err;
  }
}

/** ISO timestamp of the commit that first added a path, or null if never committed. */
function firstAddedAt(repo, path) {
  const out = git(repo, ['log', '--diff-filter=A', '--follow', '--format=%aI', '--', path], { allowFailure: true });
  if (!out) return null;
  const lines = out.split('\n').filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

export function harvestGit(repo, { harnessPaths = [] } = {}) {
  const inside = git(repo, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (inside !== 'true') {
    return { source: source.notHarvested('not a git repository — no history to read') };
  }

  // Distinguish "no commits" from "the command failed". Both used to report an empty
  // history, so a repo whose log exceeded the output buffer looked brand new and silently
  // lost the harness-timing criterion.
  const hasCommits = git(repo, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }) !== null;
  if (!hasCommits) {
    return { source: source.empty('git repository has no commits yet') };
  }

  let log;
  try {
    log = git(repo, ['log', '--format=%H%x1f%aI%x1f%an%x1f%s']);
  } catch (err) {
    return {
      source: source.notHarvested('could not read the commit history: ' + err.message),
    };
  }

  const commits = log.split('\n').filter(Boolean).map((line) => {
    const [hash, date, author, subject] = line.split(FIELD);
    return { hash, date, author, subject: subject ?? '' };
  });
  if (!commits.length) {
    return { source: source.empty('git repository has no commits yet') };
  }

  const conventional = commits.filter((c) => CONVENTIONAL.test(c.subject)).length;
  const times = commits.map((c) => Date.parse(c.date)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  const medianCommitAt = times.length ? times[Math.floor(times.length / 2)] : null;

  // When did each harness artefact first appear, relative to the bulk of the work?
  const harnessTiming = harnessPaths.map((path) => {
    const at = firstAddedAt(repo, path);
    const t = at ? Date.parse(at) : NaN;
    return {
      path,
      firstAddedAt: at,
      commitsAfterItAppeared: Number.isNaN(t) ? null : times.filter((x) => x > t).length,
      precededMedianCommit: Number.isNaN(t) || medianCommitAt === null ? null : t < medianCommitAt,
    };
  }).filter((entry) => entry.firstAddedAt !== null);

  const trackedEnv = (git(repo, ['ls-files', '.env', '*.env', '**/.env'], { allowFailure: true }) ?? '')
    .split('\n').filter(Boolean);

  const authors = {};
  for (const c of commits) authors[c.author] = (authors[c.author] ?? 0) + 1;

  return {
    source: source.harvested({ commitsRead: commits.length }),
    commitCount: commits.length,
    authors,
    branch: git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true }),
    firstCommitAt: times.length ? new Date(times[0]).toISOString() : null,
    lastCommitAt: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    spanHours: times.length > 1
      ? Math.round(((times[times.length - 1] - times[0]) / 3600000) * 10) / 10 : 0,
    medianCommitAt: medianCommitAt ? new Date(medianCommitAt).toISOString() : null,
    conventionalCommits: {
      count: conventional,
      total: commits.length,
      ratio: Math.round((conventional / commits.length) * 100) / 100,
    },
    harnessTiming,
    trackedEnvFiles: trackedEnv,
    uncommittedChanges: (git(repo, ['status', '--porcelain'], { allowFailure: true }) ?? '')
      .split('\n').filter(Boolean).length,
  };
}
