/**
 * Scoring rules.
 *
 * The invariants here are what make a competitive result defensible: the weights add to
 * 100, the same evidence always yields the same score, an unassessable dimension is
 * excluded rather than zeroed, and a crash in our code cannot quietly improve a ranking.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, SCORER_VERSION } from '../lib/score/index.mjs';
import { DIMENSIONS } from '../lib/score/dimensions.mjs';

/** Minimal evidence with every source present and unremarkable. */
function evidenceFixture(overrides = {}) {
  const base = {
    schemaVersion: 1,
    harvestedAt: '2026-08-21T10:00:00.000Z',
    repo: { path: null, name: 'fixture' },
    sources: { repo: { status: 'harvested' }, git: { status: 'harvested' } },
    noChatEvidence: false,
    repoEvidence: {
      source: { status: 'harvested', truncated: false },
      harnessFiles: [{ path: 'AGENTS.md', present: true, lines: 90, unfilledPlaceholders: 0, templateSimilarity: 0.1 }],
      instructionFiles: [],
      contextDocs: [],
      commands: { setup: 'npm run setup', test: 'npm test', dev: 'npm run dev' },
      tests: { testFileCount: 7, run: { ran: true, command: 'npm test', exitCode: 0, durationMs: 900 } },
      ci: { workflowCount: 1, workflows: ['ci.yml'] },
      safety: {
        secretFindings: { kept: [], offered: 0, truncated: false },
        gitignorePresent: true, gitignoreCoversEnv: true, claudeSettingsPresent: true,
      },
      reproducibility: {
        readmePresent: true, readmeBytes: 2400, setupCommand: 'npm run setup',
        runCommand: 'npm run dev', lockfilePresent: true, containerised: false,
      },
    },
    gitEvidence: {
      source: { status: 'harvested' },
      commitCount: 40, trackedEnvFiles: [],
      harnessTiming: [{ path: 'AGENTS.md', firstAddedAt: '2026-08-21T08:00:00.000Z', commitsAfterItAppeared: 30, precededMedianCommit: true }],
    },
    journalEvidence: { source: { status: 'harvested' }, entryCount: 3, substantiveEntries: 3 },
    chat: {
      totals: {
        sessionCount: 4, userPrompts: 40, toolCalls: 600, corrections: 6,
        testRuns: { total: 20, pass: 14, fail: 6, unknown: 0 }, failThenPassSequences: 5,
        commands: { test: 20, buildOrLint: 8, destructive: 0, other: 100 },
        planningSignals: 3, promptLength: { count: 40, totalChars: 32000, mean: 800 },
        partialSessions: 0,
      },
      claudeCode: [], copilot: [],
    },
  };
  return { ...base, ...overrides };
}

test('every criterion says what it looked for, and it reaches score.json', () => {
  // `lookedFor` was added to all 19 criteria by script, which is the change most likely to
  // go silently wrong — and a criterion that cannot say what it measured is the whole
  // complaint this field exists to answer.
  for (const d of DIMENSIONS) {
    for (const c of d.criteria) {
      assert.ok(typeof c.lookedFor === 'string' && c.lookedFor.length > 30,
        `${c.id} has no usable lookedFor`);
    }
  }
  const scored = score(evidenceFixture()).dimensions.flatMap((d) => d.criteria);
  assert.equal(scored.length, DIMENSIONS.reduce((n, d) => n + d.criteria.length, 0));
  for (const c of scored) {
    assert.ok(c.lookedFor, `${c.id} lost its lookedFor on the way into score.json`);
  }
});

test('the rubric weights sum to exactly 100', () => {
  const total = DIMENSIONS.reduce((sum, d) => sum + d.points, 0);
  assert.equal(total, 100);
});

test('each dimension’s criteria sum to its declared weight', () => {
  for (const d of DIMENSIONS) {
    const sum = d.criteria.reduce((n, c) => n + c.points, 0);
    assert.equal(sum, d.points, `dimension ${d.id} declares ${d.points} but criteria sum to ${sum}`);
  }
});

test('scoring the same evidence twice gives the same result', () => {
  const ev = evidenceFixture();
  const strip = (s) => { const c = { ...s }; delete c.scoredAt; return JSON.stringify(c); };
  assert.equal(strip(score(ev)), strip(score(ev)));
});

test('dimension totals reconcile with the reported totals', () => {
  const r = score(evidenceFixture());
  assert.equal(r.dimensions.reduce((n, d) => n + d.earned, 0), r.earned);
  assert.equal(r.dimensions.reduce((n, d) => n + d.available, 0), r.available);
  assert.ok(r.earned <= r.available);
});

test('a strong team scores well and records the scorer version', () => {
  const r = score(evidenceFixture());
  assert.ok(r.earned >= 70, `expected a high score, got ${r.earned}/${r.available}`);
  assert.equal(r.scorerVersion, SCORER_VERSION);
});

