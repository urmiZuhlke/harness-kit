#!/usr/bin/env node
/**
 * final-round — render the finalist's final-round.md as final-round.html.
 *
 *   node bin/camp/final-round.mjs eval/
 *
 * Run by /camp-final once the camp-finalist agent has written its Markdown. The agent never
 * writes HTML itself; see lib/camp/final.mjs for why.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { finalRoundHtml } from '../../lib/camp/final.mjs';

const dirArg = process.argv[2];
if (!dirArg || dirArg.startsWith('-')) {
  console.log('Usage: node bin/camp/final-round.mjs <eval folder>   — writes final-round.html from final-round.md');
  process.exit(dirArg === '-h' || dirArg === '--help' ? 0 : 1);
}
const dir = resolve(dirArg);
const source = join(dir, 'final-round.md');
if (!existsSync(source)) { console.error('No final-round.md in ' + dir + ' — run /camp-final first.'); process.exit(1); }

let rehearsal = false;
try { rehearsal = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).rehearsal === true; } catch { /* no manifest */ }
const target = join(dir, 'final-round.html');
writeFileSync(target, finalRoundHtml(readFileSync(source, 'utf8'), { rehearsal }), 'utf8');
console.log('Wrote ' + target);
