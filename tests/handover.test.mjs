/**
 * The hand-in path: one command per person, one file, grouped into teams by name.
 *
 * This is the part of the kit that a hundred people touch under time pressure on a day
 * nobody can repeat. Every assertion here is about it failing *loudly* rather than
 * plausibly — a team scored on one member's laptop, or a judging file that still carries
 * everybody's names, both look completely normal in the output.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug } from '../lib/harvest/index.mjs';
import { mergeEvidence } from '../lib/harvest/merge.mjs';
import { judgingBundle } from '../lib/score/judging-bundle.mjs';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- team names into one key --------------------------------------------------------

test('team names that a human would call the same land in the same group', () => {
  // Five people typing a team name into five terminals will not agree on spacing or case,
  // and a leaderboard that ranks "Team Blue" and "team  blue" separately is worse than
  // useless — it splits one team's evidence in half without saying so.
  const same = ['Team Blue', 'team blue', 'TEAM  BLUE', ' Team-Blue ', 'Team_Blue'];
  const keys = new Set(same.map(slug));
  assert.equal(keys.size, 1, [...keys].join(' / '));
  assert.equal(slug('Team Blue'), 'team-blue');
});

test('names that are genuinely different stay different', () => {
  assert.notEqual(slug('Team Blue'), slug('Team Blue 2'));
  assert.notEqual(slug('Alpha'), slug('Beta'));
});

test('a name made only of punctuation does not collapse to nothing silently', () => {
  // It becomes an empty slug, which the leaderboard turns into 'unnamed' rather than
  // grouping every such team together under ''.
  assert.equal(slug('***'), '');
});

// --- the judging bundle -----------------------------------------------------------------

/** Evidence with something identifying in every field the trim is supposed to drop. */
function evidenceWithIdentity() {
  return {
    schemaVersion: 3,
    team: { name: 'Team Blue', slug: 'team-blue', member: 'Ana Petrovic' },
    repo: { path: '/home/ana.petrovic/booking-app', name: 'booking-app' },
    merged: {
      memberCount: 2,
      members: [{ label: 'Ana Petrovic', repoPath: '/home/ana.petrovic/booking-app' }],
    },
    repoEvidence: {
      harnessFiles: [
        { path: 'AGENTS.md', present: true, lines: 90, unfilledPlaceholders: 0, templateSimilarity: 0.1, contentExcerpt: 'Real rules here.' },
        { path: 'GEMINI.md', present: false },
      ],
      contextDocs: [{ path: 'docs/project-context.md', present: true, lines: 40, contentExcerpt: 'A booking is one working day.' }],
      tests: { run: { tail: 'FAIL src/booking.test.ts — expected 3 got 4 at /home/ana.petrovic/...' } },
      safety: { secretFindings: { kept: [{ file: 'src/db.ts', line: 12 }], offered: 1 } },
    },
    gitEvidence: {
      authors: { 'Ana Petrovic': 30, 'Marko Ilic': 12 },
      branch: 'feat/ana-booking-conflicts',
    },
    chat: {
      totals: { userPrompts: 120, sessionCount: 9 },
      claudeCode: [{ sessionId: 's1', branches: ['feat/ana-booking-conflicts'], toolCalls: { Bash: 4 }, excerpts: { prompts: { kept: [{ text: 'Add a conflict check.' }], offered: 9 } } }],
      copilot: [], codex: [],
      cursor: [{ sessionId: 's2', excerpts: { prompts: { kept: [{ text: 'Now the release job.' }], offered: 2 } } }],
    },
  };
}

test('the judging bundle keeps exactly what the judge reads', () => {
  const b = judgingBundle(evidenceWithIdentity());
  assert.equal(b.team, 'Team Blue');
  assert.equal(b.repoName, 'booking-app');
  assert.deepEqual(b.scale, { prompts: 120, sessions: 9, members: 2 });
  assert.deepEqual(b.harnessFiles.map((f) => f.path), ['AGENTS.md'], 'absent files are dropped');
  assert.equal(b.harnessFiles[0].contentExcerpt, 'Real rules here.');
  assert.equal(b.contextDocs[0].contentExcerpt, 'A booking is one working day.');
  assert.deepEqual(b.promptExcerpts.claudeCode, ['Add a conflict check.']);
  assert.deepEqual(b.promptExcerpts.cursor, ['Now the release job.']);
  assert.ok(!('copilot' in b.promptExcerpts), 'a tool with no excerpts is omitted entirely');
});

