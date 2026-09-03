#!/usr/bin/env node
/**
 * leaderboard — rank every team from their collected bundles.
 *
 * This is the facilitator-side command and the authoritative one. It **recomputes** each score
 * from `evidence.json` and ignores whatever `score.json` a bundle contains, so a team that
 * hand-edits their own score changes nothing. Every team is scored by this one build of
 * the scorer, which is what makes the ranking defensible.
 *
 *   node bin/leaderboard.mjs --dir collected       # every file, one flat folder
 *   node bin/leaderboard.mjs bundles/*             # or one directory per team
 *
 * The flat folder is the normal way. Each person hands in one file from
 * `vibecheck --team "<name>"`; drop all of them into one folder and point `--dir` at it.
 * Files are grouped by the team name stamped inside them and several members of one team
 * are merged into a single score, so there is nothing to organise by hand.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeEvidence } from '../lib/harvest/merge.mjs';
import { slug } from '../lib/harvest/index.mjs';
import { judgingBundle } from '../lib/score/judging-bundle.mjs';
import { score, SCORER_VERSION } from '../lib/score/index.mjs';
import { renderLeaderboard } from '../lib/report/render.mjs';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { bundles: [], dir: null, out: null, html: null, help: false, judgingFiles: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') args.dir = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--html') args.html = argv[++i];
    else if (arg === '--no-judging-files') args.judgingFiles = false;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else args.bundles.push(arg);
  }
  return args;
}

function help() {
  console.log(`Usage: node bin/leaderboard.mjs --dir <folder> [--out <file.json>] [--html <file>]

Recomputes every team's score from their evidence and ranks them. Any score.json handed in
is ignored — the evidence is the source of truth, so editing your own score achieves
nothing.

Collect every file everyone handed in into one flat folder and point --dir at it:

  collected/
    team-blue--ana.json          one per person, from vibecheck --team "Team Blue"
    team-blue--marko.json        members of a team are merged automatically
    team-red--jelena.json
    team-blue.scorecard.json     you write these: demo score, checklist, badges
    team-blue.judgement.json     written by /facilitator-judge

A bundle directory still works: a folder holding evidence.json, and optionally
facilitator-scorecard.json and judgement.json beside it.

Running this also writes <folder>/judging/<team>.json — one small file per team holding
only the excerpts /facilitator-judge reads. Judge from those, not from the evidence:
they leave out the committer names, repository paths, branch names and test output that
a judgement does not depend on. Pass --no-judging-files to skip writing them.

Options:
  --dir <folder>   A flat folder of handed-in files, or a parent of bundle directories
  --no-judging-files  Do not write the trimmed per-team files for /facilitator-judge
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

/**
 * A file a facilitator wrote about a team, rather than evidence a team handed in.
 * Named `<team-slug>.scorecard.json` / `<team-slug>.judgement.json` so both can live in
 * the same flat folder as the evidence without being mistaken for it.
 */
const FACILITATOR_FILE = /^(.+)\.(scorecard|judgement)\.json$/i;

const skipped = [];

/**
 * Everything handed in, as one entry per person, plus the facilitator's own files keyed by
 * team slug. Accepts a flat folder of files, a bundle directory, or both.
 */
function collect(paths, dir) {
  const members = [];
  const facilitatorFiles = { scorecard: new Map(), judgement: new Map() };

  const addBundle = (candidate) => {
    const bundle = resolveBundle(candidate);
    if (!bundle) { skipped.push({ path: candidate, why: 'no evidence.json' }); return; }
    const evidence = loadJson(join(bundle, 'evidence.json'));
    if (!evidence) { skipped.push({ path: candidate, why: 'evidence.json is unreadable' }); return; }
    const scorecard = loadJson(join(bundle, 'facilitator-scorecard.json'));
    const judgement = loadJson(join(bundle, 'judgement.json'));
    const key = teamKeyOf(evidence, scorecard, basename(candidate));
    if (scorecard) facilitatorFiles.scorecard.set(key, scorecard);
    if (judgement) facilitatorFiles.judgement.set(key, judgement);
    members.push({ key, label: memberLabelOf(evidence, bundle), evidence });
  };

  for (const candidate of paths) addBundle(candidate);

  if (dir) {
    const parent = resolve(dir);
    let entries;
    try { entries = readdirSync(parent); } catch (err) {
      console.error('Could not read --dir ' + parent + ': ' + err.message);
      process.exit(1);
    }
    for (const name of entries) {
      const full = join(parent, name);
      let isDir = false;
      try { isDir = statSync(full).isDirectory(); } catch { continue; }
      if (isDir) { addBundle(full); continue; }
      if (!name.toLowerCase().endsWith('.json')) continue;

      const facilitatorMatch = name.match(FACILITATOR_FILE);
      if (facilitatorMatch) {
        const parsed = loadJson(full);
        if (!parsed) { skipped.push({ path: full, why: 'unreadable' }); continue; }
        facilitatorFiles[facilitatorMatch[2].toLowerCase()].set(slug(facilitatorMatch[1]), parsed);
        continue;
      }
      const evidence = loadJson(full);
      // A stray JSON file in the folder is not an error worth stopping for, but it is
      // worth naming: a mistyped scorecard filename would otherwise vanish silently.
      if (!evidence?.chat) { skipped.push({ path: full, why: 'not an evidence file' }); continue; }
      members.push({
        key: teamKeyOf(evidence, null, basename(name, '.json')),
        label: memberLabelOf(evidence, full),
        evidence,
      });
    }
  }
  return { members, facilitatorFiles };
}

