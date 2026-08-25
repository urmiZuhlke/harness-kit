# Story 2 — feat: Harvest evidence from the repo, git history and AI chat transcripts

## Intent

Scoring how a team worked with AI requires evidence of what actually happened, not just
what the repo looks like at the end. Files are cheap to fake; a transcript showing a real
plan-implement-test-fix loop is not. This story collects that evidence into one auditable
file so scoring becomes a pure function of it.

## Current Behaviour

This capability does not exist yet. The kit's assessment is prose an LLM interprets by
reading the repo; there is no code, no structured output, and no awareness that AI chat
transcripts exist on disk.

## New Behaviour

Running the harvester on a team's machine produces `.vibecheck/evidence.json` — a
structured, human-readable record of what the repo contains, what the git history shows,
and what the team's AI sessions reveal about how they worked. It scores nothing and
judges nothing; it only observes and cites. A missing or unreadable source is recorded as
`not-harvested`, never as a zero.

## Decisions & Rationale

- **Harvesting is separate from scoring**: the harvester runs on the team's machine where
  transcripts live, while scoring must run on a coach's machine to be trustworthy.
  Splitting them makes that possible. _(Alternative considered: one combined command —
  rejected because a coach re-running it on their own laptop would find no transcripts.)_
- **Chat adapters are pluggable**: Claude Code's format is stable and documented by
  inspection; Copilot's is undocumented and changes between VS Code releases. An adapter
  boundary means a Copilot schema break degrades one source instead of breaking the run.
- **Aggregate metrics plus bounded excerpts, never full transcripts**: the evidence file
  is handed to coaches and must not become a copy of everything a participant typed.
- **Command classification strips heredocs and quoted spans, then anchors to the start of
  a shell segment.** Matching runner names anywhere in the raw command string produced
  false positives on this repo's own history — writing a file that mentions `pytest`, or
  grepping for "vitest", registered as test runs. Verification is the heaviest dimension,
  so inflation there is the expensive error. _(Alternative considered: full shell parsing —
  rejected as disproportionate; segment anchoring removed every observed false positive.)_
- **Exit codes outrank log sniffing** when deciding whether a test run passed. An exit code
  is a fact; a matched log line is a guess.
- ***`not-harvested` is a distinct state from zero**: a team whose tool we cannot read must
  not be scored as though they never used AI.

## Requirements

- Collect repo evidence: which harness artefacts exist, whether their content is
  substantive or unmodified boilerplate, whether a test command exists and whether the
  suite actually runs, whether a setup script exists, whether CI configuration is present,
  and whether any secrets appear in tracked files.
- Collect git evidence: commit count, commit message conventions, and the timestamp
  relationship between when harness files first appeared and when the bulk of code was
  committed.
- Collect Claude Code session evidence for sessions belonging to the target repo: prompt
  count and size distribution, tool-call mix, plan-mode usage, test invocations and their
  outcomes, sequences where a failure was followed by a fix and a re-run, and turns where
  the human corrected the agent.
- Collect Copilot chat evidence for the target repo through the same adapter interface.
- Collect session-journal evidence from `.ai-journal/` when present.
- Record every source's harvest status as harvested, empty or not-harvested, with the
  reason.
- Emit a single `evidence.json` containing the collected metrics, a citation for each
  observation, and bounded excerpts where an excerpt is the evidence.
- Provide a `/journal` command that appends a short structured session note to
  `.ai-journal/` when a team runs it.
- Process all transcript data locally and never transmit, upload or copy raw transcripts
  into the output.
- Run on Windows, macOS and Linux with plain Node and no installed dependencies.

## Acceptance Criteria

- [x] Given a repo with Claude Code sessions on disk, when the harvester runs, then
      `evidence.json` contains per-session metrics attributed to that repo and no sessions
      belonging to other repos.
- [x] Given a machine with no Claude Code history, when the harvester runs, then the
      Claude source is recorded `not-harvested` with a reason and the run completes
      successfully.
- [x] Given a Copilot session file whose schema does not parse, when the harvester runs,
      then the Copilot source is recorded `not-harvested` and no exception escapes.
