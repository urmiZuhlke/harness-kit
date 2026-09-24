#!/usr/bin/env node
// GENERATED FILE — do not edit. Built from bin/collect-history.mjs by
// .github/scripts/build-collector.mjs; edit the sources and rebuild.
//
// harness-kit history collector. Run it inside your project folder:
//
//   node collect-history.mjs
//
// It reads your AI chat history for this project on this machine and writes a summary
// to .vibecheck/history-<your name>.json for you to commit. Nothing is uploaded.
// `node collect-history.mjs --help` lists exactly what the file contains.

import * as __node_child_process from 'node:child_process';
import * as __node_fs from 'node:fs';
import * as __node_os from 'node:os';
import * as __node_path from 'node:path';
import * as __node_readline from 'node:readline';
import * as __node_url from 'node:url';
import * as __node_zlib from 'node:zlib';
// ─── lib/harvest/redact.mjs ──────────────────────────────────────────────────────────
const __m0 = (() => {

/**
 * redact.mjs — the credential shapes the kit looks for, and the one function that masks them.
 *
 * Kept apart from repo.mjs because the participant-side history collector is bundled into a
 * single file and must redact prompt excerpts without dragging the whole repo harvester in.
 * A prompt is exactly where a pasted key ends up ("here's my key, why does this 401?"), and
 * the history file is committed to a repository that may be pushed somewhere public.
 */

/**
 * Secret patterns. Every match is reported by file and line with the value masked —
 * the point is to tell a team they leaked something, never to reproduce it.
 */
const SECRET_PATTERNS = [
  { name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/, alwaysReal: true },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, alwaysReal: true },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, alwaysReal: true },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, alwaysReal: true },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, alwaysReal: true },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/, alwaysReal: true },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, alwaysReal: true },
  // These two match shapes, not issuers, so where they appear decides what they mean.
  { name: 'connection-string-password', re: /\b[a-z+]{2,12}:\/\/[^\s:@/]+:[^\s:@/]{4,}@/i },
  {
    name: 'assigned-credential',
    re: /\b(?:api[_-]?key|secret|password|passwd|token|client[_-]?secret)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  },
];

/**
 * Global versions of the detection patterns. The originals are non-global because they
 * only ever answer "does this line match"; replacing every occurrence needs the `g` flag.
 */
const SECRET_PATTERNS_GLOBAL = SECRET_PATTERNS.map(({ name, re }) => ({
  name,
  re: new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'),
}));

/** Replace anything that looks like a credential with a named marker. */
function redactSecrets(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const { name, re } of SECRET_PATTERNS_GLOBAL) {
    re.lastIndex = 0;
    out = out.replace(re, '[redacted: ' + name + ']');
  }
  return out;
}
return { SECRET_PATTERNS, redactSecrets };
})();

