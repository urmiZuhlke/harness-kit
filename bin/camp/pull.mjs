#!/usr/bin/env node
/**
 * pull — clone or update every submitted repository, in parallel.
 *
 *   node bin/camp/pull.mjs --list repos.txt --out repos/
 *   node bin/camp/pull.mjs --list repos.txt --out repos/ --before "2026-09-25 14:00"
 *
 * `repos.txt` holds one repository per line, either a URL (or local path) alone or
 * `team-name,url`; blank lines and `#` comments are skipped. The folder a repository is
 * cloned into is its team name. Re-running updates existing clones. `--before` pins each
 * clone to its default branch's last commit before the deadline, so a push at 14:05 is
 * not seen.
 *
 * Git only fetches and checks out. No hook is installed or run, no submodule is fetched,
 * symlinks are checked out as plain files (so none can point a judge outside the clone),
 * and a credential prompt fails the clone instead of waiting for a keyboard nobody is at.
 * A repository with no commit before the deadline is removed, so it cannot be judged on
 * work pushed after it.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { slug } from '../../lib/harvest/history.mjs';

function help() {
  console.log(`Usage: node bin/camp/pull.mjs --list <repos.txt> --out <folder> [--before <deadline>] [--jobs <n>]

  --list    one repository per line: "url" or "team-name,url" (# comments allowed)
  --out     folder to clone into; one sub-folder per team, named after the team
  --before  pin every clone to its last commit before this time, e.g. "2026-09-25 14:00"
            (read in this machine's time zone unless it carries one)
  --jobs    parallel clones (default 8)`);
}

const args = { list: null, out: null, before: null, jobs: 8 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--list') args.list = argv[++i];
  else if (a === '--out') args.out = argv[++i];
  else if (a === '--before') args.before = argv[++i];
  else if (a === '--jobs') args.jobs = Number(argv[++i]);
  else if (a === '-h' || a === '--help') { help(); process.exit(0); }
  else { console.error('Unknown argument: ' + a + '\n'); help(); process.exit(1); }
}
if (!args.list || !args.out || !(args.jobs >= 1)) { help(); process.exit(1); }

let deadline = null;
if (args.before) {
  const t = Date.parse(args.before.replace(' ', 'T'));
  if (Number.isNaN(t)) { console.error('Could not read --before "' + args.before + '" as a date and time.'); process.exit(1); }
  deadline = new Date(t).toISOString();
}

/** `team,url` or `url` → {team, url}. The team defaults to the repository's own name. */
function parseList(text) {
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const comma = line.indexOf(',');
    // A URL can hold no comma worth keeping, so the first comma separates the team name.
    const [name, url] = comma > 0 ? [line.slice(0, comma).trim(), line.slice(comma + 1).trim()] : [null, line];
    const team = slug(name ?? basename(url.replace(/\/+$/, '')).replace(/\.git$/i, ''));
    entries.push({ team: team || 'unnamed', url });
  }
  return entries;
}

// Hooks are never copied by a clone, but an empty hooks path makes that a guarantee
// rather than an assumption; the same goes for the transport a malicious URL could pick.
const SAFE = ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
  '-c', 'protocol.ext.allow=never', '-c', 'core.symlinks=false'];

function git(args, cwd) {
  return new Promise((done) => {
    execFile('git', [...SAFE, ...args], {
      cwd, timeout: 5 * 60 * 1000, maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', SSH_ASKPASS: 'echo',
        GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
      },
    }, (err, stdout, stderr) => done({
      ok: !err, out: String(stdout).trim(),
      why: err ? (String(stderr).trim().split('\n').pop() || err.message) : null,
    }));
  });
}

