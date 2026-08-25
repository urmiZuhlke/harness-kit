---
description: 'Use when writing commit messages, reviewing commits, or working with git in this repository. Covers the Conventional Commits format enforced by commitlint + Husky.'
applyTo: '**'
---

# Git Commit Message Conventions

## Enforcement

Commit messages are validated automatically on every `git commit` via a Husky
`commit-msg` hook running `commitlint`. Non-conforming messages are **rejected**
before the commit is created.

## Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

- **type** and **subject** are required.
- **scope** is optional but recommended.
- **subject** is lowercase, imperative mood, no trailing period.
- Max header line length: **100 characters**.

## Allowed Types

| Type       | When to use                                                        |
| ---------- | ------------------------------------------------------------------ |
| `feat`     | A new feature visible to users or consumers of an API              |
| `fix`      | A bug fix                                                          |
| `chore`    | Maintenance (deps bumps, tooling config, scripts) — no prod change |
| `docs`     | Documentation only                                                 |
| `style`    | Formatting, whitespace — no logic change                           |
| `refactor` | Code restructure with no feature add or bug fix                    |
| `perf`     | Performance improvement                                            |
| `test`     | Adding or updating tests                                           |
| `build`    | Build system or external dependency changes                        |
| `ci`       | CI/CD configuration changes (GitHub Actions, workflows)            |
| `revert`   | Reverts a previous commit                                          |

## Scopes

Use the name of the affected area. Define a short, project-specific scope list and
keep it consistent — e.g. `auth`, `db`, `frontend`, `mf`, `infra`, `ci`, `deps`,
`config`, `e2e`, plus one scope per major feature.

## Examples

```
feat(auth): add JWT refresh token endpoint
fix(db): handle null created_at in migration guard
chore(deps): bump orm to latest patch
docs(api): document /health endpoint
test(auth): add unit tests for jwt strategy
ci: add permissions blocks to all workflows
refactor(hello): extract greeting logic to service
```

## Breaking Changes

Add `!` after the type/scope and include a `BREAKING CHANGE:` footer:

```
feat(auth)!: replace session cookies with JWT

BREAKING CHANGE: clients must now send Authorization: Bearer <token> header
```

## Escape Hatch

`git commit --no-verify` bypasses all hooks. Use only in genuine emergencies. The
bypass is visible in history and should be explained in the commit body.