// ─── lib/harvest/shared.mjs ──────────────────────────────────────────────────────────
const __m1 = (() => {
const { existsSync, readFileSync } = __node_fs;
const { relative, resolve, isAbsolute, join } = __node_path;
const { fileURLToPath } = __node_url;
const { redactSecrets } = __m0;
/**
 * shared.mjs — classifiers and bounded-excerpt helpers used by every harvester.
 *
 * Nothing here scores or judges. Classifiers answer "what kind of thing is this?"; the
 * scorer decides what that is worth.
 */

/** Hard privacy ceiling. No excerpt may exceed this, and no source may emit more than MAX_EXCERPTS. */
const EXCERPT_CHARS = 280;
const MAX_EXCERPTS = 12;

/** Lines larger than this are not JSON.parse'd — see adapters/copilot.mjs. */
const MAX_LINE_BYTES = 20 * 1024 * 1024;

/**
 * Truncate to the privacy ceiling, collapsing whitespace so excerpts stay one-line.
 *
 * Credential-shaped strings are masked *before* truncating: a prompt is where a pasted key
 * ends up, and cutting first could leave half a key that no pattern recognises any more.
 * Every prompt and correction excerpt passes through here, and since the history file is
 * committed to a team's repository, this is the line that keeps a key out of their git log.
 */
function excerpt(text) {
  if (typeof text !== 'string') return '';
  const flat = redactSecrets(text).replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT_CHARS ? flat : `${flat.slice(0, EXCERPT_CHARS - 1)}…`;
}

/** Collects at most MAX_EXCERPTS bounded excerpts; counts everything it was offered. */
function excerptCollector(limit = MAX_EXCERPTS) {
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
function classifyCommand(command) {
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
function stripAnsi(text) {
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
function classifyOutcome(output, isError) {
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

function isCorrection(text) {
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
function distribution(values) {
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
const source = {
  harvested: (detail = {}) => ({ status: 'harvested', ...detail }),
  empty: (reason, detail = {}) => ({ status: 'empty', reason, ...detail }),
  notHarvested: (reason, detail = {}) => ({ status: 'not-harvested', reason, ...detail }),
};

/**
 * Repo attribution. Uses path.relative rather than string prefixes so that a session
 * started in a subfolder counts, a sibling directory with a shared name prefix does not,
 * and Windows/POSIX separators and drive-letter case stop mattering.
 */
function makeIsInRepo(repoPath) {
  const root = resolve(repoPath);
  return (candidate) => {
    if (typeof candidate !== 'string' || !candidate) return false;
    let rel;
    try { rel = relative(root, resolve(candidate)); } catch { return false; }
    if (rel === '') return true;
    if (isAbsolute(rel)) return false;
    return !rel.startsWith('..');
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
function editorStorageRoots(appNames, { platform, env, home }) {
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
function workspaceFolderOf(hashDir) {
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
return { EXCERPT_CHARS, MAX_EXCERPTS, MAX_LINE_BYTES, excerpt, excerptCollector, classifyCommand, stripAnsi, classifyOutcome, isCorrection, distribution, source, makeIsInRepo, editorStorageRoots, workspaceFolderOf };
})();

// ─── lib/harvest/adapters/claude-code.mjs ────────────────────────────────────────────
const __m2 = (() => {
const { createReadStream, existsSync, readdirSync, statSync } = __node_fs;
const { createInterface } = __node_readline;
const { basename, join } = __node_path;
const { homedir } = __node_os;
const { classifyCommand, classifyOutcome, distribution, excerptCollector, isCorrection, source } = __m1;
/**
 * claude-code.mjs — harvest Claude Code sessions for one repo: the CLI, the VS Code and
 * JetBrains extensions, and the Code tab in Claude Desktop, which all write the same files.
 *
 * Sessions are JSONL at <config dir>/projects/<path-slug>/<session-uuid>.jsonl, where the
 * config dir is `~/.claude`, or `$CLAUDE_CONFIG_DIR` for someone who relocated it. Every record
 * carries `timestamp`, `cwd`, `gitBranch` and `sessionId`, which is how sessions are
 * attributed to a repo without trusting the directory-name slug (a session started in a
 * subfolder or through a symlink still reports the real cwd).
 *
 * Streams line by line and never retains message bodies — only counts, classifications
 * and bounded excerpts.
 */

/**
 * Every projects directory worth reading: the relocated one if `CLAUDE_CONFIG_DIR` is set,
 * and the default as well — setting the variable in one shell does not move sessions an
 * editor extension already wrote to `~/.claude`.
 */
const projectsRoots = () => {
  const roots = [];
  if (process.env.CLAUDE_CONFIG_DIR) roots.push(join(process.env.CLAUDE_CONFIG_DIR, 'projects'));
  const fallback = join(homedir(), '.claude', 'projects');
  if (!roots.includes(fallback)) roots.push(fallback);
  return roots.filter((r) => existsSync(r));
};

/**
 * Planning leaves several different traces depending on how a team works, and scoring
 * only one of them punished teams for using a different-but-equivalent method.
 *
 * The first version counted `ExitPlanMode` alone. This repo's own transcript then scored
 * zero for "no planning step is visible" while containing two explicit `/planner`
 * invocations and 39 records attributed to that skill — a team following this kit's own
 * advice, marked down for it.
 */
const PLANNING_TOOLS = /^(?:ExitPlanMode|EnterPlanMode|TodoWrite|manage_todo_list)$/;
const PLANNING_SKILL = /plan/i;

/**
 * Reduce a user record to the words a human actually typed, or null to skip it entirely.
 *
 * A slash command does not arrive as one tidy prompt. Invoking `/planner do X` writes
 * *two* user records: a `<command-message>…<command-args>do X</command-args>` wrapper, and
 * a second record carrying the skill's entire definition ("Base directory for this
 * skill: …"). Counting both as prompts measured this repo at 20 prompts when a human typed
 * 8, dragged the mean prompt length up with 10,000-character skill definitions, and — via
 * imperative prose inside those definitions — produced six "corrections" the human never
 * made.
 *
 * That distortion lands hardest on teams who use slash commands, which is exactly what
 * this kit recommends, so it had to be removed rather than tolerated.
 */
function humanPromptText(raw) {
  const text = raw.trim();
  if (!text) return null;

  // The injected body of a skill definition. Not human words at all.
  if (/^Base directory for this skill:/.test(text)) return null;

  // A slash-command invocation: the human's own words are inside <command-args>.
  if (/<command-name>/.test(text) || /<command-message>/.test(text)) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
    const name = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
    const typed = (args?.[1] ?? '').trim();
    if (typed) return typed;
    // A bare `/command` with no arguments is still a real instruction, just a terse one.
    return name ? name[1].trim() : null;
  }

  // Context the harness injects around a prompt, never typed by anyone.
  const stripped = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .trim();
  return stripped || null;
}

/** Text of a message whose content is either a string or an array of typed blocks. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function toolResultText(block) {
  const c = block?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x?.text === 'string' ? x.text : '')).join('\n');
  return '';
}

async function readSession(file, isInRepo) {
  const s = {
    sessionId: null, startedAt: null, endedAt: null, branches: new Set(),
    userPrompts: 0, promptLengths: [], corrections: 0, assistantTurns: 0,
    sidechainRecords: 0, toolCalls: {},
    commands: { test: 0, buildOrLint: 0, destructive: 0, other: 0 },
    testRuns: [], planningSignals: 0, malformedLines: 0, injectedRecordsSkipped: 0,
  };
  const prompts = excerptCollector(6);
  const corrections = excerptCollector(6);
  const pending = new Map();
  let cwdChecked = false;
  let belongs = false;

  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { s.malformedLines++; continue; }

    if (!cwdChecked && typeof rec.cwd === 'string') {
      cwdChecked = true;
      belongs = isInRepo(rec.cwd);
      if (!belongs) { rl.close(); break; }
    }
    if (rec.sessionId && !s.sessionId) s.sessionId = rec.sessionId;
    if (rec.gitBranch) s.branches.add(rec.gitBranch);
    if (rec.timestamp) {
      const t = Date.parse(rec.timestamp);
      if (!Number.isNaN(t)) {
        if (s.startedAt === null || t < s.startedAt) s.startedAt = t;
        if (s.endedAt === null || t > s.endedAt) s.endedAt = t;
      }
    }
    if (rec.isSidechain) s.sidechainRecords++;

    const msg = rec.message;
    if (rec.type === 'user' && msg) {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const results = blocks.filter((b) => b?.type === 'tool_result');
      if (results.length) {
        for (const r of results) {
          const info = pending.get(r.tool_use_id);
          if (!info) continue;
          pending.delete(r.tool_use_id);
          if (info.kind === 'test') {
            // Pass is_error through as a tri-state: true and false are both facts about
            // the exit code, while undefined means fall back to reading the output.
            s.testRuns.push({
              outcome: classifyOutcome(toolResultText(r),
                typeof r.is_error === 'boolean' ? r.is_error : undefined),
              at: rec.timestamp ?? null,
            });
          }
        }
        continue;
      }
      if (rec.isSidechain) continue;
      const rawText = textOf(msg.content);
      // `/planner ...` typed by the human is a planning step just as much as the agent
      // entering plan mode; it simply leaves a different trace.
      const invoked = rawText.match(/<command-name>([^<]+)<\/command-name>/);
      if (invoked && PLANNING_SKILL.test(invoked[1])) s.planningSignals++;
      const text = humanPromptText(rawText);
      if (!text) { s.injectedRecordsSkipped++; continue; }
      s.userPrompts++;
      s.promptLengths.push(text.length);
      prompts.offer(text, { at: rec.timestamp ?? null });
      if (isCorrection(text)) {
        s.corrections++;
        corrections.offer(text, { at: rec.timestamp ?? null });
      }
    } else if (rec.type === 'assistant' && msg) {
      s.assistantTurns++;
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
        s.toolCalls[b.name] = (s.toolCalls[b.name] ?? 0) + 1;
        if (PLANNING_TOOLS.test(b.name)) s.planningSignals++;
        // A skill invoked by name is the strongest planning signal this kit can see,
        // because the kit itself ships a planner skill and tells teams to use it.
        if (b.name === 'Skill' && PLANNING_SKILL.test(String(b.input?.skill ?? ''))) {
          s.planningSignals++;
        }
        const kinds = classifyCommand(b.input?.command);
        for (const kind of kinds) s.commands[kind]++;
        if (b.id && kinds.includes('test')) pending.set(b.id, { name: b.name, kind: 'test' });
      }
    }
  }

  if (!belongs) return null;
  return {
    sessionId: s.sessionId,
    startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
    endedAt: s.endedAt ? new Date(s.endedAt).toISOString() : null,
    durationMinutes: s.startedAt && s.endedAt ? Math.round((s.endedAt - s.startedAt) / 60000) : null,
    branches: [...s.branches],
    userPrompts: s.userPrompts,
    promptLength: distribution(s.promptLengths),
    corrections: s.corrections,
    assistantTurns: s.assistantTurns,
    subagentRecords: s.sidechainRecords,
    toolCalls: s.toolCalls,
    toolCallTotal: Object.values(s.toolCalls).reduce((a, b) => a + b, 0),
    commands: s.commands,
    testRuns: s.testRuns,
    planningSignals: s.planningSignals,
    malformedLines: s.malformedLines,
    // Command wrappers and skill definitions dropped before counting, reported so the
    // gap between what the transcript holds and what a human typed stays visible.
    injectedRecordsSkipped: s.injectedRecordsSkipped,
    excerpts: { prompts: prompts.result(), corrections: corrections.result() },
  };
}

async function harvestClaudeCode({ isInRepo }) {
  const roots = projectsRoots();
  if (!roots.length) {
    return { source: source.notHarvested('no ~/.claude/projects directory on this machine'), sessions: [] };
  }
  // Keyed by project-folder/file name, so the same file found under two config dirs (a
  // copied or synced ~/.claude) is read once. Deliberately *not* keyed by session id:
  // subagent transcripts are separate files that share their parent's id, and collapsing
  // them would silently drop the tool calls and test runs they hold.
  const byName = new Map();
  try {
    for (const root of roots) {
      for (const dir of readdirSync(root)) {
        const d = join(root, dir);
        if (!statSync(d).isDirectory()) continue;
        for (const f of readdirSync(d)) {
          if (f.endsWith('.jsonl') && !byName.has(dir + '/' + f)) byName.set(dir + '/' + f, join(d, f));
        }
      }
    }
  } catch (err) {
    return { source: source.notHarvested('could not list sessions: ' + err.message), sessions: [] };
  }
  const files = [...byName.values()];
  if (!files.length) {
    return { source: source.empty('no Claude Code session files on this machine'), sessions: [] };
  }

  const sessions = [];
  const failures = [];
  for (const f of files) {
    try {
      const s = await readSession(f, isInRepo);
      if (s) sessions.push(s);
    } catch (err) {
      // A session that fails to parse is lost evidence, not a neutral event. Record why,
      // so a facilitator can see it rather than a team quietly scoring lower.
      failures.push({ file: basename(f), error: err.message });
    }
  }
  if (!sessions.length) {
    return {
      source: source.empty(
        'Claude Code sessions exist on this machine but none belong to this repo',
        { filesScanned: files.length, failures }
      ),
      sessions: [],
    };
  }
  return {
    source: source.harvested({
      filesScanned: files.length, sessionsMatched: sessions.length, failures,
    }),
    sessions,
  };
}
return { harvestClaudeCode };
})();

// ─── lib/harvest/adapters/codex.mjs ──────────────────────────────────────────────────
const __m3 = (() => {
const { createReadStream, existsSync, readdirSync, statSync } = __node_fs;
const { createInterface } = __node_readline;
const { basename, join } = __node_path;
const { homedir } = __node_os;
const { classifyCommand, classifyOutcome, distribution, excerptCollector, isCorrection, source } = __m1;
/**
 * codex.mjs — harvest Codex sessions for one repo: the CLI, the desktop app and the IDE
 * extension, which all write the same rollout files.
 *
 * Sessions are JSONL under <codex home>/sessions/<yyyy>/<mm>/<dd>/rollout-<stamp>-<id>.jsonl,
 * where the Codex home is `$CODEX_HOME` if set and `~/.codex` otherwise. A session archived
 * from the app or the extension is moved to <codex home>/archived_sessions/ — flat, same
 * file format — and is read from there too: archiving tidies a sidebar, it does not mean
 * the work did not happen.
 * Each line is one record; the first is `session_meta`, whose payload carries the `cwd`
 * that attributes the session to a repo — the same rule the Claude Code adapter uses, and
 * for the same reason: a directory-name slug lies when a session started in a subfolder or
 * through a symlink.
 *
 * **Written against a moving format, deliberately tolerantly.** Codex has shipped several
 * record layouts: a record may be wrapped in `payload` or flat, a shell call may arrive as
 * `function_call` with JSON `arguments` or as `local_shell_call` with a structured action,
 * and message content may be a string or an array of typed blocks. Every reader here
 * accepts all of those and skips what it does not recognise, because the failure mode that
 * matters is silent: an unreadable record does not raise an error, it just quietly removes
 * evidence from a team's score. What cannot be read is counted in `unreadRecords` and
 * reported, rather than being absorbed into a lower number.
 *
 * Streams line by line and never retains message bodies — only counts, classifications
 * and bounded excerpts.
 */

/**
 * Where Codex keeps its data. `CODEX_HOME` relocates all of it, and a person who set it
 * would otherwise be reported as never having used Codex.
 */
const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');

/** Live sessions first, then archived ones — both hold the same rollout format. */
const SESSION_DIRS = ['sessions', 'archived_sessions'];

/** Codex's own plan tool, plus the names its harness has used for the same thing. */
const PLANNING_TOOLS = /^(?:update_plan|plan|todo|todos|manage_todo_list)$/i;

/**
 * Walk a date-partitioned tree and collect session files, **newest first**.
 *
 * Capped, because a long-time Codex user can have tens of thousands of rollouts. The cap
 * used to apply in whatever order the filesystem listed directories — alphabetical on one
 * machine, hash order on another — so a heavy user could have exactly the hackathon's
 * sessions dropped. Rollout paths sort chronologically (`2026/09/24/rollout-2026-09-24T…`),
 * so visiting names in descending order keeps the most recent work when the cap bites.
 */
function sessionFiles(root, maxFiles = 4000) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // Directories pushed oldest-first so the newest is popped next; files taken newest-first.
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(join(dir, entry.name));
    }
    for (const entry of [...entries].reverse()) {
      if (out.length >= maxFiles) break;
      if (!entry.isDirectory() && entry.name.endsWith('.jsonl')) out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * The meaningful body of a record.
 *
 * Older rollouts put the interesting fields at the top level; newer ones nest them under
 * `payload`. Reading only one of the two shapes silently harvests nothing from half the
 * Codex versions in the wild.
 */
function bodyOf(rec) {
  if (rec && typeof rec.payload === 'object' && rec.payload !== null) return rec.payload;
  return rec ?? {};
}

/** Text of message content that may be a string, or an array of typed blocks. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => {
      if (typeof b === 'string') return b;
      // input_text, output_text and plain text blocks all carry `text`.
      return typeof b?.text === 'string' ? b.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * The shell command a tool call would run, whatever shape it arrived in.
 *
 * Codex passes a command as an argv array far more often than as a string, and
 * `["bash", "-lc", "npm test"]` classified as a whole reads as a `bash` invocation rather
 * than a test run. The last element of such an array is the actual command line, so it is
 * preferred; anything shorter is joined.
 */
function commandOf(body) {
  let args = body.arguments ?? body.action ?? body.input ?? null;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { return args; }
  }
  if (!args || typeof args !== 'object') return null;
  const command = args.command ?? args.cmd ?? args.script ?? null;
  if (typeof command === 'string') return command;
  if (!Array.isArray(command)) return null;
  const parts = command.filter((x) => typeof x === 'string');
  if (!parts.length) return null;
  // ["bash", "-lc", "npm test"] — the payload is the last element, not the shell.
  const shellish = /^(?:ba|z|k|fi)?sh(?:\.exe)?$|^(?:cmd|powershell|pwsh)(?:\.exe)?$/i;
  if (parts.length > 1 && shellish.test(basename(parts[0]))) return parts[parts.length - 1];
  return parts.join(' ');
}

/** Output text of a tool result, and the exit code if the record states one. */
function resultOf(body) {
  let out = body.output ?? body.result ?? body.content ?? '';
  if (typeof out === 'string') {
    // A result is often a JSON string wrapping the real output plus metadata.
    const trimmed = out.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const text = typeof parsed.output === 'string' ? parsed.output : out;
        const code = parsed?.metadata?.exit_code ?? parsed?.exit_code ?? null;
        return { text, exitCode: typeof code === 'number' ? code : null };
      } catch { /* not JSON after all — use it as written */ }
    }
    return { text: out, exitCode: null };
  }
  if (out && typeof out === 'object') {
    const code = out?.metadata?.exit_code ?? out.exit_code ?? null;
    return {
      text: typeof out.output === 'string' ? out.output : textOf(out.content ?? ''),
      exitCode: typeof code === 'number' ? code : null,
    };
  }
  return { text: '', exitCode: null };
}

const CALL_TYPES = new Set([
  'function_call', 'local_shell_call', 'custom_tool_call', 'tool_call', 'shell_call',
]);
const OUTPUT_TYPES = new Set([
  'function_call_output', 'local_shell_call_output', 'custom_tool_call_output',
  'tool_call_output', 'shell_call_output',
]);

async function readSession(file, isInRepo) {
  const s = {
    sessionId: null, startedAt: null, endedAt: null,
    userPrompts: 0, promptLengths: [], corrections: 0, assistantTurns: 0, toolCalls: {},
    commands: { test: 0, buildOrLint: 0, destructive: 0, other: 0 },
    testRuns: [], planningSignals: 0, malformedLines: 0, unreadRecords: 0,
  };
  const prompts = excerptCollector(6);
  const corrections = excerptCollector(6);
  const pending = new Map();
  let cwdSeen = false;
  let belongs = false;

  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { s.malformedLines++; continue; }
    const body = bodyOf(rec);

    // Attribution. Not necessarily on the first line — a rollout may open with a version
    // banner — so every record is checked until a cwd is found, and a session that never
    // states one is dropped rather than credited to whichever repo asked.
    if (!cwdSeen) {
      const cwd = body.cwd ?? rec.cwd ?? body.workdir ?? null;
      if (typeof cwd === 'string' && cwd) {
        cwdSeen = true;
        belongs = isInRepo(cwd);
        if (!belongs) { rl.close(); break; }
      }
    }
    if (!s.sessionId) {
      const id = body.id ?? rec.id ?? body.session_id ?? rec.session_id ?? null;
      if (typeof id === 'string') s.sessionId = id;
    }
    const stamp = rec.timestamp ?? body.timestamp ?? null;
    if (typeof stamp === 'string') {
      const t = Date.parse(stamp);
      if (!Number.isNaN(t)) {
        if (s.startedAt === null || t < s.startedAt) s.startedAt = t;
        if (s.endedAt === null || t > s.endedAt) s.endedAt = t;
      }
    }

    const type = body.type ?? rec.type ?? null;

    if (type === 'message') {
      const text = textOf(body.content ?? body.text ?? '').trim();
      if (body.role === 'user') {
        if (!text) { s.unreadRecords++; continue; }
        s.userPrompts++;
        s.promptLengths.push(text.length);
        prompts.offer(text, { at: stamp });
        if (isCorrection(text)) {
          s.corrections++;
          corrections.offer(text, { at: stamp });
        }
      } else if (body.role === 'assistant') {
        s.assistantTurns++;
      }
      continue;
    }

    if (CALL_TYPES.has(type)) {
      const name = typeof body.name === 'string' ? body.name : (type === 'local_shell_call' ? 'shell' : 'tool');
      s.toolCalls[name] = (s.toolCalls[name] ?? 0) + 1;
      if (PLANNING_TOOLS.test(name)) s.planningSignals++;
      const command = commandOf(body);
      const kinds = classifyCommand(command);
      for (const kind of kinds) s.commands[kind]++;
      const id = body.call_id ?? body.id ?? rec.call_id ?? null;
      if (id && kinds.includes('test')) pending.set(id, { at: stamp });
      continue;
    }

    if (OUTPUT_TYPES.has(type)) {
      const id = body.call_id ?? body.id ?? rec.call_id ?? null;
      const info = id ? pending.get(id) : null;
      if (!info) continue;
      pending.delete(id);
      const { text, exitCode } = resultOf(body);
      // Exit code passed through as a tri-state: 0 and non-zero are both facts, while
      // null means fall back to reading the output the way every other adapter does.
      s.testRuns.push({
        outcome: classifyOutcome(text, exitCode === null ? undefined : exitCode !== 0),
        at: stamp ?? info.at ?? null,
      });
      continue;
    }
  }

  if (!belongs) return null;
  return {
    sessionId: s.sessionId ?? basename(file, '.jsonl'),
    startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
    endedAt: s.endedAt ? new Date(s.endedAt).toISOString() : null,
    durationMinutes: s.startedAt && s.endedAt ? Math.round((s.endedAt - s.startedAt) / 60000) : null,
    branches: [],
    userPrompts: s.userPrompts,
    promptLength: distribution(s.promptLengths),
    corrections: s.corrections,
    assistantTurns: s.assistantTurns,
    toolCalls: s.toolCalls,
    toolCallTotal: Object.values(s.toolCalls).reduce((a, b) => a + b, 0),
    commands: s.commands,
    testRuns: s.testRuns,
    planningSignals: s.planningSignals,
    malformedLines: s.malformedLines,
    // Records whose shape this adapter did not recognise. Reported rather than absorbed:
    // Codex's format moves, and a team should be able to see that evidence went unread.
    unreadRecords: s.unreadRecords,
    excerpts: { prompts: prompts.result(), corrections: corrections.result() },
  };
}

async function harvestCodex({ isInRepo }) {
  const home = codexHome();
  const roots = SESSION_DIRS.map((d) => join(home, d)).filter((d) => existsSync(d));
  if (!roots.length) {
    return {
      source: source.notHarvested('no Codex sessions directory on this machine (looked in '
        + (process.env.CODEX_HOME ? '$CODEX_HOME' : '~/.codex') + ')'),
      sessions: [],
    };
  }
  // Keyed by file name: archiving moves a rollout from sessions/<date>/ to
  // archived_sessions/ under the same name, and one caught mid-move must not count twice.
  // Not keyed by session id, which a forked or resumed session can share with its parent.
  const byName = new Map();
  try {
    for (const root of roots) {
      if (!statSync(root).isDirectory()) continue;
      for (const f of sessionFiles(root)) if (!byName.has(basename(f))) byName.set(basename(f), f);
    }
  } catch (err) {
    return { source: source.notHarvested('could not list sessions: ' + err.message), sessions: [] };
  }
  const files = [...byName.values()];
  if (!files.length) {
    return { source: source.empty('no Codex session files on this machine'), sessions: [] };
  }

  const sessions = [];
  const failures = [];
  for (const f of files) {
    try {
      const s = await readSession(f, isInRepo);
      if (s) sessions.push(s);
    } catch (err) {
      failures.push({ file: basename(f), error: err.message });
    }
  }
  if (!sessions.length) {
    return {
      source: source.empty('Codex sessions exist on this machine but none belong to this repo',
        { filesScanned: files.length, failures }),
      sessions: [],
    };
  }
  return {
    source: source.harvested({
      filesScanned: files.length, sessionsMatched: sessions.length, failures,
    }),
    sessions,
  };
}
return { sessionFiles, harvestCodex };
})();

// ─── lib/harvest/adapters/copilot.mjs ────────────────────────────────────────────────
const __m4 = (() => {
const { createReadStream, existsSync, readdirSync, statSync } = __node_fs;
const { createInterface } = __node_readline;
const { basename, join } = __node_path;
const { homedir, platform } = __node_os;
const { MAX_LINE_BYTES, classifyCommand, classifyOutcome, distribution, editorStorageRoots, excerptCollector, isCorrection, source, workspaceFolderOf } = __m1;
/**
 * copilot.mjs — harvest GitHub Copilot Chat sessions for one repo.
 *
 * Sessions are JSONL (not .json) under
 *   <user-data>/Code/User/workspaceStorage/<hash>/chatSessions/<uuid>.jsonl
 * with a sibling workspace.json mapping the hash to a folder URI.
 *
 * The file is an append-only delta log:
 *   kind 0 - initial session snapshot (v.requests is usually empty)
 *   kind 1 - set the value at key path k
 *   kind 2 - append at key path k  (["requests"] appends requests;
 *                                   ["requests", N, "response"] appends response parts)
 *
 * Two consequences drive this implementation:
 *   1. Sessions get very large (a 210 MB file was observed on a real machine), so lines
 *      are streamed and never accumulated, and an oversized line is counted rather than
 *      parsed — the session is then reported as partial.
 *   2. The same response part is re-emitted as it updates (a terminal command appears
 *      first without output, then again carrying it), so parts are deduplicated by
 *      toolCallId / terminalCommandId with the latest version winning. Without this,
 *      every tool call would be counted several times.
 */

/**
 * Candidate VS Code workspaceStorage roots across platforms and channels.
 *
 * The shared helper finds each channel's `User` directory; this adapter wants the
 * `workspaceStorage` inside it. Cursor keeps its history in the same layout and used to
 * carry its own copy of this lookup — the copies had already drifted over whether to check
 * for a `file:` URI before parsing one.
 */
function userDataRoots() {
  return editorStorageRoots(['Code', 'Code - Insiders', 'VSCodium'], {
    platform: platform(), env: process.env, home: homedir(),
  }).map((user) => join(user, 'workspaceStorage')).filter((p) => existsSync(p));
}

/**
 * Copilot's own names for its planning tools.
 *
 * This adapter counted no planning signals at all, which is not the same as a team that
 * did no planning: `planned-before-building` needs at least one, so every Copilot team was
 * capped at partial credit on it however they worked, and only a journal entry could
 * rescue any of it. The tool ids were already being recorded for `toolCalls` — nothing
 * was reading them for this.
 *
 * Anchored at the end so a planning word buried inside a longer name does not count:
 * `deploy_plan_checker` is not a planning tool, and this kit's rule is that a classifier
 * gets a test for what it must catch *and* what it must not.
 */
// `plan(?:ner)?`, not `planner?` — the latter makes only the final `r` optional and so
// matches "planne" and "planner" while missing the word it was written for.
const PLANNING_TOOLS = /(?:^|[-_/])(?:manage_todo_list|todos?|plan(?:ner)?)$/i;

/** Exported for the classifier test; not part of the harvest contract. */
const isPlanningTool = (toolId) => PLANNING_TOOLS.test(String(toolId ?? ''));

function scanParts(parts, acc) {
  for (const part of parts || []) {
    if (part?.kind !== 'toolInvocationSerialized') continue;
    const tsd = part.toolSpecificData;
    const id = part.toolCallId || tsd?.terminalCommandId;
    const toolId = typeof part.toolId === 'string' ? part.toolId : 'unknown';
    if (id) acc.toolCallIds.set(id, toolId);
    else acc.anonymousToolCalls++;

    if (tsd?.kind !== 'terminal') continue;
    const command = tsd.commandLine?.original ?? tsd.commandLine?.forDisplay;
    if (typeof command !== 'string') continue;
    const kinds = classifyCommand(command);
    // terminalCommandState is an object ({exitCode, timestamp, duration}) and
    // terminalCommandOutput is {text, lineCount} — neither is the plain value the name
    // suggests. The exit code is authoritative; fall back to sniffing the text only when
    // the command had not finished by the time this delta was written.
    const exitCode = tsd.terminalCommandState?.exitCode;
    const isError = typeof exitCode === 'number' ? exitCode !== 0 : undefined;
    const outputText = typeof tsd.terminalCommandOutput === 'string'
      ? tsd.terminalCommandOutput
      : tsd.terminalCommandOutput?.text;
    const outcome = kinds.includes('test') ? classifyOutcome(outputText, isError) : null;
    // Latest write wins: a later delta carries the command's output and final state.
    acc.terminalCommands.set(tsd.terminalCommandId || id, { kinds, outcome });
  }
}

function collectRequests(list, acc) {
  for (const request of list || []) {
    const id = request?.requestId;
    if (id && acc.requestIds.has(id)) { scanParts(request.response, acc); continue; }
    if (id) acc.requestIds.add(id);

    const text = typeof request?.message?.text === 'string' ? request.message.text : '';
    if (text.trim()) {
      acc.promptLengths.push(text.length);
      acc.prompts.offer(text, { at: request.timestamp ?? null });
      if (isCorrection(text)) {
        acc.corrections++;
        acc.correctionExcerpts.offer(text, { at: request.timestamp ?? null });
      }
    }
    if (typeof request?.timestamp === 'number') {
      if (acc.startedAt === null || request.timestamp < acc.startedAt) acc.startedAt = request.timestamp;
      if (acc.endedAt === null || request.timestamp > acc.endedAt) acc.endedAt = request.timestamp;
    }
    const mode = request?.agent?.id || request?.modeInfo?.modeId;
    if (mode) acc.modes[mode] = (acc.modes[mode] ?? 0) + 1;
    if (request?.modelId) acc.models[request.modelId] = (acc.models[request.modelId] ?? 0) + 1;
    scanParts(request.response, acc);
  }
}

async function readSession(file) {
  const acc = {
    sessionId: null, startedAt: null, endedAt: null,
    requestIds: new Set(), promptLengths: [], corrections: 0,
    modes: {}, models: {}, toolCallIds: new Map(), terminalCommands: new Map(),
    anonymousToolCalls: 0, oversizedLines: 0, malformedLines: 0,
    prompts: excerptCollector(6), correctionExcerpts: excerptCollector(6),
  };

  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) { acc.oversizedLines++; continue; }
    let record;
    try { record = JSON.parse(line); } catch { acc.malformedLines++; continue; }

    if (record.kind === 0) {
      if (record.v?.sessionId) acc.sessionId = record.v.sessionId;
      if (typeof record.v?.creationDate === 'number') acc.startedAt = record.v.creationDate;
      collectRequests(record.v?.requests, acc);
      continue;
    }
    const path = Array.isArray(record.k) ? record.k : [];
    if (record.kind === 2 && path.length === 1 && path[0] === 'requests') {
      collectRequests(record.v, acc);
    } else if (path.length === 3 && path[0] === 'requests' && path[2] === 'response') {
      scanParts(record.v, acc);
    }
  }

  const commands = { test: 0, buildOrLint: 0, destructive: 0, other: 0 };
  const testRuns = [];
  for (const { kinds, outcome } of acc.terminalCommands.values()) {
    for (const kind of kinds) commands[kind]++;
    if (outcome) testRuns.push({ outcome, at: null });
  }
  const toolCalls = {};
  let planningSignals = 0;
  for (const toolId of acc.toolCallIds.values()) {
    toolCalls[toolId] = (toolCalls[toolId] ?? 0) + 1;
    if (isPlanningTool(toolId)) planningSignals++;
  }

  return {
    sessionId: acc.sessionId,
    startedAt: acc.startedAt ? new Date(acc.startedAt).toISOString() : null,
    endedAt: acc.endedAt ? new Date(acc.endedAt).toISOString() : null,
    durationMinutes: acc.startedAt && acc.endedAt
      ? Math.round((acc.endedAt - acc.startedAt) / 60000) : null,
    userPrompts: acc.requestIds.size,
    promptLength: distribution(acc.promptLengths),
    corrections: acc.corrections,
    modes: acc.modes,
    models: acc.models,
    toolCalls,
    toolCallTotal: acc.toolCallIds.size + acc.anonymousToolCalls,
    commands,
    testRuns,
    planningSignals,
    partial: acc.oversizedLines > 0,
    oversizedLines: acc.oversizedLines,
    malformedLines: acc.malformedLines,
    excerpts: { prompts: acc.prompts.result(), corrections: acc.correctionExcerpts.result() },
  };
}

async function harvestCopilot({ isInRepo }) {
  const roots = userDataRoots();
  if (!roots.length) {
    return {
      source: source.notHarvested('no VS Code user-data directory found on this machine'),
      sessions: [],
    };
  }

  const files = [];
  let hashesSeen = 0;
  let hashesMatched = 0;
  for (const root of roots) {
    let hashes;
    try { hashes = readdirSync(root); } catch { continue; }
    for (const hash of hashes) {
      const dir = join(root, hash);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      hashesSeen++;
      const folder = workspaceFolderOf(dir);
      if (!folder || !isInRepo(folder)) continue;
      hashesMatched++;
      const sessionDir = join(dir, 'chatSessions');
      if (!existsSync(sessionDir)) continue;
      try {
        for (const file of readdirSync(sessionDir)) {
          if (file.endsWith('.jsonl')) files.push(join(sessionDir, file));
        }
      } catch { /* unreadable session dir — contributes nothing */ }
    }
  }

  if (!hashesMatched) {
    return {
      source: source.empty('no VS Code workspace on this machine maps to this repo', { hashesSeen }),
      sessions: [],
    };
  }
  if (!files.length) {
    return {
      source: source.empty('a VS Code workspace matched but holds no Copilot chat sessions',
        { hashesSeen, hashesMatched }),
      sessions: [],
    };
  }

  const sessions = [];
  const failures = [];
  for (const file of files) {
    try {
      const session = await readSession(file);
      if (session.userPrompts > 0) sessions.push(session);
    } catch (err) {
      // Lost evidence must be visible, not silently absorbed into a lower score.
      failures.push({ file: basename(file), error: err.message });
    }
  }
  if (!sessions.length) {
    return {
      source: source.empty('Copilot session files exist for this repo but contain no requests',
        { hashesSeen, hashesMatched, filesScanned: files.length, failures }),
      sessions: [],
    };
  }
  return {
    source: source.harvested({
      hashesSeen, hashesMatched, filesScanned: files.length,
      sessionsMatched: sessions.length, failures,
    }),
    sessions,
  };
}
return { isPlanningTool, harvestCopilot };
})();

// ─── lib/harvest/adapters/cursor.mjs ─────────────────────────────────────────────────
const __m5 = (() => {
const { existsSync, readdirSync, statSync } = __node_fs;
const { basename, join } = __node_path;
const { homedir, platform } = __node_os;
const { classifyCommand, classifyOutcome, distribution, editorStorageRoots, excerptCollector, isCorrection, source, workspaceFolderOf } = __m1;
/**
 * cursor.mjs — harvest Cursor sessions for one repo.
 *
 * Cursor keeps its chat history in two SQLite databases, and both are needed:
 *
 *   - **Per workspace**: `<user-data>/Cursor/User/workspaceStorage/<hash>/state.vscdb`,
 *     with a sibling `workspace.json` naming the folder. Its `ItemTable` holds
 *     `composer.composerData`, which lists the composer (conversation) ids belonging to
 *     that workspace. This is what attributes a conversation to a repo.
 *   - **Global**: `<user-data>/Cursor/User/globalStorage/state.vscdb`, whose
 *     `cursorDiskKV` table holds the conversations themselves —
 *     `composerData:<composerId>` for the ordered message list, and
 *     `bubbleId:<composerId>:<bubbleId>` for each message.
 *
 * The global database is large — 550 MB with 14,000 messages is an ordinary size, and
 * single messages exceed 2 MB — so nothing is read wholesale. Every query pulls only the
 * few fields this kit scores, via SQLite's own `json_extract`, with the text fields
 * truncated in SQL before they ever reach Node. A full scan of that database costs about
 * 400 ms.
 *
 * Requires `node:sqlite`, which arrived in Node 22.5. On an older runtime this reports
 * not-harvested with the reason, rather than failing the harvest: an unreadable tool
 * must never be scored as a zero.
 */

/** Cursor's tool names for running a terminal command, across versions. */
const TERMINAL_TOOLS = /^(?:run_terminal_cmd|run_terminal_command|terminal|shell)$/i;

/** Tool names that mean the agent was planning rather than editing. */
const PLANNING_TOOLS = /^(?:todo_write|update_todos|create_plan|plan)$/i;

/** How much of a message body SQLite is allowed to hand back. */
const TEXT_CAP = 4000;
const RESULT_CAP = 4000;

/** Bubbles carry a numeric `type`: 1 is the human, 2 is the assistant. */
const HUMAN = 1;
const ASSISTANT = 2;

/** `"command": "<value>"`, matched so it also works on a fragment with no closing quote. */
const COMMAND_FIELD = /"command"\s*:\s*"((?:[^"\\]|\\.)*)/;

/**
 * The command a terminal tool call ran, from an argument blob that may be truncated.
 *
 * The blob is cut to a fixed length inside SQLite, so a long invocation arrives as invalid
 * JSON. Returning null there deleted the run from every counter — not classified, not
 * counted as `other`, and never pushed to `testRuns` — which meant a team's *longest* test
 * command was the one most likely to go unrecorded. The fallback reads the command out of
 * the fragment directly, because `command` is the only field needed here and it survives
 * truncation far more often than the closing brace does.
 */
function commandFrom(rawArgs) {
  if (typeof rawArgs !== 'string' || !rawArgs) return null;
  try {
    const parsed = JSON.parse(rawArgs);
    if (typeof parsed?.command === 'string') return parsed.command;
  } catch { /* truncated mid-JSON — fall through to reading the fragment */ }
  const match = rawArgs.match(COMMAND_FIELD);
  if (!match) return null;
  // Only the escapes a shell command realistically carries. Re-parsing as JSON is not an
  // option: that is the thing that already failed.
  return match[1]
    .replaceAll('\\n', '\n')
    .replaceAll('\\t', '\t')
    .replaceAll('\\"', '"')
    .replaceAll('\\\\', '\\');
}

/**
 * `node:sqlite` is unavailable before Node 22.5 and is still flagged experimental, which
 * prints a warning to stderr on first use. Imported lazily so that neither cost is paid
 * by a harvest on a machine that has never run Cursor.
 */
async function loadSqlite() {
  try {
    const mod = await import('node:sqlite');
    return mod.DatabaseSync ?? null;
  } catch {
    return null;
  }
}

/** Candidate Cursor user-data roots across platforms. */
const userDataRoots = () => editorStorageRoots(['Cursor'], {
  platform: platform(), env: process.env, home: homedir(),
});

/**
 * Open a database read-only.
 *
 * Read-only matters for more than tidiness: Cursor may be running while a team harvests,
 * and opening its live database for writing risks a lock or a migration on someone's
 * actual chat history.
 */
function openDb(Database, path) {
  try {
    return new Database(path, { readOnly: true });
  } catch {
    return null;
  }
}

function jsonValue(db, table, key) {
  try {
    const row = db.prepare('select value from ' + table + ' where key = ?').get(key);
    if (!row || row.value == null) return null;
    return JSON.parse(String(row.value));
  } catch {
    return null;
  }
}

/** The composer ids a workspace database claims, with whatever timing it records. */
function composersOf(db) {
  const data = jsonValue(db, 'ItemTable', 'composer.composerData');
  const all = Array.isArray(data?.allComposers) ? data.allComposers : [];
  return all
    .filter((c) => typeof c?.composerId === 'string')
    .map((c) => ({
      composerId: c.composerId,
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : null,
      lastUpdatedAt: typeof c.lastUpdatedAt === 'number' ? c.lastUpdatedAt : null,
    }));
}

/**
 * Read one conversation into the session shape every adapter in this kit produces.
 *
 * Messages are fetched one at a time by primary key, in the order the conversation header
 * states, because ordering is what makes a fail-then-pass loop visible: a set of test runs
 * with no sequence proves only that tests ran.
 */
function readComposer(global, composer) {
  const header = jsonValue(global, 'cursorDiskKV', 'composerData:' + composer.composerId);
  const ordered = Array.isArray(header?.fullConversationHeadersOnly)
    ? header.fullConversationHeadersOnly : [];
  if (!ordered.length) return null;

  const s = {
    userPrompts: 0, promptLengths: [], corrections: 0, assistantTurns: 0, toolCalls: {},
    commands: { test: 0, buildOrLint: 0, destructive: 0, other: 0 },
    testRuns: [], planningSignals: 0, unreadRecords: 0, humanRejections: 0,
  };
  const prompts = excerptCollector(6);
  const corrections = excerptCollector(6);

  // Only the fields that are scored, truncated inside SQLite. A bubble can exceed 2 MB;
  // parsing whole ones for a 400-character excerpt is how this adapter would run out of
  // memory on a real machine.
  const q = global.prepare(
    'select json_extract(value, ?) as type,'
    + " substr(coalesce(json_extract(value, '$.text'), ''), 1, " + TEXT_CAP + ') as text,'
    + " json_extract(value, '$.toolFormerData.name') as tool,"
    + " substr(coalesce(json_extract(value, '$.toolFormerData.rawArgs'), ''), 1, 2000) as args,"
    + " substr(coalesce(json_extract(value, '$.toolFormerData.result'), ''), 1, " + RESULT_CAP + ') as result,'
    + " json_extract(value, '$.toolFormerData.userDecision') as decision"
    + ' from cursorDiskKV where key = ?'
  );

  for (const entry of ordered) {
    if (typeof entry?.bubbleId !== 'string') continue;
    let row;
    try {
      row = q.get('$.type', 'bubbleId:' + composer.composerId + ':' + entry.bubbleId);
    } catch {
      s.unreadRecords++;
      continue;
    }
    // A header can name a message the database no longer holds — Cursor prunes — and a
    // row can be a shape json_extract returns nothing for.
    if (!row) { s.unreadRecords++; continue; }

    const type = row.type ?? entry.type ?? null;
    const text = typeof row.text === 'string' ? row.text.trim() : '';

    if (type === HUMAN) {
      if (!text) { s.unreadRecords++; continue; }
      s.userPrompts++;
      s.promptLengths.push(text.length);
      prompts.offer(text, { at: null });
      if (isCorrection(text)) {
        s.corrections++;
        corrections.offer(text, { at: null });
      }
      continue;
    }

    if (type === ASSISTANT) {
      if (text) s.assistantTurns++;
      const tool = typeof row.tool === 'string' ? row.tool : null;
      if (!tool) continue;
      s.toolCalls[tool] = (s.toolCalls[tool] ?? 0) + 1;
      if (PLANNING_TOOLS.test(tool)) s.planningSignals++;
      // A human who rejected a proposed tool call read the output and pushed back on it,
      // which is the same act `corrections` counts in prose.
      if (typeof row.decision === 'string' && /reject|deny|cancel/i.test(row.decision)) {
        s.humanRejections++;
      }
      if (!TERMINAL_TOOLS.test(tool)) continue;

      const command = commandFrom(row.args);
      const kinds = classifyCommand(command);
      for (const kind of kinds) s.commands[kind]++;
      if (!kinds.includes('test')) continue;

      let output = '';
      let failed;
      try {
        const parsed = row.result ? JSON.parse(row.result) : null;
        output = typeof parsed?.output === 'string' ? parsed.output : String(row.result ?? '');
        // Cursor records how the command ended rather than an exit code.
        const reason = parsed?.endedReason;
        if (typeof reason === 'string' && /INTERRUPT|TIMEOUT|ERROR/i.test(reason)) failed = true;
      } catch {
        // A result truncated mid-JSON is still readable as text by the outcome classifier.
        output = String(row.result ?? '');
      }
      s.testRuns.push({ outcome: classifyOutcome(output, failed), at: null });
      continue;
    }

    s.unreadRecords++;
  }

  if (!s.userPrompts && !s.assistantTurns) return null;

  const startedAt = composer.createdAt ? new Date(composer.createdAt).toISOString() : null;
  const endedAt = composer.lastUpdatedAt ? new Date(composer.lastUpdatedAt).toISOString() : null;
  return {
    sessionId: composer.composerId,
    startedAt,
    endedAt,
    durationMinutes: composer.createdAt && composer.lastUpdatedAt
      ? Math.round((composer.lastUpdatedAt - composer.createdAt) / 60000) : null,
    branches: [],
    userPrompts: s.userPrompts,
    promptLength: distribution(s.promptLengths),
    // A rejected tool call is a correction that was never typed. Counted alongside the
    // prose ones so a team that steers by clicking "reject" is not recorded as having
    // steered less than one that steers by typing "no, do it the other way".
    corrections: s.corrections + s.humanRejections,
    assistantTurns: s.assistantTurns,
    toolCalls: s.toolCalls,
    toolCallTotal: Object.values(s.toolCalls).reduce((a, b) => a + b, 0),
    commands: s.commands,
    testRuns: s.testRuns,
    planningSignals: s.planningSignals,
    malformedLines: 0,
    unreadRecords: s.unreadRecords,
    excerpts: { prompts: prompts.result(), corrections: corrections.result() },
  };
}

async function harvestCursor({ isInRepo }) {
  const roots = userDataRoots();
  if (!roots.length) {
    return { source: source.notHarvested('no Cursor user-data directory on this machine'), sessions: [] };
  }
  // Workspaces whose folder is inside the repo being scored. Matched from workspace.json
  // alone, before any database is opened, so a machine with Cursor installed but no
  // conversation about this repo never pays the cost — or prints the experimental-feature
  // warning — of loading node:sqlite at all.
  const matched = [];
  let workspacesScanned = 0;
  for (const root of roots) {
    const storage = join(root, 'workspaceStorage');
    if (!existsSync(storage)) continue;
    let dirs;
    try { dirs = readdirSync(storage); } catch { continue; }
    for (const name of dirs) {
      const dir = join(storage, name);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      workspacesScanned++;
      const folder = workspaceFolderOf(dir);
      if (!folder || !isInRepo(folder)) continue;
      const db = join(dir, 'state.vscdb');
      if (existsSync(db)) matched.push({ db, root });
    }
  }
  if (!matched.length) {
    return {
      source: source.empty('no Cursor workspace on this machine points at this repo',
        { workspacesScanned }),
      sessions: [],
    };
  }

  const Database = await loadSqlite();
  if (!Database) {
    return {
      source: source.notHarvested(
        'reading Cursor history needs node:sqlite, which requires Node 22.5 or newer — '
        + 'this is Node ' + process.versions.node
      ),
      sessions: [],
    };
  }

  const sessions = [];
  const failures = [];
  const globals = new Map();

  for (const { db: wsPath, root } of matched) {
    const ws = openDb(Database, wsPath);
    if (!ws) { failures.push({ file: basename(wsPath), error: 'could not open workspace database' }); continue; }
    let composers;
    try {
      composers = composersOf(ws);
    } catch (err) {
      failures.push({ file: basename(wsPath), error: err.message });
      composers = [];
    } finally {
      try { ws.close(); } catch { /* already closed */ }
    }
    if (!composers.length) continue;

    if (!globals.has(root)) {
      const path = join(root, 'globalStorage', 'state.vscdb');
      globals.set(root, existsSync(path) ? openDb(Database, path) : null);
    }
    const global = globals.get(root);
    if (!global) {
      failures.push({ file: 'globalStorage/state.vscdb', error: 'not readable — conversation bodies are stored here' });
      continue;
    }

    for (const composer of composers) {
      try {
        const s = readComposer(global, composer);
        if (s) sessions.push(s);
      } catch (err) {
        failures.push({ file: composer.composerId, error: err.message });
      }
    }
  }
  for (const db of globals.values()) {
    if (db) { try { db.close(); } catch { /* already closed */ } }
  }

  if (!sessions.length) {
    return {
      source: source.empty('Cursor workspaces point at this repo but hold no readable conversations',
        { workspacesScanned, workspacesMatched: matched.length, failures }),
      sessions: [],
    };
  }
  return {
    source: source.harvested({
      workspacesScanned, workspacesMatched: matched.length,
      sessionsMatched: sessions.length, failures,
    }),
    sessions,
  };
}
return { commandFrom, harvestCursor };
})();

