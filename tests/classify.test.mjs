/**
 * Command and outcome classification.
 *
 * These are the highest-stakes functions in the kit: Verification is 25 of 100 points and
 * is driven almost entirely by what counts as a test run and whether it passed. Every case
 * below is either a real runner we must detect, or a false positive observed in an actual
 * transcript during development.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand, classifyOutcome, isCorrection, stripAnsi } from '../lib/harvest/shared.mjs';

const ESC = String.fromCharCode(27);
const ZW = '​';

test('detects every supported test runner', () => {
  const runners = [
    'npm test', 'npm run test', 'pnpm test', 'yarn test', 'bun test',
    'npx vitest run', 'npx jest --ci', 'npx playwright test',
    'pytest -q', 'python -m pytest tests/', 'python3 -m unittest',
    'go test ./...', 'cargo test', 'dotnet test', 'mvn verify',
    './gradlew test', 'mix test', 'bundle exec rspec',
  ];
  for (const cmd of runners) {
    assert.ok(classifyCommand(cmd).includes('test'), `expected a test run: ${cmd}`);
  }
});

test('a test runner still counts after a cd or an env prefix', () => {
  assert.ok(classifyCommand('cd apps/api && npm test').includes('test'));
  assert.ok(classifyCommand('CI=1 FORCE_COLOR=0 npm test').includes('test'));
  assert.ok(classifyCommand('sudo pytest').includes('test'));
});

test('does not count runner names that merely appear in text', () => {
  // Every one of these was a false positive observed in a real transcript.
  const notTests = [
    'node --check lib/harvest/adapters/claude-code.mjs',
    'node .github/scripts/kit-check.mjs',
    'mkdir -p "$TEMP/hk-test" && cat > "$TEMP/hk-test/t.mjs"',
    'grep -n "pytest|vitest|playwright" -i docs/*.md',
    'echo "remember to run pytest later"',
  ];
  for (const cmd of notTests) {
    assert.ok(!classifyCommand(cmd).includes('test'), `false positive: ${cmd}`);
  }
});

test('ignores runner names inside a heredoc body', () => {
  const cmd = [
    "cat > shared.mjs <<'JS'",
    'const TEST = /pytest|vitest|jest/;',
    'JS',
  ].join('\n');
  assert.deepEqual(classifyCommand(cmd), ['other']);
});

test('ignores shell metacharacters inside quoted arguments', () => {
  // Splitting on the pipe inside this quoted pattern used to invent segments.
  const cmd = 'grep -n "a\\|pytest\\|b" -i docs/';
  assert.ok(!classifyCommand(cmd).includes('test'));
});

test('classifies destructive and build commands', () => {
  assert.ok(classifyCommand('rm -rf build/').includes('destructive'));
  assert.ok(classifyCommand('git push --force origin main').includes('destructive'));
  assert.ok(classifyCommand('git reset --hard HEAD~3').includes('destructive'));
  assert.ok(classifyCommand('npm run build').includes('buildOrLint'));
  assert.ok(classifyCommand('cargo clippy').includes('buildOrLint'));
  assert.deepEqual(classifyCommand('git status'), ['other']);
});

test('reports every distinct kind present in one command line', () => {
  const kinds = classifyCommand('npm run build && npm test && rm -rf dist');
  assert.ok(kinds.includes('buildOrLint'));
  assert.ok(kinds.includes('test'));
  assert.ok(kinds.includes('destructive'));
});

test('empty or non-string commands classify as nothing', () => {
  assert.deepEqual(classifyCommand(''), []);
  assert.deepEqual(classifyCommand(undefined), []);
  assert.deepEqual(classifyCommand(null), []);
});

// --- outcome ------------------------------------------------------------------------

test('classifyOutcome never throws on the text-sniffing path', () => {
  // Regression: FAILURE_MARKER and SUCCESS_MARKER were once referenced but undefined, so
  // this threw. The throw escaped readSession and a whole session was silently discarded.
  assert.doesNotThrow(() => classifyOutcome('some output', undefined));
  assert.equal(classifyOutcome('3 passed', undefined), 'pass');
  assert.equal(classifyOutcome('2 failed, 1 passed', undefined), 'fail');
  assert.equal(classifyOutcome('hello world', undefined), 'unknown');
  assert.equal(classifyOutcome('', undefined), 'unknown');
  assert.equal(classifyOutcome(undefined, undefined), 'unknown');
});

test('a non-zero exit is decisive', () => {
  assert.equal(classifyOutcome('everything looks great, 9 passed', true), 'fail');
});

test('a zero exit does not override failure text in the output', () => {
  // `npm test | tee log`, `npm test || true` and `pytest; echo done` all exit zero
  // regardless of the suite. Believing the exit code there inflates Verification.
  assert.equal(classifyOutcome('Tests: 2 failed, 1 passed', false), 'fail');
  assert.equal(classifyOutcome('FAILED tests/test_api.py::test_create', false), 'fail');
  assert.equal(classifyOutcome('AssertionError: expected 1 to equal 2', false), 'fail');
});

test('a zero exit with clean output passes', () => {
  assert.equal(classifyOutcome('12 passed', false), 'pass');
  assert.equal(classifyOutcome('no output worth reading', false), 'pass');
});

test('a green TAP run is not read as a failure', () => {
  // Regression: `# fail 0` matched a loose FAIL pattern, so every passing `node --test`
  // run was reported as failed.
  const green = ['ok 1 - adds numbers', '1..1', '# tests 1', '# pass 1', '# fail 0'].join('\n');
  assert.equal(classifyOutcome(green, undefined), 'pass');
  assert.equal(classifyOutcome(green, false), 'pass');
});

test('a red TAP run is read as a failure', () => {
  const red = ['not ok 1 - adds numbers', '1..1', '# tests 1', '# pass 0', '# fail 1'].join('\n');
  assert.equal(classifyOutcome(red, undefined), 'fail');
  assert.equal(classifyOutcome(red, false), 'fail', 'a zero exit must not hide a red suite');
});

test('zero counts never signal their outcome', () => {
  assert.equal(classifyOutcome('0 failed', undefined), 'unknown');
  assert.equal(classifyOutcome('0 passed', undefined), 'unknown');
  assert.equal(classifyOutcome('Tests: 0 failed, 5 passed', undefined), 'pass');
});

test('colour codes do not hide a failure', () => {
  const coloured = `${ESC}[91mFAILED${ESC}[0m tests/test_x.py`;
  assert.equal(stripAnsi(coloured), 'FAILED tests/test_x.py');
  assert.equal(classifyOutcome(coloured, undefined), 'fail');
});

// --- corrections --------------------------------------------------------------------

test('recognises a human redirecting the agent', () => {
  for (const text of [
    'no, that is not what I asked for',
    "that's wrong, the id comes from the header",
    'you forgot the migration',
    'revert that change please',
    'actually, use the queue instead',
    'try again with the other approach',
  ]) {
    assert.ok(isCorrection(text), `expected a correction: ${text}`);
  }
});

test('does not treat ordinary instructions as corrections', () => {
  for (const text of [
    'add a test for the empty-input case',
    'now wire it into the router',
    'looks good, ship it',
    'run the suite',
  ]) {
    assert.ok(!isCorrection(text), `false correction: ${text}`);
  }
});

test('does not mistake a relative clause for a correction', () => {
  // Regression: "that is not" matched anywhere flagged a 5,000-character feature brief
  // ("remove anything that is not relevant") as a correction of work not yet done.
  for (const text of [
    'Remove anything that is not relevant for this need.',
    'Keep the parts that are wrong out of scope for now.',
    'Document every case that is not covered by a test.',
  ]) {
    assert.ok(!isCorrection(text), `false correction: ${text}`);
  }
  // The demonstrative use, pointing at prior output, must still register.
  for (const text of [
    "That's not what I meant.",
    'That is wrong — the id comes from the header.',
    'Looks close. That is not the right table though.',
  ]) {
    assert.ok(isCorrection(text), `missed a real correction: ${text}`);
  }
});

test('correction detection tolerates junk input', () => {
  assert.equal(isCorrection(''), false);
  assert.equal(isCorrection(undefined), false);
  assert.equal(isCorrection(ZW), false);
});
