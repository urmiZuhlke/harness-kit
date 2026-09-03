/**
 * Volume-scaled thresholds, and the three criteria added with them.
 *
 * The rubric's counts were tuned for one person working for one day. Five people working
 * for two days clear every one of them before lunch on the first day, so the two heaviest
 * dimensions stopped separating a good team from an excellent one. Scaling the thresholds
 * fixes that — but the way it could go wrong is by quietly raising the bar on a small team
 * too, which is why the "never worse than before" property is asserted here as directly as
 * the scaling itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../lib/score/index.mjs';
import { scaledThreshold } from '../lib/score/dimensions.mjs';

/** A team that passes everything, which each test then makes worse in exactly one way. */
function evidenceFixture(overrides = {}) {
  const base = {
    schemaVersion: 3, harvestedAt: '2026-09-03T10:00:00.000Z',
    repo: { path: null, name: 'fixture' },
    sources: { repo: { status: 'harvested' }, git: { status: 'harvested' } },
    noChatEvidence: false,
    repoEvidence: {
      source: { status: 'harvested', truncated: false },
      harnessFiles: [{ path: 'AGENTS.md', present: true, lines: 90, unfilledPlaceholders: 0, templateSimilarity: 0.1 }],
      instructionFiles: [],
      contextDocs: [{ path: 'docs/project-context.md', present: true, lines: 120, unfilledPlaceholders: 0, templateSimilarity: 0.1 }],
      commands: { setup: 'npm run setup', test: 'npm test', dev: 'npm run dev' },
      tests: { testFileCount: 8, sourceFileCount: 60, run: { ran: true, command: 'npm test', exitCode: 0, durationMs: 900 } },
      safety: { secretFindings: { kept: [], offered: 0 }, gitignorePresent: true, gitignoreCoversEnv: true, claudeSettingsPresent: true },
      reproducibility: { readmePresent: true, readmeBytes: 2400, setupCommand: 'npm run setup', runCommand: 'npm run dev', lockfilePresent: true },
    },
    gitEvidence: {
      source: { status: 'harvested' }, commitCount: 40, trackedEnvFiles: [], authors: { ana: 40 },
      harnessTiming: [{ path: 'AGENTS.md', firstAddedAt: '2026-09-03T08:00:00.000Z', commitsAfterItAppeared: 30, precededMedianCommit: true }],
    },
    journalEvidence: { entryCount: 2, substantiveEntries: 2 },
    scale: { memberHarvests: 1, contributors: 1, sessions: 4, activeDays: 1 },
    chat: {
      totals: {
        sessionCount: 4, userPrompts: 40, toolCalls: 600, corrections: 2,
        testRuns: { total: 5, pass: 4, fail: 1, unknown: 0 }, failThenPassSequences: 2,
        tracedSessions: 2,
        commands: { test: 5, buildOrLint: 8, destructive: 0, other: 100 },
        planningSignals: 3, promptLength: { count: 40, totalChars: 32000, mean: 800 },
      },
      claudeCode: [], copilot: [], codex: [], cursor: [],
    },
  };
  const merged = { ...base, ...overrides };
  if (overrides.chat) merged.chat = { ...base.chat, ...overrides.chat, totals: { ...base.chat.totals, ...(overrides.chat.totals ?? {}) } };
  return merged;
}

const criterion = (result, dimensionId, criterionId) => result.dimensions
  .find((d) => d.id === dimensionId).criteria.find((c) => c.id === criterionId);

// --- the helper itself ------------------------------------------------------------------

test('a threshold never falls below the single-person baseline', () => {
  // The property that protects a small team: more evidence can raise the bar, less can
  // never lower it below what it always was.
  for (const observed of [0, 1, 5, 20, 39]) {
    assert.equal(scaledThreshold(2, observed, 20), 2, 'observed ' + observed);
  }
});

test('a threshold rises with the volume of evidence', () => {
  assert.equal(scaledThreshold(2, 100, 20), 5);
  assert.equal(scaledThreshold(5, 240, 8), 30);
});

test('a threshold is capped so it can never become unreachable', () => {
  // The cap matters where the observed unit differs from the counted one: three test
  // files per thirty source files is fine at sixty files and a suite nobody could write
  // in two days at three thousand.
  assert.equal(scaledThreshold(3, 100000, 30, 4), 12);
  assert.equal(scaledThreshold(2, 100000, 20), 20);
});