// ─── lib/harvest/history.mjs ─────────────────────────────────────────────────────────
const __m6 = (() => {
const { execFileSync } = __node_child_process;
const { realpathSync } = __node_fs;
const { basename, resolve } = __node_path;
const { userInfo } = __node_os;
const { harvestClaudeCode } = __m2;
const { harvestCodex } = __m3;
const { harvestCopilot } = __m4;
const { harvestCursor } = __m5;
const { makeIsInRepo } = __m1;
/**
 * history.mjs — read one person's AI chat history for one repository.
 *
 * This is the only part of a harvest that has to happen on a participant's own machine:
 * transcripts live in their home directory, never in the repo. Everything else — files,
 * git history — a facilitator can read from the pushed repository. So the participant-side
 * command runs this and nothing else, and it is kept free of the repo harvester so it can
 * be bundled into one small downloadable file (see scripts/build-collector.mjs).
 */

/** Same contract as evidence.json's `chat` block, so merge.mjs can union it unchanged. */
const HISTORY_SCHEMA_VERSION = 3;

/** Where a history file goes, relative to the repository root. */
const HISTORY_DIR = '.vibecheck';
const HISTORY_PREFIX = 'history-';

/**
 * Does a recorded working directory belong to this repository — by either spelling?
 *
 * The root comes from `git rev-parse --show-toplevel`, which resolves symlinks, while an AI
 * tool records whatever path the person had open. On macOS `/var` is itself a symlink to
 * `/private/var`, and a project reached through a symlinked folder is common anywhere. A
 * plain comparison would find nothing and report a team as having no history. So both the
 * root and the recorded path are also compared in their resolved form.
 */
function repoMatcher(repo) {
  const roots = [resolve(repo)];
  try {
    const real = realpathSync.native(repo);
    if (!roots.includes(real)) roots.push(real);
  } catch { /* the folder is gone; the given spelling is all there is */ }
  const checks = roots.map((root) => makeIsInRepo(root));
  return (candidate) => {
    if (checks.some((inRepo) => inRepo(candidate))) return true;
    if (typeof candidate !== 'string' || !candidate) return false;
    let real;
    try { real = realpathSync.native(candidate); } catch { return false; }
    return checks.some((inRepo) => inRepo(real));
  };
}

/** Every chat adapter, run concurrently: they share nothing but the repo to match against. */
async function harvestChat(repo) {
  const isInRepo = repoMatcher(repo);
  const [claudeCode, copilot, codex, cursor] = await Promise.all([
    harvestClaudeCode({ isInRepo }),
    harvestCopilot({ isInRepo }),
    harvestCodex({ isInRepo }),
    harvestCursor({ isInRepo }),
  ]);
  return { claudeCode, copilot, codex, cursor };
}

/**
 * The repository root for a path, so running from `src/` still matches sessions started at
 * the root. Falls back to the path itself: a folder that is not a git repo is still a
 * folder people worked in.
 */
function repoRootOf(path) {
  const start = resolve(path);
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: start, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (top) return realpathSync.native(top);
  } catch { /* not a git repo, or no git — the folder given is the root */ }
  return start;
}

/** Who is at this keyboard, for the filename only. Never used for scoring. */
function whoAmI(repo) {
  try {
    const name = execFileSync('git', ['config', 'user.name'],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (name) return name;
  } catch { /* no git, or no name configured — the OS user will do */ }
  try { return userInfo().username; } catch { return 'member'; }
}

/** A filename-safe slug. */
function slug(text) {
  return String(text ?? '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** `.vibecheck/history-<person>.json`, one per person so teammates never conflict on merge. */
function historyFileName(member) {
  return HISTORY_PREFIX + (slug(member) || 'member') + '.json';
}

/**
 * One person's history for one repository, in the shape merge.mjs reads.
 *
 * Deliberately carries no repository state, no test output and no local paths: those come
 * from the pushed repo on the facilitator's side, and a path on a laptop is not something
 * that belongs in a file committed to a shared repository.
 */
async function collectHistory(repoPath, { member } = {}) {
  const repo = resolve(repoPath);
  const groups = await harvestChat(repo);
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    kind: 'history',
    harvestedAt: new Date().toISOString(),
    member: member ?? null,
    repo: { name: basename(repo) },
    sources: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, g.source])),
    chat: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, g.sessions])),
  };
}
return { HISTORY_SCHEMA_VERSION, HISTORY_DIR, HISTORY_PREFIX, repoMatcher, harvestChat, repoRootOf, whoAmI, slug, historyFileName, collectHistory };
})();

