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
import { harvestClaudeCode } from '../lib/harvest/adapters/claude-code.mjs';
import { harvestCodex, sessionFiles, userRequestOf } from '../lib/harvest/adapters/codex.mjs';
import { isPlanningTool } from '../lib/harvest/adapters/copilot.mjs';
import { commandFrom, harvestCursor } from '../lib/harvest/adapters/cursor.mjs';
import { editorStorageRoots, makeIsInRepo, makeRepoFrom, workspaceFolderOf } from '../lib/harvest/shared.mjs';

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
async function withHome(home, fn, extraEnv = {}) {
  // CODEX_HOME and CLAUDE_CONFIG_DIR relocate a tool's whole history, so a developer who has
  // either set would otherwise have these tests read their real sessions.
  const keys = ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR'];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  delete process.env.CODEX_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
  Object.assign(process.env, extraEnv);
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

// --- the IDE extension: a workspace opened above the repository ---------------------------
//
// VS Code records the folder it has open. At a camp that is often the folder holding the
// team's clone, so every session looked like another project's and a person's whole Codex
// history was reported as "none belong to this repo".

const PARENT = process.platform === 'win32' ? 'C:\\work' : '/work';
const SIBLING = process.platform === 'win32' ? 'C:\\work\\other' : '/work/other';
const ideRequest = (request, tabs = ['other/notes.md']) => ({ type: 'response_item', payload: { type: 'message', role: 'user',
  content: [{ type: 'input_text', text: '# Context from my IDE setup:\n\n## Open tabs:\n' + tabs.map((t) => '- ' + t).join('\n') + '\n\n## My request:\n' + request }] } });
const setupMessage = { type: 'response_item', payload: { type: 'message', role: 'user',
  content: [{ type: 'input_text', text: '<recommended_plugins>\n- figma\n</recommended_plugins>\n<environment_context>\n<cwd>' + PARENT + '</cwd>\n</environment_context>' }] } };
const harvestFor = () => harvestCodex({ isInRepo: makeIsInRepo(REPO), repoFrom: makeRepoFrom(REPO) });

test('a session started in the workspace above the repo counts when a request names a path in it', async () => {
  const home = codexHome([
    { type: 'session_meta', payload: { id: 'ide-1', cwd: PARENT } },
    setupMessage,
    ideRequest('Look at app/src/booking.js and add the 14-day window check.'),
    ideRequest('Now run the tests.'),
  ]);
  await withHome(home, async () => {
    const r = await harvestFor();
    assert.equal(r.sessions.length, 1);
    const [s] = r.sessions;
    assert.equal(s.userPrompts, 2, 'the injected setup message is nobody\u2019s prompt');
    assert.equal(s.promptLength.max, 'Look at app/src/booking.js and add the 14-day window check.'.length,
      'the IDE context preamble is not part of the prompt');
    assert.equal(s.excerpts.prompts.kept[0].text, 'Look at app/src/booking.js and add the 14-day window check.');
  });
});

test('a tool call running inside the repo is evidence too, as JSON arguments or as source', async () => {
  const repoDir = REPO;
  for (const args of [JSON.stringify({ command: ['bash', '-lc', 'npm test'], workdir: repoDir }),
    'exec_command({ cmd: "npm test", workdir: ' + JSON.stringify(repoDir) + ' })']) {
    const home = codexHome([
      { type: 'session_meta', payload: { id: 'ide-2', cwd: PARENT } },
      ideRequest('run the tests'),
      { type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: args } },
    ]);
    await withHome(home, async () => {
      const r = await harvestFor();
      assert.equal(r.sessions.length, 1, 'workdir inside the repo: ' + args.slice(0, 40));
      // The command itself is only read from JSON arguments; attribution works for both.
      if (args.startsWith('{')) assert.equal(r.sessions[0].commands.test, 1);
    });
  }
});

test('a workspace session with no evidence — or about a sibling project — does not count', async () => {
  const cases = [
    // The repo only appears in the open tabs: another project's work in the same window.
    [ideRequest('summarise this document', ['app/README.md'])],
    // The request and the commands are about a sibling folder.
    [ideRequest('fix other/src/main.js'),
      { type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['ls'], workdir: SIBLING }) } }],
    // "app" appears, but not as a path under the workspace.
    [ideRequest('what does this app do?')],
  ];
  for (const lines of cases) {
    const home = codexHome([{ type: 'session_meta', payload: { cwd: PARENT } }, ...lines]);
    await withHome(home, async () => {
      const r = await harvestFor();
      assert.equal(r.sessions.length, 0);
      assert.equal(r.source.status, 'empty');
    });
  }
});