/** What links several machines into one team. The stamped name wins over everything. */
function teamKeyOf(evidence, scorecard, fallback) {
  return slug(evidence?.team?.name ?? scorecard?.team ?? evidence?.repo?.name ?? fallback)
    || 'unnamed';
}

/** Who produced this file, for the per-member breakdown on a merged bundle. */
function memberLabelOf(evidence, path) {
  return evidence?.team?.member ?? basename(path, '.json');
}

const { members, facilitatorFiles } = collect(args.bundles.map((b) => resolve(b)), args.dir);
if (!members.length) {
  for (const s of skipped) console.error('Skipped ' + s.path + '  (' + s.why + ')');
  console.error('\nNothing to rank — no readable evidence was found.');
  process.exit(1);
}

// Group by team, then merge each team's members into one bundle. A team of five hands in
// five files; scoring them separately would rank the same team five times, each on one
// person's day.
const byTeam = new Map();
for (const member of members) {
  if (!byTeam.has(member.key)) byTeam.set(member.key, []);
  byTeam.get(member.key).push(member);
}

const rows = [];
for (const [key, group] of byTeam) {
  let evidence = group[0].evidence;
  let mergeWarnings = [];
  if (group.length > 1) {
    try {
      const merged = mergeEvidence(group.map((m) => ({ label: m.label, evidence: m.evidence })));
      evidence = merged.evidence;
      mergeWarnings = merged.warnings;
    } catch (err) {
      skipped.push({ path: key, why: 'could not merge ' + group.length + ' file(s): ' + err.message });
      continue;
    }
  }
  const scorecard = facilitatorFiles.scorecard.get(key) ?? null;
  const judgement = facilitatorFiles.judgement.get(key) ?? null;
  // Recompute. Any score.json handed in alongside is deliberately not read.
  const result = score(evidence, {
    facilitatorScorecard: scorecard,
    judgement,
    repoPath: evidence?.repo?.path,
    kitRoot: KIT_ROOT,
    practice: false,
  });
  rows.push({
    team: evidence?.team?.name ?? scorecard?.team ?? evidence?.repo?.name ?? key,
    bundle: key,
    members: group.length,
    mergeWarnings,
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

const clean = [...rows]
  .sort((a, b) => share(b.result) - share(a.result)
    || (b.result.badges?.length ?? 0) - (a.result.badges?.length ?? 0));
// `incomplete` — points that could never be assessed (an unreadable AI tool). Permanent.
// `pending`    — judgements and demo scores a facilitator still owes. Actionable right now.
/**
 * Dimensions something could not be measured for, excluding ones simply awaiting a facilitator.
 *
 * Each is reported with the reason the criterion itself gave, because "unassessed" covers
 * two different situations and only the criterion knows which: a permanently unreadable
 * source (no transcripts for that AI tool) versus a re-runnable one (the suite was
 * skipped with --no-run-tests). Claiming nothing can change either would be wrong half
 * the time.
 */
const unassessable = (r) => r.dimensions.flatMap((d) => {
  // Only criteria nobody *can* assess. A criterion waiting on a facilitator is pending,
  // not unassessable, and the block above already reports it — listing it here would tell
  // a facilitator "no action will change this" about work they are about to do.
  const unreadable = d.criteria.filter((c) => c.status === 'not-harvested' && !c.facilitatorScored);
  if (!unreadable.length) return [];
  const why = unreadable.find((c) => c.lostBecause)?.lostBecause;
  return [d.label + (why ? ' — ' + why : '')];
});

// A team is only listed as `incomplete` when something was genuinely unreadable. A score
// that is merely missing its demo points is *pending*, not incomplete — listing it here
// would tell a facilitator "no action will change this" about work they are about to do.
const incomplete = clean.filter((r) => unassessable(r.result).length > 0);
const pending = clean.filter((r) => (r.result.awaiting?.length ?? 0) > 0);

/** One short phrase naming an outstanding facilitator action. */
function describeAwaiting(item) {
  return item.criterion
    ? item.criterion + ' (' + item.needs + ')'
    : item.dimension + ' (' + item.needs + ')';
}

const DIMS = clean[0]?.result.dimensions ?? [];
const shortLabel = (d) => d.label.split(/[\s&]+/)[0].slice(0, 6);

console.log('\nLEADERBOARD   (scorer ' + SCORER_VERSION + ', ' + rows.length + ' team(s))\n');
const header = '  #  ' + 'Team'.padEnd(22) + ' Score   of  ' + ' Ppl'
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
    r.facilitatorNotes.strong.length + r.facilitatorNotes.weak.length ? 'has notes' : null,
  ].filter(Boolean).join(', ');
  console.log('  ' + String(i + 1).padStart(2) + ' ' + row.team.slice(0, 21).padEnd(22)
    + String(r.total).padStart(4) + '  ' + String(r.available).padStart(4) + '  '
    + String(row.members).padStart(4) + cells + '   ' + flags);
});

