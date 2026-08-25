# harness-kit (plugin)

The optional installable slice of [harness-kit](../README.md). Installs the generic agent
roster and the scaffolding skill into your personal folders so they work from any repo.

## What it installs

- **Agents**: `Planner`, `Implementer`, `Reviewer`, `Explore` (plus Claude-side skill
  equivalents).
- **`harness-kit`**: `/harness-kit new` scaffolds a brand-new empty repo (folder skeleton,
  instruction files, workflows); `/harness-kit init` captures the repo's project context.

It deliberately does **not** install an instruction layer or invariants — that is the work
the rubric scores, and shipping it would hand out points for free.

## Install

```bash
node plugin/scripts/install.mjs --dry-run
```

Preview first; drop `--dry-run` to apply. Plain Node, no dependencies, idempotent — it
reports which items changed, updates the stale ones and leaves the rest alone. A no-op run
just says "already up to date".

Claude Code users can instead add this repo as a plugin marketplace and install
`harness-kit@harness-kit`.