// ─── lib/camp/submission.mjs ─────────────────────────────────────────────────────────
const __m7 = (() => {
const { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync } = __node_fs;
const { join, relative } = __node_path;
const { inflateSync } = __node_zlib;
/**
 * submission.mjs — find a team's proposal deck and SDLC diagram, and count the deck's pages.
 *
 * Shared by the participant's pre-flight (bundled into dist/collect-history.mjs, so node:
 * built-ins only) and the facilitator's prepare step, so both say the same thing about
 * the same repository: a team told "found" on the day before must not be scored "missing".
 *
 * Only PDFs and PNG/JPEG images are ever read. A PowerPoint file is *reported* — so a team
 * can be warned it will not be read — and never opened.
 */

/** Where a deck is expected unless an event says otherwise. */
const DEFAULT_DECK_PATH = 'submission/proposal.pdf';

/**
 * Where the SDLC diagram is expected, as its own image. A diagram on its own is read far
 * more reliably than one found among ten slides, so it is the primary source; the deck's
 * diagram slide is the fallback.
 */
const DIAGRAM_PATHS = ['submission/sdlc-diagram.png', 'submission/sdlc-diagram.jpg', 'submission/sdlc-diagram.jpeg'];

const SKIP = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.venv', 'venv',
  '__pycache__', 'target', 'vendor', '.vibecheck', '.idea', '.gradle', 'obj',
]);