test('a missing or nonsensical volume falls back to the baseline', () => {
  for (const bad of [undefined, null, NaN, -5]) {
    assert.equal(scaledThreshold(2, bad, 20), 2);
  }
});

// --- the same behaviour scores the same at small scale -----------------------------------

test('a solo team is held to exactly the standard it was held to before', () => {
  // Two corrections across forty prompts, five test runs, two closed loops: the old
  // absolutes. Every one of them must still be a pass, or the recalibration has quietly
  // punished the teams it was never aimed at.
  const r = score(evidenceFixture());
  assert.equal(criterion(r, 'working-method', 'course-correction').status, 'pass');
  assert.equal(criterion(r, 'verification-loop', 'agent-ran-tests').status, 'pass');
  assert.equal(criterion(r, 'verification-loop', 'failures-were-closed').status, 'pass');
  assert.equal(criterion(r, 'verification-loop', 'tests-exist').status, 'pass');
});

// --- and stops being a pass at large scale ------------------------------------------------

test('the same two corrections across ten times the work no longer passes', () => {
  const r = score(evidenceFixture({ chat: { totals: { userPrompts: 400, corrections: 2 } } }));
  const c = criterion(r, 'working-method', 'course-correction');
  assert.notEqual(c.status, 'pass');
  assert.match(c.evidence, /20 expected/);
});

test('a large team that keeps up the same habit still passes', () => {
  const r = score(evidenceFixture({ chat: { totals: { userPrompts: 400, corrections: 22 } } }));
  assert.equal(criterion(r, 'working-method', 'course-correction').status, 'pass');
});

test('failures left hanging no longer pass, however many were closed elsewhere', () => {
  // Twenty failing runs with three returns to green: seventeen failures that were never
  // driven back. The old rule passed this on two loops alone.
  const r = score(evidenceFixture({
    chat: { totals: { testRuns: { total: 40, pass: 20, fail: 20, unknown: 0 }, failThenPassSequences: 3 } },
  }));
  const c = criterion(r, 'verification-loop', 'failures-were-closed');
  assert.notEqual(c.status, 'pass');
  assert.match(c.evidence, /7 expected/);
});

test('a team whose suite rarely broke is not asked for loops it could not make', () => {
  const r = score(evidenceFixture({
    chat: { totals: { testRuns: { total: 20, pass: 18, fail: 2, unknown: 0 }, failThenPassSequences: 2 } },
  }));
  assert.equal(criterion(r, 'verification-loop', 'failures-were-closed').status, 'pass');
});

test('five test runs across four hundred prompts is no longer a verification loop', () => {
  const r = score(evidenceFixture({
    chat: { totals: { userPrompts: 400, testRuns: { total: 5, pass: 4, fail: 1, unknown: 0 } } },
  }));
  assert.notEqual(criterion(r, 'verification-loop', 'agent-ran-tests').status, 'pass');
});

test('three test files for a large codebase is no longer enough', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.tests = { ...ev.repoEvidence.tests, testFileCount: 3, sourceFileCount: 300 };
  const c = criterion(score(ev), 'verification-loop', 'tests-exist');
  assert.equal(c.status, 'partial');
  assert.match(c.evidence, /10 expected/);
});

test('three test files for a small codebase still passes', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.tests = { ...ev.repoEvidence.tests, testFileCount: 3, sourceFileCount: 12 };
  assert.equal(criterion(score(ev), 'verification-loop', 'tests-exist').status, 'pass');
});

// --- end-to-end trace ---------------------------------------------------------------------

test('two sessions carrying the whole loop earn the trace criterion', () => {
  assert.equal(criterion(score(evidenceFixture()), 'working-method', 'end-to-end-trace').status, 'pass');
});

test('work spread across sessions with no single complete loop does not', () => {
  const r = score(evidenceFixture({ chat: { totals: { tracedSessions: 0 } } }));
  const c = criterion(r, 'working-method', 'end-to-end-trace');
  // The journal still describes the work, so this is a partial rather than a zero.
  assert.equal(c.status, 'partial');
  assert.match(c.lostBecause, /journal/);
});

test('with neither a traced session nor a journal, the trace criterion fails', () => {
  const ev = evidenceFixture({ chat: { totals: { tracedSessions: 0 } } });
  ev.journalEvidence = { entryCount: 0, substantiveEntries: 0 };
  const c = criterion(score(ev), 'working-method', 'end-to-end-trace');
  assert.equal(c.status, 'fail');
});

