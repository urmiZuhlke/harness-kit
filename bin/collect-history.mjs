#!/usr/bin/env node
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
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  HISTORY_DIR, collectHistory, historyFileName, repoRootOf, whoAmI,
} from '../lib/harvest/history.mjs';
import { DEFAULT_DECK_PATH, DIAGRAM_PATHS, findDeck, findDiagram } from '../lib/camp/submission.mjs';

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
of your prompts cut to 280 characters (the first 6 per session, plus up to 6 where you
corrected the AI), with anything that looks like a key or password replaced by
[redacted]. Never full conversations and never your code. Open the file and read it
before you commit it — it will be visible to anyone who can see your repository.

Run it in the project folder. Sessions are matched by folder; a Codex session started in a
workspace ABOVE the project also counts when a request names a path inside the project or a
command ran inside it.`);
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
