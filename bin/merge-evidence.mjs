#!/usr/bin/env node
/**
 * merge-evidence — combine several members' harvests into one team bundle.
 *
 * AI chat transcripts live in a developer's home directory, so `vibecheck` sees the work
 * of whoever ran it. A team therefore harvests once per machine and merges the results:
 *
 *   # on each member's machine, in the team's repo
 *   node bin/vibecheck.mjs --harvest-only
 *   # then, with the evidence files collected in one place
 *   node bin/merge-evidence.mjs ana.json marko.json ... --out team/evidence.json
 *   node bin/vibecheck.mjs --evidence team/evidence.json
 *
 * Each argument is an evidence.json, a bundle directory holding one, or a repository with
 * a `.vibecheck` folder. Nothing is uploaded; this reads and writes local files only.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { mergeEvidence } from '../lib/harvest/merge.mjs';

function parseArgs(argv) {
  const args = { inputs: [], out: null, dir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--dir') args.dir = argv[++i];
    else if (arg === '-h' || arg === '--help') args.help = true;
    else if (arg.startsWith('-')) {
      console.error('Unknown option: ' + arg);
      args.help = true;
    } else args.inputs.push(arg);
  }
  return args;
}

function help() {
  console.log(`Usage: node bin/merge-evidence.mjs <evidence...> --out <file.json>

Combines evidence harvested on several machines into one team bundle. Sessions are unioned
and every total is recomputed from them; repository state is taken from one member and
named in the output.

Each input may be an evidence.json, a directory containing one, or a repo with a
.vibecheck folder.

Options:
  --dir <parent>   Use every subdirectory of <parent> as an input
  --out <file>     Where to write the merged evidence (default: ./team-evidence.json)
  -h, --help       Show this help`);
}

/** Resolve an argument to an evidence.json path, or null. */
function resolveEvidence(path) {
  const p = resolve(path);
  if (!existsSync(p)) return null;
  if (statSync(p).isFile()) return p;
  for (const candidate of [join(p, 'evidence.json'), join(p, '.vibecheck', 'evidence.json')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * A name for this member in the output.
 *
 * The containing directory is more useful than the filename: five files all called
 * `evidence.json` tell a facilitator nothing about whose laptop each came from, while
 * `ana/evidence.json` does.
 */
function labelFor(path) {
  const dir = basename(dirname(path));
  return dir === '.vibecheck' ? basename(dirname(dirname(path))) : (dir || basename(path));
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { help(); process.exit(0); }

const inputs = [...args.inputs];
if (args.dir) {
  const parent = resolve(args.dir);
  try {
    inputs.push(...readdirSync(parent)
      .map((name) => join(parent, name))
      .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } }));
  } catch (err) {
    console.error('Could not read --dir ' + parent + ': ' + err.message);
    process.exit(1);
  }
}
if (!inputs.length) { help(); process.exit(1); }

const members = [];
const skipped = [];
for (const input of inputs) {
  const path = resolveEvidence(input);
  if (!path) { skipped.push({ input, why: 'no evidence.json here' }); continue; }
  try {
    members.push({ label: labelFor(path), path, evidence: JSON.parse(readFileSync(path, 'utf8')) });
  } catch (err) {
    skipped.push({ input, why: 'unreadable: ' + err.message });
  }
}

for (const s of skipped) console.error('Skipped ' + s.input + '  (' + s.why + ')');

if (!members.length) {
  console.error('\nNothing to merge — no readable evidence file was found.');
  process.exit(1);
}
// One input is not an error, but it is almost certainly not what was intended, and a
// team that merges one laptop and thinks it merged five would never find out.
if (members.length === 1) {
  console.error('\nOnly one evidence file was found (' + members[0].label + '). Merging it '
    + 'produces the same evidence back. If you expected more, check that every member ran '
    + '`node bin/vibecheck.mjs --harvest-only` and that their files were collected.');
}

let merged;
try {
  merged = mergeEvidence(members);
} catch (err) {
  console.error('\nCould not merge: ' + err.message);
  process.exit(1);
}

const outPath = resolve(args.out ?? 'team-evidence.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(merged.evidence, null, 2) + '\n', 'utf8');

const t = merged.evidence.chat.totals;
console.log('\nMerged ' + members.length + ' harvest(s):\n');
for (const m of merged.evidence.merged.members) {
  console.log('  ' + m.label.padEnd(20) + String(m.sessions).padStart(4) + ' session(s), '
    + String(m.prompts).padStart(5) + ' prompt(s)'
    + (m.label === merged.evidence.merged.repoStateFrom ? '   <-- repo state from here' : ''));
}
console.log('\n  team total          ' + String(t.sessionCount).padStart(4) + ' session(s), '
  + String(t.userPrompts).padStart(5) + ' prompt(s), ' + t.testRuns.total + ' test run(s)');
console.log('  scale               ' + JSON.stringify(merged.evidence.scale));

for (const w of merged.warnings) console.log('\n  ! ' + w);

console.log('\nScore it with:\n  node bin/vibecheck.mjs --evidence ' + outPath + '\n');
console.log(outPath);
