#!/usr/bin/env node
/**
 * leaderboard — rank every team from their collected bundles.
 *
 * This is the coach-side command and the authoritative one. It **recomputes** each score
 * from `evidence.json` and ignores whatever `score.json` a bundle contains, so a team that
 * hand-edits their own score changes nothing. Every team is scored by this one build of
 * the scorer, which is what makes the ranking defensible.
 *
 *   node bin/leaderboard.mjs bundles/*             # one directory per team
 *   node bin/leaderboard.mjs --dir bundles         # or a parent holding them all
 *
 * A bundle is a directory containing `evidence.json`, optionally alongside
 * `coach-scorecard.json` (demo score, badges, manual adjustment) and `judgement.json`
 * (a coach judging pass's verdict on the subjective criteria — see plugin/skills/coach-judge).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score, SCORER_VERSION } from '../lib/score/index.mjs';
import { renderLeaderboard } from '../lib/report/render.mjs';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { bundles: [], dir: null, out: null, html: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') args.dir = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--html') args.html = argv[++i];
    else if (arg === '-h' || arg === '--help') args.help = true;
    else args.bundles.push(arg);
  }
  return args;
}

function help() {
  console.log(`Usage: node bin/leaderboard.mjs [bundle-dir ...] [--dir <parent>] [--out <file.json>]

Recomputes every team's score from their evidence.json and ranks them. Any score.json in a
bundle is ignored — the evidence is the source of truth.

A bundle directory contains:
  evidence.json          produced by vibecheck on the team's machine   (required)
  coach-scorecard.json   demo score, badges, manual adjustment          (optional)
  judgement.json         verdict from the coach-judge skill             (optional)

Options:
  --dir <parent>   Treat every subdirectory of <parent> as a bundle
  --out <file>     Also write the ranked results as JSON
  --html <file>    Also write the ranked results as a self-contained HTML page
  -h, --help       Show this help`);
}

/** A bundle may be the directory itself or a `.vibecheck` folder inside it. */
function resolveBundle(dir) {
  if (existsSync(join(dir, 'evidence.json'))) return dir;
  const nested = join(dir, '.vibecheck');
  if (existsSync(join(nested, 'evidence.json'))) return nested;
  return null;
}

function loadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { help(); process.exit(0); }

let candidates = args.bundles.map((b) => resolve(b));
if (args.dir) {
  const parent = resolve(args.dir);
  try {
    candidates.push(...readdirSync(parent)
      .map((name) => join(parent, name))
      .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } }));
  } catch (err) {
    console.error('Could not read --dir ' + parent + ': ' + err.message);
    process.exit(1);
  }
}
if (!candidates.length) { help(); process.exit(1); }

const rows = [];
const skipped = [];
for (const candidate of candidates) {
  const bundle = resolveBundle(candidate);
  if (!bundle) { skipped.push({ path: candidate, why: 'no evidence.json' }); continue; }

  const evidence = loadJson(join(bundle, 'evidence.json'));
  if (!evidence) { skipped.push({ path: candidate, why: 'evidence.json is unreadable' }); continue; }

  const scorecard = loadJson(join(bundle, 'coach-scorecard.json'));
  const judgement = loadJson(join(bundle, 'judgement.json'));
  // Recompute. Any score.json sitting in this bundle is deliberately not read.
  const result = score(evidence, {
    coachScorecard: scorecard,
    judgement,
    repoPath: evidence?.repo?.path,
    kitRoot: KIT_ROOT,
    practice: false,
  });
  rows.push({
    team: scorecard?.team ?? evidence?.repo?.name ?? basename(candidate),
    bundle,
    evidence,
    result,
  });
}

/**
 * Rank by share of assessable points, not raw total.
 *
 * When every team is complete this is identical to ranking by total, because available is
 * 100 for all of them. It only differs when a team could not be assessed on some
 * dimension — and there, ranking by raw total would punish them for a tool this kit
 * cannot read rather than for anything they did. Badges break ties.
 */
const share = (r) => (r.available > 0 ? r.total / r.available : 0);

const clean = rows.filter((r) => !r.result.integrity.penalised)
  .sort((a, b) => share(b.result) - share(a.result)
    || (b.result.badges?.length ?? 0) - (a.result.badges?.length ?? 0));
const penalised = rows.filter((r) => r.result.integrity.penalised);
// `incomplete` — points that could never be assessed (an unreadable AI tool). Permanent.
// `pending`    — judgements and demo scores a coach still owes. Actionable right now.
/**
 * Dimensions something could not be measured for, excluding ones simply awaiting a coach.
 *
 * Each is reported with the reason the criterion itself gave, because "unassessed" covers
 * two different situations and only the criterion knows which: a permanently unreadable
 * source (no transcripts for that AI tool) versus a re-runnable one (the suite was
 * skipped with --no-run-tests). Claiming nothing can change either would be wrong half
 * the time.
 */
const unassessable = (r) => r.dimensions
  .filter((d) => d.status !== 'assessed' && !d.coachScored)
  .map((d) => {
    const why = d.criteria.find((c) => c.status === 'not-harvested' && c.lostBecause)?.lostBecause;
    return d.label + (why ? ' — ' + why : '');
  });

