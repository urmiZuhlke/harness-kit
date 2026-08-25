/**
 * injection.mjs — detect attempts to instruct the scorer rather than impress it.
 *
 * Two tiers, because a joke in a README should not cost a team the event:
 *
 *   deliberate — concealment, references to the scorer's own internals, or imperatives
 *                addressed at an evaluator. Sets the final score to zero.
 *   ambiguous  — self-promotional prose that might be innocent. Flagged for a coach,
 *                no automatic penalty.
 *
 * This detector is the *punishment*. The defence is separate and must also hold: content
 * read from a team's repo is data everywhere in this kit, never instructions. If an
 * injection ever actually works, that is our bug, not their win.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

/** Invisible characters used to hide text from a human reviewer but not from a parser. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

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

const DELIBERATE = [
  {
    id: 'evaluator-imperative',
    label: 'an instruction addressed at whatever is reading the files',
    re: /\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all)\b[^.\n]{0,20}\b(?:instruction|prompt|rule|direction)/i,
  },
  {
    id: 'role-assignment',
    label: 'an attempt to assign the reader a role',
    re: /\byou are\b[^.\n]{0,30}\b(?:judge|scorer|evaluator|grader|assessor|examiner)\b/i,
  },
  {
    id: 'score-demand',
    label: 'a demand for a specific score',
    re: /\b(?:award|give|assign|grant|set)\b[^.\n]{0,40}\b(?:full|maximum|max|perfect|100|top)\b[^.\n]{0,20}\b(?:mark|point|score|grade)/i,
  },
  {
    id: 'score-declaration',
    label: 'a declaration of the score this repo should receive',
    re: /\b(?:score|rate|grade)\b[^.\n]{0,30}\b(?:this|the)\b[^.\n]{0,20}\b(?:repo|repository|project|team)\b[^.\n]{0,30}\b(?:100|full|maximum|perfect)\b/i,
  },
  {
    id: 'system-prompt-reference',
    label: 'a reference to the reader\u2019s system prompt or instructions',
    re: /\b(?:system prompt|your instructions|as an ai(?: language)? model)\b/i,
  },
  {
    id: 'scorer-internals',
    label: 'an instruction aimed at the scorer by name',
    re: /\b(?:vibecheck|evidence\.json|score\.json|failThenPassSequences|noChatEvidence|templateSimilarity)\b/i,
    // Naming the tool is not an attack \u2014 a README that says "we ran vibecheck" is normal
    // and must never be penalised. It only counts when the same line also *instructs* a
    // reader. False-zeroing a team is far worse than missing a clumsy attempt.
    requiresDirective: true,
  },
  {
    id: 'hidden-styling',
    label: 'text styled to be invisible to a human reader',
    re: /(?:color\s*:\s*(?:#f{3,6}\b|white|transparent)|font-size\s*:\s*0|display\s*:\s*none|visibility\s*:\s*hidden)/i,
  },
];

/**
 * Language that addresses a reader and tells it what to do. Used to gate rules that would
 * otherwise fire on innocent mentions.
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

const AMBIGUOUS = [
  {
    id: 'self-praise',
    label: 'unusually promotional self-assessment',
    re: /\bthis (?:repo|repository|project|codebase) is\b[^.\n]{0,30}\b(?:exemplary|excellent|world[- ]class|perfect|flawless|outstanding)\b/i,
  },
  {
    id: 'best-practice-claim',
    label: 'an unverifiable blanket quality claim',
    re: /\bfollows? (?:all )?(?:industry )?best practices?\b/i,
  },
];

/**
 * The kit's own files legitimately contain these patterns — this very module lists them.
 * A team that vendors the kit into their repo must not be penalised for our text.
 *
 * Exclusion is by **content identity, not path**. An earlier version skipped anything
 * under `lib/score/`, `lib/harvest/`, `bin/vibecheck.mjs` and friends, which handed
 * attackers seven guaranteed-unscanned directories: dropping `lib/score/notes.md` into
 * their repo evaded the penalty entirely. A file is now skipped only when its bytes match
 * the kit's own copy of that file, so an added or edited file is always scanned.
 */
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
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
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

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.venv', 'venv',
  '__pycache__', 'target', 'vendor', '.vibecheck', '.idea',
]);

/** Files an agent would plausibly read. Binary and generated content is skipped. */
const READABLE = new Set([
  '.md', '.markdown', '.txt', '.json', '.yml', '.yaml', '.toml', '.ini', '.cfg',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java',
  '.cs', '.php', '.sh', '.ps1', '.html', '.vue', '.svelte', '.sql', '.env', '',
]);

function scanText(text, rel, findings) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    if (INVISIBLE.test(line)) {
      findings.deliberate.push({
        rule: 'invisible-characters',
        label: 'characters hidden from a human reader',
        file: rel, line: i + 1, text: defang(line.trim()).slice(0, 240), untrusted: true,
      });
      continue;
    }
    for (const { id, label, re, requiresDirective } of DELIBERATE) {
      if (!re.test(line)) continue;
      if (requiresDirective && !DIRECTIVE.test(line)) continue;
      findings.deliberate.push({
        rule: id, label, file: rel, line: i + 1,
        text: defang(line.trim()).slice(0, 240), untrusted: true,
      });
      break;
    }
    for (const { id, label, re } of AMBIGUOUS) {
      if (!re.test(line)) continue;
      findings.ambiguous.push({
        rule: id, label, file: rel, line: i + 1,
        text: defang(line.trim()).slice(0, 240), untrusted: true,
      });
      break;
    }
  }
}

/**
 * @param {string} repo        repository root
 * @param {object} [options]   `options.kitRoot` enables byte-identity exclusion
 * @param {object} [evidence]  evidence.json — its excerpts are scanned too, so an
 *                             injection a team told the agent to write is still caught
 */
export function detectInjection(repo, evidence, options = {}) {
  const findings = { deliberate: [], ambiguous: [] };
  const kitHashes = kitFileHashes(options.kitRoot);
  let filesScanned = 0;
  let kitFilesSkipped = 0;

  const stack = [repo];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(repo, full);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;

      // A filename is also read by an agent, so it is also a place to hide an instruction.
      if (INVISIBLE.test(entry.name)) {
        findings.deliberate.push({
          rule: 'invisible-characters-in-filename',
          label: 'characters hidden inside a filename',
          file: rel, line: 0, text: defang(entry.name), untrusted: true,
        });
      }
      if (!READABLE.has(extname(entry.name).toLowerCase())) continue;
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
        scanText(bytes.toString('utf8'), rel, findings);
      } catch { /* unreadable file contributes nothing */ }
    }
  }

  // Prompts a team wrote are evidence too: telling the agent to plant the instruction is
  // the same act as planting it.
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
    scanned: { filesScanned, kitFilesSkipped },
    deliberate: findings.deliberate,
    ambiguous: findings.ambiguous,
    penalised: findings.deliberate.length > 0,
  };
}
