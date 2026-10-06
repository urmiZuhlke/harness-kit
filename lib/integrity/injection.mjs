/**
 * injection.mjs — flag text that tries to instruct whatever is reading the repo.
 *
 * **This produces notes for a facilitator. It never changes a score.**
 *
 * An earlier version set the final score to zero on any hit, and printed "Nice try" on
 * the big screen. That was wrong in the only way that really matters: a regex that
 * misfires publicly accuses a team of cheating. It did misfire — `background-color:
 * #FFFFFF` matched a rule looking for `color: white`, and the zero-width joiner inside an
 * ordinary emoji matched a rule looking for concealed text. Both are unremarkable things
 * to have in a repository. A missed injection attempt costs the event very little; a
 * false accusation costs a team their day. So: no automatic penalty, ever. A human looks
 * at these notes and decides.
 *
 * ## What is scanned, and why only that
 *
 * The facilitator judging pass reads `evidence.json` and nothing else — never the repository
 * directly. So the surface an injection could actually reach is small:
 *
 *   1. the **instruction layer** — prose an agent is meant to read as direction
 *      (`AGENTS.md`, `CLAUDE.md`, `README.md`, editor rule files, docs);
 *   2. the **excerpts** already captured into `evidence.json`.
 *
 * Source code, stylesheets, HTML templates, SQL and fixtures are not scanned. Nobody
 * judges a team on them, and scanning them produced hundreds of findings and zero
 * attacks. Narrowing the surface is what makes the remaining findings worth reading.
 *
 * The defence against injection is separate from this file and must hold on its own:
 * content read from a team's repo is data everywhere in this kit, never instructions. If
 * an injection ever actually works, that is our bug, not their win.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

/** Invisible characters that can hide text from a human reviewer but not from a parser. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

/**
 * Emoji are built out of the same zero-width joiner that concealment uses: 🧘\u200D♀\uFE0F is
 * `\u{1F9D8}\u200D♀\uFE0F`. Stripping well-formed pictographic sequences before the
 * concealment test is the difference between "this repo hides text" and "this repo has an
 * emoji in it". Skin-tone and keycap sequences are covered by the same shape.
 *
 * Every zero-width codepoint in this file is written as an escape rather than embedded
 * literally. Embedded, they made the file read as binary to `grep` and `rg`, which then
 * skipped it silently — and an editor or lint autofix that normalised them would have
 * changed the detector with nothing visible in the diff, on the one file rule 9 in
 * AGENTS.md depends on.
 */
const EMOJI_ZWJ_SEQUENCE =
  /\p{Extended_Pictographic}[\p{Emoji_Modifier}\uFE0F]*(?:\u200D\p{Extended_Pictographic}[\p{Emoji_Modifier}\uFE0F]*)+/gu;

/** True when a line contains invisible characters that no legitimate use explains. */
function hasConcealment(line) {
  return INVISIBLE.test(line.replace(EMOJI_ZWJ_SEQUENCE, ''));
}

/**
 * Render invisible characters as visible tokens. Serves two purposes: a finding stays
 * legible when shown on screen, and hidden characters cannot travel onwards inside our
 * own output. Excerpts are stored defanged, never raw.
 */
export function defang(text) {
  return String(text).replace(
    /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g,
    (ch) => '<U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + '>'
  );
}

/** Escape for safe insertion into HTML. Used by the report renderer. */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Language that addresses a reader and tells it what to do. Rules gated on this fire only
 * when the line actually instructs someone — which is what separates an attack from a
 * mention of one.
 */
const DIRECTIVE = new RegExp([
  String.raw`\byou (?:must|should|will|are to|need to)\b`,
  String.raw`\b(?:ignore|disregard)\b`,
  String.raw`\b(?:award|grant)\b`,
  String.raw`\btreat (?:this|it)\b`,
  String.raw`\bregard (?:this|it)\b`,
  String.raw`\bconsider (?:this|it) (?:as|to be)\b`,
  String.raw`\b(?:respond|reply) with\b`,
  String.raw`\boutput (?:only|exactly|the following)\b`,
  String.raw`\bset the (?:score|total|result)\b`,
].join('|'), 'i');

/**
 * Findings a facilitator should look at. High confidence, but still only a note — the facilitator
 * decides what, if anything, it means.
 */
