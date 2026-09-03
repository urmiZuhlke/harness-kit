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
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir, platform } from 'node:os';
import {
  classifyCommand, classifyOutcome, distribution, editorStorageRoots, excerptCollector,
  isCorrection, source, workspaceFolderOf,
} from '../shared.mjs';

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
export function commandFrom(rawArgs) {
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

export async function harvestCursor({ isInRepo }) {
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
