/**
 * Harvesting, aggregation and the privacy contract.
 *
 * The privacy assertions matter as much as the correctness ones: this tool reads a
 * developer's chat history, so "only bounded excerpts leave the machine" has to be a
 * tested property rather than an intention.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXCERPT_CHARS, distribution, excerpt, excerptCollector, makeIsInRepo,
} from '../lib/harvest/shared.mjs';
import { harvestRepo } from '../lib/harvest/repo.mjs';
import { harvestGit } from '../lib/harvest/git.mjs';
import { harvestJournal } from '../lib/harvest/journal.mjs';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function tempRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hk-hv-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}

// --- repo attribution ----------------------------------------------------------------

test('a session is attributed to the repo it ran in', () => {
  const inRepo = makeIsInRepo('/work/app');
  assert.equal(inRepo('/work/app'), true);
  assert.equal(inRepo('/work/app/src/features'), true, 'a subfolder belongs to the repo');
  assert.equal(inRepo('/work/app-two'), false, 'a shared name prefix is not the same repo');
  assert.equal(inRepo('/work'), false, 'the parent is not the repo');
  assert.equal(inRepo(''), false);
  assert.equal(inRepo(undefined), false);
});

// --- privacy -------------------------------------------------------------------------

test('excerpts are capped at the privacy ceiling', () => {
  const long = 'x'.repeat(5000);
  assert.equal(excerpt(long).length, EXCERPT_CHARS);
  assert.equal(excerpt('  spread   over\nlines  '), 'spread over lines');
  assert.equal(excerpt(undefined), '');
});

test('a caller cannot smuggle unbounded text past the cap via metadata', () => {
  const collector = excerptCollector(2);
  collector.offer('x'.repeat(400), { text: 'UNBOUNDED-' + 'y'.repeat(400), at: 'now' });
  const [first] = collector.result().kept;
  assert.ok(first.text.length <= EXCERPT_CHARS, 'metadata overwrote the bounded excerpt');
  assert.equal(first.at, 'now', 'other metadata is still kept');
});

test('a collector keeps its limit but counts everything offered', () => {
  const collector = excerptCollector(2);
  for (let i = 0; i < 7; i++) collector.offer('item ' + i);
  const r = collector.result();
  assert.equal(r.kept.length, 2);
  assert.equal(r.offered, 7);
  assert.equal(r.truncated, true);
});

// --- distribution --------------------------------------------------------------------

test('median and p90 are computed correctly', () => {
  assert.equal(distribution([1, 2, 3, 4]).median, 3, 'even counts average the two middles (2.5 -> 3)');
  assert.equal(distribution([1, 2, 3]).median, 2);
  const d = distribution([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(d.median, 6);
  assert.equal(d.p90, 9, 'p90 must not collapse onto max');
  assert.equal(d.max, 10);
  assert.equal(d.mean, 6);
  assert.equal(d.totalChars, 55);
});

test('an empty distribution is well formed', () => {
  assert.deepEqual(distribution([]), { count: 0, totalChars: 0 });
});

// --- repo harvest --------------------------------------------------------------------

test('reads harness files, commands and reproducibility signals', async () => {
  const dir = tempRepo({
    'AGENTS.md': '# AGENTS\n' + 'Real project rule.\n'.repeat(40),
    'README.md': 'x'.repeat(900),
    'package.json': JSON.stringify({ scripts: { setup: 'echo s', dev: 'echo d', test: 'echo "3 passed"' } }),
    'package-lock.json': '{}',
    'tests/a.test.js': 'ok',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.source.status, 'harvested');
    const agents = r.harnessFiles.find((f) => f.path === 'AGENTS.md');
    assert.equal(agents.present, true);
    assert.equal(agents.unfilledPlaceholders, 0);
    assert.equal(r.commands.test, 'npm test');
    assert.equal(r.commands.setup, 'npm run setup');
    assert.equal(r.tests.testFileCount, 1);
    assert.equal(r.reproducibility.lockfilePresent, true);
    assert.equal(r.tests.run.ran, false, '--no-run-tests must not execute anything');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- command discovery ----------------------------------------------------------------
//
// Every case below is drawn from one real repository that the old exact-key lookup
// reported as having no runnable command at all. That single miss zeroed three criteria
// worth 16 points and printed "an agent that cannot run your tests cannot check its own
// work" on a project with 84 test files and a Makefile full of targets.

test('a namespaced npm script counts as a test command', async () => {
  const dir = tempRepo({
    'package.json': JSON.stringify({ scripts: { 'test:unit': 'echo ok', 'test:unit:watch': 'echo ok' } }),
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.commands.test, 'npm run test:unit');
    assert.equal(r.commands.testSource, 'package.json');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a suffixed Makefile target counts as a test command', async () => {
  const dir = tempRepo({ Makefile: 'test-lambdas:\n\tpytest\n\nverify-be:\n\tpytest\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.commands.test, 'make test-lambdas');
    assert.equal(r.commands.testSource, 'Makefile');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a manifest one directory down is found and stays runnable from the root', async () => {
  const dir = tempRepo({
    'frontend/package.json': JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .' } }),
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.commands.test, 'npm --prefix frontend test');
    assert.equal(r.commands.lint, 'npm --prefix frontend run lint');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a pytest config below the root is found', async () => {
  const dir = tempRepo({ 'services/api/pyproject.toml': '[tool.pytest.ini_options]\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.commands.test, 'pytest services/api');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an e2e suite is found but never chosen to run', async () => {
  // It needs a dev server this scorer never started, so running it guarantees a red
  // result that says nothing about the team's code.
  const dir = tempRepo({
    'package.json': JSON.stringify({ scripts: { 'test:e2e': 'playwright test' } }),
    Makefile: 'test-unit:\n\tpytest\n',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.commands.test, 'make test-unit');
    assert.ok(r.commands.candidates.some((c) => c.name === 'test:e2e'),
      'the e2e suite should still be discovered, just not run');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a root entry point wins over a package inside a monorepo', async () => {
  const dir = tempRepo({
    Makefile: 'test-lambdas:\n\tpytest\n',
    'frontend/package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.commands.test, 'make test-lambdas');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a command name that could reach a shell is dropped, not quoted', async () => {
  // The chosen test command is executed via `spawn(..., { shell: true })`, and its name and
  // directory now come from repo content. A relaxation of the guard would otherwise pass
  // the suite silently, so this pins it: hostile names vanish, ordinary ones survive.
  const dir = tempRepo({
    Makefile: [
      'test-safe:', '\techo ok', '',
      'test-ok.2:', '\techo ok', '',
    ].join('\n'),
    'package.json': JSON.stringify({
      scripts: {
        'test; echo PWNED': 'x', 'test`id`': 'x', 'test$(id)': 'x', 'test|id': 'x',
        'test&&id': 'x', 'test>out': 'x', 'test id': 'x', '--test': 'x', '../test': 'x',
        'test:e2e': 'playwright test', 'test:unit': 'vitest',
      },
    }),
    'sub dir/package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    const names = r.commands.candidates.map((c) => c.name);
    for (const hostile of ['test; echo PWNED', 'test`id`', 'test$(id)', 'test|id',
      'test&&id', 'test>out', 'test id', '--test', '../test']) {
      assert.ok(!names.includes(hostile), 'a hostile name survived: ' + hostile);
    }
    for (const c of r.commands.candidates) {
      assert.doesNotMatch(c.command, /[;&|`$><\n\r]/, 'a shell metacharacter reached a command');
      assert.ok(!/\s(?:sub dir|\.\.)/.test(c.command), 'an unsafe directory reached a command');
    }
    assert.ok(names.includes('test-safe'), 'an ordinary target was dropped');
    assert.ok(names.includes('test:unit'), 'an ordinary namespaced script was dropped');
    assert.ok(names.includes('test-ok.2'), 'a dotted target was dropped');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a .PHONY line is not mistaken for a target', async () => {
  const dir = tempRepo({ Makefile: '.PHONY: test build\n\nbuild:\n\techo hi\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.commands.test, undefined);
    assert.equal(r.commands.build, 'make build');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a make variable assignment is not mistaken for a target', async () => {
  const dir = tempRepo({ Makefile: 'TEST_ARGS := -v\n\nbuild:\n\techo hi\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.commands.test, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- reproducibility signals ------------------------------------------------------------

test('a root docker-compose file counts as containerised', async () => {
  const dir = tempRepo({ 'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.reproducibility.containerised, true);
    assert.equal(r.reproducibility.containerFile, 'docker-compose.yml');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a repo with no container config is reported as such', async () => {
  const dir = tempRepo({ 'README.md': 'x' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.reproducibility.containerised, false);
    assert.equal(r.reproducibility.containerFile, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- .gitignore coverage ----------------------------------------------------------------

test('a root-anchored .env pattern counts as covering .env', async () => {
  // `/.env` is the more precise way to write it, and the old regex missed it.
  const dir = tempRepo({ '.gitignore': '.venv/\n/.env\n/.env.*\n/frontend/.env.*\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.safety.gitignoreCoversEnv, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('other .env spellings count too', async () => {
  for (const pattern of ['.env', '.env*', '**/.env', '*.env']) {
    const dir = tempRepo({ '.gitignore': pattern + '\n' });
    try {
      const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
      assert.equal(r.safety.gitignoreCoversEnv, true, 'missed: ' + pattern);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a .gitignore that does not mention .env is reported honestly', async () => {
  // `lambdas/.env` is anchored to that directory in git's own semantics, so it says
  // nothing about a `.env` at the root and must not be read as covering one.
  for (const pattern of ['node_modules/\n', '.env.example\n', '.venv/\n', '.env.local\n',
    'lambdas/.env\n', 'config/dev/.env\n', 'docs/*.env\n']) {
    const dir = tempRepo({ '.gitignore': pattern });
    try {
      const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
      assert.equal(r.safety.gitignoreCoversEnv, false, 'wrongly matched: ' + pattern);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

// --- secret tiering ----------------------------------------------------------------------

test('a localhost dev credential is reported but not counted as a leak', async () => {
  // Eight of these cost a real repo five points, with the advice "rotate anything real"
  // about a password that unlocks a container on the developer's own laptop.
  const dir = tempRepo({
    'scripts/run_job_local.py':
      'LOCAL_DB_URL = "postgresql+psycopg://mica:mica_password@localhost:5432/app"\n',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.safety.secretFindings.offered, 0, 'a localhost password was scored as a leak');
    assert.equal(r.safety.localCredentials.offered, 1, 'it should still be reported');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a real credential in a local-looking file is still a leak', async () => {
  // Path-based leniency applies only to shape-matched rules. An issuer-specific key is a
  // real key wherever it sits.
  const dir = tempRepo({ 'tests/fixtures_local.py': 'KEY = "AKIA' + 'ABCDEFGHIJKLMNOP' + '"\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.safety.secretFindings.offered, 1);
    assert.equal(r.safety.localCredentials.offered, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unrelated localhost mention cannot vouch for a production credential', async () => {
  // The localhost check is anchored to the text immediately after the match, because the
  // host a connection string points at starts exactly where the match ends. Testing the
  // whole line let a comment downgrade a real secret out of scoring.
  const dir = tempRepo({
    'src/config.py':
      'PROD = "postgres://admin:Pr0dS3cretPw@db.acme.io/x"  # local: postgres://d:dddd@localhost/x\n',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, testTimeoutMs: 30000 });
    assert.equal(r.safety.secretFindings.offered, 1, 'a production credential was downgraded');
    assert.equal(r.safety.localCredentials.offered, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a credential in a dev infrastructure file is still a leak', async () => {
  // A development *account* still has real credentials. `dev` is not a local-only marker.
  const dir = tempRepo({
    'infra/main-dev.tf': 'client_secret = "abcd1234efgh5678ijkl"\n',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, testTimeoutMs: 30000 });
    assert.equal(r.safety.secretFindings.offered, 1);
    assert.equal(r.safety.localCredentials.offered, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a credential in an untracked file is reported but never scored', async () => {
  // "No secrets in tracked files" is the criterion's own name, and the advice it gives is
  // "deleting it from the working tree does not remove it from git history" — both false
  // for a file the team deliberately gitignored. Those are also the files most likely to
  // hold a real credential, so a five-point deduction and a "rotate this" instruction over
  // one is the worst output this kit can produce.
  const dir = tempRepo({
    '.gitignore': 'local.settings.json\nsecrets/\n',
    'local.settings.json': '{"key":"AKIA' + 'ABCDEFGHIJKLMNOP' + '"}\n',
    'secrets/prod.py': 'KEY = "AKIA' + 'QRSTUVWXYZ123456' + '"\n',
    'src/app.py': 'x = 1\n',
  });
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.safety.secretFindings.offered, 0, 'an untracked file was scored as a leak');
    assert.equal(r.safety.untrackedCredentials.offered, 2, 'it should still be reported');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a credential in a tracked file is still a leak', async () => {
  const dir = tempRepo({ 'src/config.py': 'KEY = "AKIA' + 'ABCDEFGHIJKLMNOP' + '"\n' });
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.safety.secretFindings.offered, 1);
    assert.equal(r.safety.untrackedCredentials.offered, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a foreign git index cannot vouch that a secret is untracked', async () => {
  // `git ls-files` succeeding is not evidence that it answered about the repo we asked
  // about. Run inside a directory that merely sits within someone else's repository — a
  // facilitator keeping `bundles/` under version control, a git-managed home directory — it
  // exits 0 and prints nothing, and that empty answer read as "nothing is tracked". Every
  // committed credential was then reclassified as untracked, and a repo with a live AWS
  // key scored 5/5 on "No secrets in tracked files" and earned a Clean Hands badge.
  const outer = tempRepo({ 'outer.md': 'outer\n' });
  try {
    execFileSync('git', ['init', '-q'], { cwd: outer });
    execFileSync('git', ['add', '-A'], { cwd: outer });
    const inner = join(outer, 'teambundle');
    mkdirSync(join(inner, 'src'), { recursive: true });
    writeFileSync(join(inner, 'src', 'config.py'),
      'AWS_KEY = "AKIA' + 'ABCDEFGHIJKLMNOP' + '"\n', 'utf8');
    const r = await harvestRepo(inner, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.safety.trackedFileCount, null,
      'a foreign index was trusted as this repo’s own');
    assert.equal(r.safety.secretFindings.offered, 1, 'a real key was excused as untracked');
  } finally { rmSync(outer, { recursive: true, force: true }); }
});

test('a repo reached through a symlink is still recognised as itself', async () => {
  // `git rev-parse --show-toplevel` returns a canonicalised path, so comparing it to the
  // path we were handed as a *string* disabled tracked-file detection for any repo reached
  // through a symlink, a Windows junction, or a path differing only in case — and every
  // gitignored credential was then reported as committed. macOS `tmpdir()` sits under the
  // /var -> /private/var symlink, so this also broke the sibling tests off Linux, where CI
  // would never have seen it.
  const outer = tempRepo({ 'placeholder.md': 'x\n' });
  const real = join(outer, 'real');
  const link = join(outer, 'link');
  try {
    mkdirSync(join(real, 'secrets'), { recursive: true });
    writeFileSync(join(real, '.gitignore'), 'secrets/\n', 'utf8');
    writeFileSync(join(real, 'app.py'), 'x = 1\n', 'utf8');
    writeFileSync(join(real, 'secrets', 'prod.py'),
      'KEY = "AKIA' + 'ABCDEFGHIJKLMNOP' + '"\n', 'utf8');
    execFileSync('git', ['init', '-q'], { cwd: real });
    execFileSync('git', ['add', '-A'], { cwd: real });
    try {
      // 'junction' is the only symlink type Windows allows without elevation; POSIX
      // ignores the hint and makes an ordinary symlink.
      symlinkSync(real, link, 'junction');
    } catch {
      return; // no symlink privileges here — the direct-path tests still cover the rest
    }
    const r = await harvestRepo(link, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.notEqual(r.safety.trackedFileCount, null,
      'the repo was not recognised as itself through a symlink');
    assert.equal(r.safety.secretFindings.offered, 0,
      'a gitignored credential was reported as committed');
    assert.equal(r.safety.untrackedCredentials.offered, 1);
  } finally { rmSync(outer, { recursive: true, force: true }); }
});

test('without git, everything is scanned rather than reported clean', async () => {
  // Failing open is the safe direction here: telling a team "no secrets found" because we
  // could not read the index would be a false all-clear.
  const dir = tempRepo({ 'src/config.py': 'KEY = "AKIA' + 'ABCDEFGHIJKLMNOP' + '"\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.safety.trackedFileCount, null, 'a non-git repo should report null');
    assert.equal(r.safety.secretFindings.offered, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a secret printed by the test suite is redacted before it is stored', async () => {
  // evidence.json is loaded whole into a model's context by the judging skill, and a
  // failing integration test dumping its connection string is an ordinary thing to happen.
  const leak = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const dir = tempRepo({
    'package.json': JSON.stringify({
      scripts: { test: 'node -e "console.log(\'connecting with ' + leak + '\');process.exit(1)"' },
    }),
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, testTimeoutMs: 30000 });
    assert.ok(!JSON.stringify(r).includes(leak), 'the secret survived into the evidence');
    assert.match(r.tests.run.tail, /\[redacted: aws-access-key-id\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a credential against a real host is still a leak', async () => {
  const dir = tempRepo({
    'src/config.py': 'DB = "postgresql://admin:hunter2hunter2@prod-db.example.com:5432/app"\n',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.safety.secretFindings.offered, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a templated credential is not reported at all', async () => {
  // `${var.db_password}` in a Terraform output is the correct way to write this.
  const dir = tempRepo({
    'infra/outputs.tf':
      'value = "postgresql://${var.db_username}:${var.db_password}@${aws_db.this.address}:5432/app"\n',
    'docker-compose.yml': 'DATABASE_URL: postgresql://user:${DB_PASSWORD}@db:5432/app\n',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.safety.secretFindings.offered, 0);
    assert.equal(r.safety.localCredentials.offered, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('counts unfilled template placeholders', async () => {
  const dir = tempRepo({ 'AGENTS.md': 'Stack: {{LANGUAGES}}\n<!-- FILL: the rules -->\nRun {{TEST_COMMAND}}\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.harnessFiles.find((f) => f.path === 'AGENTS.md').unfilledPlaceholders, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports a committed secret by location without reproducing its value', async () => {
  const secret = 'sk-' + 'A1b2C3d4E5f6G7h8J9k0';
  const dir = tempRepo({ 'src/config.js': `const key = "${secret}";\n` });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    const findings = r.safety.secretFindings;
    assert.equal(findings.offered, 1);
    assert.equal(findings.kept[0].file.replace(/\\/g, '/'), 'src/config.js');
    assert.equal(findings.kept[0].line, 1);
    assert.ok(!JSON.stringify(r).includes(secret), 'the secret value leaked into the evidence');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runs a real suite and distinguishes green from red', async () => {
  const green = tempRepo({
    'package.json': JSON.stringify({ scripts: { test: 'node -e "console.log(\'3 passed\')"' } }),
  });
  const red = tempRepo({
    'package.json': JSON.stringify({ scripts: { test: 'node -e "console.log(\'2 failed\');process.exit(1)"' } }),
  });
  try {
    const g = await harvestRepo(green, { kitRoot: KIT_ROOT, testTimeoutMs: 30000 });
    assert.equal(g.tests.run.ran, true);
    assert.equal(g.tests.run.exitCode, 0);

    const r = await harvestRepo(red, { kitRoot: KIT_ROOT, testTimeoutMs: 30000 });
    assert.equal(r.tests.run.exitCode, 1);
    assert.match(r.tests.run.tail, /2 failed/);
  } finally {
    rmSync(green, { recursive: true, force: true });
    rmSync(red, { recursive: true, force: true });
  }
});

test('a suite that never started is marked as such, not as red', async () => {
  // Detecting more commands means occasionally picking one this machine cannot run.
  // A missing dependency and a genuinely failing test both exit non-zero, so the two are
  // told apart by what the run printed.
  const dir = tempRepo({
    'package.json': JSON.stringify({ scripts: { test: 'node -e "require(\'nope-not-here\')"' } }),
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, testTimeoutMs: 30000 });
    assert.equal(r.tests.run.ran, true);
    assert.notEqual(r.tests.run.exitCode, 0);
    assert.equal(r.tests.run.couldNotStart, true);
    assert.match(r.tests.run.couldNotStartWhy, /dependency is not installed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a suite that ran and genuinely failed is not excused', async () => {
  const dir = tempRepo({
    'package.json': JSON.stringify({ scripts: { test: 'node -e "console.log(\'2 failed\');process.exit(1)"' } }),
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, testTimeoutMs: 30000 });
    assert.equal(r.tests.run.couldNotStart, false);
    assert.equal(r.tests.run.couldNotStartWhy, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failing test that prints a startup-looking error is still red', async () => {
  // `Cannot find module`, `No such file or directory` and `ECONNREFUSED` are among the
  // most ordinary strings in a *failing test's* output. Matching them blindly reported a
  // suite with 412 passing tests as never having started — the same false negative the
  // classifier exists to prevent. A printed pass or fail count proves it ran.
  // One console.log per line, never an embedded \n: JSON.stringify writes the escape into
  // package.json, npm's parse turns it back into a real newline, and the script then dies
  // of a SyntaxError before printing anything. These four assertions passed anyway,
  // because npm echoes the script source and the echo happened to contain both the counts
  // and the trigger — which would have left the most load-bearing guard in this change
  // resting on a coincidence.
  const outputs = [
    ['412 passed, 3 failed', "E   FileNotFoundError: No such file or directory: 'x.csv'"],
    ['98 passed, 2 failed', 'Error: connect ECONNREFUSED 127.0.0.1:5432'],
    ['200 passed, 1 failed', "Cannot find module './fixtures/user.json'"],
    ['1 failed', "AssertionError: expected 'command not found' to equal 'ok'"],
  ];
  for (const lines of outputs) {
    const script = lines.map((l) => 'console.log(\'' + l.replace(/'/g, '') + '\')').join(';')
      + ';process.exit(1)';
    const dir = tempRepo({
      'package.json': JSON.stringify({ scripts: { test: 'node -e "' + script + '"' } }),
    });
    try {
      const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, testTimeoutMs: 30000 });
      assert.ok(!/SyntaxError/.test(r.tests.run.tail),
        'the payload did not execute, so this asserts nothing: ' + r.tests.run.tail);
      assert.ok(typeof r.tests.run.summary.passed === 'number'
        || typeof r.tests.run.summary.failed === 'number',
        'the counts that drive the gate were not parsed: ' + JSON.stringify(r.tests.run.summary));
      assert.equal(r.tests.run.couldNotStart, false,
        'wrongly excused: ' + lines.join(' | ') + ' -> ' + r.tests.run.couldNotStartWhy);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a run reports how many tests passed and failed, not just an exit code', async () => {
  const dir = tempRepo({
    'package.json': JSON.stringify({
      scripts: { test: 'node -e "console.log(\'2 failed, 516 passed, 34 skipped in 55s\');process.exit(1)"' },
    }),
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, testTimeoutMs: 30000 });
    assert.deepEqual(r.tests.run.summary, { passed: 516, failed: 2, skipped: 34 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unrecognised runner yields nulls rather than a wrong count', async () => {
  const dir = tempRepo({
    'package.json': JSON.stringify({ scripts: { test: 'node -e "console.log(\'all good\')"' } }),
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, testTimeoutMs: 30000 });
    assert.deepEqual(r.tests.run.summary, { passed: null, failed: null, skipped: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a hanging suite times out instead of blocking the run', async () => {
  const dir = tempRepo({
    'package.json': JSON.stringify({ scripts: { test: 'node -e "setInterval(()=>{},1000)"' } }),
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, testTimeoutMs: 3000 });
    assert.equal(r.tests.run.timedOut, true);
    assert.equal(r.tests.run.exitCode, null);
    assert.ok(r.tests.run.durationMs < 20000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- git harvest ---------------------------------------------------------------------

/**
 * `at` pins the commit date. Git timestamps have one-second resolution, so commits made
 * back-to-back in a test can share a second and make ordering assertions flaky.
 */
function git(dir, args, at) {
  execFileSync('git', args, {
    cwd: dir,
    stdio: 'ignore',
    env: at ? { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : process.env,
  });
}

test('distinguishes a repo with no commits from a missing repo', () => {
  const plain = tempRepo({ 'a.txt': 'x' });
  const empty = tempRepo({ 'a.txt': 'x' });
  try {
    assert.equal(harvestGit(plain).source.status, 'not-harvested');

    git(empty, ['init']);
    const r = harvestGit(empty);
    assert.equal(r.source.status, 'empty');
    assert.match(r.source.reason, /no commits yet/);
  } finally {
    rmSync(plain, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

test('reads commit conventions and harness timing', () => {
  const dir = tempRepo({ 'AGENTS.md': 'rules\n', 'a.txt': '1' });
  try {
    git(dir, ['init']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
    git(dir, ['add', 'AGENTS.md']);
    git(dir, ['commit', '-m', 'chore: add agent instructions'], '2026-08-21T09:00:00+00:00');
    const dates = ['2026-08-21T10:00:00+00:00', '2026-08-21T11:00:00+00:00', '2026-08-21T12:00:00+00:00'];
    dates.forEach((at, i) => {
      writeFileSync(join(dir, 'a.txt'), String(i), 'utf8');
      git(dir, ['add', 'a.txt']);
      git(dir, ['commit', '-m', 'feat: change ' + i], at);
    });
    const r = harvestGit(dir, { harnessPaths: ['AGENTS.md'] });
    assert.equal(r.source.status, 'harvested');
    assert.equal(r.commitCount, 4);
    assert.equal(r.conventionalCommits.count, 4);
    assert.equal(r.conventionalCommits.ratio, 1);
    assert.equal(r.harnessTiming[0].path, 'AGENTS.md');
    assert.equal(r.harnessTiming[0].commitsAfterItAppeared, 3,
      'the harness landed before the rest of the work');
    assert.equal(r.harnessTiming[0].precededMedianCommit, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- journal -------------------------------------------------------------------------

test('separates a substantive journal entry from a stub', () => {
  const dir = tempRepo({
    '.ai-journal/2026-08-21-1400-a.md': [
      '# Parser split', '## Goal', 'Extract the parser so it can be tested alone.',
      '## Approach', 'Chose the boundary myself, delegated the move.',
      '## What worked', 'Isolated tests caught two off-by-one errors.',
      '## What went wrong', 'The agent claimed green; two cases were skipped.',
      '## Verified', 'Ran pytest -q: 41 passed.', '## Next', 'Wire into ingest.',
    ].join('\n'),
    '.ai-journal/2026-08-21-1500-b.md': '# Stub\n## Goal\n## Next\n',
  });
  try {
    const r = harvestJournal(dir);
    assert.equal(r.source.status, 'harvested');
    assert.equal(r.entryCount, 2);
    assert.equal(r.substantiveEntries, 1, 'a headings-only stub must not count');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing journal is not-harvested rather than empty', () => {
  const dir = tempRepo({ 'a.txt': 'x' });
  try {
    assert.equal(harvestJournal(dir).source.status, 'not-harvested');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('secrets in a harness file are redacted from its content excerpt', async () => {
  // The excerpt is written to evidence.json and sent to a model by the judging skill.
  // Detecting a secret while republishing it verbatim would be worse than not scanning.
  const secret = 'sk-' + 'Live9SecretKeyABCDEFGH1234';
  const dir = tempRepo({
    'AGENTS.md': '# AGENTS.md\n\nUse the ledger service for writes.\n'
      + 'The staging password is ' + secret + '\n',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.safety.secretFindings.offered, 1, 'still detected');
    assert.ok(!JSON.stringify(r).includes(secret), 'the secret value leaked into the evidence');
    const excerpt = r.harnessFiles.find((f) => f.path === 'AGENTS.md').contentExcerpt;
    assert.match(excerpt, /\[redacted: openai-key\]/);
    assert.match(excerpt, /Use the ledger service for writes\./, 'real content must survive');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('harness excerpts are bounded per file and in total', async () => {
  const big = 'x'.repeat(9000);
  const dir = tempRepo({ 'AGENTS.md': big, 'CLAUDE.md': big, 'GEMINI.md': big });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    for (const f of r.harnessFiles.filter((x) => x.present)) {
      assert.ok(f.contentExcerpt.length <= 4100, f.path + ' exceeded the per-file cap');
      assert.match(f.contentExcerpt, /truncated/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- JVM and .NET projects ------------------------------------------------------------
//
// Every assertion here is a point a team was losing for their choice of stack rather than
// for anything they did: a Spring Boot repo reported no test command, no test files and no
// lockfile, which is three criteria and up to 19 points against a repo that pins its
// dependencies by construction.

test('a Maven project has its test and build commands found', async () => {
  const dir = tempRepo({ 'pom.xml': '<project><modelVersion>4.0.0</modelVersion></project>' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.commands.test, 'mvn -q test');
    assert.equal(r.commands.build, 'mvn -q package -DskipTests');
    assert.equal(r.commands.testSource, 'pom.xml');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a Gradle project prefers the wrapper over a system gradle', async () => {
  const dir = tempRepo({ 'build.gradle.kts': 'plugins { java }\n', 'gradlew': '#!/bin/sh\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.match(r.commands.test, /gradlew(?:\.bat)? test$/,
      'the wrapper pins the version the team actually built with');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a Gradle project with no wrapper falls back to a system gradle', async () => {
  const dir = tempRepo({ 'build.gradle': 'plugins { id "java" }\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.commands.test, 'gradle test');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a .NET solution has its test, build and restore commands found', async () => {
  const dir = tempRepo({
    'Booking.sln': 'Microsoft Visual Studio Solution File\n',
    'Booking/Booking.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.commands.test, 'dotnet test');
    assert.equal(r.commands.build, 'dotnet build');
    assert.equal(r.commands.setup, 'dotnet restore');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('JVM and .NET test classes are counted as tests', async () => {
  const dir = tempRepo({
    'pom.xml': '<project/>',
    'src/test/java/com/acme/BookingTest.java': 'class BookingTest {}',
    'Booking.Tests/BookingServiceTests.cs': 'public class BookingServiceTests {}',
    'src/main/java/com/acme/Booking.java': 'class Booking {}',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.tests.testFileCount, 2, 'both test classes count; the source class does not');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a project file inside a test directory is not counted as a test', async () => {
  // Booking.Tests/Booking.Tests.csproj matched the directory rule and reported a project
  // with one test class as having two.
  const dir = tempRepo({
    'Booking.Tests/Booking.Tests.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
    'Booking.Tests/BookingServiceTests.cs': 'public class BookingServiceTests {}',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.tests.testFileCount, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an ordinary file whose name ends in "test" is not counted as a test', async () => {
  // `latest.java` ends in "test" + ".java"; only the case-sensitive rule keeps it out.
  const dir = tempRepo({ 'src/main/java/com/acme/latest.java': 'class latest {}' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.tests.testFileCount, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a Maven manifest counts as a dependency pin', async () => {
  const dir = tempRepo({ 'pom.xml': '<project><dependencies/></project>' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.reproducibility.lockfilePresent, true,
      'a Maven dependency without a version does not resolve — the manifest is the pin');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a .NET project file anywhere counts as a dependency pin', async () => {
  const dir = tempRepo({ 'src/Booking/Booking.csproj': '<Project><PackageReference Version="1.2.3" /></Project>' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.reproducibility.lockfilePresent, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a repo with no manifest at all is still reported as unpinned', async () => {
  const dir = tempRepo({ 'README.md': '# nothing here\n' });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.reproducibility.lockfilePresent, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a credential in a Spring properties file is found', async () => {
  // .properties and .xml were outside the scanned extensions, so the single most likely
  // place for a hardcoded JVM credential was never read.
  const dir = tempRepo({
    'src/main/resources/application.properties':
      'spring.datasource.password="hunter2hunter2hunter2"\n',
  });
  try {
    const r = await harvestRepo(dir, { kitRoot: KIT_ROOT, runTestSuite: false });
    assert.equal(r.safety.secretFindings.offered, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
