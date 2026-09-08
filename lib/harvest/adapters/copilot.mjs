/**
 * copilot.mjs — harvest GitHub Copilot Chat sessions for one repo.
 *
 * Sessions are JSONL (not .json) under
 *   <user-data>/Code/User/workspaceStorage/<hash>/chatSessions/<uuid>.jsonl
 * with a sibling workspace.json mapping the hash to a folder URI.
 *
 * The file is an append-only delta log:
 *   kind 0 - initial session snapshot (v.requests is usually empty)
 *   kind 1 - set the value at key path k
 *   kind 2 - append at key path k  (["requests"] appends requests;
 *                                   ["requests", N, "response"] appends response parts)
 *
 * Two consequences drive this implementation:
 *   1. Sessions get very large (a 210 MB file was observed on a real machine), so lines
 *      are streamed and never accumulated, and an oversized line is counted rather than
 *      parsed — the session is then reported as partial.
 *   2. The same response part is re-emitted as it updates (a terminal command appears
 *      first without output, then again carrying it), so parts are deduplicated by
 *      toolCallId / terminalCommandId with the latest version winning. Without this,
 *      every tool call would be counted several times.
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, join } from 'node:path';
import { homedir, platform } from 'node:os';
import {
  MAX_LINE_BYTES, classifyCommand, classifyOutcome, distribution, editorStorageRoots,
  excerptCollector, isCorrection, source, workspaceFolderOf,
} from '../shared.mjs';

/**
 * Candidate VS Code workspaceStorage roots across platforms and channels.
 *
 * The shared helper finds each channel's `User` directory; this adapter wants the
 * `workspaceStorage` inside it. Cursor keeps its history in the same layout and used to
 * carry its own copy of this lookup — the copies had already drifted over whether to check
 * for a `file:` URI before parsing one.
 */
function userDataRoots() {
  return editorStorageRoots(['Code', 'Code - Insiders', 'VSCodium'], {
    platform: platform(), env: process.env, home: homedir(),
  }).map((user) => join(user, 'workspaceStorage')).filter((p) => existsSync(p));
}

/**
 * Copilot's own names for its planning tools.
 *
 * This adapter counted no planning signals at all, which is not the same as a team that
 * did no planning: `planned-before-building` needs at least one, so every Copilot team was
 * capped at partial credit on it however they worked, and only a journal entry could
 * rescue any of it. The tool ids were already being recorded for `toolCalls` — nothing
 * was reading them for this.
 *
 * Anchored at the end so a planning word buried inside a longer name does not count:
 * `deploy_plan_checker` is not a planning tool, and this kit's rule is that a classifier
 * gets a test for what it must catch *and* what it must not.
 */
// `plan(?:ner)?`, not `planner?` — the latter makes only the final `r` optional and so
// matches "planne" and "planner" while missing the word it was written for.
const PLANNING_TOOLS = /(?:^|[-_/])(?:manage_todo_list|todos?|plan(?:ner)?)$/i;

/** Exported for the classifier test; not part of the harvest contract. */
export const isPlanningTool = (toolId) => PLANNING_TOOLS.test(String(toolId ?? ''));

function scanParts(parts, acc) {
  for (const part of parts || []) {
    if (part?.kind !== 'toolInvocationSerialized') continue;
    const tsd = part.toolSpecificData;
    const id = part.toolCallId || tsd?.terminalCommandId;
    const toolId = typeof part.toolId === 'string' ? part.toolId : 'unknown';
    if (id) acc.toolCallIds.set(id, toolId);
    else acc.anonymousToolCalls++;

    if (tsd?.kind !== 'terminal') continue;
    const command = tsd.commandLine?.original ?? tsd.commandLine?.forDisplay;
    if (typeof command !== 'string') continue;
    const kinds = classifyCommand(command);
    // terminalCommandState is an object ({exitCode, timestamp, duration}) and
    // terminalCommandOutput is {text, lineCount} — neither is the plain value the name
    // suggests. The exit code is authoritative; fall back to sniffing the text only when
    // the command had not finished by the time this delta was written.
    const exitCode = tsd.terminalCommandState?.exitCode;
    const isError = typeof exitCode === 'number' ? exitCode !== 0 : undefined;
    const outputText = typeof tsd.terminalCommandOutput === 'string'
      ? tsd.terminalCommandOutput
      : tsd.terminalCommandOutput?.text;
    const outcome = kinds.includes('test') ? classifyOutcome(outputText, isError) : null;
    // Latest write wins: a later delta carries the command's output and final state.
    acc.terminalCommands.set(tsd.terminalCommandId || id, { kinds, outcome });
  }
}

function collectRequests(list, acc) {
  for (const request of list || []) {
    const id = request?.requestId;
    if (id && acc.requestIds.has(id)) { scanParts(request.response, acc); continue; }
    if (id) acc.requestIds.add(id);

    const text = typeof request?.message?.text === 'string' ? request.message.text : '';
    if (text.trim()) {
      acc.promptLengths.push(text.length);
      acc.prompts.offer(text, { at: request.timestamp ?? null });
      if (isCorrection(text)) {
        acc.corrections++;
        acc.correctionExcerpts.offer(text, { at: request.timestamp ?? null });
      }
    }
    if (typeof request?.timestamp === 'number') {
      if (acc.startedAt === null || request.timestamp < acc.startedAt) acc.startedAt = request.timestamp;
      if (acc.endedAt === null || request.timestamp > acc.endedAt) acc.endedAt = request.timestamp;
    }
    const mode = request?.agent?.id || request?.modeInfo?.modeId;
    if (mode) acc.modes[mode] = (acc.modes[mode] ?? 0) + 1;
    if (request?.modelId) acc.models[request.modelId] = (acc.models[request.modelId] ?? 0) + 1;
    scanParts(request.response, acc);
  }
}

