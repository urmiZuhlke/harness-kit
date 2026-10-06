#!/usr/bin/env node
/**
 * injection-check — after the evaluation, look for attempts to steer the judges.
 *
 *   node bin/camp/injection-check.mjs eval/            # every team
 *   node bin/camp/injection-check.mjs eval/ --top 5    # only the teams ranked 5th or better
 *
 * Runs separately from the evaluation, on the finished eval folder, so it can never slow or
 * break it. It scans what the pipeline's own scan does not: the full text of each deck
 * (including text that is white, tiny or behind an image — pdftotext extracts it all), chat
 * logs a team kept by hand, and the prompt excerpts of every AI tool. It also gathers what
 * the judges already reported and what prepare's scan found in the repository.
 *
 * Everything here is a note for a human (kit rule 9): it changes no score, and a finding is
 * a reason to look, not a conclusion. Writes <eval>/injection-check.md.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanTextForNotes } from '../../lib/integrity/injection.mjs';

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith('-')) && resolve(argv.find((a) => !a.startsWith('-')));
const topAt = argv.indexOf('--top');
const top = topAt >= 0 ? Number(argv[topAt + 1]) : null;
if (!dir || !existsSync(join(dir, 'manifest.json'))) {
  console.error('Usage: node bin/camp/injection-check.mjs <eval folder> [--top N]');
  process.exit(1);
}

const load = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
let teams = load(join(dir, 'manifest.json'))?.teams ?? [];

// --top N: the ranking from results.csv, ties included.
if (top && existsSync(join(dir, 'results.csv'))) {
  const ranks = new Map(readFileSync(join(dir, 'results.csv'), 'utf8').split(/\r?\n/).slice(1)
    .map((l) => l.split(',')).filter((c) => c[0] && c[1]).map((c) => [c[1].replace(/^"|"$/g, ''), Number(c[0])]));
  teams = teams.filter((t) => (ranks.get(t) ?? Infinity) <= top);
}

let pdftotext = true;
try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { pdftotext = false; }

// Judges' notes worth repeating here: the ones about text aimed at them, not ordinary remarks.
const EVALUATOR_WORDS = /\b(?:evaluator|injection|full marks|ignore (?:all |any )?(?:previous|prior)|addressed to|hidden text|to the (?:ai|judge|reviewer))\b/i;

// In chat content people legitimately tell their own agent "you are a senior developer" and
// talk about system prompts; only the rules that point at the evaluator are reported there.
const CHAT_RULES = new Set(['evaluator-imperative', 'score-demand', 'score-declaration', 'scorer-internals',
  'hidden-styling', 'invisible-characters']);
const chatOnly = (found) => ({ strong: found.strong.filter((f) => CHAT_RULES.has(f.rule)), weak: [] });
const out = [];
let flagged = 0;

for (const team of teams) {
  const notes = [];
  const add = (where, found) => {
    for (const f of found.strong) notes.push('**' + where + '** — ' + f.label + (f.line ? ' (line ' + f.line + ')' : '') + ': `' + String(f.text).slice(0, 200).replace(/`/g, "'") + '`');
  };
  const facts = load(join(dir, team, 'facts.json'));

  // 1. The deck's full text, hidden text included.
  const deck = join(dir, team, 'proposal.pdf');
  if (existsSync(deck)) {
    if (!pdftotext) notes.push('deck text not checked — pdftotext (poppler) is not installed');
    else {
      try {
        const text = execFileSync('pdftotext', ['-q', deck, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        add('deck text', scanTextForNotes(text, 'deck'));
      } catch (err) { notes.push('deck text could not be extracted: ' + err.message.split('\n')[0]); }
    }
  }

  // 2. Chat logs kept by hand, read from the team's clone.
  for (const log of facts?.history?.manualLogs ?? []) {
    const path = join(facts.repo.path, log.path);
    try {
      if (statSync(path).size > 5 * 1024 * 1024) { notes.push(log.path + ' not checked — over 5 MB'); continue; }
      add(log.path, chatOnly(scanTextForNotes(readFileSync(path, 'utf8'), log.path)));
    } catch { /* gone since prepare */ }
  }

  // 3. Every prompt and correction excerpt the judge was given, all tools.
  const excerpts = [...Object.values(facts?.history?.promptExcerpts ?? {}).flat(), ...(facts?.history?.correctionExcerpts ?? [])];
  add('prompt excerpts', chatOnly(scanTextForNotes(excerpts.join('\n'), 'prompt excerpts')));

  // 4. What prepare's repository scan found, and what the judge itself reported.
  for (const f of load(join(dir, team, 'human-notes.json'))?.strong ?? []) {
    notes.push('**repository** — ' + f.label + ' at ' + f.file + ':' + f.line);
  }
  for (const n of load(join(dir, team, 'score.json'))?.notesForHumans ?? []) {
    if (EVALUATOR_WORDS.test(n)) notes.push('**judge noted** — ' + n);
  }

  if (notes.length) flagged++;
  out.push('## ' + team + '\n\n' + (notes.length ? notes.map((n) => '- ' + n).join('\n') : 'Nothing found.') + '\n');
}

const report = '# Injection check — notes for the human review\n\n'
  + 'No score was changed. A finding is a reason to look at the source, not a conclusion.\n'
  + 'Checked: deck text (including hidden text), chat logs kept by hand, prompt excerpts of all tools, '
  + 'the repository scan, and the judges\' own notes. Not checked: text inside images (the diagram).\n\n'
  + out.join('\n');
writeFileSync(join(dir, 'injection-check.md'), report, 'utf8');
console.log('\n  ' + teams.length + ' team(s) checked, ' + flagged + ' with something worth a look.');
console.log('  Wrote ' + join(dir, 'injection-check.md') + '\n');