test('every deduction carries a reason and a citation', () => {
  const weak = evidenceFixture();
  weak.repoEvidence.tests = { testFileCount: 0, run: { ran: false, reason: 'no test command detected' } };
  weak.repoEvidence.reproducibility.lockfilePresent = false;
  const r = score(weak);
  assert.ok(r.lostPoints.length > 0);
  for (const loss of r.lostPoints) {
    assert.ok(loss.reason, `deduction without a reason: ${loss.criterion}`);
    assert.ok(loss.evidence, `deduction without evidence: ${loss.criterion}`);
    assert.ok(loss.lost > 0);
  }
});

test('transcript-only criteria drop out when there are no transcripts', () => {
  const ev = evidenceFixture({ noChatEvidence: true });
  const r = score(ev);
  const working = r.dimensions.find((d) => d.id === 'working-method');

  // The journal is the documented fallback, so planning stays assessable while the three
  // transcript-only criteria leave the denominator entirely.
  const byId = Object.fromEntries(working.criteria.map((c) => [c.id, c]));
  for (const id of ['iterative-direction', 'prompts-carry-context', 'course-correction']) {
    assert.equal(byId[id].status, 'not-harvested', `${id} should be unassessable`);
    assert.equal(byId[id].earned, 0);
  }
  assert.notEqual(byId['planned-before-building'].status, 'not-harvested');
  assert.equal(working.status, 'partial');
  assert.equal(working.available, 5);
  assert.ok(r.available < 100);
  assert.equal(r.complete, false);
  // Deliberately not asserting `provisional` here: it now means "a human owes an action",
  // which for this fixture is true because of the unscored demo — nothing to do with the
  // transcript-only criteria this test is about. `tests/judging.test.mjs` covers it.
});

test('with neither transcripts nor a journal, the whole dimension drops out', () => {
  const ev = evidenceFixture({ noChatEvidence: true });
  ev.journalEvidence = { source: { status: 'not-harvested' }, entryCount: 0, substantiveEntries: 0 };
  const working = score(ev).dimensions.find((d) => d.id === 'working-method');
  assert.equal(working.status, 'not-harvested');
  assert.equal(working.available, 0);
});

test('a criterion that throws costs points instead of shrinking the denominator', () => {
  // If an error removed its points from `available`, a crash would raise the team's
  // share-of-available ranking. It must behave like a failure we own.
  const ev = evidenceFixture();
  Object.defineProperty(ev.repoEvidence, 'reproducibility', {
    get() { throw new Error('boom'); },
  });
  const r = score(ev);
  const repro = r.dimensions.find((d) => d.id === 'reproducibility');
  assert.equal(repro.errors, 3);
  assert.equal(repro.available, 10, 'errored criteria must stay in the available total');
  assert.equal(repro.earned, 0);
  for (const c of repro.criteria) assert.equal(c.status, 'error');
});

test('the demo dimension stays unassessed until a coach scores it', () => {
  const r = score(evidenceFixture());
  const demo = r.dimensions.find((d) => d.id === 'it-actually-works');
  assert.equal(demo.status, 'not-harvested');
  assert.equal(demo.available, 0);
});

test('a coach scorecard supplies the demo score and badges', () => {
  const r = score(evidenceFixture(), {
    coachScorecard: { demo: { points: 8, note: 'one edge case crashes' }, badges: ['zero-secrets'] },
  });
  const demo = r.dimensions.find((d) => d.id === 'it-actually-works');
  assert.equal(demo.earned, 8);
  assert.equal(demo.available, 10);
  assert.deepEqual(r.badges, ['zero-secrets']);
});

test('a demo score outside 0..10 is clamped', () => {
  const high = score(evidenceFixture(), { coachScorecard: { demo: { points: 99 } } });
  assert.equal(high.dimensions.find((d) => d.id === 'it-actually-works').earned, 10);
  const low = score(evidenceFixture(), { coachScorecard: { demo: { points: -5 } } });
  assert.equal(low.dimensions.find((d) => d.id === 'it-actually-works').earned, 0);
});

test('a manual adjustment applies only with a written reason', () => {
  const withReason = score(evidenceFixture(), {
    coachScorecard: { adjustment: { points: -3, reason: 'committed a vendored tree' } },
  });
  assert.equal(withReason.adjustment.applied, true);
  assert.equal(withReason.total, withReason.earned - 3);

  const without = score(evidenceFixture(), { coachScorecard: { adjustment: { points: 20 } } });
  assert.equal(without.adjustment.applied, false);
  assert.ok(without.adjustment.rejected);
  assert.equal(without.total, without.earned);
});

test('skipping the test run is not scored as having no tests', () => {
  // --no-run-tests is the operator's choice. Treating it as "no test command" would
  // deduct 8 points for how the scorer was invoked, not for anything the team did.
  const ev = evidenceFixture();
  ev.repoEvidence.tests.run = { ran: false, reason: 'skipped by flag' };
  const r = score(ev);
  const dim = r.dimensions.find((d) => d.id === 'verification-loop');
  const green = dim.criteria.find((c) => c.id === 'suite-runs-green');
  assert.equal(green.status, 'not-harvested');
  assert.equal(dim.available, 17, 'the 8 unrunnable points leave the denominator');
});