// A team is only listed as `incomplete` when something was genuinely unreadable. A score
// that is merely missing its demo points is *pending*, not incomplete — listing it here
// would tell a coach "no action will change this" about work they are about to do.
const incomplete = clean.filter((r) => unassessable(r.result).length > 0);
const pending = clean.filter((r) => (r.result.awaiting?.length ?? 0) > 0);

/** One short phrase naming an outstanding coach action. */
function describeAwaiting(item) {
  return item.criterion
    ? item.criterion + ' (' + item.needs + ')'
    : item.dimension + ' (' + item.needs + ')';
}

const DIMS = clean[0]?.result.dimensions ?? penalised[0]?.result.dimensions ?? [];
const shortLabel = (d) => d.label.split(/[\s&]+/)[0].slice(0, 6);

console.log('\nLEADERBOARD   (scorer ' + SCORER_VERSION + ', ' + rows.length + ' team(s))\n');
const header = '  #  ' + 'Team'.padEnd(22) + ' Score   of  '
  + DIMS.map((d) => shortLabel(d).padStart(7)).join('') + '   Flags';
console.log(header);
console.log('  ' + '-'.repeat(header.length));

clean.forEach((row, i) => {
  const r = row.result;
  const cells = r.dimensions.map((d) => (d.status === 'not-harvested'
    ? '     --' : (d.earned + '/' + d.available).padStart(7))).join('');
  const flags = [
    r.complete ? null : 'incomplete',
    r.provisional ? 'provisional' : null,
    r.badges?.length ? r.badges.length + ' badge(s)' : null,
    r.integrity.ambiguous.length ? 'review' : null,
  ].filter(Boolean).join(', ');
  console.log('  ' + String(i + 1).padStart(2) + ' ' + row.team.slice(0, 21).padEnd(22)
    + String(r.total).padStart(4) + '  ' + String(r.available).padStart(4) + '  ' + cells
    + '   ' + flags);
});

// Two different states, deliberately reported separately. Conflating them used to tell a
// coach to "resolve" dimensions that were unassessable — work nobody could do — while
// staying silent about the judgements and demo scores actually outstanding.
if (pending.length) {
  console.log('\n  BEFORE DECLARING A WINNER — still waiting on a coach:');
  for (const row of pending) {
    console.log('    ' + row.team.slice(0, 21).padEnd(22)
      + row.result.awaiting.map(describeAwaiting).join('; '));
  }
}

if (incomplete.length) {
  console.log('\n  Ranked by share of assessable points: ' + incomplete.length
    + ' team(s) could not be assessed');
  console.log('  on every dimension. Read each reason — some are permanent, some just');
  console.log('  need the harvest re-running:');
  for (const row of incomplete) {
    console.log('    ' + row.team.slice(0, 21));
    for (const item of unassessable(row.result)) console.log('      ' + item);
  }
}

if (penalised.length) {
  console.log('\n  NICE TRY  — caught instructing the scorer. Automatic zero.\n');
  for (const row of penalised) {
    const first = row.result.integrity.deliberate[0];
    console.log('     ' + row.team.slice(0, 21).padEnd(22) + '  0    '
      + '(would have scored ' + row.result.integrity.wouldHaveScored + ')');
    console.log('       ' + first.file + ':' + first.line + '  ' + first.label);
    console.log('       ' + first.text.slice(0, 100));
    if (row.result.integrity.deliberate.length > 1) {
      console.log('       ...and ' + (row.result.integrity.deliberate.length - 1) + ' more');
    }
  }
}

if (skipped.length) {
  console.log('\n  Skipped:');
  for (const s of skipped) console.log('    ' + s.path + '  (' + s.why + ')');
}

// Per-dimension leaders: a team that placed fourth overall but first on verification
// should find that out.
if (clean.length > 1) {
  console.log('\n  Best per dimension:');
  for (const dim of DIMS) {
    const ranked = clean
      .map((r) => ({ team: r.team, d: r.result.dimensions.find((x) => x.id === dim.id) }))
      .filter((x) => x.d && x.d.status !== 'not-harvested')
      .sort((a, b) => (b.d.earned / (b.d.available || 1)) - (a.d.earned / (a.d.available || 1)));
    if (!ranked.length) continue;
    const top = ranked[0];
    console.log('    ' + dim.label.padEnd(28) + top.team.slice(0, 21).padEnd(22)
      + top.d.earned + '/' + top.d.available);
  }
}
console.log('');

if (args.out) {
  writeFileSync(resolve(args.out), JSON.stringify({
    scorerVersion: SCORER_VERSION,
    rankedAt: new Date().toISOString(),
    teams: [...clean, ...penalised].map((r) => ({ team: r.team, bundle: r.bundle, score: r.result })),
    skipped,
  }, null, 2) + '\n', 'utf8');
  console.log('Wrote ' + resolve(args.out) + '\n');
}

if (args.html) {
  const target = resolve(args.html);
  writeFileSync(target, renderLeaderboard(
    [...clean, ...penalised].map((r) => ({ team: r.team, score: r.result, evidence: r.evidence })),
    { scorerVersion: SCORER_VERSION }
  ), 'utf8');
  console.log('Wrote ' + target);
}
