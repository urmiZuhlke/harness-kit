/**
 * index.mjs — run every harvester and assemble evidence.json.
 *
 * evidence.json is the contract the scorer consumes. It is deliberately readable: a facilitator
 * settling a dispute should be able to open it and see what was observed, without running
 * anything. Two rules hold throughout:
 *
 *   - Nothing here scores or judges. Every field is an observation.
 *   - A source that could not be read is `not-harvested`, never a zero. Conflating the two
 *     would punish a team for using a tool we cannot see.
 */
import { basename, resolve } from 'node:path';
import { harvestClaudeCode } from './adapters/claude-code.mjs';
import { harvestCodex } from './adapters/codex.mjs';
import { harvestCopilot } from './adapters/copilot.mjs';
import { harvestCursor } from './adapters/cursor.mjs';
import { harvestGit } from './git.mjs';
import { harvestJournal } from './journal.mjs';
import { harvestRepo } from './repo.mjs';
import { distribution, makeIsInRepo } from './shared.mjs';

/**
 * Bump on any change to the shape or meaning of evidence.json.
 *
 * v2 adds `repoEvidence.harnessFiles[].contentExcerpt` (bounded, secret-redacted) so a
 * facilitator's judging pass can assess harness substance without opening the team's repo.
 * Purely additive — a v1 consumer still reads a v2 file correctly.
 *
 * v3 adds `chat.codex`, `chat.cursor` and a top-level `scale`. Additive in shape, but
 * the version moves because a consumer that reads only `chat.claudeCode` and
 * `chat.copilot` now under-reports a team rather than merely missing a field.
 */
export const EVIDENCE_SCHEMA_VERSION = 3;

/** Fold per-session records into the totals the scorer actually reads. */
export function summariseSessions(groups) {
  const all = groups.flatMap((g) => g.sessions);
  if (!all.length) {
    return {
      sessionCount: 0, userPrompts: 0, toolCalls: 0, corrections: 0,
      testRuns: { total: 0, pass: 0, fail: 0, unknown: 0 }, failThenPassSequences: 0,
      tracedSessions: 0,
      commands: { test: 0, buildOrLint: 0, destructive: 0, other: 0 },
      planningSignals: 0, promptLength: { count: 0, totalChars: 0, mean: 0 }, partialSessions: 0,
    };
  }

  const commands = { test: 0, buildOrLint: 0, destructive: 0, other: 0 };
  const testRuns = { total: 0, pass: 0, fail: 0, unknown: 0 };
  let failThenPass = 0;
  let traced = 0;

  for (const s of all) {
    for (const [kind, n] of Object.entries(s.commands ?? {})) commands[kind] += n;
    let sawFailure = false;
    let closedHere = 0;
    let ranTests = 0;
    for (const run of s.testRuns ?? []) {
      testRuns.total++;
      ranTests++;
      testRuns[run.outcome] = (testRuns[run.outcome] ?? 0) + 1;
      // A failure later followed by a pass is the verification loop actually closing.
      if (run.outcome === 'fail') sawFailure = true;
      else if (run.outcome === 'pass' && sawFailure) { closedHere++; sawFailure = false; }
    }
    failThenPass += closedHere;
    // One session carrying the whole loop end to end: a goal set, work done by the agent,
    // the result actually verified, and a human stepping back in — either by correcting
    // in prose or by driving a failure back to green. Counted per session because that is
    // what makes it a trace rather than four unrelated facts about a fortnight.
    const directed = (s.planningSignals ?? 0) > 0 || (s.userPrompts ?? 0) > 0;
    const worked = (s.toolCallTotal ?? 0) > 0;
    const humanInTheLoop = (s.corrections ?? 0) > 0 || closedHere > 0;
    if (directed && worked && ranTests > 0 && humanInTheLoop) traced++;
  }

  // Raw prompt lengths are never retained, so the global figure is reconstructed exactly
  // from each session's count and character total. Averaging the per-session *means*
  // would silently weight a 3-prompt session the same as a 60-prompt one.
  const promptCount = all.reduce((n, s) => n + (s.promptLength?.count ?? 0), 0);
  const promptChars = all.reduce((n, s) => n + (s.promptLength?.totalChars ?? 0), 0);

  return {
    sessionCount: all.length,
    userPrompts: all.reduce((n, s) => n + (s.userPrompts ?? 0), 0),
    toolCalls: all.reduce((n, s) => n + (s.toolCallTotal ?? 0), 0),
    corrections: all.reduce((n, s) => n + (s.corrections ?? 0), 0),
    testRuns,
    failThenPassSequences: failThenPass,
    tracedSessions: traced,
    commands,
    planningSignals: all.reduce((n, s) => n + (s.planningSignals ?? 0), 0),
    promptLength: {
      count: promptCount,
      totalChars: promptChars,
      mean: promptCount ? Math.round(promptChars / promptCount) : 0,
    },
    partialSessions: all.filter((s) => s.partial).length,
    firstSessionAt: all.map((s) => s.startedAt).filter(Boolean).sort()[0] ?? null,
    lastSessionAt: all.map((s) => s.endedAt).filter(Boolean).sort().pop() ?? null,
  };
}

