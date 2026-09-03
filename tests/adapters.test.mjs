/**
 * Codex and Cursor transcript adapters.
 *
 * Both are built against formats this kit does not control and cannot pin: Codex has
 * shipped several record layouts, and Cursor's storage is an implementation detail of a
 * closed editor. So the assertions here are deliberately about *behaviour under variation*
 * — a record shape that moved, a field that vanished, a body that is too big to parse —
 * because the failure mode that matters is silent. An adapter that quietly reads nothing
 * does not throw; it just removes a team's evidence and lowers their score for using the
 * wrong editor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { harvestCodex } from '../lib/harvest/adapters/codex.mjs';
import { harvestCursor } from '../lib/harvest/adapters/cursor.mjs';
import { makeIsInRepo } from '../lib/harvest/shared.mjs';

// --- Codex ----------------------------------------------------------------------------
//
// The adapter reads ~/.codex/sessions, so these exercise readSession through the exported
// entry point by pointing HOME at a temporary tree.

function codexHome(lines, { dated = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'hk-codex-'));
  const dir = dated
    ? join(home, '.codex', 'sessions', '2026', '09', '03')
    : join(home, '.codex', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rollout-2026-09-03T09-00-00-abc.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return home;
}

/**
 * Point every path the adapters consult at a temporary home.
 *
 * APPDATA and XDG_CONFIG_HOME matter as much as HOME: the Cursor adapter reads APPDATA
 * first on Windows, so a test that redirected only HOME quietly read the developer's own
 * Cursor history and passed for the wrong reason.
 */
async function withHome(home, fn) {
  const keys = ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME'];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.APPDATA = join(home, 'AppData', 'Roaming');
  process.env.XDG_CONFIG_HOME = join(home, '.config');
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

const REPO = process.platform === 'win32' ? 'C:\\work\\app' : '/work/app';

test('a Codex session is read for prompts, tool calls and test outcomes', async () => {
  const home = codexHome([
    { timestamp: '2026-09-03T09:00:00Z', type: 'session_meta', payload: { id: 'sess-1', cwd: REPO } },
    { timestamp: '2026-09-03T09:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Add a booking conflict check to the service layer.' }] } },
    { timestamp: '2026-09-03T09:02:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Doing that now.' }] } },
    { timestamp: '2026-09-03T09:03:00Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) } },
    { timestamp: '2026-09-03T09:04:00Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: '2 failing', metadata: { exit_code: 1 } }) } },
    { timestamp: '2026-09-03T09:05:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'No, that is wrong — the check must run inside the transaction.' }] } },
    { timestamp: '2026-09-03T09:06:00Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c2', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) } },
    { timestamp: '2026-09-03T09:07:00Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'c2', output: JSON.stringify({ output: 'all good', metadata: { exit_code: 0 } }) } },
  ]);
  await withHome(home, async () => {
    const r = await harvestCodex({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.source.status, 'harvested');
    assert.equal(r.sessions.length, 1);
    const s = r.sessions[0];
    assert.equal(s.sessionId, 'sess-1');
    assert.equal(s.userPrompts, 2);
    assert.equal(s.assistantTurns, 1);
    assert.equal(s.corrections, 1, '"No, that is wrong" is a correcting turn');
    assert.equal(s.commands.test, 2);
    assert.deepEqual(s.testRuns.map((t) => t.outcome), ['fail', 'pass']);
    assert.equal(s.startedAt, '2026-09-03T09:00:00.000Z');
  });
});

test('a shell wrapper is not mistaken for the command it runs', async () => {
  // ["bash", "-lc", "npm test"] classified whole reads as a `bash` invocation, and the
  // test run disappears from the verification dimension.
  const home = codexHome([
    { type: 'session_meta', payload: { cwd: REPO } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'pytest -q'] }) } },
  ]);
  await withHome(home, async () => {
    const [s] = (await harvestCodex({ isInRepo: makeIsInRepo(REPO) })).sessions;
    assert.equal(s.commands.test, 1);
  });
});