async function pullOne({ team, url }, outDir) {
  const dir = join(outDir, team);
  const existed = existsSync(join(dir, '.git'));
  // A URL corrected in the list since the last run is used, not the one cloned earlier.
  if (existed) await git(['remote', 'set-url', 'origin', url], dir);
  const step = existed
    ? await git(['fetch', '--prune', '--quiet', 'origin'], dir)
    : await git(['clone', '--quiet', '--no-recurse-submodules', '-c', 'core.symlinks=false', url, dir], outDir);
  if (!step.ok) return { team, url, status: 'failed', why: step.why };

  // origin/HEAD is the default branch as of the clone; refresh it so a team that renamed
  // its default branch since is still read from the right one.
  await git(['remote', 'set-head', 'origin', '--auto'], dir);
  const ref = (await git(['rev-parse', '--verify', '--quiet', 'origin/HEAD'], dir)).ok ? 'origin/HEAD' : 'HEAD';
  const target = deadline
    ? await git(['rev-list', '-n', '1', '--first-parent', '--before=' + deadline, ref], dir)
    : await git(['rev-parse', ref], dir);
  if (!target.ok || !target.out) {
    // Left in place, the clone would sit at its late HEAD and prepare would judge it.
    rmSync(dir, { recursive: true, force: true });
    return { team, url, status: 'failed', why: (deadline ? 'no commit before the deadline' : 'empty repository') + ' — clone removed' };
  }
  const checkout = await git(['checkout', '--quiet', '--force', '--detach', target.out], dir);
  if (!checkout.ok) return { team, url, status: 'failed', why: checkout.why };
  const when = await git(['log', '-1', '--format=%cI', target.out], dir);
  // Work only the default branch is read from: say so when another branch has newer
  // commits (before the deadline), and when submodules were not fetched.
  const notes = [];
  const refs = await git(['for-each-ref', '--format=%(committerdate:iso-strict)%09%(refname:short)', 'refs/remotes/origin'], dir);
  for (const line of refs.out.split('\n').filter(Boolean)) {
    const [date, ref] = line.split('\t');
    if (ref === 'origin/HEAD' || ref === 'origin' || !date) continue;
    const t = Date.parse(date);
    if (t > Date.parse(when.out) && (!deadline || t <= Date.parse(deadline))) notes.push('newer commits on ' + ref);
  }
  if (existsSync(join(dir, '.gitmodules'))) notes.push('has submodules — not fetched');
  return { team, url, status: existed ? 'updated' : 'cloned', commit: target.out.slice(0, 10), at: when.out, notes };
}

const entries = parseList(readFileSync(resolve(args.list), 'utf8'));
if (!entries.length) { console.error('No repositories in ' + args.list); process.exit(1); }
const dupes = entries.map((e) => e.team).filter((t, i, all) => all.indexOf(t) !== i);
if (dupes.length) { console.error('Two lines share a team name: ' + [...new Set(dupes)].join(', ')); process.exit(1); }

const outDir = resolve(args.out);
mkdirSync(outDir, { recursive: true });
const started = Date.now();
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(args.jobs, entries.length) }, async () => {
  while (next < entries.length) {
    const entry = entries[next++];
    results.push(await pullOne(entry, outDir));
  }
}));
results.sort((a, b) => a.team.localeCompare(b.team));

console.log('\nPULL   ' + results.length + ' repositories in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s'
  + (deadline ? ', pinned before ' + deadline : '') + '\n');
for (const r of results) {
  console.log('  ' + r.team.slice(0, 21).padEnd(22) + r.status.padEnd(9)
    + (r.status === 'failed' ? r.why + '  (' + r.url + ')' : r.commit + '  ' + r.at
      + (r.notes?.length ? '   ! ' + r.notes.join('; ') : '')));
}
// Every team that was expected, and which ones could not be pulled. prepare reads this so a
// team whose clone failed is carried into the manifest — and the report refuses to publish
// until it is pulled or explicitly --exclude'd — instead of silently not existing.
writeFileSync(join(outDir, '.pull.json'), JSON.stringify({
  pulledAt: new Date().toISOString(), deadline,
  teams: results.map((r) => r.team),
  failed: results.filter((r) => r.status === 'failed').map((r) => ({ team: r.team, why: r.why })),
}, null, 2) + '\n', 'utf8');

const failed = results.filter((r) => r.status === 'failed');
if (failed.length) {
  console.log('\n  ' + failed.length + ' FAILED: ' + failed.map((r) => r.team).join(', '));
  console.log('  Check access for those URLs, then run this again — existing clones are updated, not re-cloned.\n');
  process.exit(1);
}
console.log('\nNext:  node bin/camp/prepare.mjs --repos ' + args.out + ' --out eval/ --rubric <rubric.md>\n');
