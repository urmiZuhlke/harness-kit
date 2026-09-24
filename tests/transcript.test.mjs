/**
 * Slash-command records in a Claude Code transcript.
 *
 * Invoking `/planner do X` writes two user records: a `<command-args>` wrapper holding
 * what the human typed, and a second record containing the skill's whole definition.
 * Counting both as prompts measured this repo at 20 prompts against 8 real ones, pulled
 * the mean prompt length up with 10,000-character skill bodies, and manufactured six
 * "corrections" out of imperative prose inside those definitions.
 *
 * The distortion is worst for teams who use slash commands — which this kit recommends —
 * so it is scored from what a human actually typed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { harvestClaudeCode } from '../lib/harvest/adapters/claude-code.mjs';
import { makeIsInRepo } from '../lib/harvest/shared.mjs';

/** Build a transcript in the real on-disk shape, under a fake projects root. */
function transcriptWith(userTexts, repoPath) {
  const root = mkdtempSync(join(tmpdir(), 'hk-tx-'));
  const dir = join(root, 'proj');
  mkdirSync(dir, { recursive: true });
  const lines = userTexts.map((text, i) => JSON.stringify({
    type: 'user', sessionId: 's1', timestamp: new Date(Date.UTC(2026, 7, 21, 9, i)).toISOString(),
    cwd: repoPath, gitBranch: 'main',
    message: { role: 'user', content: [{ type: 'text', text }] },
  }));
  writeFileSync(join(dir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
  return root;
}

/**
 * The adapter reads from the real home directory, so these tests drive it through a
 * temporary HOME. Restored in a finally block.
 */
async function harvestFrom(root, repoPath) {
  const realHome = process.env.HOME;
  const realProfile = process.env.USERPROFILE;
  // homedir() reads USERPROFILE on Windows and HOME elsewhere.
  const fakeHome = join(root, 'home');
  mkdirSync(join(fakeHome, '.claude', 'projects', 'p'), { recursive: true });
  const { renameSync, readdirSync, copyFileSync } = await import('node:fs');
  for (const f of readdirSync(join(root, 'proj'))) {
    copyFileSync(join(root, 'proj', f), join(fakeHome, '.claude', 'projects', 'p', f));
  }
  const realConfigDir = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR; // or a developer's relocated sessions leak in
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  try {
    return await harvestClaudeCode({ isInRepo: makeIsInRepo(repoPath) });
  } finally {
    if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
    if (realProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = realProfile;
    if (realConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = realConfigDir;
  }
}

const REPO = process.platform === 'win32' ? 'C:\work\app' : '/work/app';

test('a slash command counts once, as the words the human typed', async () => {
  const root = transcriptWith([
    '<command-message>planner</command-message>\n<command-name>/planner</command-name>\n'
      + '<command-args>Build the booking flow, auth first</command-args>',
    'Base directory for this skill: /home/u/.claude/skills/planner\nYou are a feature analyst. '
      + 'Do not implement. Never add scope. '.repeat(60),
  ], REPO);
  try {
    const r = await harvestFrom(root, REPO);
    const s = r.sessions[0];
    assert.equal(s.userPrompts, 1, 'the skill definition must not count as a prompt');
    assert.equal(s.injectedRecordsSkipped, 1);
    assert.equal(s.excerpts.prompts.kept[0].text, 'Build the booking flow, auth first');
    assert.ok(s.promptLength.max < 200, 'a skill body must not inflate prompt length');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a bare slash command with no arguments still counts as an instruction', async () => {
  const root = transcriptWith([
    '<command-message>reviewer</command-message>\n<command-name>/reviewer</command-name>\n'
      + '<command-args></command-args>',
  ], REPO);
  try {
    const s = (await harvestFrom(root, REPO)).sessions[0];
    assert.equal(s.userPrompts, 1);
    assert.match(s.excerpts.prompts.kept[0].text, /reviewer/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('imperative prose inside a skill definition cannot manufacture a correction', async () => {
  const root = transcriptWith([
    'Base directory for this skill: /x\nYou do not add scope. Never change the plan. '
      + "That is not acceptable. Revert anything unrelated.",
    'add the auth endpoint',
  ], REPO);
  try {
    const s = (await harvestFrom(root, REPO)).sessions[0];
    assert.equal(s.userPrompts, 1);
    assert.equal(s.corrections, 0, 'the skill body is not a human correcting anything');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('harness-injected context is stripped from an ordinary prompt', async () => {
  const root = transcriptWith([
    'fix the failing test\n<system-reminder>Some injected note</system-reminder>',
  ], REPO);
  try {
    const s = (await harvestFrom(root, REPO)).sessions[0];
    assert.equal(s.userPrompts, 1);
    assert.equal(s.excerpts.prompts.kept[0].text, 'fix the failing test');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invoking a planner skill counts as planning', async () => {
  // Regression: the criterion looked only for ExitPlanMode, so this repo's own transcript
  // scored zero for "no planning step is visible" while containing two /planner
  // invocations — a team following the kit's own advice, marked down for it.
  const root = transcriptWith([
    '<command-message>planner</command-message>\n<command-name>/planner</command-name>\n'
      + '<command-args>design the booking flow</command-args>',
  ], REPO);
  try {
    const s = (await harvestFrom(root, REPO)).sessions[0];
    assert.ok(s.planningSignals >= 1, 'a /planner invocation is a planning signal');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unrelated slash command is not mistaken for planning', async () => {
  const root = transcriptWith([
    '<command-message>reviewer</command-message>\n<command-name>/reviewer</command-name>\n'
      + '<command-args>check the diff</command-args>',
  ], REPO);
  try {
    const s = (await harvestFrom(root, REPO)).sessions[0];
    assert.equal(s.planningSignals, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
