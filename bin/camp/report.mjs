#!/usr/bin/env node
/**
 * report — validate every team's scorecard, apply calibration, and write the results.
 *
 *   node bin/camp/report.mjs eval/                 # write results.md, results.csv, results.html
 *   node bin/camp/report.mjs eval/ --check         # validate only; writes nothing
 *   node bin/camp/report.mjs eval/ --check --team team-alpha
 *   node bin/camp/report.mjs eval/ --exclude team-x   # publish without a team that failed
 *
 * Writes results.md / results.csv / results.html, which may be shown to anyone, and
 * review.html, the facilitators' side-by-side view with the notes for the human review.
 *
 * Reads the rubric prepare copied to `eval/rubric.md`. Totals are computed here from the
 * sub-criteria and never read from a card. If any card is missing or invalid, or any
 * calibration change cannot be applied, nothing is written and the exit code is 1: a
 * results table with one team silently missing is worse than no table.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseRubric } from '../../lib/camp/rubric.mjs';
import { applyCalibration, validateScorecard } from '../../lib/camp/scorecard.mjs';
import { closeCalls, rankTeams, toCsv, toHtml, toMarkdown } from '../../lib/camp/report.mjs';
import { toReviewHtml } from '../../lib/camp/review.mjs';

function help() {
  console.log(`Usage: node bin/camp/report.mjs <eval folder> [--check] [--team <id>] [--exclude <id>] [--close <n>]

  --check    validate scorecards (and calibration.json, if present) and write nothing
  --team     with --check only: validate just this team (repeatable) — used after each judge
  --exclude  leave this team out (repeatable) and publish the rest; the results say it was
             not scored. For a team that cannot be judged in time — never to hide a score.
  --close    flag places in the top five whose totals are within this many points (default 3)
  --rubric   a rubric other than <eval folder>/rubric.md

Writes results.md, results.csv and results.html (shareable) and review.html (facilitators
only: side by side, with evidence, links to the files, and the notes for human review).`);
}

const args = { dir: null, check: false, teams: [], exclude: [], close: 3, rubric: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--check') args.check = true;
  else if (a === '--team') args.teams.push(argv[++i]);
  else if (a === '--exclude') args.exclude.push(argv[++i]);
  else if (a === '--close') {
    args.close = Number(argv[++i]);
    if (!Number.isInteger(args.close) || args.close < 0) { console.error('--close needs a whole number of points'); process.exit(1); }
  }
  else if (a === '--rubric') args.rubric = argv[++i];
  else if (a === '-h' || a === '--help') { help(); process.exit(0); }
  else if (!a.startsWith('-') && !args.dir) args.dir = a;
  else { console.error('Unknown argument: ' + a + '\n'); help(); process.exit(1); }
}
if (!args.dir) { help(); process.exit(1); }
// Publishing a subset silently was the one way to lose a team from the results without a
// trace, so a partial publication must say what it left out: --exclude, not --team.
if (args.teams.length && !args.check) {
  console.error('--team only works with --check. To publish without a team, use --exclude <team>.');
  process.exit(1);
}

const dir = resolve(args.dir);
const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

let rubric;
try { rubric = parseRubric(readFileSync(resolve(args.rubric ?? join(dir, 'rubric.md')), 'utf8')); } catch (err) {
  console.error('Could not read the rubric: ' + err.message);
  process.exit(1);
}

// The manifest lists every team prepare was given, so a team whose preparation failed is
// reported rather than silently left out of the ranking. Without one, the folders decide.
let manifestTeams = null;
try { manifestTeams = loadJson(join(dir, 'manifest.json')).teams ?? null; } catch { /* folders decide */ }
const teams = (manifestTeams ?? readdirSync(dir)
  .filter((name) => { try { return statSync(join(dir, name)).isDirectory(); } catch { return false; } })
  .filter((name) => existsSync(join(dir, name, 'facts.json'))))
  .filter((name) => !args.teams.length || args.teams.includes(name))
  .filter((name) => !args.exclude.includes(name))
  .sort();
const unknownExcluded = args.exclude.filter((t) => !(manifestTeams ?? []).includes(t) && !existsSync(join(dir, t)));
if (unknownExcluded.length) { console.error('Not a team in ' + dir + ': ' + unknownExcluded.join(', ')); process.exit(1); }
if (!teams.length) { console.error('No prepared teams in ' + dir + ' — run bin/camp/prepare.mjs first.'); process.exit(1); }