/** Every PDF, PowerPoint and PNG/JPEG file in the repository, as repo-relative paths. */
function listCandidates(repo, maxEntries = 20000) {
  const pdf = [];
  const pptx = [];
  const images = [];
  const stack = [repo];
  let seen = 0;
  while (stack.length && seen < maxEntries) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (++seen >= maxEntries) break;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(repo, full).split('\\').join('/');
      if (/\.pdf$/i.test(entry.name)) pdf.push(rel);
      else if (/\.pptx?$/i.test(entry.name)) pptx.push(rel);
      else if (/\.(?:png|jpe?g)$/i.test(entry.name)) images.push(rel);
    }
  }
  return { pdf: pdf.sort(), pptx: pptx.sort(), images: images.sort() };
}

/** Higher is more likely to be the deck. Name first, then where it sits, then how deep. */
function deckLikelihood(rel) {
  let score = 0;
  if (DECK_WORD.test(rel)) score += 4;
  if (/^submission\//i.test(rel)) score += 2;
  else if (/^docs?\//i.test(rel)) score += 1;
  return score * 100 - rel.split('/').length;
}

/**
 * PDFs that are something other than the team's deck: the client's brief or spec a team
 * kept for reference, or the diagram exported on its own. Guessing one of those as the
 * deck would have a judge score the client's own document as the team's proposal.
 */
const NOT_A_DECK = /brief|spec(?:ification)?s?\b|requirements?|zahtev|sdlc|diagram/i;

/** Words that say "this is the offer", which win over NOT_A_DECK ("AI SDLC Proposal.pdf"). */
const DECK_WORD = /proposal|deck|pitch|presentation|offer|ponuda|prezentacija/i;

const notADeck = (rel) => { const name = rel.split('/').pop(); return NOT_A_DECK.test(name) && !DECK_WORD.test(name); };

/** A regular file — never a symlink, which could point anywhere on this machine. */
function isRegularFile(path) {
  try { return lstatSync(path).isFile(); } catch { return false; }
}

/** The first bytes of a file, as latin1 text. */
function head(path, n = 64) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(n);
    const read = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read).toString('latin1');
  } catch { return ''; } finally { if (fd !== undefined) closeSync(fd); }
}

