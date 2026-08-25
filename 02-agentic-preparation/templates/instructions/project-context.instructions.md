---
description: 'Apply to every agent interaction. Points agents at the project context document and defines how to handle confirmed gaps ("open questions") without guessing.'
applyTo: '**'
---

# Project Context

Full product/business context is maintained in [`docs/project-context.md`](../../docs/project-context.md)
(rename to suit your project — e.g. `business-context.md`).

**Read that file before:**

- Refining any requirement or acceptance criterion
- Designing or naming any new database table, column, or enum value
- Implementing any feature that touches core domain records or access control
- Choosing between architectural approaches with product implications
- Writing any business-logic validation (status transitions, access rules, field constraints)

**Update that file when you discover new context:**

- If a user's request conflicts with the documented context, politely flag the conflict,
  point to the relevant section, and pause until they clarify or approve an update.
- If you discover new confirmed behaviour while implementing, add it to the relevant
  section of the context doc.

## How to handle open questions

The context doc contains confirmed gaps (mark them with a consistent convention, e.g.
`<!-- OPEN: ... -->`). When your task touches an open question:

1. Do **not** guess or assume an answer.
2. Do **not** pick a "reasonable default" and proceed silently.
3. Surface the specific question to the user in plain language (via the ask-questions
   tool) before writing any code.
4. If the question concerns a feature explicitly deferred / not yet being built, skip
   it entirely — do not scaffold a placeholder unless instructed.

## What agents must never do

- Invent domain rules that are not documented or confirmed.
- Infer the current database schema from migration scripts — read the schema doc /
  schema source instead. Migrations are incremental deltas, not the current state.
- Store or return plaintext secrets beyond the moment of creation, when the design says
  otherwise.
- Hard-code values that the design says should be data-driven.
