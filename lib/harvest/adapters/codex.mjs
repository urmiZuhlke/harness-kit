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
 * The IDE extension records the folder VS Code has open, which is often the workspace ABOVE
 * the repository (a camp folder holding the team's clone). Such a session is the repo's
 * only on evidence it worked there: a request that names a path under the repository, or a
 * tool call whose working directory is inside it. Open editor tabs in the IDE context are
 * not evidence — another project's tabs can be open in the same window.
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
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import {
  classifyCommand, classifyOutcome, distribution, excerptCollector, isCorrection, source,
} from '../shared.mjs';

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
export function sessionFiles(root, maxFiles = 4000) {
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

/**
 * What the person actually asked, from a user message.
 *
 * Codex injects a setup message (plugin recommendations and environment context) as a user
 * turn, and the VS Code extension prefixes every request with the IDE context — open tabs,
 * the active file — ending in `## My request:`. Counted as typed, the first makes a person
 * look chattier and the second makes every prompt look like a pasted specification, which
 * is exactly the one-giant-prompt signal the working-method criteria penalise.
 */
export function userRequestOf(text) {
  const t = String(text ?? '').trim();
  if (/^<recommended_plugins>[\s\S]*<\/recommended_plugins>\s*(?:<environment_context>[\s\S]*<\/environment_context>)?$/.test(t)
    || /^<environment_context>[\s\S]*<\/environment_context>$/.test(t)) return '';
  const marker = '## My request:';
  const at = t.lastIndexOf(marker);
  return at >= 0 ? t.slice(at + marker.length).trim() : t;
}

/** Every working directory a tool call states, whether its arguments are JSON or source. */
function workdirsOf(body) {
  let args = body.arguments ?? body.action ?? body.input ?? null;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch {
      // Some tools record JavaScript source rather than JSON; the workdir is still stated.
      return [...args.matchAll(/\bworkdir\s*:\s*(["'`])([^"'`]+)\1/g)].map((m) => m[2]);
    }
  }
  return args && typeof args === 'object' && typeof args.workdir === 'string' ? [args.workdir] : [];
}

/** True when `request` names a path under the repo, as seen from the workspace above it. */
function namesRepoPath(request, repoRel) {
  const escaped = repoRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^A-Za-z0-9_.-])' + escaped + '/').test(request.replaceAll('\\', '/').normalize('NFC'));
}

const CALL_TYPES = new Set([
  'function_call', 'local_shell_call', 'custom_tool_call', 'tool_call', 'shell_call',
]);
const OUTPUT_TYPES = new Set([
  'function_call_output', 'local_shell_call_output', 'custom_tool_call_output',
  'tool_call_output', 'shell_call_output',
]);

async function readSession(file, isInRepo, repoFrom) {
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
  // Set when the session started in a folder that contains the repo: the repo's path from
  // there, until evidence in the session shows it worked on the repo.
  let repoRel = null;

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
        if (!belongs) repoRel = repoFrom?.(cwd) ?? null;
        if (!belongs && !repoRel) { rl.close(); break; }
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

    if (!belongs && repoRel) {
      if (type === 'message' && body.role === 'user') {
        belongs = namesRepoPath(userRequestOf(textOf(body.content ?? body.text ?? '')), repoRel);
      } else if (CALL_TYPES.has(type)) {
        belongs = workdirsOf(body).some((dir) => isInRepo(dir));
      }
    }

    if (type === 'message') {
      const raw = textOf(body.content ?? body.text ?? '').trim();
      if (body.role === 'user') {
        if (!raw) { s.unreadRecords++; continue; }
        const text = userRequestOf(raw);
        // An injected setup message is nobody's prompt.
        if (!text) continue;
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

export async function harvestCodex({ isInRepo, repoFrom = null }) {
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
      const s = await readSession(f, isInRepo, repoFrom);
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
