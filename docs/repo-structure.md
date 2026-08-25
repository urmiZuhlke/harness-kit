# Repo Structure

Reference for anyone changing the kit. To just use it, read the
[README](../README.md) and [the rubric](rubric.md) instead.

```
harness-kit/
├── README.md                          ← what this is, for teams and for coaches
├── docs/
│   ├── rubric.md                      ← THE scoring standard: 6 dimensions, 100 points
│   ├── repo-structure.md              ← you are here
│   └── stories/                       ← the build plan, one file per story
├── 02-agentic-preparation/            ← what teams start from
│   ├── cross-tool-setup.md
│   ├── templates/
│   │   ├── AGENTS.md · CLAUDE.md · copilot-instructions.md
│   │   ├── story-template.md · ai-infrastructure.md
│   │   └── instructions/              ← 8 generic path-scoped rule files
│   └── skills/systematic-debugging/
├── 03-agent-setup/                    ← the agent roster + reference workflows
│   ├── agents-overview.md
│   ├── agents/                        ← Planner, Implementer, Reviewer, Explore
│   │   └── claude/                    ← Claude-side skill equivalents
│   └── workflows/ci.yml · security-scan.yml
├── .claude-plugin/marketplace.json    ← makes this repo an installable plugin marketplace
└── plugin/                            ← the optional global-install slice
    ├── scripts/install.mjs            ← copies agents + skills into personal folders
    ├── scripts/scaffold-new-project.mjs
    ├── agents/                        ← bundled mirror of 03-agent-setup/agents/
    └── skills/harness-kit/            ← /harness-kit new · /harness-kit init
```

## Arriving with later stories

`bin/vibecheck.mjs` (harvest + score), `lib/harvest/` (repo, git, Claude Code and Copilot
adapters), `lib/score/`, `lib/integrity/`, `bin/leaderboard.mjs` and the coach/participant
material. See [`stories/`](stories/) for the sequence.

## The two sections, one line each

1. **`02-agentic-preparation/`** — the harness templates a team fills in. Starting points,
   never answers: the rubric scores substance, so an unmodified template earns almost
   nothing.
2. **`03-agent-setup/`** — a small generic agent roster (Planner → Implementer → Reviewer,
   plus a read-only Explore) and reference CI/security workflows.
