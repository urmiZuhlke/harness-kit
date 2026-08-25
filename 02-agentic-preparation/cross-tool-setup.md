# Cross-Tool Agent Setup — Making Copilot _and_ Claude Obey the Same Rules

The single most important goal of the agentic layer is this: **every AI tool a
developer might use must follow the same conventions, and it must not be optional.** A
teammate using Claude Code should not be able to silently change code in ways that
violate rules that only GitHub Copilot happens to read.

This document explains how the files in [`templates/`](templates/) achieve that, and how
to lay them out in a project.

## The problem

Different tools discover instructions differently:

| Tool                                                  | Discovers automatically                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GitHub Copilot**                                    | `.github/copilot-instructions.md` (repo-wide) + `.github/instructions/*.instructions.md` (path-scoped via `applyTo`) + `AGENTS.md` / `CLAUDE.md` |
| **Claude Code**                                       | `CLAUDE.md` (root + nested, supports `@path` imports) and `AGENTS.md`                                                                            |
| **Codex / Cursor / Aider / Gemini / Amp / Jules / …** | `AGENTS.md` (nearest in the directory tree wins)                                                                                                 |

If rules lived **only** in `.github/instructions/*.instructions.md`, Copilot would honor
them but a Claude Code or Cursor user might never see them. That is the "optional
instructions" trap we must avoid.

## The solution: one canonical source + a universal entry point

```
repo-root/
├── AGENTS.md                         ← UNIVERSAL entry point (all tools read this)
│                                        • non-negotiable always-on rules (duplicated here on purpose)
│                                        • an index mapping file globs → the path-scoped rule files
├── CLAUDE.md                         ← thin file: `@AGENTS.md` import + Claude-specific notes
├── .github/
│   ├── copilot-instructions.md       ← Copilot repo-wide entry (points to AGENTS.md + instructions/)
│   ├── instructions/
│   │   └── *.instructions.md         ← CANONICAL path-scoped rules (Copilot loads via applyTo)
│   └── story-template.md
└── docs/
    └── ai-infrastructure.md          ← human/agent-readable inventory of the whole setup
```

Note what's deliberately **not** in this tree: the agent roster (Planner, Implementer,
Reviewer, Explore). Those are installed globally, once per machine
(`node plugin/scripts/install.mjs` → `~/.copilot/agents/` for Copilot, `~/.claude/skills/`
for Claude Code), the same way this kit's skills are — not copied per repo. `.github/
agents/*.agent.md` is a real Copilot discovery location, but Claude Code has no
equivalent for it; genuine subagents would live in `.claude/agents/`, but none are
bundled today (see the fork-and-revert note in
[`03-agent-setup/agents-overview.md`](../03-agent-setup/agents-overview.md)), so that
folder stays empty. See that doc for the full design.

Skills (domain playbooks + validation audits) are deliberately **not** part of this
per-repo tree — they live once in your global personal-skills install
(`~/.claude/skills/`, `~/.copilot/skills/`, via `plugin/scripts/install.mjs`) so every
repo shares one up-to-date copy instead of drifting on the next kit update.

### Why this works — three layers of enforcement

1. **Universal layer (`AGENTS.md`).** Read by _every_ modern coding agent. It carries
   the **critical invariants** (auth-by-default, no secrets in source, idempotent
   migrations, Conventional Commits, tests-with-behaviour, no wildcard CORS, stay in
   scope). Because these are duplicated in the always-loaded file — not buried in a
   path-scoped file a tool might ignore — **no tool can miss them.** This is the
   "not optional" guarantee.

2. **Copilot-native path layer (`.github/instructions/*.instructions.md`).** The richest
   layer: each file's `applyTo` glob means Copilot injects exactly the right rules when
   editing matching files, with zero prompt overhead. This is the canonical home of the
   detailed conventions.

3. **Bridge for other tools.** `AGENTS.md` contains an explicit **index table** telling
   any agent: "before editing files matching X, open `.github/instructions/Y`." `CLAUDE.md`
   imports `AGENTS.md` via `@AGENTS.md` so Claude Code inherits everything. Nothing is
   duplicated except the small set of invariants — the detailed rules have exactly one
   home, preventing drift.

## Design principles

- **Single source of truth.** Detailed rules live once, in `.github/instructions/`.
  Everything else _points_ to them. Never copy rule bodies into multiple files.
- **Duplicate only invariants, deliberately.** The short list of "never violate" rules
  is intentionally repeated in `AGENTS.md` so the always-on layer is self-sufficient.
- **Index, don't inline.** `AGENTS.md` maps globs → instruction files; it does not inline
  their contents.
- **Reinforce with automation.** Instructions are necessary but not sufficient. Back them
  with a pre-commit hook (lint/format/commitlint), a required CI gate, and code-review
  conventions so a violation is caught even if an agent ignored a rule.

## Adoption checklist

- [ ] Copy `templates/AGENTS.md` → repo root; fill in placeholders and the invariant list.
- [ ] Copy `templates/CLAUDE.md` → repo root (keep the `@AGENTS.md` import).
- [ ] Copy `templates/copilot-instructions.md` → `.github/copilot-instructions.md`.
- [ ] Copy `templates/instructions/*` → `.github/instructions/`; adjust `applyTo` globs
      and placeholders to your paths.
- [ ] Copy `templates/story-template.md` → `.github/story-template.md`.
- [ ] Make sure the agent roster and skills are installed globally on this machine
      (`node plugin/scripts/install.mjs`, once) — never copy agents or skills into the repo.
- [ ] Copy `templates/ai-infrastructure.md` → `docs/ai-infrastructure.md`; fill in this
      repo's own instruction files and any repo-embedded skills.
- [ ] Wire a pre-commit hook + a required CI gate so the rules are also enforced mechanically.
- [ ] Verify: open the repo in Copilot **and** Claude Code and confirm both surface the rules.

## FAQ

**Do I still need `.github/instructions/` if I have `AGENTS.md`?** Yes — keep it. It gives
Copilot precise, low-overhead, path-scoped context that a single monolithic `AGENTS.md`
cannot. `AGENTS.md` is the safety net and index; the instruction files are the detail.

**What if a tool reads none of these?** Then mechanical enforcement (hooks + required CI)
is your backstop. Never rely on instructions alone for a hard invariant.

**Nested monorepo packages?** You may add a nested `AGENTS.md` inside a package; the
nearest file wins for tools that support it. Keep shared invariants at the root.
