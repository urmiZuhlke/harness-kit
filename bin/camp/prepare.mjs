#!/usr/bin/env node
/**
 * prepare — turn a folder of cloned team repositories into what the camp judges read.
 *
 *   node bin/camp/prepare.mjs --repos repos/ --out eval/ --rubric <event>/evaluation-rubric.md
 *
 * Writes, per team, `eval/<team>/facts.json` (the same normalised facts for every team)
 * `eval/<team>/proposal.pdf` and `eval/<team>/sdlc-diagram.png|jpg` (copies of the deck
 * and the diagram image, wherever the team put them), plus
 * `eval/<team>/human-notes.json` for the facilitators only. Copies the rubric to
 * `eval/rubric.md` so the judges, the calibration pass and the report all read the one
 * copy, and prints a pre-flight table of what is missing.
 *
 * Nothing from a team repository is executed.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug } from '../../lib/harvest/history.mjs';
import { FACTS_VERSION, prepareTeam } from '../../lib/camp/prepare.mjs';
import { parseRubric } from '../../lib/camp/rubric.mjs';
import { DEFAULT_DECK_PATH } from '../../lib/camp/submission.mjs';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function help() {
  console.log(`Usage: node bin/camp/prepare.mjs --repos <folder> --out <folder> --rubric <rubric.md> [--deck <path>]

  --repos   one cloned repository per team (from bin/camp/pull.mjs); the folder name is the team
  --out     where the evaluation is prepared (created if missing)
  --rubric  the event's rubric markdown; refused if its areas and sub-criteria do not add up
  --deck    where teams were told to put the deck (default ${DEFAULT_DECK_PATH})
  --team    prepare only this team folder (repeatable), e.g. after re-pulling one repository

Existing score.json files are kept; delete one to have that team judged again.`);
}

const args = { repos: null, out: null, rubric: null, deck: DEFAULT_DECK_PATH, teams: [] };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--repos') args.repos = argv[++i];
  else if (a === '--out') args.out = argv[++i];
  else if (a === '--rubric') args.rubric = argv[++i];
  else if (a === '--deck') args.deck = argv[++i];
  else if (a === '--team') args.teams.push(argv[++i]);
  else if (a === '-h' || a === '--help') { help(); process.exit(0); }
  else { console.error('Unknown argument: ' + a + '\n'); help(); process.exit(1); }
}
if (!args.repos || !args.out || !args.rubric) { help(); process.exit(1); }

const rubricText = readFileSync(resolve(args.rubric), 'utf8');
let rubric;
try { rubric = parseRubric(rubricText); } catch (err) {
  console.error(err.message);
  process.exit(1);
}

const reposDir = resolve(args.repos);
const outDir = resolve(args.out);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'rubric.md'), rubricText, 'utf8');

// Only folders that are git repositories of their own are teams. `leaderboard --repos`
// writes a `judging/` folder into the same place, and a folder that is not its own
// repository would be read as part of whatever repository contains it (kit rule 10).
const notRepos = [];
const teams = readdirSync(reposDir)
  .filter((name) => !name.startsWith('.'))
  .filter((name) => { try { return statSync(join(reposDir, name)).isDirectory(); } catch { return false; } })
  .filter((name) => { if (existsSync(join(reposDir, name, '.git'))) return true; notRepos.push(name); return false; })
  .filter((name) => !args.teams.length || args.teams.includes(name))
  .sort();
if (notRepos.length) console.log('Not a team (no .git), skipped: ' + notRepos.join(', '));

// Teams pull expected but could not clone: carried as failed rows so they stay visible.
let pulled = null;
try { pulled = JSON.parse(readFileSync(join(reposDir, '.pull.json'), 'utf8')); } catch { /* not from pull.mjs */ }
const notPulled = (pulled?.failed ?? [])
  .filter((f) => !teams.includes(f.team) && (!args.teams.length || args.teams.includes(f.team)));
if (!teams.length && !notPulled.length) { console.error('No team repositories in ' + reposDir); process.exit(1); }

