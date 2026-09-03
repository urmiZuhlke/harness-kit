/**
 * Merging several members' harvests into one team bundle.
 *
 * The property under test throughout is that merging *re-derives* rather than *adds up*.
 * Summing pre-computed totals looks right and is wrong for everything that is not a plain
 * count — a mean, a median, an ordered fail-then-pass loop — and the error is invisible in
 * the output. These tests exist because a team of five is scored on this arithmetic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEvidence, chooseRepoMember, MINIMUM_SCHEMA_VERSION } from '../lib/harvest/merge.mjs';

/** A minimal evidence file with one Claude Code session. */
function member(label, { sessionId = label + '-s1', prompts = 10, chars = 1000,
  corrections = 1, testRuns = [], commits = 3, name = 'app', ran = false,
  planningSignals = 0, tool = 'claudeCode' } = {}) {
  const session = {
    sessionId, startedAt: '2026-09-03T09:00:00.000Z', endedAt: '2026-09-03T17:00:00.000Z',
    userPrompts: prompts,
    promptLength: { count: prompts, totalChars: chars, mean: Math.round(chars / prompts) },
    corrections, assistantTurns: prompts, toolCalls: { Bash: 4 }, toolCallTotal: 4,
    commands: { test: testRuns.length, buildOrLint: 0, destructive: 0, other: 0 },
    testRuns: testRuns.map((outcome) => ({ outcome, at: null })),
    planningSignals, excerpts: { prompts: { kept: [], offered: 0 }, corrections: { kept: [], offered: 0 } },
  };
  const chat = { claudeCode: [], copilot: [], codex: [], cursor: [] };
  chat[tool] = [session];
  return {
    label,
    evidence: {
      schemaVersion: MINIMUM_SCHEMA_VERSION,
      harvestedAt: '2026-09-03T18:00:00.000Z',
      repo: { path: '/home/' + label + '/app', name },
      sources: {
        repo: { status: 'harvested' }, git: { status: 'harvested' },
        journal: { status: 'not-harvested', reason: 'no .ai-journal directory' },
        // The tool this member used is harvested; Codex stands in for a tool nobody
        // could read at all, so its reason has to survive the merge.
        ...Object.fromEntries(['claudeCode', 'copilot', 'codex', 'cursor'].map((t) => [t,
          t === tool ? { status: 'harvested' }
            : t === 'codex' ? { status: 'not-harvested', reason: 'no ~/.codex/sessions directory' }
              : { status: 'empty' }])),
      },
      noChatEvidence: false,
      repoEvidence: { tests: { testFileCount: 4, run: { ran } }, source: { status: 'harvested' } },
      gitEvidence: { commitCount: commits, authors: { ana: commits } },
      journalEvidence: {},
      scale: {},
      chat: { totals: { userPrompts: prompts }, ...chat },
    },
  };
}

test('prompts and sessions are unioned across members', () => {
  const { evidence } = mergeEvidence([
    member('ana', { prompts: 10, chars: 1000 }),
    member('marko', { prompts: 30, chars: 9000 }),
  ]);
  assert.equal(evidence.chat.totals.sessionCount, 2);
  assert.equal(evidence.chat.totals.userPrompts, 40);
  assert.equal(evidence.merged.memberCount, 2);
});

test('the mean prompt length is recomputed, not averaged across members', () => {
  // Ana wrote 10 prompts of 100 characters; Marko wrote 30 of 300. The true mean is 250.
  // Averaging the two members' means gives 200 — a different number, and the one a naive
  // merge produces.
  const { evidence } = mergeEvidence([
    member('ana', { prompts: 10, chars: 1000 }),
    member('marko', { prompts: 30, chars: 9000 }),
  ]);
  assert.equal(evidence.chat.totals.promptLength.mean, 250);
});

test('fail-then-pass loops are recounted per session, never summed', () => {
  // Each member closed one loop. A third loop cannot be manufactured by concatenation:
  // the sequence is a property of one ordered session.
  const { evidence } = mergeEvidence([
    member('ana', { testRuns: ['fail', 'pass'] }),
    member('marko', { testRuns: ['fail', 'pass'] }),
  ]);
  assert.equal(evidence.chat.totals.failThenPassSequences, 2);
  assert.equal(evidence.chat.totals.testRuns.total, 4);
});