// Two different states, deliberately reported separately. Conflating them used to tell a
// facilitator to "resolve" dimensions that were unassessable — work nobody could do — while
// staying silent about the judgements and demo scores actually outstanding.
if (pending.length) {
  console.log('\n  BEFORE DECLARING A WINNER — still waiting on a facilitator:');
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

// Notes from the injection scan. They deduct nothing and rank nobody — a facilitator reads them
// and decides what, if anything, they mean. Listed last so they never colour how the
// table above is read.
// A bundle whose repo is not on this machine had only its evidence excerpts scanned. Say
// so, or "no notes" reads as an all-clear nobody actually earned.
// `scanned` is null when the bundle carried no repo path at all, which is the same silence
// this block exists to break — so both cases count as unscanned.
const unscanned = clean.filter((r) => !r.result.facilitatorNotes.scanned
  || r.result.facilitatorNotes.scanned.repoScanned === false);
if (unscanned.length) {
  console.log('\n  Repo files not scanned for ' + unscanned.length + ' team(s) — their repo');
  console.log('  is not on this machine, so only the evidence excerpts were read:');
  for (const row of unscanned) console.log('    ' + row.team.slice(0, 21));
}

const withNotes = clean.filter((r) => r.result.facilitatorNotes.strong.length);
if (withNotes.length) {
  console.log('\n  Worth a second look (no points affected, no conclusion drawn):\n');
  for (const row of withNotes) {
    const first = row.result.facilitatorNotes.strong[0];
    console.log('     ' + row.team.slice(0, 21).padEnd(22)
      + first.file + ':' + first.line + '  ' + first.label);
    console.log('       ' + first.text.slice(0, 100));
    if (row.result.facilitatorNotes.strong.length > 1) {
      console.log('       ...and ' + (row.result.facilitatorNotes.strong.length - 1) + ' more');
    }
  }
}

// How many people each team's score actually covers. A team of five that hands in one
// file is scored on one person's day, and nothing else in the output looks wrong — so it
// is named here rather than left for someone to notice.
const thin = clean.filter((r) => r.members === 1);
if (thin.length && clean.some((r) => r.members > 1)) {
  console.log('\n  Only one person\u2019s evidence for ' + thin.length + ' team(s): '
    + thin.map((r) => r.team.slice(0, 21)).join(', '));
  console.log('  If those teams had more than one member, the missing files are worth');
  console.log('  chasing before you rank anyone — transcripts live on each laptop.');
}

for (const row of clean) {
  for (const warning of row.mergeWarnings ?? []) {
    console.log('\n  ! ' + row.team.slice(0, 21) + ': ' + warning);
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

// One trimmed file per team, for the judging pass. Written by default rather than behind
// a flag: a facilitator who forgets the flag would hand a model a hundred people's
// committer names and home-directory paths, and forgetting is the normal case.
if (args.judgingFiles && args.dir && clean.length) {
  const judgingDir = join(resolve(args.dir), 'judging');
  try {
    mkdirSync(judgingDir, { recursive: true });
    for (const row of clean) {
      writeFileSync(join(judgingDir, row.bundle + '.json'),
        JSON.stringify(judgingBundle(row.evidence), null, 2) + '\n', 'utf8');
    }
    console.log('\n  For /facilitator-judge, judge these rather than the evidence:');
    console.log('    ' + judgingDir);
    console.log('  They hold the harness, context and prompt excerpts only — no committer');
    console.log('  names, repository paths, branch names or test output.\n');
  } catch (err) {
    console.error('  Could not write the judging files: ' + err.message);
  }
}

if (args.out) {
  writeFileSync(resolve(args.out), JSON.stringify({
    scorerVersion: SCORER_VERSION,
    rankedAt: new Date().toISOString(),
    teams: clean.map((r) => ({ team: r.team, bundle: r.bundle, score: r.result })),
    skipped,
  }, null, 2) + '\n', 'utf8');
  console.log('Wrote ' + resolve(args.out) + '\n');
}

if (args.html) {
  const target = resolve(args.html);
  writeFileSync(target, renderLeaderboard(
    clean.map((r) => ({ team: r.team, score: r.result, evidence: r.evidence })),
    { scorerVersion: SCORER_VERSION }
  ), 'utf8');
  console.log('Wrote ' + target);
}