const STRONG = [
  {
    id: 'evaluator-imperative',
    label: 'an instruction addressed at whatever is reading the files',
    re: /\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all)\b[^.\n]{0,20}\b(?:instruction|prompt|rule|direction)/i,
  },
  {
    id: 'role-assignment',
    // Labels describe the text, never the writer's intent. These notes are shown to the
    // team, and "an attempt to…" reads as an accusation when the match is a false positive.
    label: 'text that reads like it assigns the reader a role',
    // `(?! not\b)` because "you are not the judge of whether the user approved" is ordinary
    // guidance in an agent file, and matched this rule until it was excluded by hand.
    re: /\byou are\b(?! not\b)[^.\n]{0,30}\b(?:judge|scorer|evaluator|grader|assessor|examiner)\b/i,
  },
  {
    id: 'score-demand',
    label: 'text that reads like it asks for a specific score',
    re: /\b(?:award|give|assign|grant|set)\b[^.\n]{0,40}\b(?:full|maximum|max|perfect|100|top)\b[^.\n]{0,20}\b(?:mark|point|score|grade)/i,
  },
  {
    id: 'score-declaration',
    label: 'a declaration of the score this repo should receive',
    re: /\b(?:score|rate|grade)\b[^.\n]{0,30}\b(?:this|the)\b[^.\n]{0,20}\b(?:repo|repository|project|team)\b[^.\n]{0,30}\b(?:100|full|maximum|perfect)\b/i,
  },
  {
    id: 'system-prompt-reference',
    label: 'a reference to the reader’s system prompt or instructions',
    re: /\b(?:system prompt|your instructions|as an ai(?: language)? model)\b/i,
  },
  {
    id: 'scorer-internals',
    label: 'text that names the scorer while instructing a reader',
    re: /\b(?:vibecheck|evidence\.json|score\.json|failThenPassSequences|noChatEvidence|templateSimilarity)\b/i,
    // Naming the tool is not an attack — a README that says "we ran vibecheck" is normal.
    // It only counts when the same line also *instructs* a reader.
    requiresDirective: true,
  },
  {
    id: 'hidden-styling',
    label: 'text styled to be invisible to a human reader',
    // The lookbehind is load-bearing: without it `background-color: #FFFFFF` — a white
    // card in an HTML email — reads as concealment. So does `border-color`, `caret-color`
    // and `text-decoration-color`. Every one of those is a normal thing to write.
    re: /(?:(?<![-\w])color\s*:\s*(?:#f{3,6}\b|white|transparent)|font-size\s*:\s*0\b|display\s*:\s*none|visibility\s*:\s*hidden)/i,
    // White text is only interesting when it is hiding an instruction. On its own it is
    // CSS, and CSS is not evidence of anything.
    requiresDirective: true,
  },
];

/** Lower confidence. Prose that reads oddly but has an innocent explanation most of the time. */
const WEAK = [
  {
    id: 'self-praise',
    label: 'unusually promotional self-assessment',
    re: /\bthis (?:repo|repository|project|codebase) is\b[^.\n]{0,30}\b(?:exemplary|excellent|world[- ]class|perfect|flawless|outstanding)\b/i,
  },
  {
    id: 'best-practice-claim',
    label: 'an unverifiable blanket quality claim',
    // Only the *claim* form. "I want to follow best practices" is a person describing a
    // goal in a prompt, and was being reported as a quality claim about the repo.
    re: /\b(?:follows|adheres to|implements)\s+(?:all\s+)?(?:industry[- ]standard\s+|industry\s+)?best practices?\b/i,
  },
];

/**
 * The instruction layer: prose an agent reads as direction, plus the docs around it.
 * Extension-based so it stays true on any stack — this kit is used on repos in languages
 * nobody here has seen.
 */
const PROSE_EXTENSIONS = new Set(['.md', '.markdown', '.mdc', '.txt', '.rst', '.adoc']);

/** Editor and agent rule files that carry no extension. */
const RULE_FILENAMES = new Set([
  '.cursorrules', '.windsurfrules', '.aiderrules', '.clinerules', '.goosehints',
  '.rules', 'agents.md', 'claude.md', 'gemini.md', 'copilot-instructions.md',
]);

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.venv', 'venv',
  '__pycache__', 'target', 'vendor', '.vibecheck', '.idea', '.pytest_cache',
  'site-packages', '.tox', '.gradle', 'Pods',
]);

