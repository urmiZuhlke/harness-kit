/**
 * claude-code.mjs — harvest Claude Code sessions for one repo.
 *
 * Sessions are JSONL at ~/.claude/projects/<path-slug>/<session-uuid>.jsonl. Every record
 * carries `timestamp`, `cwd`, `gitBranch` and `sessionId`, which is how sessions are
 * attributed to a repo without trusting the directory-name slug (a session started in a
 * subfolder or through a symlink still reports the real cwd).
 *
 * Streams line by line and never retains message bodies — only counts, classifications
 * and bounded excerpts.
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import {
  classifyCommand, classifyOutcome, distribution, excerptCollector, isCorrection, source,
} from '../shared.mjs';

const projectsRoot = () => join(homedir(), '.claude', 'projects');

/**
 * Planning leaves several different traces depending on how a team works, and scoring
 * only one of them punished teams for using a different-but-equivalent method.
 *
 * The first version counted `ExitPlanMode` alone. This repo's own transcript then scored
 * zero for "no planning step is visible" while containing two explicit `/planner`
 * invocations and 39 records attributed to that skill — a team following this kit's own
 * advice, marked down for it.
 */
const PLANNING_TOOLS = /^(?:ExitPlanMode|EnterPlanMode|TodoWrite|manage_todo_list)$/;
const PLANNING_SKILL = /plan/i;

/**
 * Reduce a user record to the words a human actually typed, or null to skip it entirely.
 *
 * A slash command does not arrive as one tidy prompt. Invoking `/planner do X` writes
 * *two* user records: a `<command-message>…<command-args>do X</command-args>` wrapper, and
 * a second record carrying the skill's entire definition ("Base directory for this
 * skill: …"). Counting both as prompts measured this repo at 20 prompts when a human typed
 * 8, dragged the mean prompt length up with 10,000-character skill definitions, and — via
 * imperative prose inside those definitions — produced six "corrections" the human never
 * made.
 *
 * That distortion lands hardest on teams who use slash commands, which is exactly what
 * this kit recommends, so it had to be removed rather than tolerated.
 */
function humanPromptText(raw) {
  const text = raw.trim();
  if (!text) return null;

  // The injected body of a skill definition. Not human words at all.
  if (/^Base directory for this skill:/.test(text)) return null;

  // A slash-command invocation: the human's own words are inside <command-args>.
  if (/<command-name>/.test(text) || /<command-message>/.test(text)) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
    const name = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
    const typed = (args?.[1] ?? '').trim();
    if (typed) return typed;
    // A bare `/command` with no arguments is still a real instruction, just a terse one.
    return name ? name[1].trim() : null;
  }

  // Context the harness injects around a prompt, never typed by anyone.
  const stripped = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .trim();
  return stripped || null;
}

