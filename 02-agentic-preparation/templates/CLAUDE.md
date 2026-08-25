# CLAUDE.md

This project's agent instructions are maintained in a single, tool-neutral source so
that every AI tool follows the **same** rules. Do not duplicate rules here.

@AGENTS.md

## For Claude Code specifically

- The line above imports [`AGENTS.md`](AGENTS.md) using Claude Code's `@path` import
  syntax. Read it in full — it contains the non-negotiable rules and an index of the
  path-scoped instruction files.
- Before editing files in a given area, open the matching
  `.github/instructions/<name>.instructions.md` file listed in the AGENTS.md table.
  These are the same rules GitHub Copilot loads automatically via `applyTo` — they are
  **mandatory**, not optional, for every tool.
- Any repo-specific skills live under `.claude/skills/`. Load the relevant `SKILL.md`
  when its triggers match the task.
- If the agent roster (Planner, Implementer, Reviewer) is installed on this machine, use
  `/planner`, `/implementer` or `/reviewer`. See `docs/ai-infrastructure.md` for what this
  repo actually relies on.

> **Why this indirection?** Keeping one canonical source (`.github/instructions/` +
> `AGENTS.md`) prevents drift. If instructions lived only in Copilot-specific files, a
> Claude Code user could unknowingly change code that violates conventions. This file
> closes that gap.
