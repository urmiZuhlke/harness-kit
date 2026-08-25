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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
