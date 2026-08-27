#!/usr/bin/env node
/**
 * vibecheck — harvest the evidence for a team's repo.
 *
 * Run this on the machine the team actually worked on: AI chat transcripts live in the
 * user's home directory, not in the repo, so a coach running it elsewhere would see the
 * files but none of the process. Scoring is a separate step that reads the evidence file
 * this produces, so it can run anywhere.
 *
 *   node bin/vibecheck.mjs                 # harvest the current directory
 *   node bin/vibecheck.mjs --repo ../app   # harvest somewhere else
 *   node bin/vibecheck.mjs --no-run-tests  # skip executing the test suite
 *
 * Everything happens locally. Nothing is uploaded, and no raw transcript is copied into
 * the output — only counts, classifications and short bounded excerpts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harvest } from '../lib/harvest/index.mjs';
import { score } from '../lib/score/index.mjs';
import { renderReport } from '../lib/report/render.mjs';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = '.vibecheck';

function parseArgs(argv) {
  const args = {
    repo: process.cwd(), runTestSuite: true, testTimeoutMs: 120000,
    quiet: false, harvestOnly: false, explainIntegrity: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') args.repo = argv[++i];
    else if (arg === '--no-run-tests') args.runTestSuite = false;
    else if (arg === '--test-timeout') args.testTimeoutMs = Number(argv[++i]) * 1000;
    else if (arg === '--harvest-only') args.harvestOnly = true;
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--explain-integrity') args.explainIntegrity = true;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else {
      console.error('Unknown option: ' + arg);
      args.help = true;
    }
  }
  return args;
}

function help() {
  console.log(`Usage: node bin/vibecheck.mjs [options]

Harvests how this repo was built with AI, then scores it out of 100 against the rubric in
docs/rubric.md. Writes ${OUTPUT_DIR}/evidence.json and ${OUTPUT_DIR}/score.json.

Run it as often as you like — this is practice mode. Coach-judged dimensions are marked
provisional until a coach scores your demo, and nothing else changes between now and then.

Options:
  --repo <path>          Repository to check (default: current directory)
  --no-run-tests         Do not execute the detected test command
  --test-timeout <secs>  Timeout for the test run (default: 120)
  --harvest-only         Collect evidence without scoring it
  --quiet                Only print the output paths
  --explain-integrity    List exactly which files the injection scan read
  -h, --help             Show this help

Privacy: transcripts are read locally, only aggregate metrics and short excerpts are
written, and nothing is uploaded anywhere.`);
}

/** A JSON file dropped next to the evidence, if one exists — used for both bundle inputs. */
function readBundleFile(dir, name) {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error('Ignoring unreadable ' + name + ': ' + err.message);
    return null;
  }
}

function bar(earned, available, width = 24) {
  if (!available) return '-'.repeat(width);
  const filled = Math.round((earned / available) * width);
  return '#'.repeat(filled) + '.'.repeat(width - filled);
}

function statusLine(name, src) {
  const mark = src.status === 'harvested' ? 'ok  ' : src.status === 'empty' ? '--  ' : '??  ';
  const detail = src.reason ? '  (' + src.reason + ')' : '';
  return '  ' + mark + name.padEnd(12) + src.status + detail;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { help(); process.exit(0); }

const repo = resolve(args.repo);
if (!args.quiet) {
  console.log('vibecheck — harvesting ' + repo);
  if (args.runTestSuite) console.log('  (will run the test suite if one is detected; --no-run-tests to skip)');
}

const evidence = await harvest(repo, {
  kitRoot: KIT_ROOT,
  runTestSuite: args.runTestSuite,
  testTimeoutMs: args.testTimeoutMs,
});

const outDir = join(repo, OUTPUT_DIR);
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'evidence.json');
writeFileSync(outFile, JSON.stringify(evidence, null, 2) + '\n', 'utf8');