/**
 * The size of the effort this evidence covers.
 *
 * `memberHarvests` is 1 for a single machine and rises when several are merged into one
 * team bundle. Every field here is reported, never scored: a team is not credited or
 * docked for how many people were on it, only for how they worked.
 */
export function describeScale(groups, gitEvidence, { memberHarvests = 1 } = {}) {
  const sessions = groups.flatMap((g) => g.sessions ?? []);
  const days = new Set();
  for (const s of sessions) {
    for (const stamp of [s.startedAt, s.endedAt]) {
      if (typeof stamp === 'string' && stamp.length >= 10) days.add(stamp.slice(0, 10));
    }
  }
  const authors = Object.keys(gitEvidence?.authors ?? {}).length;
  return {
    memberHarvests,
    // The larger of the two readings. Committing under one shared account hides a team of
    // five behind a single author name, and harvesting one laptop hides them behind a
    // single machine; neither reading is trustworthy on its own.
    contributors: Math.max(memberHarvests, authors, sessions.length ? 1 : 0),
    gitAuthors: authors,
    sessions: sessions.length,
    activeDays: days.size,
    toolsRead: groups.length,
  };
}

export async function harvest(repoPath, options = {}) {
  const repo = resolve(repoPath);
  const isInRepo = makeIsInRepo(repo);
  const kitRoot = options.kitRoot ?? resolve(new URL('../..', import.meta.url).pathname);

  const repoEvidence = await harvestRepo(repo, {
    kitRoot,
    runTestSuite: options.runTestSuite !== false,
    testTimeoutMs: options.testTimeoutMs ?? 120000,
  });

  const harnessPaths = (repoEvidence.harnessFiles ?? [])
    .filter((f) => f.present)
    .map((f) => f.path);

  const gitEvidence = harvestGit(repo, { harnessPaths });
  const journalEvidence = harvestJournal(repo);

  const claude = await harvestClaudeCode({ isInRepo });
  const copilot = await harvestCopilot({ isInRepo });
  const codex = await harvestCodex({ isInRepo });
  const cursor = await harvestCursor({ isInRepo });

  const chatHarvested = [claude, copilot, codex, cursor]
    .filter((g) => g.source.status === 'harvested');

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    harvestedAt: new Date().toISOString(),
    repo: { path: repo, name: basename(repo) },
    sources: {
      repo: repoEvidence.source,
      git: gitEvidence.source,
      journal: journalEvidence.source,
      claudeCode: claude.source,
      copilot: copilot.source,
      codex: codex.source,
      cursor: cursor.source,
    },
    // True when no chat source could be read at all: the scorer must report the
    // transcript-driven dimensions as not-harvested rather than scoring them zero.
    noChatEvidence: chatHarvested.length === 0,
    repoEvidence,
    gitEvidence,
    journalEvidence,
    // What this evidence represents, so a number can be read in context: one person's
    // afternoon and five people's two days produce very different absolute counts for
    // identical working habits. Observation only — the scorer scales its thresholds from
    // observed volume, never from these fields.
    scale: describeScale(chatHarvested, gitEvidence),
    chat: {
      totals: summariseSessions(chatHarvested),
      claudeCode: claude.sessions,
      copilot: copilot.sessions,
      codex: codex.sessions,
      cursor: cursor.sessions,
    },
  };
}