test('without the parent matcher a workspace session is still refused, as before', async () => {
  const home = codexHome([{ type: 'session_meta', payload: { cwd: PARENT } }, ideRequest('edit app/src/x.js')]);
  await withHome(home, async () => {
    const r = await harvestCodex({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.sessions.length, 0);
  });
});

test('the IDE preamble and the setup message are recognised, and ordinary text is left alone', () => {
  assert.equal(userRequestOf('# Context from my IDE setup:\n## Open tabs:\n- a.js\n## My request:\nfix it'), 'fix it');
  assert.equal(userRequestOf(setupMessage.payload.content[0].text), '');
  assert.equal(userRequestOf('<environment_context><cwd>/x</cwd></environment_context>'), '');
  assert.equal(userRequestOf('plain request mentioning <environment_context> in passing'), 'plain request mentioning <environment_context> in passing');
});

test('a folder name in two Unicode forms is the same folder', () => {
  // macOS returned "Zühlke" decomposed in the session and composed on disk.
  const composed = '/Users/a/Z\u00fchlke/camp/app';
  const decomposed = '/Users/a/Zu\u0308hlke/camp/app';
  assert.ok(makeIsInRepo(composed)(decomposed + '/src'));
  assert.equal(makeRepoFrom(composed)('/Users/a/Zu\u0308hlke/camp'), 'app');
  assert.equal(makeRepoFrom(composed)(composed), null, 'the repo itself is not its own parent');
  assert.equal(makeRepoFrom(composed)('/Users/a/Z\u00fchlke/camp/app/src'), null, 'a folder inside is not a parent');
});

// --- where Codex keeps sessions: the CLI, the desktop app and the IDE extension ------------

const codexLines = (text) => [
  { type: 'session_meta', payload: { cwd: REPO } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: text } },
];

function writeRollout(dir, name, lines) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
}

test('Codex sessions under $CODEX_HOME are read', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hk-codex-'));
  const relocated = join(home, 'elsewhere', 'codex');
  writeRollout(join(relocated, 'sessions', '2026', '09', '24'), 'rollout-a.jsonl', codexLines('plan the booking flow'));
  await withHome(home, async () => {
    const r = await harvestCodex({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.source.status, 'harvested');
    assert.equal(r.sessions.length, 1);
  }, { CODEX_HOME: relocated });
});