- [x] Given a repo containing a hardcoded secret in a tracked file, when the harvester
      runs, then the finding is recorded with its file and line and the secret value
      itself is masked in the output.
- [x] Verify `evidence.json` contains no verbatim transcript longer than the documented
      excerpt limit.
- [x] Verify the harvester writes nothing outside `.vibecheck/` and `.ai-journal/`.
- [x] Verify the harvester assigns no scores and expresses no judgement anywhere in its
      output.
- [x] Verify a second run on an unchanged repo produces materially identical evidence.

## Technical Proposal

- **Affected files**: new `bin/vibecheck.mjs` harvest entry point; new `lib/harvest/`
  containing `repo.mjs`, `git.mjs`, `journal.mjs` and an `adapters/` folder holding
  `claude-code.mjs` and `copilot.mjs`; new skill for `/journal`.
- **Database changes**: None.
- **API changes**: None. `evidence.json` is the contract consumed by story 3 and must be
  versioned with a schema field.
- **Verified against real data**: 38 Copilot sessions totalling 703 MB (largest single file
  210 MB) parsed at peak 311 MB RSS under a 1 GB heap cap; 18 mixed-tool sessions on one
  repo yielded 355 prompts, 5089 tool calls, 120 test runs and 30 fail-then-pass loops.
  Two Copilot field shapes are not what their names suggest: `terminalCommandOutput` is
  `{text, lineCount}` and `terminalCommandState` is `{exitCode, timestamp, duration}`.
  Terminal output retains ANSI colour codes, which split match targets unless stripped.
- **Key implementation notes**: Claude Code sessions are JSONL at
  `~/.claude/projects/<path-slug>/<uuid>.jsonl`; each line carries `timestamp`, `cwd`,
  `gitBranch`, `sessionId` and a `message` with typed content blocks including tool calls,
  which is how repo attribution and tool-mix metrics are derived. Copilot sessions are **JSONL** (not
  `.json`) under `<user-data>/Code/User/workspaceStorage/<hash>/chatSessions/`, with a
  sibling `workspace.json` mapping the hash to a folder URI. Verified format: an
  append-only delta log where `kind:0` is the initial session snapshot, `kind:1` sets the
  value at key path `k`, and `kind:2` appends at key path `k` — so `["requests"]` appends
  new requests and `["requests", N, "response"]` appends response parts. Each request
  carries `requestId`, `timestamp` (epoch ms), `agent.id` (which distinguishes ask / edit /
  agent mode), `modelId`, `message`, `response`, `result` and `timeSpentWaiting`. Sessions
  outside any workspace live in `globalStorage/emptyWindowChatSessions/`.

## Edge Cases & Out of Scope

**Edge cases to handle:**

- A team works in a directory that is a subfolder of, or a symlink to, the scored repo —
  sessions must still be attributed correctly.
- Two teams share one machine, producing sessions for multiple repos in the same folder.
- A session was started before `git init`, so `gitBranch` is absent.
- **Copilot session files can be enormous** — one observed session was 210 MB. Files must
  be streamed line by line and state rebuilt from the deltas; parsing a whole file into
  memory will exhaust it.
- The test command exists but hangs — the harvester must time out and record the outcome
  rather than blocking the run, **and terminate the whole process tree**. Node's own
  timeout signals only the process it started; a suite run through a shell leaves the
  runner and its workers alive on the team's machine. Verified: zero orphans remain.
- Transcript files are being written while the harvester reads them, leaving a truncated
  final line.

**Out of scope:**

- Reading Copilot's `GitHub.copilot-chat/debug-logs/` and `transcripts/` folders; the
  `chatSessions/` delta log is the authoritative source.
- Assigning any score, weight or pass/fail to the collected evidence — story 3.
- Detecting prompt-injection attempts — story 3.
- Cursor, JetBrains AI or any adapter beyond Claude Code and Copilot.
- Uploading evidence to any server or aggregating across teams — story 5.

## Dependencies

- Story 1 — provides the stripped repo and the rubric that defines which evidence matters.