test('genuinely having no tests at all still fails', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.tests = { testFileCount: 0, run: { ran: false, reason: 'no test command detected' } };
  ev.chat.totals.testRuns = { total: 0, pass: 0, fail: 0, unknown: 0 };
  const green = score(ev).dimensions.find((d) => d.id === 'verification-loop')
    .criteria.find((c) => c.id === 'suite-runs-green');
  assert.equal(green.status, 'fail');
  assert.equal(green.earned, 0);
});

test('the scorer failing to find the command is not the team failing to have tests', () => {
  // A real repo was credited 6/6 for running its tests throughout the build and told two
  // rows later that "an agent that cannot run your tests cannot check its own work" — the
  // scorer simply could not parse `test-lambdas:` out of the Makefile. Contradicting
  // another criterion on the same page is a bug, not a score.
  const ev = evidenceFixture();
  ev.repoEvidence.tests = { testFileCount: 84, run: { ran: false, reason: 'no test command detected' } };
  ev.chat.totals.testRuns = { total: 12, pass: 10, fail: 2, unknown: 0 };
  const dim = score(ev).dimensions.find((d) => d.id === 'verification-loop');
  const green = dim.criteria.find((c) => c.id === 'suite-runs-green');
  assert.equal(green.status, 'not-harvested');
  assert.equal(dim.available, 17, 'the 8 unscorable points left the denominator');
  assert.match(green.lostBecause, /transcripts show tests running 12 time/);
});

test('test files with no transcript evidence are still not scored as a red suite', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.tests = { testFileCount: 40, run: { ran: false, reason: 'no test command detected' } };
  ev.chat.totals.testRuns = { total: 0, pass: 0, fail: 0, unknown: 0 };
  const green = score(ev).dimensions.find((d) => d.id === 'verification-loop')
    .criteria.find((c) => c.id === 'suite-runs-green');
  assert.equal(green.status, 'not-harvested');
  assert.match(green.lostBecause, /40 test file\(s\) are here/);
});

test('a suite that could not start is unassessable, not red', () => {
  // Detecting more commands means occasionally picking one this machine cannot run.
  // Scoring that as "red at hand-in" would be the same false negative in a new costume.
  const ev = evidenceFixture();
  ev.repoEvidence.tests.run = {
    ran: true, command: 'npm test', exitCode: 1, durationMs: 400,
    couldNotStart: true, couldNotStartWhy: 'a dependency is not installed',
  };
  const green = score(ev).dimensions.find((d) => d.id === 'verification-loop')
    .criteria.find((c) => c.id === 'suite-runs-green');
  assert.equal(green.status, 'not-harvested');
  assert.equal(green.earned, 0);
  assert.match(green.lostBecause, /dependency is not installed/);
});

test('a suite that ran and failed is still scored as red', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.tests.run = {
    ran: true, command: 'npm test', exitCode: 1, durationMs: 4000, couldNotStart: false,
  };
  const green = score(ev).dimensions.find((d) => d.id === 'verification-loop')
    .criteria.find((c) => c.id === 'suite-runs-green');
  assert.equal(green.status, 'partial');
  assert.equal(green.earned, 3);
});

test('a truncated file scan cannot award full secrets marks', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.source = { status: 'harvested', truncated: true };
  const r = score(ev);
  const safety = r.dimensions.find((d) => d.id === 'safety-and-boundaries');
  const secrets = safety.criteria.find((c) => c.id === 'no-secrets');
  assert.equal(secrets.status, 'not-harvested');
  assert.equal(safety.available, 5, 'the unscannable 5 points must leave the denominator');
});

test('committed secrets fail outright and name the location', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.safety.secretFindings = {
    kept: [{ file: 'src/config.js', line: 12, rule: 'openai-key' }], offered: 1, truncated: false,
  };
  const r = score(ev);
  const secrets = r.dimensions.find((d) => d.id === 'safety-and-boundaries')
    .criteria.find((c) => c.id === 'no-secrets');
  assert.equal(secrets.earned, 0);
  assert.match(secrets.evidence, /src\/config\.js:12/);
  assert.match(secrets.lostBecause, /git history/);
});

test('a harness committed after the code loses the timing criterion', () => {
  const ev = evidenceFixture();
  ev.gitEvidence.harnessTiming = [{
    path: 'AGENTS.md', firstAddedAt: '2026-08-21T18:00:00.000Z',
    commitsAfterItAppeared: 0, precededMedianCommit: false,
  }];
  const r = score(ev);
  const timing = r.dimensions.find((d) => d.id === 'context-and-harness')
    .criteria.find((c) => c.id === 'harness-preceded-code');
  assert.equal(timing.earned, 0);
  assert.match(timing.lostBecause, /after essentially all of the code/);
});

test('an unmodified template scores near nothing for substance', () => {
  const ev = evidenceFixture();
  ev.repoEvidence.harnessFiles = [{
    path: 'AGENTS.md', present: true, lines: 104, unfilledPlaceholders: 9, templateSimilarity: 0.95,
  }];
  const r = score(ev);
  const substance = r.dimensions.find((d) => d.id === 'context-and-harness')
    .criteria.find((c) => c.id === 'harness-is-substantive');
  assert.equal(substance.earned, 0);
});