/**
 * Agent assets installed from a marketplace rather than written by the team. Scanning
 * them reports the vendor's prose as the team's — one such file said "you are not the
 * judge of whether the user already approved", which is guidance to an agent, and was
 * reported as an attempt to assign the scorer a role.
 *
 * The shape is stable across tools: third-party skills and plugins land under a
 * dot-directory (`.claude/skills/`, `.agents/skills/`, `.cursor/plugins/`).
 */
function isVendored(relPath) {
  const parts = relPath.split(/[\\/]/);
  for (let i = 0; i < parts.length - 1; i++) {
    if (!parts[i].startsWith('.')) continue;
    const next = parts[i + 1].toLowerCase();
    if (next === 'skills' || next === 'plugins' || next === 'marketplaces') return true;
  }
  return false;
}

/** True when this file is part of the instruction layer we scan. */
function isInScope(relPath) {
  if (isVendored(relPath)) return false;
  const name = basename(relPath).toLowerCase();
  if (RULE_FILENAMES.has(name)) return true;
  return PROSE_EXTENSIONS.has(extname(name));
}

/**
 * The kit's own files legitimately contain these patterns — this very module lists them.
 * A team that vendors the kit into their repo must not be flagged for our text.
 *
 * Exclusion is by **content identity, not path**, so an added or edited file is always
 * scanned even when it sits in a directory the kit also uses.
 */
/**
 * A directory that is a git repository of its own, below the one being walked.
 *
 * Neither walk may enter one. The camp evaluator clones team repositories into
 * `<kit>/repos/`; hashing the kit used to hash every team's files too, so the scan then
 * skipped each team file as "the kit's own copy" and reported nothing, silently. And a
 * scan of the kit itself must not report a team's text as the kit's.
 */
function isNestedRepo(dir, root) {
  return dir !== root && existsSync(join(dir, '.git'));
}

function kitFileHashes(kitRoot) {
  const hashes = new Set();
  if (!kitRoot || !existsSync(kitRoot)) return hashes;
  const stack = [kitRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !isNestedRepo(full, kitRoot)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        if (statSync(full).size > 512 * 1024) continue;
        hashes.add(createHash('sha256').update(readFileSync(full)).digest('hex'));
      } catch { /* unreadable kit file simply is not excludable */ }
    }
  }
  return hashes;
}

function scanText(text, rel, findings) {
  // A byte-order mark is a file-format artefact, not concealment. Strip it before the
  // concealment test rather than reporting every UTF-8-with-BOM file as hiding something.
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    if (hasConcealment(line)) {
      findings.strong.push({
        rule: 'invisible-characters',
        label: 'characters hidden from a human reader',
        file: rel, line: i + 1, text: defang(line.trim()).slice(0, 240), untrusted: true,
      });
      continue;
    }
    for (const { id, label, re, requiresDirective } of STRONG) {
      if (!re.test(line)) continue;
      if (requiresDirective && !DIRECTIVE.test(line)) continue;
      findings.strong.push({
        rule: id, label, file: rel, line: i + 1,
        text: defang(line.trim()).slice(0, 240), untrusted: true,
      });
      break;
    }
    for (const { id, label, re } of WEAK) {
      if (!re.test(line)) continue;
      findings.weak.push({
        rule: id, label, file: rel, line: i + 1,
        text: defang(line.trim()).slice(0, 240), untrusted: true,
      });
      break;
    }
  }
}

/**
 * The same prompt is often captured in several sessions, and reported once per capture.
 * Six copies of one line reads as six problems.
 */
