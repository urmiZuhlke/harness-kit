# harness-kit

A workshop kit for learning to build software *with* AI — and a scorer that tells you how
well you did it.

Teams get harness templates and the scoring rubric on day one. At the end, one command
turns their repo, their git history and their AI chat transcripts into a score out of 100,
listing every criterion — passed and failed alike — with what was looked for, what was
found, and what to do about it.

## For teams

**1. Read the rubric.** [`docs/rubric.md`](docs/rubric.md) — six dimensions, 100 points,
published up front. Nothing is hidden.

**2. Build your harness.** Templates to start from live in
[`02-agentic-preparation/templates/`](02-agentic-preparation/templates/):

- `AGENTS.md` / `CLAUDE.md` / `copilot-instructions.md` — the instruction layer: how to
  work in this repo
- `project-context.md` — the problem itself: the domain, its rules, your decisions. Save
  it as `docs/project-context.md`; it is scored separately from the instruction layer,
  because an agent cannot infer any of it from your source
- `instructions/` — path-scoped rules, for where they earn their place
- `story-template.md` — a structure for the work you hand an agent

They are starting points, not answers. An unmodified template scores close to zero —
the rubric rewards *your* project's real rules, commands and constraints.

**3. Check yourself, as often as you like.** One command, in a terminal — it is a plain
script, not an AI:

```bash
node bin/vibecheck.mjs --team "Your Team Name"
```

It reads your repo, your git history and your AI chat transcripts — locally — and writes
`.vibecheck/report.html` with your score and what to do next, ranked by what it is worth.
It also writes **one file to hand in**, and prints its path.

**Every member of the team runs that same command with the same team name.** Transcripts
live in each person's home directory, so a check on one laptop measures one person and
calls it the team; the team name inside each file is what links your laptops together
later. Commit `.vibecheck/` so the file travels with your repository.

Transcripts can be read from **Claude Code, GitHub Copilot in VS Code, Codex CLI and
Cursor**. Anything else is reported as unassessed rather than failed — run `/journal` at
milestones as your fallback.

## For facilitators

- [`docs/rubric.md`](docs/rubric.md) — the shared standard every team is scored against
- [`docs/facilitator-field-guide.md`](docs/facilitator-field-guide.md) — one page: the
  intervention ladder, the cadence, and the three things to do before the event starts
- [`docs/participant-one-pager.md`](docs/participant-one-pager.md) — what teams are told,
  including the privacy notice they consent to
- [`docs/acceptance-checklist.template.json`](docs/acceptance-checklist.template.json) —
  write this from your event's brief; it is 5 of the 100 points
- [`docs/intro-outline.md`](docs/intro-outline.md) — a 30-minute kickoff outline
- Leaderboard across every team. Collect every file everyone handed in into one flat
  folder — no subfolders to make, no renaming — and run:

```bash
node bin/leaderboard.mjs --dir collected --html leaderboard.html
```

Files are grouped by the team name stamped inside them, several members of one team are
merged into one score automatically, and each score is recomputed from the evidence, so a
team editing their own `score.json` changes nothing. Your own per-team files go in the
same folder as `<team-slug>.scorecard.json` and `<team-slug>.judgement.json`.

The run also writes `collected/judging/<team>.json` — one small file per team holding only
the excerpts `/facilitator-judge` reads. Judge from those: they leave out the committer
names, repository paths, branch names and test output that a judgement does not depend on.

## What this measures

Engineering leverage, not consumption. Token counts, lines of code, commit numbers and
team size are not inputs to the score. What carries weight is evidence that is expensive
to fake: a real plan-implement-test-fix loop in your transcripts, a harness that existed
before the code, a written account of the problem being solved, and tests that actually
run.

## Requirements

Node 20 or newer, and nothing to install — the tests use Node's built-in runner. Reading
Cursor's history needs Node 22.5 or newer, because it uses `node:sqlite`; on an older
runtime that one source reports as unreadable and nothing else changes.

## Optional: install the agent roster globally

The kit ships four generic agents — Planner, Implementer, Reviewer, Explore — plus the
`harness-kit` scaffolding skill. Installing them makes them available from any repo:

```bash
node plugin/scripts/install.mjs --dry-run
```

Preview first; drop `--dry-run` to apply. Plain Node, no build step, safe to re-run.

## Layout

See [`docs/repo-structure.md`](docs/repo-structure.md). Work in progress is tracked in
[`docs/stories/`](docs/stories/).