/** Git LFS checks out a small text pointer when git-lfs is not installed. */
const LFS_POINTER = /^version https:\/\/git-lfs\.github\.com\/spec/;

/** `ok`, `lfs-pointer` or `not-a-pdf`, from the file's first bytes. */
function pdfState(path) {
  // The PDF header may follow a few bytes of junk (a byte-order mark, a stray line from a
  // writer); readers accept it within the first kilobyte, so this does too.
  const start = head(path, 1024);
  if (start.includes('%PDF-')) return 'ok';
  return LFS_POINTER.test(start) ? 'lfs-pointer' : 'not-a-pdf';
}

/**
 * Where the team's deck is, if anywhere.
 *
 * @returns {{status: 'found'|'misplaced'|'pptx-only'|'missing'|'lfs-pointer'|'not-a-pdf',
 *            path: string|null, bytes: number|null, otherPdfs: string[], pptx: string[]}}
 *   `misplaced` means the expected path is empty but a PDF exists elsewhere; `path` is the
 *   likeliest candidate. `pptx-only` means no PDF at all but a PowerPoint file — which is
 *   still no proposal, because a PPTX is not read. `lfs-pointer` and `not-a-pdf` mean the
 *   file is there but is not a readable PDF: something a facilitator can fix (`git lfs
 *   pull`) before judging, never something to score as missing. Symlinks are ignored.
 */