const bySlug = new Map();
for (const name of teams) {
  const key = slug(name) || 'unnamed';
  if (bySlug.has(key)) { console.error('Two folders become the same team id "' + key + '": ' + bySlug.get(key) + ', ' + name); process.exit(1); }
  bySlug.set(key, name);
}

// The judge's Read tool renders PDF page ranges with poppler. Without it, a deck over
// 20 MB cannot be read at all, so its absence is checked here rather than discovered by
// a judge in the middle of the run.
let hasPoppler = false;
try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); hasPoppler = true; } catch { /* not installed */ }

const started = Date.now();
const rows = [];
for (const [id, name] of bySlug) {
  const teamDir = join(outDir, id);
  mkdirSync(teamDir, { recursive: true });
  try {
    const { facts, humanNotes, deckFile, diagramFile, diagramCopy, preflight } = await prepareTeam(join(reposDir, name), {
      team: id, kitRoot: KIT_ROOT, deckPath: args.deck,
    });
    const factsText = JSON.stringify(facts, null, 1) + '\n';
    const factsPath = join(teamDir, 'facts.json');
    const before = existsSync(factsPath) ? readFileSync(factsPath, 'utf8') : null;
    // A scorecard judged against different facts (the repository was pulled again) is moved
    // aside, so the next /camp-evaluate judges this team again instead of keeping it.
    if (before !== null && before !== factsText && existsSync(join(teamDir, 'score.json'))) {
      renameSync(join(teamDir, 'score.json'), join(teamDir, 'score.stale.json'));
      preflight.problems.push('facts changed since it was judged (repository re-pulled or kit updated) — old score moved to score.stale.json, will be judged again');
    }
    writeFileSync(factsPath, factsText, 'utf8');
    writeFileSync(join(teamDir, 'human-notes.json'), JSON.stringify(humanNotes, null, 2) + '\n', 'utf8');
    // A deck that has gone since the last run must not be judged from the old copy.
    if (deckFile) copyFileSync(deckFile, join(teamDir, 'proposal.pdf'));
    else rmSync(join(teamDir, 'proposal.pdf'), { force: true });
    for (const ext of ['.png', '.jpg']) rmSync(join(teamDir, 'sdlc-diagram' + ext), { force: true });
    if (diagramFile) copyFileSync(diagramFile, join(teamDir, diagramCopy));
    if (existsSync(join(teamDir, 'score.json'))) preflight.problems.push('score.json already present — kept');
    rows.push(preflight);
  } catch (err) {
    // No facts from an earlier run may stand in for this one; the report names the team.
    rmSync(join(teamDir, 'facts.json'), { force: true });
    rows.push({ team: id, deck: '?', pages: null, megabytes: null, diagram: '?', historyFiles: 0, gitAuthors: null, commits: null, testFiles: 0,
      failed: true, problems: ['could not prepare: ' + err.message] });
  }
}

for (const f of notPulled) {
  const key = slug(f.team) || 'unnamed';
  rmSync(join(outDir, key, 'facts.json'), { force: true });
  bySlug.set(key, f.team);
  rows.push({ team: key, deck: '?', pages: null, megabytes: null, diagram: '?', historyFiles: 0,
    gitAuthors: null, commits: null, testFiles: 0, failed: true, problems: ['not pulled: ' + f.why] });
}

// The manifest's team list is what the report holds every result to, so preparing one
// team again (--team) adds to it rather than replacing it.
const manifestPath = join(outDir, 'manifest.json');
let earlierTeams = [];
if (args.teams.length && existsSync(manifestPath)) {
  try { earlierTeams = JSON.parse(readFileSync(manifestPath, 'utf8')).teams ?? []; } catch { /* rewritten below */ }
}

