/**
 * copilot-agent.mjs — read Copilot's agent event log, the format Copilot moved to in 2026.
 *
 * VS Code 1.137 (September 2026) stopped writing chats to `workspaceStorage/<hash>/chatSessions/`
 * and writes one transcript per session to
 *   <user-data>/Code/User/workspaceStorage/<hash>/GitHub.copilot-chat/transcripts/<id>.jsonl
 * The Copilot CLI (and IDE plugins built on the same agent) write the same records to
 *   ~/.copilot/session-state/<id>/events.jsonl, with the session's folder in workspace.yaml.
 * Reading only the old location found a person's sessions from months ago and none from the
 * camp — "it took data from April".
 *
 * Every line is `{ type, data, id, parentId, timestamp }`:
 *   session.start           data.sessionId
 *   user.message            data.content — what the person typed (transformedContent is
 *                           the wrapped form sent to the model, and is not the prompt)
 *   assistant.message       one agent turn
 *   tool.execution_start    data.toolCallId, data.toolName, data.arguments
 *   tool.execution_complete data.toolCallId, data.success, data.result
 * Unknown types are skipped and counted, as in every adapter: the format belongs to someone
 * else, and a record this reader does not know must not silently become a lower score.
 */
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname } from 'node:path';
import {
  MAX_LINE_BYTES, classifyCommand, classifyOutcome, distribution, excerptCollector, isCorrection,
} from '../shared.mjs';

const PLANNING = /(?:^|[-_/])(?:manage_todo_list|update_todos?|todo_write|todos?|plan(?:ner)?|update_plan)$/i;

/** Plain text from a string, an array of text blocks, or an object carrying one. */
function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    for (const key of ['text', 'content', 'output', 'stdout', 'detailedContent']) {
      if (value[key] !== undefined) return textOf(value[key]);
    }
  }
  return '';
}

/** The shell command a tool call ran, whatever the tool calls the argument. */
function commandOf(args) {
  if (!args || typeof args !== 'object') return null;
  for (const key of ['command', 'commandLine', 'cmd', 'script']) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return v;
    if (Array.isArray(v)) return v.join(' ');
  }
  return null;
}

/**
 * The folder a Copilot CLI session ran in, from the workspace.yaml beside its events.
 * A tiny reader for the two keys needed, not a YAML parser: `cwd:` and `git_root:`.
 */
export function sessionFolders(eventsFile) {
  try {
    const yaml = readFileSync(dirname(eventsFile) + '/workspace.yaml', 'utf8');
    const out = [];
    for (const key of ['cwd', 'git_root']) {
      const m = yaml.match(new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm'));
      if (m) out.push(m[1].replace(/^["']|["']$/g, ''));
    }
    return out;
  } catch { return []; }
}

/** One agent-format session, in the shape every adapter returns. Null when it has no prompts. */
export async function readAgentSession(file) {
  const s = {
    sessionId: null, startedAt: null, endedAt: null, prompts: 0, promptLengths: [], corrections: 0,
    assistantTurns: 0, toolCalls: {}, toolIds: new Set(), planning: 0,
    commands: { test: 0, buildOrLint: 0, destructive: 0, other: 0 }, testRuns: [],
    pendingTests: new Map(), malformed: 0, oversized: 0, unknownTypes: 0,
    promptExcerpts: excerptCollector(6), correctionExcerpts: excerptCollector(6),
  };
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) { s.oversized++; continue; }
    let rec;
    try { rec = JSON.parse(line); } catch { s.malformed++; continue; }
    const data = rec.data && typeof rec.data === 'object' ? rec.data : {};
    const t = Date.parse(rec.timestamp ?? '');
    if (!Number.isNaN(t)) {
      if (s.startedAt === null || t < s.startedAt) s.startedAt = t;
      if (s.endedAt === null || t > s.endedAt) s.endedAt = t;
    }
    switch (rec.type) {
      case 'session.start':
        if (typeof data.sessionId === 'string') s.sessionId = data.sessionId;
        break;
      case 'user.message': {
        const text = textOf(data.content).trim();
        if (!text) break;
        s.prompts++;
        s.promptLengths.push(text.length);
        s.promptExcerpts.offer(text, { at: rec.timestamp ?? null });
        if (isCorrection(text)) { s.corrections++; s.correctionExcerpts.offer(text, { at: rec.timestamp ?? null }); }
        break;
      }
      case 'assistant.message':
        s.assistantTurns++;
        break;
      case 'tool.execution_start': {
        const id = data.toolCallId ?? rec.id;
        if (id && s.toolIds.has(id)) break;
        if (id) s.toolIds.add(id);
        const name = typeof data.toolName === 'string' ? data.toolName : 'tool';
        s.toolCalls[name] = (s.toolCalls[name] ?? 0) + 1;
        if (PLANNING.test(name)) s.planning++;
        const command = commandOf(data.arguments);
        if (command) {
          const kinds = classifyCommand(command);
          for (const kind of kinds) s.commands[kind]++;
          if (id && kinds.includes('test')) s.pendingTests.set(id, rec.timestamp ?? null);
        }
        break;
      }
      case 'tool.execution_complete': {
        const id = data.toolCallId ?? rec.parentId;
        if (!id || !s.pendingTests.has(id)) break;
        const at = s.pendingTests.get(id);
        s.pendingTests.delete(id);
        const failed = data.success === false ? true : data.success === true ? false : undefined;
        s.testRuns.push({ outcome: classifyOutcome(textOf(data.result), failed), at });
        break;
      }
      default:
        if (typeof rec.type !== 'string') s.unknownTypes++;
    }
  }
  if (!s.prompts) return null;
  return {
    sessionId: s.sessionId ?? basename(dirname(file)) + '/' + basename(file, '.jsonl'),
    startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
    endedAt: s.endedAt ? new Date(s.endedAt).toISOString() : null,
    durationMinutes: s.startedAt && s.endedAt ? Math.round((s.endedAt - s.startedAt) / 60000) : null,
    userPrompts: s.prompts,
    promptLength: distribution(s.promptLengths),
    corrections: s.corrections,
    assistantTurns: s.assistantTurns,
    toolCalls: s.toolCalls,
    toolCallTotal: Object.values(s.toolCalls).reduce((a, b) => a + b, 0),
    commands: s.commands,
    testRuns: s.testRuns,
    planningSignals: s.planning,
    partial: s.oversized > 0,
    oversizedLines: s.oversized,
    malformedLines: s.malformed,
    format: 'copilot-agent-events',
    excerpts: { prompts: s.promptExcerpts.result(), corrections: s.correctionExcerpts.result() },
  };
}
