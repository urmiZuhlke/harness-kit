#!/usr/bin/env node
/**
 * vibecheck — harvest the evidence for a team's repo.
 *
 * Run this on the machine the team actually worked on: AI chat transcripts live in the
 * user's home directory, not in the repo, so a facilitator running it elsewhere would see the
 * files but none of the process. Scoring is a separate step that reads the evidence file
 * this produces, so it can run anywhere.
 *
 *   node bin/vibecheck.mjs                 # harvest the current directory
 *   node bin/vibecheck.mjs --repo ../app   # harvest somewhere else
 *   node bin/vibecheck.mjs --no-run-tests  # skip executing the test suite
 *   node bin/vibecheck.mjs --harvest-only  # collect evidence without scoring it
 *   node bin/vibecheck.mjs --evidence team/evidence.json   # score a merged team bundle
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
    quiet: false, harvestOnly: false, explainIntegrity: false, evidenceFile: null,
    repoGiven: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') { args.repo = argv[++i]; args.repoGiven = true; }
    else if (arg === '--evidence') args.evidenceFile = argv[++i];
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

Run it as often as you like — this is practice mode. Facilitator-judged dimensions are marked
provisional until a facilitator scores your demo, and nothing else changes between now and then.

Options:
  --repo <path>          Repository to check (default: current directory)
  --evidence <file>      Score an existing evidence file instead of harvesting. Use this
                         on a team bundle from bin/merge-evidence.mjs. Combine it with
                         --repo to scan the repo you have in front of you rather than the
                         path recorded on whichever machine produced the bundle.
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

// --harvest-only collects evidence; --evidence scores evidence already collected. Asked
// for together they would read a file back and print its own path, which is nobody's
// intention and easy to reach out of habit.
if (args.evidenceFile && args.harvestOnly) {
  console.error('--harvest-only and --evidence do opposite things: one collects evidence, '
    + 'the other scores evidence already collected. Pick one.');
  process.exit(1);
}

const repo = resolve(args.repo);
if (!args.quiet) {
  if (args.evidenceFile) {
    console.log('vibecheck — scoring ' + resolve(args.evidenceFile));
  } else {
    console.log('vibecheck — harvesting ' + repo);
    if (args.runTestSuite) console.log('  (will run the test suite if one is detected; --no-run-tests to skip)');
  }
}

/** Read a bundle handed to us, failing the way the rest of this toolchain fails. */
function readEvidenceFile(path) {
  const full = resolve(path);
  if (!existsSync(full)) {
    console.error('No evidence file at ' + full
      + '\nIf you meant to build one, run: node bin/merge-evidence.mjs --dir <collected> --out <file>');
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch (err) {
    console.error('Could not read ' + full + ': ' + err.message);
    process.exit(1);
  }
}

// Scoring an existing file is the merged-team path: the harvest already happened, once
// per machine, and re-running it here would throw away every other member's evidence.
const evidence = args.evidenceFile
  ? readEvidenceFile(args.evidenceFile)
  : await harvest(repo, {
    kitRoot: KIT_ROOT,
    runTestSuite: args.runTestSuite,
    testTimeoutMs: args.testTimeoutMs,
  });

if (!args.quiet && evidence?.merged) {
  console.log('  merged from ' + evidence.merged.memberCount + ' machine(s): '
    + evidence.merged.members.map((m) => m.label).join(', '));
}

// A merged bundle's report belongs beside the bundle, not inside whichever repo the
// command happened to be run from.
const outDir = args.evidenceFile ? dirname(resolve(args.evidenceFile)) : join(repo, OUTPUT_DIR);
mkdirSync(outDir, { recursive: true });
const outFile = args.evidenceFile ? resolve(args.evidenceFile) : join(outDir, 'evidence.json');
if (!args.evidenceFile) writeFileSync(outFile, JSON.stringify(evidence, null, 2) + '\n', 'utf8');

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

// Which repo the injection scan should read. A merged bundle records the path it had on
// whichever machine produced it, which usually does not exist here — but a --repo the
// operator actually typed beats it, because that is the checkout in front of them. Without
// this, `--evidence bundle.json --repo .` scanned a teammate's laptop path and silently
// reported nothing scanned.
const scanPath = !args.evidenceFile || args.repoGiven ? repo : (evidence?.repo?.path ?? repo);
if (!args.quiet && args.evidenceFile && !args.repoGiven && !existsSync(scanPath)) {
  console.log('  note: the repo this bundle came from (' + scanPath + ') is not on this');
  console.log('        machine, so only the evidence excerpts are scanned. Pass --repo');
  console.log('        <path> to scan your own checkout.');
}

const result = score(evidence, {
  repoPath: scanPath,
  kitRoot: KIT_ROOT,
  facilitatorScorecard: readBundleFile(outDir, 'facilitator-scorecard.json'),
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
  const notes = [...result.facilitatorNotes.strong, ...result.facilitatorNotes.weak];
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
    const sc = result.facilitatorNotes.scanned;
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
