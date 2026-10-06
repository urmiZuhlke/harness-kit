/**
 * prepare.mjs — the facts a camp judge starts from, identical in shape for every team.
 *
 * Deterministic where it can be, so the judge spends its judgement only where judgement is
 * needed. Everything here is an observation reused from the kit's harvester — the repo and
 * git read with `chat: false, runTestSuite: false`, merged with the history files the team
 * committed, exactly as `leaderboard --repos` does — plus the submission facts a deck-based
 * rubric needs.
 *
 * Three rules hold throughout:
 *
 *   - **Nothing from a team repository is executed.** Git is asked questions; files are
 *     read. The test suite is not run, and whether the code runs scores nothing.
 *   - **No names reach the judge.** Members are numbered, commit authors are counted, not
 *     listed (kit rule 15). The judge needs to know that four people directed the work,
 *     not who they are.
 *   - **Integrity notes go to humans only.** The injection scan's findings are returned
 *     separately and never written into the judge's facts, so they cannot move a number
 *     (kit rule 9).
 */
import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { harvest } from '../harvest/index.mjs';
import { CHAT_SOURCES, loadCommittedHistories, mergeEvidence } from '../harvest/merge.mjs';
import { CODE_EXTENSIONS, isTestPath } from '../harvest/repo.mjs';
import { excerpt } from '../harvest/shared.mjs';
import { detectInjection } from '../integrity/injection.mjs';
import { judgingBundle } from '../score/judging-bundle.mjs';
import { DEFAULT_DECK_PATH, DIAGRAM_PATHS, findDeck, findDiagram, pdfPageCountOf } from './submission.mjs';

/** Bump on any change to the shape or meaning of facts.json. */
export const FACTS_VERSION = 1;

/** Instruction files an agent reads as standing direction, wherever they sit. */
const INSTRUCTION_FILE = /(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules)$|^\.github\/copilot-instructions\.md$|^\.github\/instructions\/[^/]+\.md$|^\.cursor\/rules\//i;

/** Agent, prompt and skill definitions: the agents a diagram names should be here. */
const AGENT_DEFINITION = /^(?:\.claude\/(?:agents|skills|commands)|\.github\/(?:agents|prompts|chatmodes)|\.codex)\/|^agents\/[^/]+\.md$|\.(?:agent|prompt|chatmode)\.md$/i;

/** Documents about the problem rather than the code. */
const CONTEXT_DOC = /^docs?\/.+\.md$/i;

/**
 * Bounds on what facts.json lists, so the file stays readable by a judge in one go (the
 * Read tool refuses large files) however long a team worked. A team of five over two days
 * can log hundreds of sessions; the totals always cover all of them, and the lists are an
 * even sample across the whole period, with the true count beside each.
 */
const MAX_COMMITS = 100;
const MAX_SESSIONS = 60;
const MAX_PROMPT_EXCERPTS = 80;
const MAX_CORRECTION_EXCERPTS = 30;

/** Decks above this size cannot be read whole by the judge; it must read page ranges. */
export const READABLE_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Text an AI tool injects as a user turn: Claude Code's background-task notifications,
 * system reminders, loaded skill bodies and command wrappers; Codex's environment context.
 * Checked against real transcripts: without this, 3 of 5 "corrections" found in one real
 * session were notifications and skill text, not the person.
 */