test('the judging bundle carries nothing that identifies a person or a machine', () => {
  // The whole reason this file exists. Asserted against the serialised bundle so a field
  // added later cannot smuggle any of it back in unnoticed.
  const text = JSON.stringify(judgingBundle(evidenceWithIdentity()));
  for (const forbidden of [
    'Ana Petrovic',          // committer and member names
    'Marko Ilic',
    '/home/ana.petrovic',    // repository path on somebody's laptop
    'feat/ana-booking',      // branch names
    'expected 3 got 4',      // test output
    'src/db.ts',             // credential locations
    'Bash',                  // the tools their agent called
  ]) {
    assert.ok(!text.includes(forbidden), 'judging bundle must not contain ' + forbidden);
  }
});

test('the judging bundle survives evidence with nothing in it', () => {
  const b = judgingBundle({});
  assert.equal(b.team, null);
  assert.deepEqual(b.harnessFiles, []);
  assert.deepEqual(b.promptExcerpts, {});
  assert.deepEqual(b.scale, { prompts: 0, sessions: 0, members: 1 });
});

test('a merged team bundle keeps the team name and drops the individual member', () => {
  const member = (name, id) => ({
    label: name,
    evidence: {
      schemaVersion: 3,
      team: { name: 'Team Blue', slug: 'team-blue', member: name },
      repo: { path: '/home/' + name + '/app', name: 'app' },
      sources: {}, noChatEvidence: false,
      repoEvidence: { tests: {} }, gitEvidence: { commitCount: 3 }, journalEvidence: {},
      chat: {
        totals: { userPrompts: 10 },
        claudeCode: [{ sessionId: id, userPrompts: 10, promptLength: { count: 10, totalChars: 1000 }, corrections: 1, toolCallTotal: 2, commands: {}, testRuns: [], excerpts: { prompts: { kept: [], offered: 0 } } }],
        copilot: [], codex: [], cursor: [],
      },
    },
  });
  const { evidence } = mergeEvidence([member('ana', 'a'), member('marko', 'b')]);
  assert.equal(evidence.team.name, 'Team Blue');
  assert.equal(evidence.team.member, null, 'a merged bundle belongs to the whole team');
  assert.equal(evidence.chat.totals.userPrompts, 20);
});

// --- end to end through the two commands -------------------------------------------------