test('archived Codex sessions still count', async () => {
  // Archiving in the app or extension moves the rollout to archived_sessions/; it tidies
  // the sidebar, it does not mean the work did not happen.
  const home = mkdtempSync(join(tmpdir(), 'hk-codex-'));
  writeRollout(join(home, '.codex', 'sessions', '2026', '09', '24'), 'rollout-live.jsonl', codexLines('live one'));
  writeRollout(join(home, '.codex', 'archived_sessions'), 'rollout-old.jsonl', codexLines('archived one'));
  await withHome(home, async () => {
    const r = await harvestCodex({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.sessions.length, 2);
  });
});

test('a Codex rollout caught in both places mid-archive is counted once', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hk-codex-'));
  const lines = codexLines('the same session');
  writeRollout(join(home, '.codex', 'sessions', '2026', '09', '24'), 'rollout-same.jsonl', lines);
  writeRollout(join(home, '.codex', 'archived_sessions'), 'rollout-same.jsonl', lines);
  await withHome(home, async () => {
    const r = await harvestCodex({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.sessions.length, 1);
    assert.equal(r.sessions[0].userPrompts, 1);
  });
});

test('two Codex rollouts sharing a session id are both counted', async () => {
  // A forked or resumed session can carry its parent's id. Collapsing on id would drop real
  // work, so only the same *file* is ever deduplicated.
  const home = mkdtempSync(join(tmpdir(), 'hk-codex-'));
  const withId = (text) => [
    { type: 'session_meta', payload: { id: 'shared-id', cwd: REPO } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: text } },
  ];
  const dir = join(home, '.codex', 'sessions', '2026', '09', '24');
  writeRollout(dir, 'rollout-1.jsonl', withId('first'));
  writeRollout(dir, 'rollout-2.jsonl', withId('second'));
  await withHome(home, async () => {
    const r = await harvestCodex({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.sessions.length, 2);
  });
});

test('when the Codex file cap bites, the newest sessions are the ones kept', () => {
  const root = mkdtempSync(join(tmpdir(), 'hk-codex-cap-'));
  try {
    for (const [y, m, d] of [['2025', '01', '05'], ['2026', '09', '23'], ['2026', '09', '24'], ['2026', '02', '11']]) {
      writeRollout(join(root, y, m, d), 'rollout-' + y + '-' + m + '-' + d + '.jsonl', codexLines('x'));
    }
    const kept = sessionFiles(root, 2).map((f) => f.split(/[\\/]/).pop());
    assert.deepEqual(kept, ['rollout-2026-09-24.jsonl', 'rollout-2026-09-23.jsonl']);
  } finally { rmSync(root, { recursive: true, force: true }); }
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

// --- regressions from the review pass ---------------------------------------------------

test('a Cursor command survives an argument blob truncated mid-JSON', needsSqlite, async () => {
  // SQLite cuts the argument blob at a fixed length, so the *longest* commands arrive as
  // invalid JSON. Returning null there removed the run from every counter — not counted as
  // `other`, and never recorded as a test run — so a team's longest test invocation was
  // the one most likely to vanish.
  const long = 'npm test -- ' + '--reporter=verbose '.repeat(200);
  const truncated = JSON.stringify({ command: long, explanation: 'x' }).slice(0, 2000);
  const home = cursorHome({
    folder: REPO,
    bubbles: [
      userBubble('Run the suite.'),
      {
        type: 2,
        toolFormerData: {
          name: 'run_terminal_cmd',
          rawArgs: truncated,
          result: JSON.stringify({ output: '12 passed' }),
        },
      },
    ],
  });
  await withHome(home, async () => {
    const [s] = (await harvestCursor({ isInRepo: makeIsInRepo(REPO) })).sessions;
    assert.equal(s.commands.test, 1, 'the command must still be classified');
    assert.deepEqual(s.testRuns.map((t) => t.outcome), ['pass']);
  });
});

test('commandFrom reads well-formed, truncated and unusable arguments alike', () => {
  assert.equal(commandFrom(JSON.stringify({ command: 'pytest -q' })), 'pytest -q');
  // Truncated after the command value, with no closing quote or brace.
  assert.equal(commandFrom('{"explanation":"x","command":"pytest -q --cov'), 'pytest -q --cov');
  assert.equal(commandFrom('{"command":"echo \\"hi\\" && npm test'), 'echo "hi" && npm test');
  for (const unusable of [null, undefined, '', '{}', '{"explanation":"no command here"}']) {
    assert.equal(commandFrom(unusable), null, JSON.stringify(unusable));
  }
});

test('a workspace URI that is not a file: URI is not parsed as one', () => {
  // fileURLToPath throws on vscode-remote:// and friends. One adapter guarded for this and
  // the other did not, so the same remote workspace crashed one harvest and not the other.
  const dir = mkdtempSync(join(tmpdir(), 'hk-ws-'));
  try {
    writeFileSync(join(dir, 'workspace.json'),
      JSON.stringify({ folder: 'vscode-remote://ssh-remote%2Bbox/home/ana/app' }), 'utf8');
    assert.equal(workspaceFolderOf(dir), 'vscode-remote://ssh-remote%2Bbox/home/ana/app');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing or malformed workspace.json resolves to null, not a throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-ws-'));
  try {
    assert.equal(workspaceFolderOf(dir), null, 'no workspace.json at all');
    writeFileSync(join(dir, 'workspace.json'), '{ not json', 'utf8');
    assert.equal(workspaceFolderOf(dir), null, 'unparseable');
    writeFileSync(join(dir, 'workspace.json'), JSON.stringify({ folder: 42 }), 'utf8');
    assert.equal(workspaceFolderOf(dir), null, 'not a string');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('editor storage roots are found per platform, and only when they exist', () => {
  const home = mkdtempSync(join(tmpdir(), 'hk-roots-'));
  try {
    const env = { APPDATA: join(home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: join(home, '.config') };
    // Nothing on disk yet: an app that was never installed contributes no root.
    assert.deepEqual(editorStorageRoots(['Cursor'], { platform: 'win32', env, home }), []);
    const user = join(env.APPDATA, 'Cursor', 'User');
    mkdirSync(user, { recursive: true });
    assert.deepEqual(editorStorageRoots(['Cursor'], { platform: 'win32', env, home }), [user]);
    // The same call on another platform looks somewhere else and finds nothing.
    assert.deepEqual(editorStorageRoots(['Cursor'], { platform: 'linux', env, home }), []);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Copilot planning tools are recognised, and ordinary tools are not', () => {
  // This adapter counted no planning signals at all, so `planned-before-building` was
  // capped for every Copilot team however they worked. Both directions are asserted
  // because the first attempt at this pattern matched `deploy_plan_checker`, and the
  // second wrote `planner?` — which makes only the final `r` optional, so it matched
  // "planne" and missed "plan".
  for (const tool of ['manage_todo_list', 'copilot_manage_todo_list', 'todo', 'todos',
    'update_plan', 'plan', 'planner', 'copilot-plan']) {
    assert.equal(isPlanningTool(tool), true, tool + ' is a planning tool');
  }
  for (const tool of ['create_file', 'replace_string_in_file', 'run_in_terminal', 'read_file',
    'semantic_search', 'get_errors', 'deploy_plan_checker', 'planet_data', 'todolist_export',
    '', null, undefined]) {
    assert.equal(isPlanningTool(tool), false, JSON.stringify(tool) + ' is not a planning tool');
  }
});

// --- where Claude Code keeps sessions: the CLI, the IDE extensions and Claude Desktop ----------

const claudeLine = (sessionId, text, extra = {}) => JSON.stringify({
  type: 'user', sessionId, timestamp: '2026-09-24T09:00:00Z', cwd: REPO, gitBranch: 'main',
  message: { role: 'user', content: [{ type: 'text', text }] }, ...extra,
});

function writeClaudeSession(projectsDir, file, lines) {
  const dir = join(projectsDir, 'proj');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), lines.join('\n') + '\n', 'utf8');
}

test('Claude Code sessions under $CLAUDE_CONFIG_DIR are read, and ~/.claude still is', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hk-claude-'));
  const relocated = join(home, 'custom-claude');
  writeClaudeSession(join(relocated, 'projects'), 'a.jsonl', [claudeLine('a', 'from the relocated dir')]);
  writeClaudeSession(join(home, '.claude', 'projects'), 'b.jsonl', [claudeLine('b', 'from the default dir')]);
  await withHome(home, async () => {
    const r = await harvestClaudeCode({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.source.status, 'harvested');
    assert.deepEqual(r.sessions.map((x) => x.sessionId).sort(), ['a', 'b']);
  }, { CLAUDE_CONFIG_DIR: relocated });
});

test('the same Claude Code file under both config dirs is counted once', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hk-claude-'));
  const relocated = join(home, 'custom-claude');
  const lines = [claudeLine('same', 'one prompt')];
  writeClaudeSession(join(relocated, 'projects'), 'same.jsonl', lines);
  writeClaudeSession(join(home, '.claude', 'projects'), 'same.jsonl', lines);
  await withHome(home, async () => {
    const r = await harvestClaudeCode({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.sessions.length, 1);
  }, { CLAUDE_CONFIG_DIR: relocated });
});

test('a subagent transcript sharing its parent\u2019s session id is still read', async () => {
  // Newer Claude Code writes subagent work to its own file under the parent's session id.
  // Its tool calls and test runs are real work; deduplicating by id would delete them.
  const home = mkdtempSync(join(tmpdir(), 'hk-claude-'));
  const projects = join(home, '.claude', 'projects');
  writeClaudeSession(projects, 'parent.jsonl', [claudeLine('parent-id', 'build the booking api')]);
  writeClaudeSession(projects, 'agent-1.jsonl', [
    claudeLine('parent-id', 'subagent brief', { isSidechain: true }),
    JSON.stringify({
      type: 'assistant', sessionId: 'parent-id', cwd: REPO, isSidechain: true,
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] },
    }),
  ]);
  await withHome(home, async () => {
    const r = await harvestClaudeCode({ isInRepo: makeIsInRepo(REPO) });
    assert.equal(r.sessions.length, 2);
    assert.equal(r.sessions.reduce((n, x) => n + x.toolCallTotal, 0), 1, 'the subagent\u2019s tool call was lost');
    assert.equal(r.sessions.reduce((n, x) => n + x.userPrompts, 0), 1, 'a sidechain brief is not a human prompt');
  });
});