async function readSession(file) {
  const acc = {
    sessionId: null, startedAt: null, endedAt: null,
    requestIds: new Set(), promptLengths: [], corrections: 0,
    modes: {}, models: {}, toolCallIds: new Map(), terminalCommands: new Map(),
    anonymousToolCalls: 0, oversizedLines: 0, malformedLines: 0,
    prompts: excerptCollector(6), correctionExcerpts: excerptCollector(6),
  };

  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) { acc.oversizedLines++; continue; }
    let record;
    try { record = JSON.parse(line); } catch { acc.malformedLines++; continue; }

    if (record.kind === 0) {
      if (record.v?.sessionId) acc.sessionId = record.v.sessionId;
      if (typeof record.v?.creationDate === 'number') acc.startedAt = record.v.creationDate;
      collectRequests(record.v?.requests, acc);
      continue;
    }
    const path = Array.isArray(record.k) ? record.k : [];
    if (record.kind === 2 && path.length === 1 && path[0] === 'requests') {
      collectRequests(record.v, acc);
    } else if (path.length === 3 && path[0] === 'requests' && path[2] === 'response') {
      scanParts(record.v, acc);
    }
  }

  const commands = { test: 0, buildOrLint: 0, destructive: 0, other: 0 };
  const testRuns = [];
  for (const { kinds, outcome } of acc.terminalCommands.values()) {
    for (const kind of kinds) commands[kind]++;
    if (outcome) testRuns.push({ outcome, at: null });
  }
  const toolCalls = {};
  let planningSignals = 0;
  for (const toolId of acc.toolCallIds.values()) {
    toolCalls[toolId] = (toolCalls[toolId] ?? 0) + 1;
    if (isPlanningTool(toolId)) planningSignals++;
  }

  return {
    sessionId: acc.sessionId,
    startedAt: acc.startedAt ? new Date(acc.startedAt).toISOString() : null,
    endedAt: acc.endedAt ? new Date(acc.endedAt).toISOString() : null,
    durationMinutes: acc.startedAt && acc.endedAt
      ? Math.round((acc.endedAt - acc.startedAt) / 60000) : null,
    userPrompts: acc.requestIds.size,
    promptLength: distribution(acc.promptLengths),
    corrections: acc.corrections,
    modes: acc.modes,
    models: acc.models,
    toolCalls,
    toolCallTotal: acc.toolCallIds.size + acc.anonymousToolCalls,
    commands,
    testRuns,
    planningSignals,
    partial: acc.oversizedLines > 0,
    oversizedLines: acc.oversizedLines,
    malformedLines: acc.malformedLines,
    excerpts: { prompts: acc.prompts.result(), corrections: acc.correctionExcerpts.result() },
  };
}

export async function harvestCopilot({ isInRepo }) {
  const roots = userDataRoots();
  if (!roots.length) {
    return {
      source: source.notHarvested('no VS Code user-data directory found on this machine'),
      sessions: [],
    };
  }

  const files = [];
  let hashesSeen = 0;
  let hashesMatched = 0;
  for (const root of roots) {
    let hashes;
    try { hashes = readdirSync(root); } catch { continue; }
    for (const hash of hashes) {
      const dir = join(root, hash);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      hashesSeen++;
      const folder = workspaceFolderOf(dir);
      if (!folder || !isInRepo(folder)) continue;
      hashesMatched++;
      const sessionDir = join(dir, 'chatSessions');
      if (!existsSync(sessionDir)) continue;
      try {
        for (const file of readdirSync(sessionDir)) {
          if (file.endsWith('.jsonl')) files.push(join(sessionDir, file));
        }
      } catch { /* unreadable session dir — contributes nothing */ }
    }
  }

  if (!hashesMatched) {
    return {
      source: source.empty('no VS Code workspace on this machine maps to this repo', { hashesSeen }),
      sessions: [],
    };
  }
  if (!files.length) {
    return {
      source: source.empty('a VS Code workspace matched but holds no Copilot chat sessions',
        { hashesSeen, hashesMatched }),
      sessions: [],
    };
  }

  const sessions = [];
  const failures = [];
  for (const file of files) {
    try {
      const session = await readSession(file);
      if (session.userPrompts > 0) sessions.push(session);
    } catch (err) {
      // Lost evidence must be visible, not silently absorbed into a lower score.
      failures.push({ file: basename(file), error: err.message });
    }
  }
  if (!sessions.length) {
    return {
      source: source.empty('Copilot session files exist for this repo but contain no requests',
        { hashesSeen, hashesMatched, filesScanned: files.length, failures }),
      sessions: [],
    };
  }
  return {
    source: source.harvested({
      hashesSeen, hashesMatched, filesScanned: files.length,
      sessionsMatched: sessions.length, failures,
    }),
    sessions,
  };
}
