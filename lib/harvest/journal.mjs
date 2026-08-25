/**
 * journal.mjs — read the session journal a team writes with `/journal`.
 *
 * This is the fallback evidence source for any AI tool whose transcripts cannot be read,
 * and a reflection artefact in its own right. It is deliberately capped by the scorer:
 * a team can write whatever they like here, so it must never outweigh a transcript.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { excerptCollector, source } from './shared.mjs';

const JOURNAL_DIR = '.ai-journal';

/** Headings the /journal template writes. Presence signals a real entry, not a stub. */
const SECTIONS = ['goal', 'approach', 'what worked', 'what went wrong', 'verified', 'next'];

export function harvestJournal(repo) {
  const dir = join(repo, JOURNAL_DIR);
  if (!existsSync(dir)) {
    return { source: source.notHarvested('no ' + JOURNAL_DIR + ' directory — the team did not use /journal') };
  }

  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch (err) {
    return { source: source.notHarvested('could not read ' + JOURNAL_DIR + ': ' + err.message) };
  }
  if (!files.length) {
    return { source: source.empty(JOURNAL_DIR + ' exists but holds no entries') };
  }

  const excerpts = excerptCollector(6);
  const entries = [];
  for (const file of files) {
    const full = join(dir, file);
    let content;
    try {
      if (statSync(full).size > 256 * 1024) continue;
      content = readFileSync(full, 'utf8');
    } catch { continue; }

    const lower = content.toLowerCase();
    const sectionsPresent = SECTIONS.filter((s) => lower.includes(s));
    const words = content.split(/\s+/).filter(Boolean).length;
    entries.push({
      file,
      words,
      sectionsPresent,
      // A stub is an entry with the headings and nothing under them.
      substantive: words >= 40 && sectionsPresent.length >= 3,
    });
    const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('#'));
    if (firstLine) excerpts.offer(firstLine, { file });
  }

  if (!entries.length) {
    return { source: source.empty(JOURNAL_DIR + ' holds no readable entries') };
  }

  return {
    source: source.harvested({ entryCount: entries.length }),
    entryCount: entries.length,
    substantiveEntries: entries.filter((e) => e.substantive).length,
    totalWords: entries.reduce((sum, e) => sum + e.words, 0),
    entries,
    excerpts: excerpts.result(),
  };
}