if (!args.quiet) {
  console.log('\nSources:');
  for (const [name, src] of Object.entries(evidence.sources)) console.log(statusLine(name, src));

  const t = evidence.chat.totals;
  console.log('\nWhat was observed:');
  console.log('  chat sessions      ' + t.sessionCount);
  console.log('  prompts            ' + t.userPrompts);
  console.log('  tool calls         ' + t.toolCalls);
  console.log('  test runs          ' + t.testRuns.total
    + ' (pass ' + t.testRuns.pass + ', fail ' + t.testRuns.fail + ', unknown ' + t.testRuns.unknown + ')');
  console.log('  fail -> pass loops ' + t.failThenPassSequences);
  console.log('  corrections        ' + t.corrections);
  console.log('  commits            ' + (evidence.gitEvidence.commitCount ?? 'n/a'));
  // All three counters, because printing only the scored one said "secret findings 0" to
  // a team with two credentials sitting in gitignored files. They cost no points, and they
  // are still worth knowing about.
  const safety = evidence.repoEvidence.safety ?? {};
  const secrets = safety.secretFindings?.offered ?? 0;
  const notScored = [
    (safety.localCredentials?.offered ?? 0) ? safety.localCredentials.offered + ' local-only' : null,
    (safety.untrackedCredentials?.offered ?? 0) ? safety.untrackedCredentials.offered + ' untracked' : null,
  ].filter(Boolean);
  console.log('  secret findings    ' + secrets + (secrets ? '   <-- look at these' : '')
    + (notScored.length ? '   (plus ' + notScored.join(', ') + ' — not scored)' : ''));

  if (evidence.noChatEvidence) {
    console.log('\n  No AI chat transcripts could be read for this repo. The dimensions that');
    console.log('  depend on them are reported as not-harvested, not as zero.');
  }
  console.log('');
}

if (args.harvestOnly) {
  console.log(outFile);
  process.exit(0);
}

const result = score(evidence, {
  repoPath: repo,
  kitRoot: KIT_ROOT,
  coachScorecard: readBundleFile(outDir, 'coach-scorecard.json'),
  judgement: readBundleFile(outDir, 'judgement.json'),
  practice: true,
});
const scoreFile = join(outDir, 'score.json');
writeFileSync(scoreFile, JSON.stringify(result, null, 2) + '\n', 'utf8');

const reportFile = join(outDir, 'report.html');
writeFileSync(reportFile, renderReport(result, evidence), 'utf8');

if (!args.quiet) {
  console.log('Score: ' + result.total + '/100'
    + (result.complete ? '' : '   (' + result.available + ' points assessable so far)')
    + (result.provisional ? '   PROVISIONAL' : ''));
  console.log('');
  for (const d of result.dimensions) {
    const label = d.label.padEnd(26);
    if (d.status === 'not-harvested') {
      console.log('  ' + label + '   --/' + String(d.points).padStart(2) + '  not assessed yet ('
        + (d.criteria.find((c) => c.reason)?.reason ?? d.measuredBy) + ')');
      continue;
    }
    console.log('  ' + label + ' ' + String(d.earned).padStart(3) + '/'
      + String(d.available).padStart(2) + '  ' + bar(d.earned, d.available)
      + (d.status === 'partial' ? '  (partly assessed)' : ''));
  }

  if (result.lostPoints.length) {
    console.log('\nWhere the points went:');
    for (const loss of result.lostPoints.slice(0, 6)) {
      console.log('\n  -' + loss.lost + '  ' + loss.dimension + ' / ' + loss.criterion);
      console.log('      ' + loss.reason);
      if (loss.evidence) console.log('      evidence: ' + loss.evidence);
    }
    if (result.lostPoints.length > 6) {
      console.log('\n  ...and ' + (result.lostPoints.length - 6)
        + ' more in ' + OUTPUT_DIR + '/score.json');
    }
  }

  // Notes, not deductions. Phrased so nobody reads a regex hit as an accusation: these
  // change no number, and a human decides whether they mean anything at all.
  const notes = [...result.coachNotes.strong, ...result.coachNotes.weak];
  if (notes.length) {
    console.log('\nWorth a second look (this changes nothing about your score):');
    for (const f of notes.slice(0, 5)) {
      console.log('  ' + f.file + ':' + f.line + '  ' + f.label);
    }
    if (notes.length > 5) {
      console.log('  ...and ' + (notes.length - 5) + ' more in ' + OUTPUT_DIR + '/score.json');
    }
  }

  if (args.explainIntegrity) {
    const sc = result.coachNotes.scanned;
    console.log('\nInjection scan scope: ' + (sc?.scope ?? 'not run'));
    console.log('  files scanned: ' + (sc?.filesScanned ?? 0)
      + (sc?.kitFilesSkipped ? ', kit files skipped: ' + sc.kitFilesSkipped : ''));
    for (const f of sc?.surfaces ?? []) console.log('    ' + f);
    if (sc?.surfacesTruncated) console.log('    ...more not listed');
  }
  console.log('');
}

console.log(outFile);
console.log(scoreFile);
console.log(reportFile);