const errors = [];
for (const team of teams) {
  if (!existsSync(join(dir, team, 'facts.json'))) errors.push(team + ': not prepared (no facts.json) — re-run prepare');
}
const cards = new Map();
const humanNotes = new Map();
const facts = new Map();
for (const team of teams) {
  const path = join(dir, team, 'score.json');
  if (!existsSync(path)) { errors.push(team + ': not scored (no score.json)'); continue; }
  let card;
  try { card = loadJson(path); } catch (err) { errors.push(team + ': score.json is not valid JSON — ' + err.message); continue; }
  const result = validateScorecard(card, rubric, { team });
  for (const w of result.warnings) console.log('  ' + team + ': ' + w);
  if (result.errors.length) { errors.push(...result.errors.map((e) => team + ': ' + e)); continue; }
  cards.set(team, card);
  try { humanNotes.set(team, loadJson(join(dir, team, 'human-notes.json'))); } catch { /* optional */ }
  try { facts.set(team, loadJson(join(dir, team, 'facts.json'))); } catch { /* reported above */ }
}

let calibration = null;
const calibrationPath = join(dir, 'calibration.json');
if (existsSync(calibrationPath)) {
  try { calibration = loadJson(calibrationPath); } catch (err) { errors.push('calibration.json is not valid JSON — ' + err.message); }
}
// A single-team check ignores calibration: it runs before calibration exists, and changes
// for other teams would be reported as errors against cards that were never loaded.
if (args.teams.length) calibration = null;
// Changes for an excluded team have no card to apply to; they are dropped, and said so.
if (calibration && Array.isArray(calibration.changes) && args.exclude.length) {
  const dropped = calibration.changes.filter((c) => args.exclude.includes(c?.team));
  if (dropped.length) console.log('  ' + dropped.length + ' calibration change(s) for excluded team(s) not applied.');
  calibration = { ...calibration, changes: calibration.changes.filter((c) => !args.exclude.includes(c?.team)) };
}
const calibrated = applyCalibration(cards, calibration, rubric);
errors.push(...calibrated.errors);

if (errors.length) {
  console.error('\n' + errors.length + ' problem(s):');
  for (const e of errors) console.error('  ' + e);
  console.error('\nNothing written. Re-judge the teams named above, or fix calibration.json, then run this again.');
  if (!args.check && existsSync(join(dir, 'results.html'))) {
    console.error('Note: results.* in this folder are from an EARLIER run — do not share them.');
  }
  process.exit(1);
}

const rows = rankTeams(teams.map((team) => ({
  team, card: calibrated.cards.get(team), humanNotes: humanNotes.get(team),
})), rubric);

console.log('\n  Rank  ' + 'Team'.padEnd(22) + rubric.areas.map((a) => a.id.padStart(4)).join('') + '  Total');
for (const r of rows) {
  console.log('  ' + String(r.rank).padStart(4) + '  ' + r.team.slice(0, 21).padEnd(22)
    + rubric.areas.map((a) => String(r.areas[a.id]).padStart(4)).join('') + String(r.total).padStart(7));
}
if (calibrated.applied.length) console.log('\n  ' + calibrated.applied.length + ' calibration change(s) applied.');
const calls = closeCalls(rows, { margin: args.close });
for (const c of calls) console.log('  CLOSE CALL: ' + c.a + ' (' + c.aTotal + ') vs ' + c.b + ' (' + c.bTotal + ') — decide by hand');
if (args.exclude.length) console.log('  Not scored (excluded): ' + args.exclude.join(', '));

if (args.check) {
  console.log('\n  ' + rows.length + ' scorecard(s) valid. Nothing written (--check).\n');
  process.exit(0);
}

const options = { applied: calibrated.applied, generatedAt: new Date().toISOString(), excluded: args.exclude, calls };
writeFileSync(join(dir, 'results.md'), toMarkdown(rows, rubric, options), 'utf8');
writeFileSync(join(dir, 'results.csv'), toCsv(rows, rubric, options), 'utf8');
writeFileSync(join(dir, 'results.html'), toHtml(rows, rubric, options), 'utf8');
writeFileSync(join(dir, 'review.html'), toReviewHtml(rows, rubric, { ...options, evalDir: dir, facts }), 'utf8');
console.log('\n  Wrote results.md, results.csv, results.html (shareable) and review.html (facilitators only)');
console.log('  in ' + dir + '\n');
