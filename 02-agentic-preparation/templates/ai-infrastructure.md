# AI Infrastructure

> **Inventory of this repo's AI setup.** Kept current so any tool, and any human, can see
> what's active without reading every config file. Update this in the same change
> whenever you add, remove, or change an instruction file. Skills and agents are
> **global** (installed once per machine, not copied into this repo), so this doc mostly
> points at what's relevant here rather than duplicating global content.

## Instructions (repo-specific, `.github/instructions/`)

| File | `applyTo` | Governs |
| ---- | --------- | ------- |
| `project-context.instructions.md` | always | Business rules, domain glossary |
| `local-setup.instructions.md` | always | Local dev environment |
| `code-review.instructions.md` | any change (PR review) | Conventions and review checklist |
| `agents.instructions.md` | `**/*.agent.md` | The agent-authoring convention |
| `git-conventions.instructions.md` | commits / git | Conventional Commits |
| `story-format.instructions.md` | any GitHub issue | The story template |
| `documentation.instructions.md` | any `.md` file | Doc conventions |
| _(add rows for this repo's own stack-specific instruction files — database, frontend, backend framework, security, testing, infra, etc.)_ | | |

## Global skills relevant to this repo

Installed once per machine via `node <harness-kit>/plugin/scripts/install.mjs`
(see [`plugin/README.md`](../../plugin/README.md) for the full catalog) — not copied here.

- `harness-kit` (`/harness-kit new` scaffolds a repo, `/harness-kit init` captures
  `docs/project-context.md`)
- _(list any repo-embedded domain/stack skills adopted from `02-agentic-preparation/skills/`, if any)_

## Global agent roster

Also installed globally, not copied here — see
[`03-agent-setup/agents-overview.md`](../../03-agent-setup/agents-overview.md).

- **Planner** — feature idea → challenged requirements → GitHub issue(s)
- **Implementer** — issue (or ad hoc request) → working, tested, documented, reviewed PR
- **Reviewer** — pre-PR self-review (security, clean code, risk, AC coverage, tests)
- **Explore** — read-only research helper the other three call internally (Copilot only;
  Claude Code ships an equivalent built in)

## Local-only, should be shared

Machine-level config that lives on one developer's machine today and should be
committed/documented so the whole team inherits it — e.g. an MCP server connection
(cloud provider, database, issue tracker), a checked-in `.vscode/mcp.json`, or a harness memory/learnings file.

- _(list anything found here — leave empty if none)_

## Decision log pointer

Accepted trade-offs and CVE exceptions are recorded in
[`docs/decision-records.md`](decision-records.md), not duplicated here.
