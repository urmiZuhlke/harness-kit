import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSecrets } from './redact.mjs';

/**
 * shared.mjs — classifiers and bounded-excerpt helpers used by every harvester.
 *
 * Nothing here scores or judges. Classifiers answer "what kind of thing is this?"; the
 * scorer decides what that is worth.
 */

/** Hard privacy ceiling. No excerpt may exceed this, and no source may emit more than MAX_EXCERPTS. */
export const EXCERPT_CHARS = 280;
export const MAX_EXCERPTS = 12;

/** Lines larger than this are not JSON.parse'd — see adapters/copilot.mjs. */
export const MAX_LINE_BYTES = 20 * 1024 * 1024;

/**
 * Truncate to the privacy ceiling, collapsing whitespace so excerpts stay one-line.
 *
 * Credential-shaped strings are masked *before* truncating: a prompt is where a pasted key
 * ends up, and cutting first could leave half a key that no pattern recognises any more.
 * Every prompt and correction excerpt passes through here, and since the history file is
 * committed to a team's repository, this is the line that keeps a key out of their git log.
 */
export function excerpt(text) {
  if (typeof text !== 'string') return '';
  const flat = redactSecrets(text).replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT_CHARS ? flat : `${flat.slice(0, EXCERPT_CHARS - 1)}…`;
}

/** Collects at most MAX_EXCERPTS bounded excerpts; counts everything it was offered. */
export function excerptCollector(limit = MAX_EXCERPTS) {
  const kept = [];
  let offered = 0;
  return {
    offer(text, meta = {}) {
      offered++;
      // meta is spread first so it can never overwrite the bounded excerpt: the privacy
      // cap must not be defeatable by a caller passing a `text` key.
      if (kept.length < limit) kept.push({ ...meta, text: excerpt(text) });
    },
    result() {
      return { kept, offered, truncated: offered > kept.length };
    },
  };
}

/**
 * Command classification.
 *
 * A shell command is not one command: it is segments joined by &&, ||, ; and pipes, and
 * it may carry a heredoc whose *body* is file content rather than anything executed.
 * Matching runner names anywhere in the raw string produces false positives — writing a
 * file that mentions `pytest`, or grepping for "vitest", would otherwise register as a
 * test run. Since Verification is the heaviest scored dimension, inflation there is the
 * expensive error, so classification strips heredoc bodies, splits into segments, and
 * anchors every pattern to the start of a segment.
 */

/** Drop heredoc bodies: everything from `<<WORD` until a line consisting of WORD. */
function stripHeredocs(command) {
  const lines = command.split('\n');
  const out = [];
  let terminator = null;
  for (const line of lines) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    out.push(line);
    if (m) terminator = m[2];
  }
  return out.join('\n');
}

/**
 * Blank out quoted spans. A command *head* is never inside quotes, but grep patterns
 * and echoed text routinely contain shell metacharacters and runner names — splitting
 * on a pipe inside a quoted grep pattern invents segments never executed.
 * Replacing the span with a space biases towards under-counting, the safe direction.
 */
function stripQuoted(command) {
  return command.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' ');
}

/** Split into individually-executed segments. */
function segments(command) {
  return stripQuoted(stripHeredocs(command))
    .split(/\n|&&|\|\||[;|]/)
    .map((seg) => seg.trim())
    .filter(Boolean)
    // drop leading env assignments and `sudo`, which precede the real command
    .map((seg) => seg.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '').replace(/^sudo\s+/, ''));
}

const TEST_SEGMENT = new RegExp(
  [
    String.raw`^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b`,
    String.raw`^npx?\s+(?:jest|vitest|playwright|mocha|ava|tap)\b`,
    String.raw`^(?:jest|vitest|mocha|pytest|phpunit|rspec)\b`,
    String.raw`^python[0-9.]*\s+-m\s+(?:pytest|unittest)\b`,
    String.raw`^go\s+test\b`,
    String.raw`^cargo\s+test\b`,
    String.raw`^dotnet\s+test\b`,
    String.raw`^mvn\s+(?:test|verify)\b`,
    String.raw`^\.?/?gradlew?\s+\S*test`,
    String.raw`^mix\s+test\b`,
    String.raw`^bundle\s+exec\s+rspec\b`,
  ].join('|'),
  'i'
);

const BUILD_OR_LINT_SEGMENT = new RegExp(
  [
    String.raw`^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|lint|typecheck|type-check|format|ci)\b`,
    String.raw`^npx?\s+(?:eslint|prettier|tsc)\b`,
    String.raw`^(?:eslint|prettier|ruff|black|flake8|mypy|tsc|clippy)\b`,
    String.raw`^go\s+(?:build|vet)\b`,
    String.raw`^cargo\s+(?:build|clippy)\b`,
    String.raw`^dotnet\s+build\b`,
    String.raw`^mvn\s+(?:compile|package)\b`,
  ].join('|'),
  'i'
);