function dedupe(list) {
  const seen = new Set();
  return list.filter((f) => {
    const key = f.rule + '\u0000' + f.file + '\u0000' + f.line + '\u0000' + f.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {string} repo        repository root
 * @param {object} [evidence]  evidence.json — its excerpts are scanned too, since those
 *                             are what a judging pass actually reads
 * @param {object} [options]   `options.kitRoot` enables byte-identity exclusion
 * @returns {{scanned: object, strong: object[], weak: object[]}} notes for a facilitator.
 *          Nothing here is a penalty and nothing here alters a score.
 */
export function detectInjection(repo, evidence, options = {}) {
  const findings = { strong: [], weak: [] };
  // `repo` comes from `evidence.repo.path`, which is a value the team wrote. A bundle
  // harvested on one machine and scored on another normally points at a path that does not
  // exist here — and a path that *does* exist might be anything at all, including the
  // facilitator's home directory. Reporting whether the repo was actually there is what stops a
  // facilitator reading "no notes" as "scanned clean" when nothing was scanned.
  const repoPresent = Boolean(repo) && existsSync(repo);
  const kitHashes = repoPresent ? kitFileHashes(options.kitRoot) : new Set();
  const surfaces = [];
  let filesScanned = 0;
  let kitFilesSkipped = 0;
  let visited = 0;
  // A bound on the walk, so pointing this at a large tree cannot stall the leaderboard.
  const maxEntries = options.maxEntries ?? 20000;

  const stack = repoPresent ? [repo] : [];
  while (stack.length && visited < maxEntries) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (++visited >= maxEntries) break;
      const full = join(dir, entry.name);
      const rel = relative(repo, full);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !isNestedRepo(full, repo)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;

      // A filename is read by an agent too, so it is also a place to hide an instruction.
      // Checked for every file, in scope or not — it costs nothing and a concealed
      // character in a filename has no innocent explanation.
      if (hasConcealment(entry.name) && !isVendored(rel)) {
        findings.strong.push({
          rule: 'invisible-characters-in-filename',
          label: 'characters hidden inside a filename',
          file: rel, line: 0, text: defang(entry.name), untrusted: true,
        });
      }
      if (!isInScope(rel)) continue;
      try {
        if (statSync(full).size > 512 * 1024) continue;
        const bytes = readFileSync(full);
        // Skip only files byte-identical to the kit's own copy — never whole directories.
        if (kitHashes.size
          && kitHashes.has(createHash('sha256').update(bytes).digest('hex'))) {
          kitFilesSkipped++;
          continue;
        }
        filesScanned++;
        surfaces.push(rel);
        scanText(bytes.toString('utf8'), rel, findings);
      } catch { /* unreadable file contributes nothing */ }
    }
  }

  // Prompts a team wrote are part of the same surface: an instruction planted in a prompt
  // reaches a judging pass exactly the way one planted in AGENTS.md does.
  const excerptSources = [
    ...(evidence?.chat?.claudeCode ?? []),
    ...(evidence?.chat?.copilot ?? []),
  ];
  for (const session of excerptSources) {
    for (const kept of session.excerpts?.prompts?.kept ?? []) {
      scanText(kept.text, 'chat-transcript:' + String(session.sessionId).slice(0, 8), findings);
    }
  }

  return {
    scanned: {
      // False means the repository was not on this machine, so the file scan did not run
      // at all. Only the evidence excerpts were read. Distinguishing this from "scanned and
      // found nothing" is the difference between silence and an all-clear.
      repoScanned: repoPresent,
      truncated: visited >= maxEntries,
      filesScanned,
      kitFilesSkipped,
      // Named so a facilitator can see the scan covered what they expected, and challenge it
      // when it didn't. `--explain-integrity` prints this.
      surfaces: surfaces.sort().slice(0, 100),
      surfacesTruncated: surfaces.length > 100,
      scope: 'instruction layer only: ' + [...PROSE_EXTENSIONS].join(' ')
        + ' files and editor rule files, excluding vendored agent assets',
    },
    strong: dedupe(findings.strong),
    weak: dedupe(findings.weak),
  };
}

/**
 * The same rules applied to one piece of text that is not a repository file — a deck's
 * extracted text, a chat log a team kept by hand. Notes for a human, exactly like
 * detectInjection's: nothing here scores anything.
 */
export function scanTextForNotes(text, label) {
  const findings = { strong: [], weak: [] };
  scanText(String(text ?? ''), label, findings);
  return { strong: dedupe(findings.strong), weak: dedupe(findings.weak) };
}

/** Kept so a caller can describe the scan without reaching into the module's internals. */
export const SCAN_SCOPE_DESCRIPTION =
  'Prose an agent reads as instructions — AGENTS.md, CLAUDE.md, README, docs, editor rule '
  + 'files — plus the prompt excerpts in evidence.json. Source code, stylesheets, HTML '
  + 'templates and SQL are not scanned.';