/** Text of a message whose content is either a string or an array of typed blocks. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function toolResultText(block) {
  const c = block?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x?.text === 'string' ? x.text : '')).join('\n');
  return '';
}

async function readSession(file, isInRepo) {
  const s = {
    sessionId: null, startedAt: null, endedAt: null, branches: new Set(),
    userPrompts: 0, promptLengths: [], corrections: 0, assistantTurns: 0,
    sidechainRecords: 0, toolCalls: {},
    commands: { test: 0, buildOrLint: 0, destructive: 0, other: 0 },
    testRuns: [], planningSignals: 0, malformedLines: 0, injectedRecordsSkipped: 0,
  };
  const prompts = excerptCollector(6);
  const corrections = excerptCollector(6);
  const pending = new Map();
  let cwdChecked = false;
  let belongs = false;

  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { s.malformedLines++; continue; }

    if (!cwdChecked && typeof rec.cwd === 'string') {
      cwdChecked = true;
      belongs = isInRepo(rec.cwd);
      if (!belongs) { rl.close(); break; }
    }
    if (rec.sessionId && !s.sessionId) s.sessionId = rec.sessionId;
    if (rec.gitBranch) s.branches.add(rec.gitBranch);
    if (rec.timestamp) {
      const t = Date.parse(rec.timestamp);
      if (!Number.isNaN(t)) {
        if (s.startedAt === null || t < s.startedAt) s.startedAt = t;
        if (s.endedAt === null || t > s.endedAt) s.endedAt = t;
      }
    }
    if (rec.isSidechain) s.sidechainRecords++;

    const msg = rec.message;
    if (rec.type === 'user' && msg) {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const results = blocks.filter((b) => b?.type === 'tool_result');
      if (results.length) {
        for (const r of results) {
          const info = pending.get(r.tool_use_id);
          if (!info) continue;
          pending.delete(r.tool_use_id);
          if (info.kind === 'test') {
            // Pass is_error through as a tri-state: true and false are both facts about
            // the exit code, while undefined means fall back to reading the output.
            s.testRuns.push({
              outcome: classifyOutcome(toolResultText(r),
                typeof r.is_error === 'boolean' ? r.is_error : undefined),
              at: rec.timestamp ?? null,
            });
          }
        }
        continue;
      }
      if (rec.isSidechain) continue;
      const rawText = textOf(msg.content);
      // `/planner ...` typed by the human is a planning step just as much as the agent
      // entering plan mode; it simply leaves a different trace.
      const invoked = rawText.match(/<command-name>([^<]+)<\/command-name>/);
      if (invoked && PLANNING_SKILL.test(invoked[1])) s.planningSignals++;
      const text = humanPromptText(rawText);
      if (!text) { s.injectedRecordsSkipped++; continue; }
      s.userPrompts++;
      s.promptLengths.push(text.length);
      prompts.offer(text, { at: rec.timestamp ?? null });
      if (isCorrection(text)) {
        s.corrections++;
        corrections.offer(text, { at: rec.timestamp ?? null });
      }
    } else if (rec.type === 'assistant' && msg) {
      s.assistantTurns++;
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
        s.toolCalls[b.name] = (s.toolCalls[b.name] ?? 0) + 1;
        if (PLANNING_TOOLS.test(b.name)) s.planningSignals++;
        // A skill invoked by name is the strongest planning signal this kit can see,
        // because the kit itself ships a planner skill and tells teams to use it.
        if (b.name === 'Skill' && PLANNING_SKILL.test(String(b.input?.skill ?? ''))) {
          s.planningSignals++;
        }
        const kinds = classifyCommand(b.input?.command);
        for (const kind of kinds) s.commands[kind]++;
        if (b.id && kinds.includes('test')) pending.set(b.id, { name: b.name, kind: 'test' });
      }
    }
  }

  if (!belongs) return null;
  return {
    sessionId: s.sessionId,
    startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
    endedAt: s.endedAt ? new Date(s.endedAt).toISOString() : null,
    durationMinutes: s.startedAt && s.endedAt ? Math.round((s.endedAt - s.startedAt) / 60000) : null,
    branches: [...s.branches],
    userPrompts: s.userPrompts,
    promptLength: distribution(s.promptLengths),
    corrections: s.corrections,
    assistantTurns: s.assistantTurns,
    subagentRecords: s.sidechainRecords,
    toolCalls: s.toolCalls,
    toolCallTotal: Object.values(s.toolCalls).reduce((a, b) => a + b, 0),
    commands: s.commands,
    testRuns: s.testRuns,
    planningSignals: s.planningSignals,
    malformedLines: s.malformedLines,
    // Command wrappers and skill definitions dropped before counting, reported so the
    // gap between what the transcript holds and what a human typed stays visible.
    injectedRecordsSkipped: s.injectedRecordsSkipped,
    excerpts: { prompts: prompts.result(), corrections: corrections.result() },
  };
}

export async function harvestClaudeCode({ isInRepo }) {
  const root = projectsRoot();
  if (!existsSync(root)) {
    return { source: source.notHarvested('no ~/.claude/projects directory on this machine'), sessions: [] };
  }
  const files = [];
  try {
    for (const dir of readdirSync(root)) {
      const d = join(root, dir);
      if (!statSync(d).isDirectory()) continue;
      for (const f of readdirSync(d)) if (f.endsWith('.jsonl')) files.push(join(d, f));
    }
  } catch (err) {
    return { source: source.notHarvested('could not list sessions: ' + err.message), sessions: [] };
  }
  if (!files.length) {
    return { source: source.empty('no Claude Code session files on this machine'), sessions: [] };
  }

  const sessions = [];
  const failures = [];
  for (const f of files) {
    try {
      const s = await readSession(f, isInRepo);
      if (s) sessions.push(s);
    } catch (err) {
      // A session that fails to parse is lost evidence, not a neutral event. Record why,
      // so a facilitator can see it rather than a team quietly scoring lower.
      failures.push({ file: basename(f), error: err.message });
    }
  }
  if (!sessions.length) {
    return {
      source: source.empty(
        'Claude Code sessions exist on this machine but none belong to this repo',
        { filesScanned: files.length, failures }
      ),
      sessions: [],
    };
  }
  return {
    source: source.harvested({
      filesScanned: files.length, sessionsMatched: sessions.length, failures,
    }),
    sessions,
  };
}