/** Commands that overwrite history or destroy work — recorded for Safety & Boundaries. */
const DESTRUCTIVE_SEGMENT = new RegExp(
  [
    String.raw`^rm\s+-[a-z]*[rf]`,
    String.raw`^git\s+push\b.*\s(?:--force|-f)\b`,
    String.raw`^git\s+reset\s+--hard\b`,
    String.raw`^git\s+clean\s+-[a-z]*f`,
    String.raw`^(?:DROP|TRUNCATE)\s+(?:TABLE|DATABASE)\b`,
  ].join('|'),
  'i'
);

/**
 * Returns the distinct kinds present in a command, e.g. ['test'] or ['buildOrLint','test'].
 * Always returns at least ['other'].
 */
export function classifyCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return [];
  const kinds = new Set();
  for (const seg of segments(command)) {
    if (TEST_SEGMENT.test(seg)) kinds.add('test');
    else if (BUILD_OR_LINT_SEGMENT.test(seg)) kinds.add('buildOrLint');
    else if (DESTRUCTIVE_SEGMENT.test(seg)) kinds.add('destructive');
  }
  if (!kinds.size) kinds.add('other');
  return [...kinds];
}

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[a-zA-Z]', 'g');

/**
 * Terminal output is captured with colour codes intact. Left in place they split match
 * targets — a red "FAIL" arrives as ESC[91mFAIL — so they are stripped before matching.
 * The escape byte is built from its char code to keep it unambiguous in source.
 */
export function stripAnsi(text) {
  return typeof text === 'string' ? text.replace(ANSI, '') : '';
}

/**
 * Counts must be non-zero to mean anything. A green TAP run prints `# fail 0` and a bare
 * `\bFAIL\s` matched it case-insensitively, so every passing `node --test` run was
 * reported as a failure. Summary lines are therefore anchored and require a digit 1-9.
 */
/** Case-insensitive markers. Every count must be non-zero to mean anything. */
const FAILURE_MARKER = new RegExp([
  String.raw`\b[1-9]\d*\s+(?:test\s+)?(?:failed|failing|failures?)\b`,
  String.raw`^#\s*fail\s+[1-9]`,
  String.raw`\bTests?:[^\n]*\b[1-9]\d*\s+failed\b`,
  String.raw`\bAssertionError\b`,
  String.raw`\bTraceback \(most recent call last\)`,
  String.raw`\bexit(?:ed with)? code [1-9]`,
].join('|'), 'im');

/**
 * Case-*sensitive* markers. `FAILED` in capitals is a runner verdict (pytest, CI); the
 * same word in lower case is ordinary prose and appears inside "0 failed", which must not
 * count. Matching it case-insensitively reported every green run as red.
 */
const FAILURE_MARKER_EXACT = new RegExp([
  String.raw`\bFAILED\b`,
  String.raw`^not ok\b`,
].join('|'), 'm');

const SUCCESS_MARKER = new RegExp([
  String.raw`\b[1-9]\d*\s+(?:test\s+)?(?:passed|passing)\b`,
  String.raw`\ball tests? passed\b`,
  String.raw`^#\s*pass\s+[1-9]`,
  String.raw`\bTests?:[^\n]*\b[1-9]\d*\s+passed\b`,
].join('|'), 'im');

const SUCCESS_MARKER_EXACT = new RegExp([
  String.raw`\bOK\b\s*\(\d+ tests?\)`,
  String.raw`\bBUILD SUCCESS(?:FUL)?\b`,
].join('|'), 'm');

/**
 * Classify a test command's result as 'pass' | 'fail' | 'unknown'.
 *
 * An explicit failure signal (non-zero exit) is decisive. A *success* signal is not:
 * `npm test | tee log`, `npm test || true` and `pytest; echo done` all exit zero no
 * matter what the suite did, so a green exit code is only believed when the output does
 * not contradict it. Verification is the heaviest scored dimension and inflation there is
 * the expensive error, so the contradiction wins.
 */
export function classifyOutcome(output, isError) {
  if (isError === true) return 'fail';
  const text = stripAnsi(output);
  const sample = text.length > 20000 ? text.slice(-20000) : text;
  const failed = sample && (FAILURE_MARKER.test(sample) || FAILURE_MARKER_EXACT.test(sample));
  const passed = sample && (SUCCESS_MARKER.test(sample) || SUCCESS_MARKER_EXACT.test(sample));

  if (failed) return 'fail';
  if (isError === false) return 'pass';
  if (passed) return 'pass';
  return 'unknown';
}

/**
 * Heuristic: did this user turn redirect the agent?
 * Deliberately conservative — a missed correction understates a team, a false positive
 * inflates them, and inflation is the worse error for a competition.
 */
