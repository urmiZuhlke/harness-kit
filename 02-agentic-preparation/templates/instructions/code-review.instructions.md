---
description: 'Use when reviewing pull requests or any code change. Universal review principles plus a place to record this project'"'"'s own checklists.'
applyTo: '**'
---

# Code Review Conventions

> The **General**, **Pre-Review**, **Testing**, **Security** and **Documentation**
> sections below are universal — keep them. The `<!-- FILL -->` sections are where your
> project's actual conventions go; a reviewer that only knows the generic rules catches
> generic problems.

## General Principles

- Reject over-engineering. New abstractions are only justified if reused in ≥ 2 places or
  addressing a concrete, present need.
- Scope: reject changes that add features or refactor beyond what was asked.
- No dead code (unused imports, functions or variables).
- No secrets, credentials or `.env` values in source files — fail the review immediately.

## Pre-Review

- CI is green (lint, tests, type-check).
- **Verification evidence, not claims.** Any "tests pass" / "build succeeds" / "bug fixed"
  statement in the PR description or a commit message must be backed by having actually run
  the command. Reject a PR that asserts success without showing it — see the
  verify-before-claiming-done invariant in `AGENTS.md`.
- No `TODO` / `FIXME` comments without a linked issue.
- No committed environment files, credentials, state files or build output.
- Newly-accepted dependency vulnerabilities are documented with a rationale.

## Project-specific checklists

`<!-- FILL: one short section per area of your codebase, listing what a reviewer must
check there. Write only what a reviewer could get wrong — skip anything a linter already
enforces. A useful section looks like:

## <Area name>

- <A structural rule: where this kind of code belongs>
- <A correctness rule: the mistake that has actually bitten you here>
- <A boundary rule: what this area must never reach into>

Three areas with three real rules each beats a long generic list. Delete this comment
once you have written yours. -->`

## Testing

- New behaviour is accompanied by a test that would fail without the change.
- Tests assert on outcomes, not on implementation details.
- No skipped, focused or assertion-free tests in committed code (`it.skip`, `test.only`
  and equivalents).
- The test suite passes locally before review, not only in CI.

## Security

- No hardcoded secrets or tokens anywhere in the diff.
- New endpoints or handlers make an explicit choice about who may call them — never an
  implicit default nobody reviewed.
- Cross-origin access is an explicit allowlist, never a wildcard.
- Security middleware and headers are not removed or weakened.
- User-supplied input is validated at the boundary before it reaches storage or a query.

## Documentation

Update in the **same PR** — never as a follow-up:

| Change                          | Doc to update                      |
| ------------------------------- | ---------------------------------- |
| Data shape / schema change      | The schema source-of-truth doc     |
| New or changed API surface      | Architecture doc                   |
| New infrastructure resource     | Architecture doc                   |
| Accepted trade-off or exception | Decision-records doc (append-only) |
