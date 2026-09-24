/**
 * The pushed-repository flow: a participant runs one downloaded file, commits what it
 * writes, and a facilitator scores the cloned repositories.
 *
 * Driven through real child processes with a temporary HOME, because what matters here is
 * what a participant's machine and a facilitator's machine actually do — including which
 * chat history each one must *not* read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, OUTPUT } from '../.github/scripts/build-collector.mjs';
import { excerpt } from '../lib/harvest/shared.mjs';
import { redactSecrets } from '../lib/harvest/redact.mjs';
import { mergeEvidence, chooseRepoMember } from '../lib/harvest/merge.mjs';
import { repoMatcher } from '../lib/harvest/history.mjs';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = OUTPUT;
const SOURCE = join(KIT_ROOT, 'bin', 'collect-history.mjs');
const LEADERBOARD = join(KIT_ROOT, 'bin', 'leaderboard.mjs');

/** A key-shaped string assembled at runtime, so this file never contains one literally. */
const FAKE_KEY = 'sk-' + 'A1b2C3d4E5f6G7h8I9j0K1l2';

function scratch() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'hk-col-')));
}

function gitRepo(dir, files = {}) {
  mkdirSync(dir, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.name', 'Ana Test');
  git('config', 'user.email', 'ana@example.com');
  for (const [rel, content] of Object.entries({ 'README.md': '# app\n', ...files })) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content, 'utf8');
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir;
}

/** A fake home holding one Claude Code session whose working directory is `cwd`. */
function homeWithSession(home, cwd, prompts, sessionId = 'sess-1') {
  const dir = join(home, '.claude', 'projects', 'p-' + sessionId);
  mkdirSync(dir, { recursive: true });
  const lines = prompts.map((text, i) => JSON.stringify({
    type: 'user', sessionId, timestamp: new Date(Date.UTC(2026, 8, 24, 9, i)).toISOString(),
    cwd, gitBranch: 'main', message: { role: 'user', content: [{ type: 'text', text }] },
  }));
  writeFileSync(join(dir, sessionId + '.jsonl'), lines.join('\n') + '\n', 'utf8');
  return home;
}

/**
 * Run a script as if on a machine whose home directory is `home`. Every variable an
 * adapter reads a home from is redirected, so nothing from the real machine leaks in.
 */
function run(script, args, { cwd, home }) {
  const inherited = { ...process.env };
  delete inherited.CODEX_HOME;
  delete inherited.CLAUDE_CONFIG_DIR;
  return execFileSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...inherited,
      HOME: home, USERPROFILE: home,
      APPDATA: join(home, 'AppData'), XDG_CONFIG_HOME: join(home, '.config'),
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
}

function historyFiles(repo) {
  const dir = join(repo, '.vibecheck');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('history-')) : [];
}

// --- the bundle ---------------------------------------------------------------------

test('the committed single-file collector is built from the current sources', () => {
  assert.equal(readFileSync(BUNDLE, 'utf8'), build(),
    'dist/collect-history.mjs is stale — run npm run build:collector');
});

test('the bundle imports nothing but node built-ins', () => {
  const imports = [...readFileSync(BUNDLE, 'utf8').matchAll(/^import .* from '([^']+)';$/gm)]
    .map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const spec of imports) assert.match(spec, /^node:/, spec + ' would need installing');
});

// --- what a participant's run writes -------------------------------------------------