test('with no transcripts and no journal the trace criterion is unassessable, not zero', () => {
  const ev = evidenceFixture({ noChatEvidence: true });
  ev.journalEvidence = { entryCount: 0, substantiveEntries: 0 };
  const c = criterion(score(ev), 'working-method', 'end-to-end-trace');
  assert.equal(c.status, 'not-harvested');
});

// --- domain context ------------------------------------------------------------------------

test('a substantive context document earns full marks', () => {
  assert.equal(criterion(score(evidenceFixture()), 'context-and-harness', 'domain-context-captured').status, 'pass');
});

test('no context document at all fails, and says what to write', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.contextDocs = [];
  const c = criterion(score(ev), 'context-and-harness', 'domain-context-captured');
  assert.equal(c.status, 'fail');
  assert.match(c.lostBecause, /what this project is for/);
});

test('a context document left full of placeholders is partial, not a pass', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.contextDocs = [{ path: 'docs/project-context.md', present: true, lines: 80, unfilledPlaceholders: 6, templateSimilarity: 0.2 }];
  const c = criterion(score(ev), 'context-and-harness', 'domain-context-captured');
  assert.equal(c.status, 'partial');
  assert.match(c.lostBecause, /placeholder/);
});

test('a context document that is still the template is partial, not a pass', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.contextDocs = [{ path: 'docs/project-context.md', present: true, lines: 80, unfilledPlaceholders: 0, templateSimilarity: 0.9 }];
  assert.equal(criterion(score(ev), 'context-and-harness', 'domain-context-captured').status, 'partial');
});

test('a one-line context document is not a context document', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.contextDocs = [{ path: 'docs/project-context.md', present: true, lines: 3, unfilledPlaceholders: 0, templateSimilarity: 0 }];
  const c = criterion(score(ev), 'context-and-harness', 'domain-context-captured');
  assert.equal(c.status, 'partial');
  assert.equal(c.earned, 2);
});

// --- the facilitator-scored criteria ----------------------------------------------------------

test('the acceptance checklist is unassessed until a facilitator records one', () => {
  const c = criterion(score(evidenceFixture()), 'it-actually-works', 'acceptance-checklist');
  assert.equal(c.status, 'not-harvested');
  assert.equal(c.facilitatorScored, true);
});

test('a fully met checklist earns all five points', () => {
  const r = score(evidenceFixture(), {
    facilitatorScorecard: { acceptance: [{ id: 'a', met: true }, { id: 'b', met: true }] },
  });
  assert.equal(criterion(r, 'it-actually-works', 'acceptance-checklist').earned, 5);
});

test('a partly met checklist earns a proportional share and names what failed', () => {
  const r = score(evidenceFixture(), {
    facilitatorScorecard: {
      acceptance: [
        { id: 'book-a-desk', met: true }, { id: 'prevent-conflict', met: true },
        { id: 'auto-release', met: false }, { id: 'admin-override', met: false },
      ],
    },
  });
  const c = criterion(r, 'it-actually-works', 'acceptance-checklist');
  assert.equal(c.earned, 3);
  assert.match(c.evidence, /auto-release/);
});

test('a checklist where nothing ran fails rather than scoring a fraction', () => {
  const r = score(evidenceFixture(), {
    facilitatorScorecard: { acceptance: [{ id: 'a', met: false }, { id: 'b', met: false }] },
  });
  assert.equal(criterion(r, 'it-actually-works', 'acceptance-checklist').status, 'fail');
});

test('the sample-data privacy check is a person’s call, never a scan', () => {
  // Nothing in the evidence can move this criterion: no repo content, no fixture, no
  // pattern. Only a facilitator writing it down.
  const unchecked = criterion(score(evidenceFixture()), 'safety-and-boundaries', 'privacy-of-sample-data');
  assert.equal(unchecked.status, 'not-harvested');

  const met = score(evidenceFixture(), { facilitatorScorecard: { privacy: { met: true } } });
  assert.equal(criterion(met, 'safety-and-boundaries', 'privacy-of-sample-data').earned, 2);

  const raised = score(evidenceFixture(), {
    facilitatorScorecard: { privacy: { met: false, note: 'seed data uses real colleague names' } },
  });
  const c = criterion(raised, 'safety-and-boundaries', 'privacy-of-sample-data');
  assert.equal(c.status, 'fail');
  assert.match(c.lostBecause, /real colleague names/);
});

// --- the whole rubric still adds up --------------------------------------------------------