writeFileSync(manifestPath, JSON.stringify({
  kind: 'camp-evaluation',
  factsVersion: FACTS_VERSION,
  preparedAt: new Date().toISOString(),
  rubric: {
    source: resolve(args.rubric),
    sha256: createHash('sha256').update(rubricText).digest('hex'),
    total: rubric.total,
    areas: rubric.areas.map((a) => ({ id: a.id, title: a.title, max: a.max })),
  },
  deckPath: args.deck,
  tools: { poppler: hasPoppler },
  teams: [...new Set([...earlierTeams, ...bySlug.keys()])].sort(),
}, null, 2) + '\n', 'utf8');

const table = [
  '| Team | Deck | Pages | MB | Diagram | History files | Git authors | Commits | Test files | Problems |',
  '| ---- | ---- | ----: | --: | ------- | ------------: | ----------: | ------: | ---------: | -------- |',
  ...rows.map((r) => '| ' + [r.team, r.deck, r.pages ?? '—', r.megabytes ?? '—', r.diagram, r.historyFiles, r.gitAuthors ?? '—',
    r.commits ?? '—', r.testFiles, r.problems.join('; ') || 'none'].join(' | ') + ' |'),
];
writeFileSync(join(outDir, 'preflight.md'), '# Pre-flight\n\n' + table.join('\n') + '\n', 'utf8');

console.log('\nPRE-FLIGHT   ' + rows.length + ' team(s), rubric ' + rubric.total + ' points in '
  + rubric.areas.length + ' areas, ' + ((Date.now() - started) / 1000).toFixed(1) + ' s\n');
console.log('  ' + 'Team'.padEnd(22) + 'Deck'.padEnd(11) + 'Pages'.padStart(5) + '  Diagram  ' + 'Hist'.padStart(6)
  + 'Auth'.padStart(6) + 'Tests'.padStart(7) + '   Problems');
for (const r of rows) {
  console.log('  ' + r.team.slice(0, 21).padEnd(22) + r.deck.padEnd(11) + String(r.pages ?? '—').padStart(5)
    + '  ' + r.diagram.padEnd(9) + String(r.historyFiles).padStart(6) + String(r.gitAuthors ?? '—').padStart(6)
    + String(r.testFiles).padStart(7) + '   ' + (r.problems.join('; ') || '—'));
}
console.log('\nWrote ' + outDir + '/<team>/facts.json for ' + rows.length + ' team(s), and preflight.md.');
// The judge reads a PDF over 10 pages or 20 MB in page ranges, which needs poppler.
const bigDecks = rows.filter((r) => (r.megabytes ?? 0) > 20 || (r.pages ?? 0) > 10
  || (['found', 'misplaced'].includes(r.deck) && r.pages === null));
if (bigDecks.length && !hasPoppler) {
  console.log('\n  !! poppler is not installed, and ' + bigDecks.map((r) => r.team).join(', ')
    + ' submitted a deck over 20 MB or over 10 pages.');
  console.log('  !! The judge cannot read those decks without it. Run: brew install poppler\n');
}
const blocked = rows.filter((r) => ['lfs-pointer', 'not-a-pdf'].includes(r.deck)
  || ['lfs-pointer', 'not-an-image'].includes(r.diagram));
if (blocked.length) {
  console.log('\n  !! Fix before judging — file present but unreadable: '
    + blocked.map((r) => r.team + ' (deck ' + r.deck + ', diagram ' + r.diagram + ')').join(', ') + '\n');
}
const needsPoppler = bigDecks.length && !hasPoppler;

const failed = rows.filter((r) => r.failed);
// Judging now would score decks and diagrams nobody could read, so this is an error.
if ((blocked.length || needsPoppler) && !failed.length) {
  console.log('Fix the !! lines above, run prepare again, then /camp-evaluate.\n');
  process.exit(2);
}
if (failed.length) {
  console.log('\n' + failed.length + ' team(s) could not be prepared: ' + failed.map((r) => r.team).join(', ')
    + '. The report will refuse to publish until they are — fix and re-run with --team <name>.\n');
  process.exit(1);
}
console.log('Next, in Claude Code in the kit repo:  /camp-evaluate ' + args.out + '\n');