test('the downloaded file writes one history file per person, with sessions for this repo only', () => {
  const root = scratch();
  try {
    const repo = gitRepo(join(root, 'app'));
    const other = gitRepo(join(root, 'other-project'));
    const home = join(root, 'home');
    homeWithSession(home, repo, ['plan the booking flow first', 'now add the tests'], 'mine');
    homeWithSession(home, other, ['unrelated work'], 'elsewhere');

    const out = run(BUNDLE, [], { cwd: repo, home });
    assert.match(out, /1 session\(s\), 2 prompt\(s\)/);
    assert.deepEqual(historyFiles(repo), ['history-ana-test.json'], 'named after git user.name');

    const history = JSON.parse(readFileSync(join(repo, '.vibecheck', 'history-ana-test.json'), 'utf8'));
    assert.equal(history.kind, 'history');
    assert.equal(history.chat.claudeCode.length, 1, 'the other project’s session must not count');
    assert.equal(history.chat.claudeCode[0].userPrompts, 2);
    assert.equal(history.repo.path, undefined, 'no local path belongs in a committed file');
    assert.ok(!JSON.stringify(history).includes(root), 'no path from this machine is written');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the bundle and the source write the same history', () => {
  const root = scratch();
  try {
    const repo = gitRepo(join(root, 'app'));
    const home = homeWithSession(join(root, 'home'), repo, ['write a failing test', 'no, that is wrong, revert it']);
    const read = () => {
      const h = JSON.parse(readFileSync(join(repo, '.vibecheck', 'history-ana-test.json'), 'utf8'));
      delete h.harvestedAt;
      return h;
    };
    run(BUNDLE, [], { cwd: repo, home });
    const fromBundle = read();
    run(SOURCE, [], { cwd: repo, home });
    assert.deepEqual(fromBundle, read());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('run from a subfolder, it still writes at the repository root', () => {
  const root = scratch();
  try {
    const repo = gitRepo(join(root, 'app'), { 'src/main.js': '1\n' });
    const home = homeWithSession(join(root, 'home'), repo, ['hello']);
    run(BUNDLE, [], { cwd: join(repo, 'src'), home });
    assert.deepEqual(historyFiles(repo), ['history-ana-test.json']);
    assert.ok(!existsSync(join(repo, 'src', '.vibecheck')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a session recorded through a symlinked path is still found', () => {
  const root = scratch();
  try {
    const repo = gitRepo(join(root, 'app'));
    const link = join(root, 'linked-app');
    symlinkSync(repo, link, 'dir');
    const home = homeWithSession(join(root, 'home'), link, ['worked via the symlink']);
    const out = run(BUNDLE, [], { cwd: repo, home });
    assert.match(out, /1 session\(s\), 1 prompt\(s\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the repo matcher does not widen to siblings or parents', () => {
  const root = scratch();
  try {
    const repo = join(root, 'app');
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(root, 'app-two'));
    const inRepo = repoMatcher(repo);
    assert.equal(inRepo(repo), true);
    assert.equal(inRepo(join(repo, 'src')), true);
    assert.equal(inRepo(join(root, 'app-two')), false, 'a shared prefix is not the same repo');
    assert.equal(inRepo(root), false, 'the parent is not the repo');
    assert.equal(inRepo(''), false);
    assert.equal(inRepo(undefined), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('nothing found still writes a file, and says why', () => {
  const root = scratch();
  try {
    const repo = gitRepo(join(root, 'app'));
    const out = run(BUNDLE, [], { cwd: repo, home: join(root, 'empty-home') });
    assert.match(out, /Nothing was found for this folder/);
    assert.deepEqual(historyFiles(repo), ['history-ana-test.json']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- redaction: the history file is committed, so a pasted key must not be ------------

test('a key pasted into a prompt is redacted before it is written', () => {
  const root = scratch();
  try {
    const repo = gitRepo(join(root, 'app'));
    const home = homeWithSession(join(root, 'home'), repo, ['why does ' + FAKE_KEY + ' give me a 401?']);
    run(BUNDLE, [], { cwd: repo, home });
    const text = readFileSync(join(repo, '.vibecheck', 'history-ana-test.json'), 'utf8');
    assert.ok(!text.includes(FAKE_KEY), 'the key reached the committed file');
    assert.match(text, /\[redacted: openai-key\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('excerpts redact before truncating, so half a key cannot survive the cut', () => {
  const text = 'x'.repeat(270) + ' ' + FAKE_KEY;
  assert.ok(!excerpt(text).includes('sk-A1b2'), 'a truncated key prefix slipped through');
});

test('redaction leaves ordinary prose alone', () => {
  const prose = 'add a password field and a token refresh; ask-me-later is fine';
  assert.equal(redactSecrets(prose), prose);
  assert.equal(excerpt(prose), prose);
});

// --- merging the repository with its members' history files --------------------------

const repoRead = (commits) => ({
  schemaVersion: 3, harvestedAt: '2026-09-25T14:00:00Z', repo: { path: '/clones/team', name: 'team' },
  team: { name: 'team', slug: 'team', member: null },
  sources: { repo: { status: 'harvested' }, git: { status: 'harvested' },
    claudeCode: { status: 'not-harvested', reason: 'not read on this machine' } },
  repoEvidence: { marker: 'from-clone' }, gitEvidence: { commitCount: commits },
  chat: { claudeCode: [] },
});
const historyOf = (member, sessions) => ({
  schemaVersion: 3, kind: 'history', harvestedAt: '2026-09-25T13:00:00Z', member,
  repo: { name: 'app' }, sources: { claudeCode: { status: 'harvested' } },
  chat: { claudeCode: sessions },
});
const session = (id, prompts) => ({ sessionId: id, userPrompts: prompts, toolCallTotal: 1 });

test('the repository read supplies repo state and is not counted as a member', () => {
  const { evidence } = mergeEvidence([
    { label: 'repository', evidence: repoRead(1), repoOnly: true },
    { label: 'ana', evidence: historyOf('ana', [session('a', 3)]) },
    { label: 'marko', evidence: historyOf('marko', [session('m', 4)]) },
  ]);
  assert.equal(evidence.repoEvidence.marker, 'from-clone');
  assert.equal(evidence.merged.memberCount, 2);
  assert.equal(evidence.scale.memberHarvests, 2);
  assert.equal(evidence.chat.totals.userPrompts, 7);
  assert.equal(evidence.sources.claudeCode.status, 'harvested');
  assert.equal(evidence.team.name, 'team');
});

test('the repository read wins even with fewer commits than a stale member bundle', () => {
  const stale = { ...repoRead(50), repoEvidence: { marker: 'old-bundle' } };
  const chosen = chooseRepoMember([
    { label: 'old', evidence: stale },
    { label: 'repository', evidence: repoRead(1), repoOnly: true },
  ]);
  assert.equal(chosen.label, 'repository');
});

test('a clone folder named differently from the members’ is not a warning', () => {
  const { warnings } = mergeEvidence([
    { label: 'repository', evidence: repoRead(1), repoOnly: true },
    { label: 'ana', evidence: historyOf('ana', [session('a', 1)]) },
  ]);
  assert.deepEqual(warnings, []);
});

// --- the facilitator's one command -----------------------------------------------------

test('leaderboard --repos scores each clone from its committed history files, never from this machine', () => {
  const root = scratch();
  try {
    const repos = join(root, 'repos');
    const teamA = gitRepo(join(repos, 'team-a'));
    const teamB = gitRepo(join(repos, 'team-b'));

    // Team A: a member ran the collector on their machine and committed the result.
    const anaHome = homeWithSession(join(root, 'ana-home'), teamA, ['plan it', 'build step one', 'test it']);
    run(BUNDLE, [], { cwd: teamA, home: anaHome });
    execFileSync('git', ['add', '-A'], { cwd: teamA });
    execFileSync('git', ['commit', '-q', '-m', 'history'], { cwd: teamA });

    // The facilitator's own machine has a session recorded inside team B's clone. It is the
    // facilitator's, not the team's, and must not appear in team B's evidence.
    const facilitatorHome = homeWithSession(join(root, 'fac-home'), teamB, ['facilitator poking around']);
    writeFileSync(join(repos, 'team-a.scorecard.json'), JSON.stringify({
      team: 'team-a', demo: { points: 8, note: 'worked' },
    }), 'utf8');

    const outFile = join(root, 'ranked.json');
    const stdout = run(LEADERBOARD, ['--repos', repos, '--out', outFile], { cwd: root, home: facilitatorHome });
    const { teams } = JSON.parse(readFileSync(outFile, 'utf8'));
    const byName = Object.fromEntries(teams.map((t) => [t.team, t]));

    assert.deepEqual(Object.keys(byName).sort(), ['team-a', 'team-b'], 'folder name is the team name');
    const demo = (t) => t.score.dimensions.find((d) => d.id === 'it-actually-works')
      .criteria.find((c) => c.id === 'demo');
    assert.equal(demo(byName['team-a']).earned, 8, 'the scorecard beside the clones is applied');

    const working = (t) => t.score.dimensions.find((d) => d.id === 'working-method');
    assert.notEqual(working(byName['team-a']).status, 'not-harvested', 'team A’s history was read');
    assert.equal(working(byName['team-b']).status, 'not-harvested',
      'the facilitator’s own session leaked into team B');
    assert.match(stdout, /No history file committed for 1 team\(s\): team-b/);
    assert.ok(!existsSync(join(repos, 'judging', 'judging.json')), 'judging/ is not a team');
    assert.ok(existsSync(join(repos, 'judging', 'team-a.json')));

    // Running it again must not pick up its own judging/ output as a team.
    run(LEADERBOARD, ['--repos', repos, '--out', outFile], { cwd: root, home: facilitatorHome });
    assert.equal(JSON.parse(readFileSync(outFile, 'utf8')).teams.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