const CORRECTION_PATTERNS = [
  /^\s*(?:no|nope|wrong|stop|wait)\b/i,
  // Sentence-initial only. "that is not" is overwhelmingly a relative clause in ordinary
  // prose — "remove anything that is not relevant" is a request, not a correction — and
  // matching it anywhere flagged a long feature brief as a correction of work that had
  // not happened yet. A real correction points at prior output: "That's not what I meant."
  /(?:^|[.!?]\s+|\n\s*)that(?:'s| is)\s+(?:not|wrong|incorrect)\b/i,
  /\b(?:you|it) (?:broke|missed|forgot|ignored|misunderstood)\b/i,
  /\b(?:don't|do not|never) (?:do|use|add|change|touch)\b/i,
  /\b(?:revert|undo|roll ?back|put .* back)\b/i,
  /\b(?:actually|instead),?\s/i,
  /\bnot what I (?:asked|wanted|meant)\b/i,
  /\btry again\b/i,
];

export function isCorrection(text) {
  if (typeof text !== 'string' || text.length < 3) return false;
  return CORRECTION_PATTERNS.some((re) => re.test(text));
}

/**
 * Distribution summary. Never stores the values themselves.
 *
 * `median` averages the two middle values on an even count, and `p90` uses the
 * nearest-rank method. The earlier `floor(q * n)` indexing returned the upper-middle
 * value as the median and collapsed p90 onto max for n=10, which mattered because a
 * scored criterion reads these numbers and quotes them back to the team.
 */
export function distribution(values) {
  if (!values.length) return { count: 0, totalChars: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2
    ? sorted[(n - 1) / 2]
    : Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: n,
    min: sorted[0],
    median,
    p90: sorted[Math.max(0, Math.ceil(0.9 * n) - 1)],
    max: sorted[n - 1],
    mean: Math.round(sum / n),
    totalChars: sum,
  };
}

/** Source status. `notHarvested` must never be confused with a zero by the scorer. */
export const source = {
  harvested: (detail = {}) => ({ status: 'harvested', ...detail }),
  empty: (reason, detail = {}) => ({ status: 'empty', reason, ...detail }),
  notHarvested: (reason, detail = {}) => ({ status: 'not-harvested', reason, ...detail }),
};

/**
 * Repo attribution. Uses path.relative rather than string prefixes so that a session
 * started in a subfolder counts, a sibling directory with a shared name prefix does not,
 * and Windows/POSIX separators and drive-letter case stop mattering.
 */
export function makeIsInRepo(repoPath) {
  const root = comparable(repoPath);
  return (candidate) => {
    if (typeof candidate !== 'string' || !candidate) return false;
    let rel;
    try { rel = relative(root, comparable(candidate)); } catch { return false; }
    if (rel === '') return true;
    if (isAbsolute(rel)) return false;
    return !rel.startsWith('..');
  };
}

/**
 * A path in one Unicode form. macOS hands out the same folder name decomposed in one place
 * and composed in another ("Zühlke" as u + combining diaeresis, or as ü), and a plain string
 * comparison of the two finds no match — a whole person's history reported as "none belong
 * to this repo".
 */
function comparable(path) {
  return resolve(path).normalize('NFC');
}

/**
 * For a folder that CONTAINS the repository (an IDE workspace opened one level up), the
 * repository's path relative to it (`camp-repo`), else null. A session started there is not
 * the repository's by its folder alone — the same workspace can hold other projects — so an
 * adapter uses this only together with evidence that the session worked inside the repo.
 */
export function makeRepoFrom(repoPath) {
  const root = comparable(repoPath);
  return (candidate) => {
    if (typeof candidate !== 'string' || !candidate) return null;
    let rel;
    try { rel = relative(comparable(candidate), root); } catch { return null; }
    if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || rel.startsWith('../')) return null;
    return rel.split(sep).join('/');
  };
}

/**
 * Where a VS Code-family editor keeps its per-workspace storage, across platforms.
 *
 * Copilot and Cursor both live in this layout — `<user-data>/<app>/User/workspaceStorage`
 * with a `workspace.json` naming the folder — and both adapters had their own copy of this
 * lookup. The copies had already drifted on one detail that matters: only one of them
 * checked for a `file:` URI before handing it to `fileURLToPath`, so a workspace opened
 * over a remote or virtual filesystem threw in one adapter and resolved in the other.
 */
export function editorStorageRoots(appNames, { platform, env, home }) {
  const bases = [];
  if (platform === 'win32') {
    bases.push(env.APPDATA || join(home, 'AppData', 'Roaming'));
  } else if (platform === 'darwin') {
    bases.push(join(home, 'Library', 'Application Support'));
  } else {
    bases.push(env.XDG_CONFIG_HOME || join(home, '.config'));
  }
  const roots = [];
  for (const base of bases) {
    for (const app of appNames) {
      const user = join(base, app, 'User');
      if (existsSync(user)) roots.push(user);
    }
  }
  return roots;
}

/**
 * Resolve a workspace.json folder URI to a filesystem path, or null.
 *
 * A URI that is not a `file:` one is returned unchanged rather than parsed: `fileURLToPath`
 * throws on `vscode-remote://` and similar, and a path that is not on this machine simply
 * fails repo attribution, which is the correct outcome.
 */
export function workspaceFolderOf(hashDir) {
  const meta = join(hashDir, 'workspace.json');
  if (!existsSync(meta)) return null;
  try {
    const parsed = JSON.parse(readFileSync(meta, 'utf8'));
    const uri = parsed.folder || parsed.workspace;
    if (typeof uri !== 'string') return null;
    return uri.startsWith('file:') ? fileURLToPath(uri) : uri;
  } catch {
    return null;
  }
}