function findDeck(repo, deckPath = DEFAULT_DECK_PATH) {
  const { pdf, pptx } = listCandidates(repo);
  const size = (rel) => { try { return lstatSync(join(repo, rel)).size; } catch { return null; } };
  if (isRegularFile(join(repo, deckPath))) {
    const state = pdfState(join(repo, deckPath));
    return {
      status: state === 'ok' ? 'found' : state, path: deckPath, bytes: size(deckPath),
      otherPdfs: pdf.filter((p) => p !== deckPath), pptx,
    };
  }
  const candidates = pdf.filter((p) => !notADeck(p) && pdfState(join(repo, p)) === 'ok');
  if (candidates.length) {
    const ranked = [...candidates].sort((a, b) => deckLikelihood(b) - deckLikelihood(a) || a.localeCompare(b));
    return {
      status: 'misplaced', path: ranked[0], bytes: size(ranked[0]),
      otherPdfs: pdf.filter((p) => p !== ranked[0]), pptx,
    };
  }
  return { status: pptx.length ? 'pptx-only' : 'missing', path: null, bytes: null, otherPdfs: pdf, pptx };
}

/** `png`, `jpg` or null, from the file's bytes — whatever the file is called. */
function imageFormat(path) {
  const start = Buffer.from(head(path, 4), 'latin1');
  if (start[0] === 0x89 && start[1] === 0x50 && start[2] === 0x4e && start[3] === 0x47) return 'png';
  if (start[0] === 0xff && start[1] === 0xd8) return 'jpg';
  return null;
}
const isImage = (path) => imageFormat(path) !== null;

/**
 * Where the team's SDLC diagram image is, if anywhere.
 *
 * `misplaced` is a PNG/JPEG elsewhere whose name says it is the diagram. Screenshots and
 * logos are never guessed at, wherever they sit: a wrong guess would have a judge score
 * the wrong picture, and the deck's diagram slide is the fallback. A file at the expected
 * path that is not a real image (a Git LFS pointer, a renamed file) is `lfs-pointer` /
 * `not-an-image`: something to fix before judging, never a reason to fall back.
 *
 * @returns {{status: 'found'|'misplaced'|'missing'|'lfs-pointer'|'not-an-image',
 *            path: string|null, format: 'png'|'jpg'|null, bytes: number|null, notAnImage: string[]}}
 */
function findDiagram(repo, expected = DIAGRAM_PATHS) {
  const { images } = listCandidates(repo);
  const size = (rel) => { try { return lstatSync(join(repo, rel)).size; } catch { return null; } };
  const present = expected.filter((p) => isRegularFile(join(repo, p)));
  const real = present.find((p) => isImage(join(repo, p)));
  if (real) return { status: 'found', path: real, format: imageFormat(join(repo, real)), bytes: size(real), notAnImage: [] };
  if (present.length) {
    const lfs = present.some((p) => LFS_POINTER.test(head(join(repo, p))));
    return { status: lfs ? 'lfs-pointer' : 'not-an-image', path: present[0], format: null, bytes: size(present[0]), notAnImage: present };
  }
  const notAnImage = [];
  const named = images
    .filter((p) => /sdlc|diagram|lifecycle|workflow/i.test(p.split('/').pop()))
    .sort((a, b) => Number(/^submission\//i.test(b)) - Number(/^submission\//i.test(a))
      || Number(/sdlc/i.test(b)) - Number(/sdlc/i.test(a)) || a.localeCompare(b))
    .find((p) => { if (isImage(join(repo, p))) return true; notAnImage.push(p); return false; });
  if (named) return { status: 'misplaced', path: named, format: imageFormat(join(repo, named)), bytes: size(named), notAnImage };
  return { status: 'missing', path: null, format: null, bytes: null, notAnImage };
}

/** The innermost `<< … >>` dictionaries in a chunk of PDF text. */
const DICT = /<<((?:(?!<<|>>)[\s\S])*)>>/g;

/**
 * Number of pages in a PDF, or null when it cannot be told.
 *
 * No dependencies, so no real PDF parser: the page tree's root `/Type /Pages` dictionary
 * carries the total as `/Count`, and the largest Count is the root's. Modern writers hide
 * those dictionaries inside compressed object streams, so every `/ObjStm` stream is
 * inflated and searched too. When no page tree is found, individual `/Type /Page` objects
 * are counted instead.
 */
function pdfPageCount(bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes.toString('latin1') : String(bytes);
  if (!raw.slice(0, 1024).includes('%PDF-')) return null;
  const texts = [raw];
  const STREAM = /<<((?:(?!stream)[\s\S]){0,2000}?)>>\s*stream\r?\n/g;
  let m;
  while ((m = STREAM.exec(raw))) {
    if (!/\/Type\s*\/ObjStm\b/.test(m[1]) || !/\/FlateDecode\b/.test(m[1])) continue;
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    try { texts.push(inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1')); } catch {
      // Trailing whitespace before `endstream` is legal and upsets zlib; retry without it.
      try {
        texts.push(inflateSync(Buffer.from(raw.slice(start, end).replace(/\s+$/, ''), 'latin1')).toString('latin1'));
      } catch { /* an unreadable stream contributes nothing */ }
    }
  }
  // A PDF saved incrementally appends new versions of changed objects; the last definition
  // of each numbered object is the live one. Taking the largest /Count over all versions
  // counted pages the team had since deleted.
  const latest = new Map();
  const OBJ = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj\b/g;
  let o;
  while ((o = OBJ.exec(raw))) latest.set(o[1] + ' ' + o[2], o[3]);
  let root = 0;
  let pages = 0;
  const scan = (text) => {
    for (const d of text.matchAll(DICT)) {
      if (/\/Type\s*\/Pages\b/.test(d[1])) {
        const count = d[1].match(/\/Count\s+(\d+)/);
        if (count) root = Math.max(root, Number(count[1]));
      } else if (/\/Type\s*\/Page(?![A-Za-z])/.test(d[1])) {
        pages++;
      }
    }
  };
  for (const body of latest.values()) scan(body.replace(/stream[\s\S]*?endstream/g, ''));
  for (const text of texts.slice(1)) scan(text);
  if (!latest.size) scan(raw);
  return root || pages || null;
}

/** Page count of a PDF on disk; null when it is missing, unreadable or not a PDF. */
function pdfPageCountOf(path) {
  try { return pdfPageCount(readFileSync(path)); } catch { return null; }
}
return { DEFAULT_DECK_PATH, DIAGRAM_PATHS, findDeck, imageFormat, findDiagram, pdfPageCount, pdfPageCountOf };
})();