/** Run a kit command and return its stdout, failing the test on a non-zero exit. */
function run(args, cwd = KIT_ROOT) {
  return execFileSync(process.execPath, args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

/** One handed-in file, as `vibecheck --team` writes it. */
function handIn(dir, team, member, { prompts = 10, sessionId = member } = {}) {
  const evidence = {
    schemaVersion: 3, harvestedAt: '2026-09-03T13:00:00.000Z',
    team: { name: team, slug: slug(team), member },
    repo: { path: '/home/' + member + '/app', name: 'app' },
    sources: { repo: { status: 'harvested' }, git: { status: 'harvested' } },
    noChatEvidence: false,
    repoEvidence: {
      source: { status: 'harvested' }, harnessFiles: [], instructionFiles: [], contextDocs: [],
      commands: {}, tests: { testFileCount: 4, sourceFileCount: 20, run: { ran: false, reason: 'skipped by flag' } },
      safety: { secretFindings: { offered: 0 }, gitignorePresent: true, gitignoreCoversEnv: true },
      reproducibility: { readmePresent: true, readmeBytes: 900, lockfilePresent: true },
    },
    gitEvidence: { source: { status: 'harvested' }, commitCount: 20, authors: { [member]: 20 }, trackedEnvFiles: [], harnessTiming: [] },
    journalEvidence: {},
    chat: {
      totals: { userPrompts: prompts },
      claudeCode: [{
        sessionId, startedAt: '2026-09-03T09:00:00.000Z', endedAt: '2026-09-03T17:00:00.000Z',
        userPrompts: prompts, promptLength: { count: prompts, totalChars: prompts * 200 },
        corrections: 2, toolCallTotal: 20, commands: { test: 2, buildOrLint: 0, destructive: 0, other: 5 },
        testRuns: [{ outcome: 'fail' }, { outcome: 'pass' }], planningSignals: 1,
        excerpts: { prompts: { kept: [{ text: 'Add the conflict check.' }], offered: 3 }, corrections: { kept: [], offered: 0 } },
      }],
      copilot: [], codex: [], cursor: [],
    },
  };
  writeFileSync(join(dir, slug(team) + '--' + slug(member) + '.json'),
    JSON.stringify(evidence, null, 2), 'utf8');
}

test('a flat folder of handed-in files ranks teams, merging each team’s members', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-collected-'));
  try {
    handIn(dir, 'Team Blue', 'ana', { prompts: 20 });
    handIn(dir, 'team blue', 'marko', { prompts: 30 });   // spelled differently on purpose
    handIn(dir, 'Team Red', 'jelena', { prompts: 15 });
    const out = run([join(KIT_ROOT, 'bin', 'leaderboard.mjs'), '--dir', dir]);

    assert.match(out, /2 team\(s\)/, 'three files, two teams');
    assert.match(out, /Team Blue/);
    assert.match(out, /Team Red/);
    // Blue is two people merged; Red is one.
    assert.match(out, /Team Blue\s+\d+\s+\d+\s+2/);
    assert.match(out, /Team Red\s+\d+\s+\d+\s+1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a team that handed in only one laptop is named, not left to be noticed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-collected-'));
  try {
    handIn(dir, 'Team Blue', 'ana');
    handIn(dir, 'Team Blue', 'marko');
    handIn(dir, 'Team Red', 'jelena');
    const out = run([join(KIT_ROOT, 'bin', 'leaderboard.mjs'), '--dir', dir]);
    assert.match(out, /Only one person’s evidence for 1 team\(s\): Team Red/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a facilitator’s scorecard is picked up by filename from the same flat folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-collected-'));
  try {
    handIn(dir, 'Team Blue', 'ana');
    writeFileSync(join(dir, 'team-blue.scorecard.json'), JSON.stringify({
      team: 'Team Blue', demo: { points: 10, note: 'ran' },
      acceptance: [{ id: 'book', met: true }], privacy: { met: true },
    }), 'utf8');
    const out = run([join(KIT_ROOT, 'bin', 'leaderboard.mjs'), '--dir', dir]);
    // 15 of 15 for It Actually Works means both the demo score and the checklist landed.
    assert.match(out, /15\/15/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('running the leaderboard writes one trimmed judging file per team', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-collected-'));
  try {
    handIn(dir, 'Team Blue', 'ana');
    handIn(dir, 'Team Red', 'jelena');
    run([join(KIT_ROOT, 'bin', 'leaderboard.mjs'), '--dir', dir]);
    const written = readdirSync(join(dir, 'judging')).sort();
    assert.deepEqual(written, ['team-blue.json', 'team-red.json']);
    const bundle = JSON.parse(readFileSync(join(dir, 'judging', 'team-blue.json'), 'utf8'));
    assert.equal(bundle.team, 'Team Blue');
    assert.deepEqual(bundle.promptExcerpts.claudeCode, ['Add the conflict check.']);
    assert.ok(!JSON.stringify(bundle).includes('/home/ana'), 'no repository paths');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--no-judging-files leaves the folder alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-collected-'));
  try {
    handIn(dir, 'Team Blue', 'ana');
    run([join(KIT_ROOT, 'bin', 'leaderboard.mjs'), '--dir', dir, '--no-judging-files']);
    assert.ok(!readdirSync(dir).includes('judging'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a stray file in the folder is reported, not silently ignored', () => {
  // A mistyped scorecard filename is the realistic case: it would otherwise be read as
  // nothing at all, and the team would be ranked without their demo score.
  const dir = mkdtempSync(join(tmpdir(), 'hk-collected-'));
  try {
    handIn(dir, 'Team Blue', 'ana');
    writeFileSync(join(dir, 'team-blue-scorecard.json'), JSON.stringify({ demo: { points: 9 } }), 'utf8');
    const out = run([join(KIT_ROOT, 'bin', 'leaderboard.mjs'), '--dir', dir]);
    assert.match(out, /Skipped/);
    assert.match(out, /not an evidence file/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a bundle directory still works alongside the flat layout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-collected-'));
  try {
    handIn(dir, 'Team Blue', 'ana');
    const bundle = join(dir, 'team-green');
    mkdirSync(bundle);
    const evidence = JSON.parse(readFileSync(join(dir, 'team-blue--ana.json'), 'utf8'));
    evidence.team = { name: 'Team Green', slug: 'team-green', member: 'petar' };
    writeFileSync(join(bundle, 'evidence.json'), JSON.stringify(evidence), 'utf8');
    const out = run([join(KIT_ROOT, 'bin', 'leaderboard.mjs'), '--dir', dir]);
    assert.match(out, /Team Green/);
    assert.match(out, /2 team\(s\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
