# Copilot repository instructions

> Place this file at `.github/copilot-instructions.md`. GitHub Copilot loads it
> automatically for every request in this repository. Keep it short (≤ ~2 pages) and
> non-task-specific. Fill in every `{{PLACEHOLDER}}` — a generic version of this file
> gives Copilot nothing it doesn't already know.

## What this repo is

`{{PROJECT_NAME}}` — `{{ONE_LINE_DESCRIPTION}}`.

**Stack:** `{{LANGUAGES, FRAMEWORKS, DATASTORE, HOSTING}}`

See [`docs/project-context.md`](../docs/project-context.md) for product context.

## How instructions are organized

- **Non-negotiable, always-on rules** live in the root [`AGENTS.md`](../AGENTS.md) —
  read it.
- **Path-scoped rules** live in `.github/instructions/*.instructions.md` and are applied
  automatically by their `applyTo` globs. Follow the one matching the file you are editing.

## Build & validate

```bash
{{SETUP_COMMAND}}   # from a fresh clone to a running app
{{CHECK_COMMAND}}   # the full gate: lint + tests + build — run before sharing work
```

Always run the check command and make it pass before opening a PR. If a step fails, fix
the cause — do not bypass hooks or lower thresholds.

## Core expectations

- `<!-- FILL: the 3-5 rules specific to this codebase that you would reject a PR over.
  Not generic advice — the things a newcomer gets wrong here. -->`
- Stay strictly in scope; declare which files you will touch before touching them.
- Verify before claiming done — run the command and read the output.
- No secrets in source; environment variables only.
- Ask when a requirement is genuinely ambiguous rather than guessing.