test('a team that does everything, checked by a facilitator, scores 100', () => {
  const r = score(evidenceFixture(), {
    judgement: {
      schemaVersion: 1, model: 'test', promptVersion: 'x', judgedAt: '2026-09-03T12:00:00.000Z',
      criteria: {
        'iterative-direction': { points: 7, justification: 'real decomposition' },
        'harness-is-substantive': { points: 5, justification: 'real rules' },
        'domain-context-captured': { points: 6, justification: 'the domain is written down' },
      },
    },
    facilitatorScorecard: {
      demo: { points: 10 },
      acceptance: [{ id: 'a', met: true }],
      privacy: { met: true },
    },
  });
  assert.equal(r.available, 100, JSON.stringify(r.dimensions.map((d) => [d.id, d.available])));
  assert.equal(r.total, 100, JSON.stringify(r.lostPoints));
  assert.equal(r.provisional, false);
  assert.equal(r.complete, true);
});

// --- regressions from the review pass ---------------------------------------------------
//
// Every test below is a bug that shipped in the same change that added these criteria.
// They are grouped here rather than scattered because they share one cause: a criterion's
// maximum moved and something that referenced the old maximum did not.

test('a partial outcome can never equal the criterion maximum', () => {
  // The bug this catches: `deliberate-boundaries` fell from 3 points to 2 while its
  // no-transcript branch still returned partial(2) — full marks for a team with no
  // permission policy and no evidence either way. The scorer now reports such a criterion
  // as its own fault rather than paying out.
  const ev = evidenceFixture({ noChatEvidence: true });
  for (const d of score(ev).dimensions) {
    for (const c of d.criteria) {
      if (c.status !== 'partial') continue;
      assert.ok(c.earned > 0 && c.earned < c.points,
        d.id + '/' + c.id + ' awarded ' + c.earned + ' of ' + c.points + ' as a partial');
    }
  }
});

test('the same holds for a team with full transcripts', () => {
  const r = score(evidenceFixture(), {
    facilitatorScorecard: { demo: { points: 4 }, acceptance: [{ id: 'a', met: true }, { id: 'b', met: false }], privacy: { met: true } },
  });
  for (const d of r.dimensions) {
    for (const c of d.criteria) {
      if (c.status !== 'partial') continue;
      assert.ok(c.earned > 0 && c.earned < c.points,
        d.id + '/' + c.id + ' awarded ' + c.earned + ' of ' + c.points + ' as a partial');
    }
  }
});

test('no readable transcripts does not earn full marks for boundaries', () => {
  const ev = evidenceFixture({ noChatEvidence: true });
  const c = criterion(score(ev), 'safety-and-boundaries', 'deliberate-boundaries');
  // The fixture commits permission settings, so remove them to reach the branch.
  ev.repoEvidence.safety = { ...ev.repoEvidence.safety, claudeSettingsPresent: false };
  const without = criterion(score(ev), 'safety-and-boundaries', 'deliberate-boundaries');
  assert.equal(c.status, 'pass', 'committed settings still earn the criterion outright');
  assert.equal(without.status, 'partial');
  assert.ok(without.earned < without.points,
    'no policy and no evidence must not score the same as a proven-clean team');
});

test('an all-met acceptance checklist reads as a sentence, not a dangling colon', () => {
  const r = score(evidenceFixture(), {
    facilitatorScorecard: { acceptance: [{ id: 'a', met: true }, { id: 'b', met: true }] },
  });
  const c = criterion(r, 'it-actually-works', 'acceptance-checklist');
  assert.match(c.evidence, /all of them$/);
  assert.doesNotMatch(c.evidence, /: $/, 'the unmet list must not be printed when empty');
});

test('the dimension facilitatorScored flag follows its criteria', () => {
  // Declared in two places, the flag drifted: a dimension claimed the scorer computed all
  // of it while one criterion waited on a person, and the leaderboard reported that
  // pending check as permanently unassessable.
  const r = score(evidenceFixture());
  const safety = r.dimensions.find((d) => d.id === 'safety-and-boundaries');
  const works = r.dimensions.find((d) => d.id === 'it-actually-works');
  const repro = r.dimensions.find((d) => d.id === 'reproducibility');
  assert.equal(safety.facilitatorScored, true, 'it holds the sample-data check');
  assert.equal(works.facilitatorScored, true);
  assert.equal(repro.facilitatorScored, false, 'nothing here waits on a person');
});