const SYSTEM_TEXT = /^\s*(?:<(?:task-notification|system-reminder|command-(?:name|message|args)|local-command-stdout|environment_context|recommended_plugins|user_instructions)>|Base directory for this skill:|Caveat: The messages below were generated|\[Request interrupted)/i;
// A skill document's title, as it arrives flattened: "# Update Config Skill Modify …".
// Case-sensitive and title-shaped, so a person's "# Context … skill level" is kept.
const SKILL_TITLE = /^\s*# (?:[A-Z][\w-]*\s){1,6}Skill\s+[A-Z]/;

export function isSystemText(text) {
  const t = String(text ?? '');
  return SYSTEM_TEXT.test(t) || SKILL_TITLE.test(t);
}

/**
 * A chat log a team kept by hand: any text file directly in `.vibecheck/` that the collector
 * did not write, or a text file anywhere whose name says it is a chat, conversation,
 * transcript or prompt log. Pipeline artefacts in `.vibecheck/` subfolders are not logs.
 */
const LOG_EXT = /\.(?:md|markdown|txt|text|log|html?|json|jsonl)$/i;
const LOG_NAME = /(?:chat|conversation|transcript|prompt[-_ ]?(?:log|history)|chatgpt|ai[-_ ]?(?:log|history))/i;
// Instruction files are the harness, never a chat log, whatever their name contains.
const INSTRUCTION_NAME = /^(?:copilot-instructions\.md|AGENTS\.md|CLAUDE\.md|GEMINI\.md|.*\.instructions\.md|.*\.(?:agent|prompt|chatmode)\.md)$/i;

export function isManualLog(path) {
  if (!LOG_EXT.test(path)) return false;
  const name = path.split('/').pop();
  if (INSTRUCTION_NAME.test(name)) return false;
  if (/^history-.*\.json$/i.test(name) && path.startsWith('.vibecheck/')) return false;
  if (/^\.vibecheck\/[^/]+$/.test(path)) return true;
  return LOG_NAME.test(name);
}

/** A list cut to `limit` entries, saying how many there were when it was cut. */
function capped(list, limit = 40) {
  return list.length <= limit ? list : [...list.slice(0, limit), '… and ' + (list.length - limit) + ' more'];
}

/** An evenly spaced sample of `limit` items, first and last included. */
export function sample(list, limit) {
  if (list.length <= limit) return list;
  const step = (list.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, i) => list[Math.round(i * step)]);
}

/** Every prompt excerpt per tool, sampled to `limit` in total in proportion to each tool. */
function sampleExcerpts(byTool, limit) {
  const total = Object.values(byTool).reduce((n, l) => n + l.length, 0);
  if (total <= limit) return byTool;
  return Object.fromEntries(Object.entries(byTool)
    .map(([tool, list]) => [tool, sample(list, Math.max(1, Math.round((list.length / total) * limit)))]));
}

function git(repo, args) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch { return null; }
}

const sameDir = (a, b) => {
  try { return realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase(); } catch { return false; }
};

/**
 * One pass over the history: every commit with its files, and when each file first
 * appeared. Null when the folder is not the root of its own repository — a clone that
 * failed half-way sits inside `repos/`, and asking git there would answer about some
 * other repository (kit rule 10).
 */
export function readCommits(repo) {
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  if (!top || !sameDir(top.trim(), repo)) return null;
  const log = git(repo, ['log', '--reverse', '-M', '--name-status', '--format=%x1e%H%x1f%aI%x1f%s']);
  if (log === null) return null;
  const commits = [];
  const firstAdded = new Map();
  for (const record of log.split('\x1e').slice(1)) {
    const [head, ...rest] = record.split('\n');
    const [hash, date, subject] = head.split('\x1f');
    const files = [];
    for (const line of rest) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const status = parts[0][0];
      const path = parts[parts.length - 1];
      files.push(path);
      if ((status === 'A' || status === 'R' || status === 'C') && !firstAdded.has(path)) firstAdded.set(path, date);
    }
    commits.push({ hash: hash.slice(0, 10), date, subject: subject ?? '', files });
  }
  return { commits, firstAdded };
}

/**
 * A commit subject with the names git itself puts there removed. A merge commit's subject
 * carries a username and a branch ("Merge pull request #3 from ana/booking"); the judge
 * needs to know a merge happened, not whose (kit rule 15). The same goes for the commit
 * message the collector suggests when a member adds their history file.
 */