// ─── bin/collect-history.mjs ─────────────────────────────────────────────────────────
const { execFileSync } = __node_child_process;
const { mkdirSync, writeFileSync } = __node_fs;
const { join, relative } = __node_path;
const { HISTORY_DIR, collectHistory, historyFileName, repoRootOf, whoAmI } = __m6;
const { DEFAULT_DECK_PATH, DIAGRAM_PATHS, findDeck, findDiagram } = __m7;
/**
 * collect-history — the one thing a participant runs.
 *
 * Reads this person's AI chat history for the project they are standing in, and writes it
 * into the project as `.vibecheck/history-<name>.json`. They commit and push it with the
 * rest of their work; a facilitator pulls the repository and scores it from there.
 *
 * No team name, no kit checkout, nothing executed from the project, nothing uploaded. The
 * same source is bundled into `dist/collect-history.mjs` so it can be handed out as a
 * single file — see scripts/build-collector.mjs.
 *
 *   node collect-history.mjs            # the project in the current folder
 *   node collect-history.mjs ../app     # a project somewhere else
 */

const TOOLS = [
  ['claudeCode', 'Claude Code'],
  ['codex', 'Codex'],
  ['copilot', 'Copilot (VS Code)'],
  ['cursor', 'Cursor'],
];

function help() {
  console.log(`Usage: node collect-history.mjs [project folder]

Reads your AI chat history for this project and saves a summary of it into the project
as ${HISTORY_DIR}/history-<your name>.json. Commit and push that file with your work.

Reads: Claude Code (CLI, VS Code / JetBrains extension, Code tab in Claude Desktop),
Codex (CLI, desktop app, VS Code extension — including archived sessions and $CODEX_HOME),
GitHub Copilot in VS Code, and Cursor. Browser chats (ChatGPT, claude.ai, Codex on the
web) live on a server, not on this laptop, and cannot be read.

What the file contains: per chat session, counts (prompts, tool calls, test runs and
whether they passed, corrections, planning steps), timestamps, branch names, and a few
of your prompts cut to 280 characters (at most 12 per session, plus up to 12 where you
corrected the AI), with anything that looks like a key or password replaced by
[redacted]. Never full conversations and never your code. Open the file and read it
before you commit it — it will be visible to anyone who can see your repository.

Run it from the folder you worked in with your AI tool: sessions are matched by folder.`);
}

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) { help(); process.exit(0); }
const unknown = args.filter((a) => a.startsWith('-'));
if (unknown.length || args.length > 1) {
  console.error('Unknown arguments: ' + args.join(' ') + '\n');
  help();
  process.exit(1);
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error('This needs Node 20 or newer; this is Node ' + process.versions.node + '.');
  process.exit(1);
}

const root = repoRootOf(args[0] ?? process.cwd());
const member = whoAmI(root);
const history = await collectHistory(root, { member });

const dir = join(root, HISTORY_DIR);
mkdirSync(dir, { recursive: true });
const file = join(dir, historyFileName(member));
writeFileSync(file, JSON.stringify(history, null, 2) + '\n', 'utf8');

console.log('Project: ' + root);
console.log('You:     ' + member + '\n');
let sessions = 0;
let prompts = 0;
for (const [key, label] of TOOLS) {
  const src = history.sources[key];
  const list = history.chat[key];
  const n = list.reduce((sum, s) => sum + (s.userPrompts ?? 0), 0);
  sessions += list.length;
  prompts += n;
  const found = src.status === 'harvested'
    ? list.length + ' session(s), ' + n + ' prompt(s)'
    : '—  ' + (src.reason ?? src.status);
  console.log('  ' + label.padEnd(20) + found);
}

console.log('\nSaved ' + sessions + ' session(s) and ' + prompts + ' prompt(s) to:\n  ' + file);

if (!sessions) {
  console.log(`
Nothing was found for this folder. Check that:
  - you ran this in the folder you opened in your AI tool (or pass that folder as an argument)
  - you used Claude Code, Codex (app, extension or CLI), Copilot in VS Code or Cursor on
    this machine (browser chats such as ChatGPT or claude.ai cannot be read)
Commit the file anyway — it tells us you ran it.`);
}

// Pre-flight for the deck, because the evaluator reads one path and one format. Told here,
// the day before, a team can still fix it; told at scoring time, it is a zero.
const deck = findDeck(root);
console.log('\nProposal deck:');
if (deck.status === 'found') {
  console.log('  ' + DEFAULT_DECK_PATH + ' found (' + Math.round(deck.bytes / 1024) + ' KB). Make sure it is committed.');
} else if (deck.status === 'misplaced') {
  console.log('  ' + DEFAULT_DECK_PATH + ' is MISSING. A PDF was found at ' + deck.path + ' —');
  console.log('  move it to ' + DEFAULT_DECK_PATH + ' so the evaluator finds it where it looks.');
} else if (deck.status === 'pptx-only') {
  console.log('  WARNING: only a PowerPoint file was found (' + deck.pptx.join(', ') + ').');
  console.log('  A .pptx is NOT read. Export it to PDF (File → Export → PDF) and commit it as');
  console.log('  ' + DEFAULT_DECK_PATH + ', or your proposal scores as missing.');
} else if (deck.status === 'lfs-pointer') {
  console.log('  WARNING: ' + deck.path + ' is stored with Git LFS and cannot be read by the evaluator.');
  console.log('  Commit the PDF as a normal file: git lfs untrack "*.pdf", then add and commit it again.');
} else if (deck.status === 'not-a-pdf') {
  console.log('  WARNING: ' + deck.path + ' is not a valid PDF. Export the deck to PDF again.');
} else {
  console.log('  ' + DEFAULT_DECK_PATH + ' not found yet. Export your deck to PDF and commit it there');
  console.log('  before the deadline (if your event asks for a deck).');
  if (deck.otherPdfs.length) console.log('  (Other PDFs found, not taken as the deck: ' + deck.otherPdfs.join(', ') + ')');
}
if (deck.bytes && deck.bytes > 20 * 1024 * 1024) {
  console.log('  WARNING: the deck is ' + Math.round(deck.bytes / 1048576) + ' MB — keep it under 20 MB (File → Reduce File Size).');
}

const diagram = findDiagram(root);
console.log('\nSDLC diagram:');
if (diagram.status === 'found') {
  console.log('  ' + diagram.path + ' found. Make sure it is committed.');
} else if (diagram.status === 'misplaced') {
  console.log('  ' + DIAGRAM_PATHS[0] + ' is MISSING. An image was found at ' + diagram.path + ' —');
  console.log('  move it to ' + DIAGRAM_PATHS[0] + ' (or .jpg) so the evaluator reads it first.');
} else if (diagram.status === 'lfs-pointer' || diagram.status === 'not-an-image') {
  console.log('  WARNING: ' + diagram.path + ' is not a readable PNG/JPEG'
    + (diagram.status === 'lfs-pointer' ? ' (stored with Git LFS — commit it as a normal file)' : ' — export it again') + '.');
} else {
  console.log('  ' + DIAGRAM_PATHS[0] + ' (or .jpg) not found yet. Export the diagram as an image');
  console.log('  and commit it there; without it, the evaluator looks for it in your deck.');
}
for (const bad of diagram.status === 'misplaced' ? diagram.notAnImage : []) {
  console.log('  WARNING: ' + bad + ' is not really a PNG/JPEG — export it again as one.');
}

// A team that ignores .vibecheck/ would push nothing and never know why.
let ignored = false;
try {
  execFileSync('git', ['check-ignore', '-q', relative(root, file)], { cwd: root, stdio: 'ignore' });
  ignored = true;
} catch { /* exit 1 means not ignored; no git means nothing to check */ }

const rel = relative(root, file).split('\\').join('/');
console.log('\nNext, commit and push it with your work:');
console.log('  git add ' + (ignored ? '-f ' : '') + rel);
console.log('  git commit -m "Add AI history for ' + member.replace(/"/g, '') + '"');
console.log('  git push');
if (ignored) {
  console.log('\nNote: your .gitignore ignores this file, so the add above uses -f.');
}
