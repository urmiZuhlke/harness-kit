/**
 * codex.mjs — harvest Codex CLI (ChatGPT/Codex) sessions for one repo.
 *
 * Sessions are JSONL under ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<stamp>-<id>.jsonl.
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
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import {
  classifyCommand, classifyOutcome, distribution, excerptCollector, isCorrection, source,
} from '../shared.mjs';

const sessionsRoot = () => join(homedir(), '.codex', 'sessions');

/** Codex's own plan tool, plus the names its harness has used for the same thing. */
const PLANNING_TOOLS = /^(?:update_plan|plan|todo|todos|manage_todo_list)$/i;

/** Walk a date-partitioned tree and collect every session file. */
function sessionFiles(root, maxFiles = 4000) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.jsonl')) out.push(full);
      if (out.length >= maxFiles) break;
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

export async function harvestCodex({ isInRepo }) {
  const root = sessionsRoot();
  if (!existsSync(root)) {
    return {
      source: source.notHarvested('no ~/.codex/sessions directory on this machine'),
      sessions: [],
    };
  }
  let files;
  try {
    if (!statSync(root).isDirectory()) {
      return { source: source.notHarvested('~/.codex/sessions is not a directory'), sessions: [] };
    }
    files = sessionFiles(root);
  } catch (err) {
    return { source: source.notHarvested('could not list sessions: ' + err.message), sessions: [] };
  }
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