export function anonymousSubject(subject) {
  return excerpt(String(subject)
    .replace(/^Merge pull request (#\d+) from \S+/i, 'Merge pull request $1')
    .replace(/^Merge (remote-tracking )?branch '[^']*'(?: of \S+)?(?: into \S+)?/i, 'Merge $1branch')
    .replace(/^Merge branch \S+ into \S+/i, 'Merge branch')
    // The message collect-history itself suggests, which names the member.
    .replace(/^Add AI history for .*/i, 'Add AI history'));
}

const earliest = (dates) => dates.filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;

/** When the harness appeared relative to the code — the C5-style "before the bulk" fact. */
function harnessTiming(history, tracked) {
  if (!history) return null;
  const added = (p) => history.firstAdded.get(p) ?? null;
  const instruction = tracked.filter((p) => INSTRUCTION_FILE.test(p));
  const agents = tracked.filter((p) => AGENT_DEFINITION.test(p));
  const code = tracked.filter((p) => CODE_EXTENSIONS.has(extname(p).toLowerCase())
    && !isTestPath(p) && !AGENT_DEFINITION.test(p));
  const firstHarnessAt = earliest([...instruction, ...agents].map(added));
  const codeDates = code.map(added).filter(Boolean);
  const before = firstHarnessAt === null ? codeDates.length
    : codeDates.filter((d) => Date.parse(d) < Date.parse(firstHarnessAt)).length;
  return {
    firstHarnessFileAt: firstHarnessAt,
    firstCodeFileAt: earliest(codeDates),
    codeFiles: code.length,
    codeFilesAddedBeforeHarness: before,
    harnessBeforeMostCode: firstHarnessAt !== null && codeDates.length > 0 && before < codeDates.length / 2,
    files: [...instruction, ...agents].slice(0, 40).map((path) => (added(path) ?? 'untracked').slice(0, 16) + ' ' + path),
  };
}

/** One line per session, in time order, with nothing that names a person or a branch. */
function sessionTimeline(evidence) {
  const rows = [];
  for (const tool of CHAT_SOURCES) {
    for (const s of evidence?.chat?.[tool] ?? []) {
      let sawFail = false;
      let loops = 0;
      const runs = { pass: 0, fail: 0, unknown: 0 };
      for (const run of s.testRuns ?? []) {
        runs[run.outcome] = (runs[run.outcome] ?? 0) + 1;
        if (run.outcome === 'fail') sawFail = true;
        else if (run.outcome === 'pass' && sawFail) { loops++; sawFail = false; }
      }
      rows.push({
        startedAt: s.startedAt ?? '',
        // One line per session: a judge reads sixty of these as easily as one, where the
        // same fields as JSON objects cost a dozen lines each against the Read limit.
        line: [
          (s.startedAt ?? '?').slice(0, 16) + 'Z',
          tool + (s.__member ? ' · member ' + s.__member : ''),
          (s.durationMinutes ?? '?') + ' min',
          (s.userPrompts ?? 0) + ' prompts' + (s.promptLength?.max ? ' (longest ' + s.promptLength.max + ' chars)' : ''),
          (s.corrections ?? 0) + ' corrections',
          (s.planningSignals ?? 0) + ' planning',
          (s.toolCallTotal ?? 0) + ' tool calls',
          'tests ' + runs.pass + ' pass / ' + runs.fail + ' fail' + (runs.unknown ? ' / ' + runs.unknown + ' unknown' : ''),
          loops + ' fail→pass',
        ].join(' · '),
      });
    }
  }
  return rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((r) => r.line);
}

/**
 * Everything the judge is given about one team, plus what only humans see.
 *
 * @param {string} repo  a cloned team repository
 * @param {{team: string, kitRoot: string, deckPath?: string}} options
 * @returns {Promise<{facts: object, humanNotes: object, deckFile: string|null,
 *   diagramFile: string|null, diagramCopy: string|null, preflight: object}>}
 */
export async function prepareTeam(repo, { team, kitRoot, deckPath = DEFAULT_DECK_PATH, context = null, since = null }) {
  const base = await harvest(repo, { chat: false, runTestSuite: false, kitRoot, team });
  const { histories, skipped } = loadCommittedHistories(repo);
  // Only the event counts. A history file can carry sessions from months before (the same
  // folder opened in April, or a tool's old storage), and they say nothing about the camp.
  // A session with no start time is kept: dropping evidence on a missing field is worse.
  let droppedBeforeSince = 0;
  if (since) {
    const from = Date.parse(since);
    for (const h of histories) {
      for (const tool of CHAT_SOURCES) {
        const list = h.evidence.chat?.[tool];
        if (!Array.isArray(list)) continue;
        const kept = list.filter((sess) => !sess.startedAt || Date.parse(sess.startedAt) >= from);
        droppedBeforeSince += list.length - kept.length;
        h.evidence.chat[tool] = kept;
      }
    }
  }
  // Numbered, not named: the judge scores how the team worked, not who was on it.
  histories.forEach((h, i) => {
    for (const tool of CHAT_SOURCES) for (const s of h.evidence.chat?.[tool] ?? []) s.__member = i + 1;
  });
  const { evidence, warnings } = mergeEvidence([
    { label: 'repository', evidence: base, repoOnly: true },
    ...histories.map((h) => ({ label: h.label, evidence: h.evidence })),
  ]);

  const deck = findDeck(repo, deckPath);
  // Only a readable PDF is handed to the judge; a Git LFS pointer or a corrupt file is
  // reported for a facilitator to fix, never copied as if it were the deck.
  const deckFile = deck.path && ['found', 'misplaced'].includes(deck.status) ? join(repo, deck.path) : null;
  const pages = deckFile ? pdfPageCountOf(deckFile) : null;
  const diagram = findDiagram(repo);
  // Named after what the bytes are, not what the file is called: JPEG bytes named .png
  // would otherwise reach the judge under the wrong type.
  const diagramFile = diagram.format ? join(repo, diagram.path) : null;
  const diagramCopy = diagram.format ? 'sdlc-diagram.' + diagram.format : null;

  const history = readCommits(repo);
  const tracked = (git(repo, ['ls-files']) ?? '').split('\n').filter(Boolean);
  const manualLogs = tracked.filter(isManualLog).map((path) => {
    let bytes = null;
    try { bytes = statSync(join(repo, path)).size; } catch { /* listed without a size */ }
    return { path, bytes };
  });
  const re = evidence.repoEvidence ?? {};
  const totals = evidence.chat?.totals ?? {};
  const sessions = sessionTimeline(evidence);
  // The collector on a participant's laptop cannot always tell a person's message from text
  // the tool injects as one (background-agent notifications, loaded skill bodies). Those are
  // dropped here, so the judge reads only what a human wrote; the counts in the file cannot
  // be corrected after the fact, which the judge is told.
  let systemTextDropped = 0;
  const human = (text) => { if (isSystemText(text)) { systemTextDropped++; return false; } return true; };
  const promptExcerpts = Object.fromEntries(Object.entries(judgingBundle(evidence).promptExcerpts)
    .map(([tool, list]) => [tool, list.filter(human)]).filter(([, list]) => list.length));
  const corrections = CHAT_SOURCES.flatMap((tool) => (evidence.chat?.[tool] ?? [])
    .flatMap((s) => (s.excerpts?.corrections?.kept ?? []).map((c) => c.text).filter(Boolean)))
    .filter(human);

  const facts = {
    factsVersion: FACTS_VERSION,
    team,
    // Written by the facilitators, not the team (e.g. "merged two repositories on day 2"):
    // trusted context the judge takes into account, unlike anything read from the repo.
    facilitatorContext: context,
    repo: { path: repo, trackedFiles: tracked.length },
    submission: {
      expectedDeckPath: deckPath,
      deck: {
        status: deck.status,
        foundAt: deck.path,
        // What the judge opens: prepare copies the deck next to these facts.
        copiedTo: deck.path && ['found', 'misplaced'].includes(deck.status) ? 'proposal.pdf' : null,
        pages,
        megabytes: deck.bytes === null ? null : Math.round((deck.bytes / 1048576) * 10) / 10,
        // Over 20 MB the judge cannot read the file whole and reads it in page ranges.
        tooLargeToReadWhole: deck.bytes !== null && deck.bytes > READABLE_PDF_BYTES,
        otherPdfs: deck.otherPdfs,
        pptxIgnored: deck.pptx,
      },
      // The diagram as its own image is what the judge reads first; without one, it finds
      // the diagram slide in the deck.
      expectedDiagramPaths: DIAGRAM_PATHS,
      diagram: {
        status: diagram.status,
        foundAt: diagram.path,
        copiedTo: diagramCopy,
        notAnImage: diagram.notAnImage,
      },
      historyFiles: histories.length,
      unreadableHistoryFiles: skipped.length,
    },
    repoFacts: {
      testFiles: re.tests?.testFileCount ?? 0,
      testFileSample: tracked.filter((p) => isTestPath(p)).slice(0, 30),
      sourceFiles: re.tests?.sourceFileCount ?? 0,
      readme: { present: re.reproducibility?.readmePresent ?? false, bytes: re.reproducibility?.readmeBytes ?? 0 },
      commands: {
        setup: re.commands?.setup ?? null,
        test: re.commands?.test ?? null,
        run: re.commands?.dev ?? re.commands?.start ?? null,
      },
      lockfilePresent: re.reproducibility?.lockfilePresent ?? false,
      ciWorkflows: re.ci?.workflows ?? [],
      secretFindings: (re.safety?.secretFindings?.kept ?? []).map((f) => ({ rule: f.rule, file: f.file, line: f.line })),
      secretFindingsTotal: re.safety?.secretFindings?.offered ?? 0,
      trackedEnvFiles: evidence.gitEvidence?.trackedEnvFiles ?? [],
      gitignoreCoversEnv: re.safety?.gitignoreCoversEnv ?? null,
    },
    harness: {
      instructionFiles: capped(tracked.filter((p) => INSTRUCTION_FILE.test(p))),
      agentDefinitions: capped(tracked.filter((p) => AGENT_DEFINITION.test(p))),
      contextDocs: capped(tracked.filter((p) => CONTEXT_DOC.test(p))),
      timing: harnessTiming(history, tracked),
    },
    git: history ? {
      commits: history.commits.length,
      authors: Object.keys(evidence.gitEvidence?.authors ?? {}).length,
      firstCommitAt: history.commits[0]?.date ?? null,
      lastCommitAt: history.commits.at(-1)?.date ?? null,
      conventionalCommitRatio: evidence.gitEvidence?.conventionalCommits?.ratio ?? null,
      log: history.commits.slice(-MAX_COMMITS)
        .map((c) => c.date.slice(0, 16) + ' · ' + c.files.length + ' file(s) · ' + anonymousSubject(c.subject)),
      logTruncated: history.commits.length > MAX_COMMITS,
    } : null,
    history: {
      members: histories.length,
      perMember: histories.map((h, i) => ({
        member: i + 1,
        sessions: CHAT_SOURCES.reduce((n, t) => n + (h.evidence.chat?.[t]?.length ?? 0), 0),
        prompts: CHAT_SOURCES.reduce((n, t) => n
          + (h.evidence.chat?.[t] ?? []).reduce((m, s) => m + (s.userPrompts ?? 0), 0), 0),
      })),
      totals: {
        sessions: totals.sessionCount ?? 0,
        prompts: totals.userPrompts ?? 0,
        meanPromptChars: totals.promptLength?.mean ?? 0,
        corrections: totals.corrections ?? 0,
        planningSignals: totals.planningSignals ?? 0,
        testRuns: totals.testRuns ?? { total: 0, pass: 0, fail: 0, unknown: 0 },
        failThenPassLoops: totals.failThenPassSequences ?? 0,
        tracedSessions: totals.tracedSessions ?? 0,
        firstSessionAt: totals.firstSessionAt ?? null,
        lastSessionAt: totals.lastSessionAt ?? null,
      },
      sessionsListed: Math.min(sessions.length, MAX_SESSIONS),
      sessions: sample(sessions, MAX_SESSIONS),
      // The kit's one path from evidence to a model: already redacted and length-capped.
      promptExcerptsTotal: Object.values(promptExcerpts).reduce((n, l) => n + l.length, 0),
      promptExcerpts: sampleExcerpts(promptExcerpts, MAX_PROMPT_EXCERPTS),
      correctionExcerptsTotal: corrections.length,
      // Excerpts removed because a tool injected them, not a person (see isSystemText).
      systemTextExcerptsDropped: systemTextDropped,
      correctionExcerpts: sample(corrections, MAX_CORRECTION_EXCERPTS),
      mergeWarnings: warnings,
      // Sessions in the history files that started before the event (`--since`), not counted.
      sessionsBeforeEventDropped: droppedBeforeSince,
      // Chat history a team kept by hand — exports, copy-pastes from browser chats — which
      // the collector cannot produce. The judge reads these as the team's own logs.
      manualLogsTotal: manualLogs.length,
      manualLogs: manualLogs.slice(0, 30),
    },
  };

  // For the facilitators, never the judge. See the file comment.
  const scan = detectInjection(repo, evidence, { kitRoot });
  const humanNotes = {
    note: 'Injection-scan notes. They affect no score and draw no conclusion (kit rule 9).',
    historyFiles: histories.map((h) => h.file),
    unreadableHistoryFiles: skipped.map((s) => s.path),
    strong: scan.strong.map((f) => ({ file: f.file, line: f.line, label: f.label, text: f.text })),
    weak: scan.weak.length,
  };

  const problems = [];
  if (deck.status === 'misplaced') problems.push('deck not at ' + deckPath + ' — using ' + deck.path);
  if (deck.status === 'pptx-only') problems.push('PPTX only — no proposal PDF');
  if (deck.status === 'missing') problems.push('no proposal PDF' + (deck.otherPdfs.length ? ' (other PDFs, not taken as the deck: ' + deck.otherPdfs.join(', ') + ')' : ''));
  if (deck.status === 'lfs-pointer') problems.push('DECK IS A GIT LFS POINTER — run: git lfs install && git -C <repos>/' + team + ' lfs pull, then prepare again');
  if (deck.status === 'not-a-pdf') problems.push('DECK IS NOT A VALID PDF (' + deck.path + ') — ask the team or export it again');
  if (deck.status === 'found' || deck.status === 'misplaced') {
    if (pages === null) problems.push('deck page count unreadable');
    if (facts.submission.deck.tooLargeToReadWhole) problems.push('deck is ' + facts.submission.deck.megabytes + ' MB — needs poppler (brew install poppler) to be read');
  }
  if (diagram.status === 'misplaced') problems.push('diagram not at ' + DIAGRAM_PATHS[0] + ' — using ' + diagram.path);
  if (diagram.status === 'missing') problems.push('no diagram image — the judge uses the deck');
  if (diagram.status === 'lfs-pointer') problems.push('DIAGRAM IS A GIT LFS POINTER — run: git lfs install && git -C <repos>/' + team + ' lfs pull, then prepare again');
  if (diagram.status === 'not-an-image') problems.push('DIAGRAM IS NOT A PNG/JPEG (' + diagram.path + ') — ask the team or export it again');
  if (diagram.status !== 'not-an-image' && diagram.notAnImage.length) problems.push('not a PNG/JPEG despite its name: ' + diagram.notAnImage.join(', '));
  if (droppedBeforeSince) problems.push(droppedBeforeSince + ' session(s) from before the event ignored');
  if (!histories.length) problems.push('no history files' + (manualLogs.length ? ' — ' + manualLogs.length + ' chat log(s) kept by hand instead' : ''));
  else if (manualLogs.length) problems.push(manualLogs.length + ' chat log(s) kept by hand as well');
  if (skipped.length) problems.push(skipped.length + ' unreadable history file(s)');
  if (!history) problems.push('git history unreadable');
  if (facts.repoFacts.secretFindingsTotal) problems.push(facts.repoFacts.secretFindingsTotal + ' secret finding(s)');
  if (scan.strong.length) problems.push(scan.strong.length + ' integrity note(s) for humans');

  return {
    facts,
    humanNotes,
    deckFile,
    diagramFile,
    diagramCopy,
    preflight: {
      team,
      deck: deck.status,
      pages,
      megabytes: facts.submission.deck.megabytes,
      diagram: diagram.status,
      historyFiles: histories.length,
      gitAuthors: facts.git?.authors ?? null,
      commits: facts.git?.commits ?? null,
      testFiles: facts.repoFacts.testFiles,
      problems,
    },
  };
}
