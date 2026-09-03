# Project context

> **The problem, not the code.** `AGENTS.md` tells an agent how to work *here* — the
> commands, the conventions, the rules of the repo. This file tells it what it is working
> *on*: what the product is for, who uses it, which rules must never be broken, and what
> you have already decided. That is the context an agent cannot get by reading your source,
> and the context every new teammate otherwise has to re-derive by asking someone.
>
> Save it as `docs/project-context.md` (or `docs/business-context.md` — both are read).
>
> **This is a skeleton, not an answer.** The sections marked `{{...}}` and `<!-- FILL -->`
> are where the value is; a version that still reads like this template says nothing only
> your team could have written. Delete any section that does not apply rather than leaving
> it empty — an empty heading is worse than no heading.

## What this is and why it exists

`{{PROJECT_NAME}}` is `{{ONE_SENTENCE: what it does, for whom}}`.

**The problem it solves:** `<!-- FILL: what is broken or expensive today, in the words the
client or user would use. Not "there is no booking system" — what goes wrong because there
isn't one. -->`

**How we will know it worked:** `<!-- FILL: one or two things that would be observably
different if this succeeded. A number if you have one, an observable change if you don't. -->`

## Who uses it

`<!-- FILL: one line per role — what they are trying to get done, not what screens they
see. Two or three roles is usually the whole picture; if you have eight, you have features
rather than roles. -->`

| Role | What they are trying to do | What they must never be able to do |
| ---- | -------------------------- | ---------------------------------- |
| `{{ROLE}}` | `{{GOAL}}` | `{{FORBIDDEN}}` |

## The language of this domain

`<!-- FILL: the five to ten terms that mean something specific here, each in one line.
Include the ones that sound obvious — "booking", "release", "active" — because the obvious
ones are exactly where a wrong assumption goes unnoticed. Where your term differs from the
everyday meaning, say so. -->`

- **`{{TERM}}`** — `{{WHAT IT MEANS HERE}}`

## Rules that must hold

The highest-value section in this file, and the shortest. These are the things that make a
change wrong even when the code compiles and the tests pass.

`<!-- FILL: write them as flat statements about the domain, not as instructions. "A
resource cannot hold two active bookings for the same day" is a rule; "validate bookings
carefully" is advice. Include what happens at the edges you have decided about — and only
those. Three real rules beat twenty generic ones. -->`

1. `{{RULE}}`
2. `{{RULE}}`

## Decisions already taken

`<!-- FILL: append-only. Each entry is what was decided, when, and *why* — the why is the
part that stops the decision being silently reversed in an hour by someone who did not
know the reason. Include the alternative you rejected. -->`

- **`{{DATE}}` — `{{DECISION}}`.** Because `{{REASON}}`. _(Considered instead:
  `{{ALTERNATIVE}}`, rejected because `{{WHY NOT}}`.)_

## Deliberately out of scope

`<!-- FILL: what you have decided NOT to build, and for now. This is what stops an agent
helpfully adding it, and what stops your team re-arguing it on the second day. -->`

## Open questions

Things you genuinely do not know yet. **Never answer one by guessing** — an invented answer
here propagates into code, tests and documentation before anyone notices it was invented.

`<!-- FILL: use a consistent marker so they are greppable. -->`

- `<!-- OPEN: {{QUESTION}} — who could answer it, and what we are assuming until they do -->`