test('a Codex record with the fields at the top level reads the same as a wrapped one', async () => {
  // Older rollouts are not `payload`-wrapped. Reading only the new shape harvests nothing
  // from them, silently.
  const home = codexHome([
    { type: 'session_meta', cwd: REPO, id: 'flat-1' },
    { type: 'message', role: 'user', content: 'Explain the release job.' },
  ]);
  await withHome(home, async () => {
    const [s] = (await harvestCodex({ isInRepo: makeIsInRepo(REPO) })).sessions;
    assert.equal(s.sessionId, 'flat-1');
    assert.equal(s.userPrompts, 1);
  });
});

test('a Codex session in another repo is not counted', async () => {
  const other = process.platform === 'win32' ? 'C:\\work\\other' : '/work/other';
  const home = codexHome([
    { type: 'session_meta', payload: { cwd: other } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: 'hello' } },
  ]);
  await withHome(home, async () => {
    const r = await harvestCodex({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.source.status, 'empty');
    assert.equal(r.sessions.length, 0);
  });
});

test('a Codex session that never states a cwd is dropped rather than credited', async () => {
  // Guessing "probably this repo" would hand one team another team's evidence.
  const home = codexHome([
    { type: 'response_item', payload: { type: 'message', role: 'user', content: 'hello' } },
  ]);
  await withHome(home, async () => {
    const r = await harvestCodex({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.sessions.length, 0);
  });
});

test('a malformed Codex line is counted, not fatal', async () => {
  const home = codexHome([{ type: 'session_meta', payload: { cwd: REPO } }]);
  const dir = join(home, '.codex', 'sessions', '2026', '09', '03');
  writeFileSync(join(dir, 'rollout-broken.jsonl'),
    JSON.stringify({ type: 'session_meta', payload: { cwd: REPO } }) + '\n{ not json\n', 'utf8');
  await withHome(home, async () => {
    const r = await harvestCodex({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.source.status, 'harvested');
    assert.equal(r.sessions.reduce((n, s) => n + s.malformedLines, 0), 1);
  });
});

test('no Codex directory is reported as not-harvested, never as zero', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hk-codex-none-'));
  await withHome(home, async () => {
    const r = await harvestCodex({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.source.status, 'not-harvested');
    assert.match(r.source.reason, /\.codex/);
  });
});

// --- Cursor ---------------------------------------------------------------------------

const sqlite = await import('node:sqlite').then((m) => m.DatabaseSync).catch(() => null);
const needsSqlite = { skip: sqlite ? false : 'node:sqlite requires Node 22.5 or newer' };

/** Where the adapter will look for Cursor, for the platform the tests are running on. */
function cursorUserDir(home) {
  if (process.platform === 'win32') return join(home, 'AppData', 'Roaming', 'Cursor', 'User');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Cursor', 'User');
  return join(home, '.config', 'Cursor', 'User');
}

/**
 * Build the two databases Cursor keeps, in the layout the adapter expects.
 * `bubbles` are written in order and referenced from the conversation header.
 */
function cursorHome({ folder, composerId = 'comp-1', bubbles = [] }) {
  const home = mkdtempSync(join(tmpdir(), 'hk-cursor-'));
  const user = cursorUserDir(home);
  const ws = join(user, 'workspaceStorage', 'hash1');
  const globalDir = join(user, 'globalStorage');
  mkdirSync(ws, { recursive: true });
  mkdirSync(globalDir, { recursive: true });
  writeFileSync(join(ws, 'workspace.json'),
    JSON.stringify({ folder: pathToFileURL(folder).href }), 'utf8');

  const wsDb = new sqlite(join(ws, 'state.vscdb'));
  wsDb.exec('create table ItemTable (key text primary key, value blob)');
  wsDb.prepare('insert into ItemTable values (?, ?)').run('composer.composerData',
    JSON.stringify({ allComposers: [{ composerId, createdAt: 1756880000000, lastUpdatedAt: 1756890000000 }] }));
  wsDb.close();

  const gDb = new sqlite(join(globalDir, 'state.vscdb'));
  gDb.exec('create table cursorDiskKV (key text primary key, value blob)');
  const put = gDb.prepare('insert into cursorDiskKV values (?, ?)');
  put.run('composerData:' + composerId, JSON.stringify({
    fullConversationHeadersOnly: bubbles.map((b, i) => ({ bubbleId: 'b' + i, type: b.type })),
  }));
  bubbles.forEach((b, i) => put.run('bubbleId:' + composerId + ':b' + i, JSON.stringify(b)));
  gDb.close();
  return home;
}

const userBubble = (text) => ({ type: 1, text });
const shellBubble = (command, result) => ({
  type: 2,
  toolFormerData: { name: 'run_terminal_cmd', rawArgs: JSON.stringify({ command }), result: JSON.stringify(result) },
});

test('a Cursor conversation is read for prompts, commands and test outcomes', needsSqlite, async () => {
  const home = cursorHome({
    folder: REPO,
    bubbles: [
      userBubble('Add the release job that frees an unclaimed parking space.'),
      shellBubble('npm test', { output: '1 failed, 3 passed', endedReason: 'RUN_TERMINAL_COMMAND_ENDED_REASON_EXECUTION_COMPLETED' }),
      userBubble('That is not right — the deadline is in office-local time.'),
      shellBubble('npm test', { output: '4 passed', endedReason: 'RUN_TERMINAL_COMMAND_ENDED_REASON_EXECUTION_COMPLETED' }),
    ],
  });
  await withHome(home, async () => {
    const r = await harvestCursor({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.source.status, 'harvested');
    const [s] = r.sessions;
    assert.equal(s.userPrompts, 2);
    assert.equal(s.corrections, 1);
    assert.equal(s.commands.test, 2);
    assert.deepEqual(s.testRuns.map((t) => t.outcome), ['fail', 'pass']);
    assert.equal(s.sessionId, 'comp-1');
    assert.equal(s.startedAt, new Date(1756880000000).toISOString());
  });
});

test('a rejected tool call counts as steering the agent', needsSqlite, async () => {
  // A team that pushes back by clicking "reject" steered exactly as much as one that
  // pushed back by typing "no, do it the other way".
  const home = cursorHome({
    folder: REPO,
    bubbles: [
      userBubble('Wire up the check-in endpoint.'),
      { type: 2, toolFormerData: { name: 'edit_file', userDecision: 'rejected' } },
    ],
  });
  await withHome(home, async () => {
    const [s] = (await harvestCursor({ isInRepo: makeIsInRepo(REPO) })).sessions;
    assert.equal(s.corrections, 1);
  });
});

test('a Cursor conversation for another repo is not counted', needsSqlite, async () => {
  const other = process.platform === 'win32' ? 'C:\\work\\other' : '/work/other';
  const home = cursorHome({ folder: other, bubbles: [userBubble('hello')] });
  await withHome(home, async () => {
    const r = await harvestCursor({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.source.status, 'empty');
    assert.equal(r.sessions.length, 0);
  });
});

test('a conversation header naming a message that no longer exists is survivable', needsSqlite, async () => {
  // Cursor prunes message bodies while leaving the header intact.
  const home = cursorHome({ folder: REPO, bubbles: [userBubble('still here')] });
  const gPath = join(cursorUserDir(home), 'globalStorage', 'state.vscdb');
  const db = new sqlite(gPath);
  db.prepare('update cursorDiskKV set value = ? where key = ?').run(
    JSON.stringify({ fullConversationHeadersOnly: [{ bubbleId: 'b0', type: 1 }, { bubbleId: 'gone', type: 1 }] }),
    'composerData:comp-1');
  db.close();
  await withHome(home, async () => {
    const [s] = (await harvestCursor({ isInRepo: makeIsInRepo(REPO) })).sessions;
    assert.equal(s.userPrompts, 1);
    assert.equal(s.unreadRecords, 1, 'the missing message is reported, not silently dropped');
  });
});

test('Cursor installed but never used on this repo is empty, not not-harvested', needsSqlite, async () => {
  const home = mkdtempSync(join(tmpdir(), 'hk-cursor-none-'));
  mkdirSync(join(cursorUserDir(home), 'workspaceStorage'), { recursive: true });
  await withHome(home, async () => {
    const r = await harvestCursor({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.source.status, 'empty');
  });
});
