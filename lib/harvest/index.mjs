/**
 * index.mjs — run every harvester and assemble evidence.json.
 *
 * evidence.json is the contract the scorer consumes. It is deliberately readable: a coach
 * settling a dispute should be able to open it and see what was observed, without running
 * anything. Two rules hold throughout:
 *
 *   - Nothing here scores or judges. Every field is an observation.
 *   - A source that could not be read is `not-harvested`, never a zero. Conflating the two
 *     would punish a team for using a tool we cannot see.
 */
import { basename, resolve } from 'node:path';
import { harvestClaudeCode } from './adapters/claude-code.mjs';
import { harvestCopilot } from './adapters/copilot.mjs';
import { harvestGit } from './git.mjs';
import { harvestJournal } from './journal.mjs';
import { harvestRepo } from './repo.mjs';
import { distribution, makeIsInRepo } from './shared.mjs';

/**
 * Bump on any change to the shape or meaning of evidence.json.
 *
 * v2 adds `repoEvidence.harnessFiles[].contentExcerpt` (bounded, secret-redacted) so a
 * coach's judging pass can assess harness substance without opening the team's repo.
 * Purely additive — a v1 consumer still reads a v2 file correctly.
 */
export const EVIDENCE_SCHEMA_VERSION = 2;

/** Fold per-session records into the totals the scorer actually reads. */
function summariseSessions(groups) {
  const all = groups.flatMap((g) => g.sessions);
  if (!all.length) {
    return {
      sessionCount: 0, userPrompts: 0, toolCalls: 0, corrections: 0,
      testRuns: { total: 0, pass: 0, fail: 0, unknown: 0 }, failThenPassSequences: 0,
      commands: { test: 0, buildOrLint: 0, destructive: 0, other: 0 },
      planningSignals: 0, promptLength: { count: 0, totalChars: 0, mean: 0 }, partialSessions: 0,
    };
  }

  const commands = { test: 0, buildOrLint: 0, destructive: 0, other: 0 };
  const testRuns = { total: 0, pass: 0, fail: 0, unknown: 0 };
  let failThenPass = 0;

  for (const s of all) {
    for (const [kind, n] of Object.entries(s.commands ?? {})) commands[kind] += n;
    let sawFailure = false;
    for (const run of s.testRuns ?? []) {
      testRuns.total++;
      testRuns[run.outcome] = (testRuns[run.outcome] ?? 0) + 1;
      // A failure later followed by a pass is the verification loop actually closing.
      if (run.outcome === 'fail') sawFailure = true;
      else if (run.outcome === 'pass' && sawFailure) { failThenPass++; sawFailure = false; }
    }
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

  const chatHarvested = [claude, copilot].filter((g) => g.source.status === 'harvested');

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
    },
    // True when no chat source could be read at all: the scorer must report the
    // transcript-driven dimensions as not-harvested rather than scoring them zero.
    noChatEvidence: chatHarvested.length === 0,
    repoEvidence,
    gitEvidence,
    journalEvidence,
    chat: {
      totals: summariseSessions(chatHarvested),
      claudeCode: claude.sessions,
      copilot: copilot.sessions,
    },
  };
}