test('the same session harvested twice is counted once', () => {
  // Two members who paired at one keyboard, or one member who harvested twice into
  // different folders, would otherwise contribute the same prompts more than once.
  const { evidence, warnings } = mergeEvidence([
    member('ana', { sessionId: 'shared', prompts: 10 }),
    member('marko', { sessionId: 'shared', prompts: 10 }),
  ]);
  assert.equal(evidence.chat.totals.sessionCount, 1);
  assert.equal(evidence.chat.totals.userPrompts, 10);
  assert.match(warnings.join(' '), /appeared in more than one harvest/);
});

test('the fuller copy of a duplicated session wins', () => {
  const { evidence } = mergeEvidence([
    member('ana', { sessionId: 'shared', prompts: 4, chars: 400 }),
    member('marko', { sessionId: 'shared', prompts: 20, chars: 2000 }),
  ]);
  assert.equal(evidence.chat.totals.userPrompts, 20);
});

test('sessions from different tools all survive the merge', () => {
  const { evidence } = mergeEvidence([
    member('ana', { tool: 'claudeCode', prompts: 10 }),
    member('marko', { tool: 'cursor', prompts: 7 }),
    member('jelena', { tool: 'codex', prompts: 5 }),
  ]);
  assert.equal(evidence.chat.totals.userPrompts, 22);
  assert.equal(evidence.chat.cursor.length, 1);
  assert.equal(evidence.chat.codex.length, 1);
});

test('a source harvested by any member is harvested for the team', () => {
  // Only Marko used Cursor. Reporting the team as "no Cursor history" because Ana had
  // none would remove his evidence from the score.
  const { evidence } = mergeEvidence([
    member('ana', { tool: 'claudeCode' }),
    member('marko', { tool: 'cursor' }),
  ]);
  assert.equal(evidence.sources.cursor.status, 'harvested');
});

test('a source no member could read keeps its reason', () => {
  const { evidence } = mergeEvidence([member('ana'), member('marko')]);
  assert.equal(evidence.sources.codex.status, 'not-harvested');
  assert.match(evidence.sources.codex.reason, /\.codex/);
});

test('repository state comes from the most complete clone and is named', () => {
  // A member who harvested before the last push must not be able to decide the team's
  // Reproducibility score by being listed first.
  const { evidence } = mergeEvidence([
    member('ana', { commits: 2 }),
    member('marko', { commits: 40 }),
  ]);
  assert.equal(evidence.merged.repoStateFrom, 'marko');
  assert.equal(evidence.gitEvidence.commitCount, 40);
});

test('with equal histories, the member whose suite actually ran is preferred', () => {
  const chosen = chooseRepoMember([
    member('ana', { commits: 5, ran: false }),
    member('marko', { commits: 5, ran: true }),
  ]);
  assert.equal(chosen.label, 'marko');
});

test('scale reports how many machines the evidence came from', () => {
  const { evidence } = mergeEvidence([member('ana'), member('marko'), member('jelena')]);
  assert.equal(evidence.scale.memberHarvests, 3);
  assert.equal(evidence.scale.contributors, 3);
  assert.equal(evidence.scale.sessions, 3);
});

test('merging harvests of different repositories warns rather than passing in silence', () => {
  const { warnings } = mergeEvidence([
    member('ana', { name: 'booking-app' }),
    member('marko', { name: 'something-else' }),
  ]);
  assert.match(warnings.join(' '), /different repositories/);
});

test('an evidence file from an older schema is refused with an instruction', () => {
  const old = member('ana');
  old.evidence.schemaVersion = 2;
  assert.throws(() => mergeEvidence([old]), /schema v2/);
  assert.throws(() => mergeEvidence([old]), /Re-run vibecheck/);
});

test('merging nothing is an error, not an empty team', () => {
  assert.throws(() => mergeEvidence([]), /nothing to merge/);
});

test('a merged bundle records every member for audit', () => {
  const { evidence } = mergeEvidence([member('ana'), member('marko')]);
  assert.deepEqual(evidence.merged.members.map((m) => m.label), ['ana', 'marko']);
  assert.equal(evidence.merged.members[0].repoPath, '/home/ana/app');
});
