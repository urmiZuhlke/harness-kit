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

- `AGENTS.md` / `CLAUDE.md` / `copilot-instructions.md` — the instruction layer
- `instructions/` — path-scoped rules, for where they earn their place
- `story-template.md` — a structure for the work you hand an agent

They are starting points, not answers. An unmodified template scores close to zero —
the rubric rewards *your* project's real rules, commands and constraints.

**3. Check yourself, as often as you like.**

```bash
node bin/vibecheck.mjs
```

> Not built yet — arrives with story 3. Until then, read the rubric and self-assess.

## For coaches

- [`docs/rubric.md`](docs/rubric.md) — the shared standard every coach scores against
- Field guide and intro material — arriving with story 6
- Leaderboard across all teams — arriving with story 5

## What this measures

Engineering leverage, not consumption. Token counts, lines of code and commit numbers are
not inputs to the score. What carries weight is evidence that is expensive to fake: a real
plan-implement-test-fix loop in your transcripts, a harness that existed before the code,
and tests that actually run.

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
