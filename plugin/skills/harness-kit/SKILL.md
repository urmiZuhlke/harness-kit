---
name: harness-kit
description: "Use for harness-kit setup and onboarding commands. `/harness-kit new` scaffolds a brand-new empty repo (folder skeleton, AGENTS.md, instructions, skills, agents, workflows) via one script; `/harness-kit init` — check, create, or refresh a repository's \"brain\" (docs/project-context.md: business + technical context), then point the user at the readiness assessment. Trigger when the user runs /harness-kit, asks to start/scaffold a new project, initialise/onboard the kit in a repo, check/create/update the repo's brain or business context, or set up project context for a new codebase."
argument-hint: "[new|init] [target]"
user-invocable: true
---

# harness-kit

The setup and onboarding entry point for the harness-kit: scaffold a new repo,
and keep its brain doc current. Two commands today, room for more as patterns emerge.

## Commands

| Command | What it does |
| ------- | ------------ |
| `/harness-kit new` | Scaffold a **brand-new, empty repo**: folder skeleton, `AGENTS.md`/`CLAUDE.md`/Copilot instructions, path-scoped instruction files, domain + validation skills, the agent roster, and CI/security workflows — mechanically, via one script. Then hands off to `init`. |
| `/harness-kit init` | Check the repo's **brain** (`docs/project-context.md`): create it if missing, refresh it if stale, report if fresh. Recommend next steps. |

If the user typed `/harness-kit` with no command, or a phrase that maps to setup or brain
maintenance ("set up the kit here", "check/create/update this repo's brain", "capture
business context", "onboard this codebase"), run **init**. If the repo is empty or
doesn't exist yet ("start a new project", "scaffold a new repo", "set up an empty repo
with harness-kit"), run **new** first, then **init**.

---

## `/harness-kit new` — scaffold a brand-new repo

Goal: automate every *mechanical* step of adopting the blueprint (Sections 01–03) into an
empty repo, so the brain-doc interview in `init` is the only judgment-heavy step left. This
does **not** generate working application code (no `npm init`, no framework boilerplate) —
only the folder skeleton and the agentic layer. Deliberately one script, not a rewrite of
the copy checklist in prose: see the durable-value test in
the kit's leanness rule in `AGENTS.md`
— this qualifies (deterministic, mechanical, previously all-manual).

### Step 1 — Ask the required inputs (one batch, via the ask-questions tool)

1. **Shape**: minimal (harness only, bring your own stack), frontend-only, or
   full-stack? Default to **minimal** unless the user says otherwise. If the user
   already described the project, infer a recommendation but confirm rather than assume.
2. **Project name** — fills `{{PROJECT_NAME}}`/`{{PROJECT}}` placeholders.
3. **Target directory** — default to the current directory if it looks empty; otherwise ask.

### Step 2 — Locate the kit's clone

The scaffold script reads its source files (templates, skills, agents, workflows) from
this repo, so it must be run from inside a clone of it. If you already have this repo
open, use its root. Otherwise ask the user for the path to their local clone (they cloned
it once already to install the kit) — never guess a path.

### Step 3 — Run the scaffold script

```
node <kit-repo-root>/plugin/scripts/scaffold-new-project.mjs --shape <minimal|frontend|fullstack> --name "<name>" --target <path> --yes
```

This deterministically creates: the shape's folder skeleton (`.gitkeep`-only, structure
not code), root `AGENTS.md`/`CLAUDE.md`/`.github/copilot-instructions.md`, the path-scoped
`.github/instructions/*`, `.github/story-template.md`, the relevant skills into
`.claude/skills/`, the agent roster into `.github/agents/`, the CI/security workflows into
`.github/workflows/`, and an auto-generated `docs/ai-infrastructure.md` inventory. It also
fills `{{PROJECT_NAME}}`, `{{PROJECT}}`, `{{AGENTIC_LABEL}}` (always `agentic`), and
`{{ORG}}`/`{{REPO}}` (detected from the target's git remote when one already exists).

### Step 4 — Report what still needs human input, honestly

The script prints every file that still contains a placeholder it couldn't safely guess
(e.g. `{{UI_LIB}}`, `{{ONE_LINE_DESCRIPTION}}`, `{{ORG}}` if there's no git remote yet).
Surface that list plainly — never claim the repo is fully set up while placeholders remain.

### Step 5 — Chain into `init`

Immediately continue into **Branch A of `/harness-kit init`** below to capture the actual brain
doc — the one part of setup that's a real interview, not a copy. Then recommend
`docs/rubric.md` to see how the result will be scored.

> **"The repo's brain"** is the friendly name for `docs/project-context.md` — a per-repo,
> human- and agent-readable description of what the app is, who it's for, and how its
> domain works. It's deliberately **not** a cross-repo chatbot or index (see
> a full domain-modelling exercise — that's a separate, larger
> effort); harness-kit's job is narrower and concrete: make sure *this* repo's brain file
> exists and stays current, in a shape any aggregator could later ingest.

---

## `/harness-kit init` — check, create, or refresh the repo's brain

Goal: `docs/project-context.md` always reflects reality, with the least work each time it's
run. One command, three branches — **idempotent by design**: safe to run on a brand-new repo
or a repo that already has a doc.

### Step 0 — Check freshness first (deterministic, no reasoning needed)

Before reading anything with judgement, run the freshness check — it's a plain script, not
an LLM call, so it's cheap and exact:

```
node <path-to-harness-kit>/plugin/skills/harness-kit/scripts/check-brain-freshness.mjs --target <repo-path>
```

It prints one of:

- **`MISSING`** — no brain doc found → go to **Branch A: Create**.
- **`UNSTAMPED`** — a doc exists but has no readable "Last updated" date → go to
  **Branch B: Refresh** (and make sure Step 4 always stamps the date going forward).
- **`STALE <n> <since-date>`** — `n` commits touched core paths (`src/`, `schema/`,
  `docs/`) since the doc was last updated → go to **Branch B: Refresh**.
- **`FRESH <since-date>`** — no core-path commits since the last update → go to
  **Branch C: Report only**.

If the script can't run (no Node, no git, unusual layout), fall back to manually checking
for `docs/project-context.md` and reading its "Last updated" line before proceeding.

### Branch A — Create (doc is missing)

Run the full interview: Steps 1–4 below, then Step 5.

### Branch B — Refresh (doc is stale or unstamped)

A lighter pass — don't re-run the whole interview:

1. Read the existing doc in full; treat every section as **provisionally accurate** unless
   the freshness check or a targeted re-crawl (Step 2, scoped to the core paths the script
   flagged) shows it's changed.
2. Ask only about what plausibly changed — new flows, new terms, new integrations, a
   status/access rule that moved. Don't re-ask what's still true.
3. Preserve every confirmed line the human hasn't contradicted; never wholesale-rewrite.
4. Resolve any `<!-- OPEN: ... -->` markers you now have an answer for; add new ones for
   anything newly uncertain.
5. Re-stamp the "Last updated" date (Step 4) even if only one section changed — that's what
   makes the next freshness check accurate.

### Branch C — Report only (doc is fresh)

Tell the user the brain doc is current (cite the `FRESH <since-date>` result), summarise it
in 2–3 lines, and skip straight to Step 5's next-step recommendations. Don't rewrite it.

### Step 1 — Load current state (Branch A only; Branch B already read the doc in its own step 1 above)

Look for `docs/project-context.md` (also `docs/business-context.md`, or a `## Project
context` section elsewhere in `docs/`) — Step 0's script already tells you which case you're
in, so this step is just reading the file, not deciding what to do with it.

### Step 2 — Explore the codebase (crawl once, thoroughly)

Before asking anything, scan the repo so your questions are informed and you never ask what
the code already answers:

- **README / docs** — stated purpose, audience, domain terms.
- **Manifests** (`package.json`, `*.csproj`, `pom.xml`, `pyproject.toml`, …) — stack,
  frameworks, workspaces, entry points, how it's run.
- **Source layout** — the modules/domains, the main flows, the entities (schema files,
  models, migrations *as hints only — read the schema source for the current state*).
- **Config / infra** — external systems it talks to (DBs, queues, third-party APIs), envs.
- **Existing setup docs** — how to install and run locally.

For example: the README says "returns service", `package.json` shows a workspace named
`@org/returns-api`, and a migration file mentions a `refund_status` column — that's enough
evidence to form the hypothesis "this is a returns-processing service" before asking anyone.

Form **hypotheses** (domain, primary users, key flows, external systems) to confirm in the
interview — don't present them as settled facts.

### Step 3 — Interview (open, one topic at a time)

Use the harness's structured question tool when available; otherwise ask in chat and stop
after each question. Keep **one topic per question**, lead with your hypothesis where the
crawl produced one ("From the code this looks like a returns-processing service — is that
right?"), and wait for the answer before the next.

Cover, at minimum (skip anything the repo already answers with strong evidence):

1. **What is this app, in one line?** The single thing it exists to do.
2. **Who uses it?** Primary users and their context; a secondary audience only if real.
3. **Key business flows.** The 3–7 flows that matter (e.g. "create return", "approve
   refund"), each in a sentence.
4. **Domain glossary.** The terms a newcomer would misread — define them.
5. **Access & rules.** Who can do what; important status transitions or constraints.
6. **External systems.** What it integrates with and why.
7. **How to run it.** The shortest path from clone to running locally.
8. **Known gaps / not-yet-built.** Things deliberately deferred (mark as open questions).

Do at least one real answer round before drafting. Propose inferred answers as hypotheses the
user confirms — never synthesise the whole doc from the crawl alone.

### Step 4 — Write `docs/project-context.md`

Write the confirmed context in this structure. Mark confirmed gaps with
`<!-- OPEN: ... -->` so downstream agents know not to guess (matches the kit's
[project-context instruction](../../../02-agentic-preparation/templates/instructions/project-context.instructions.md)).

```markdown
# Project Context — <app>

_Last updated: <date> · captured via `/harness-kit init`_

## What this is
<one-line purpose, then a short paragraph>

## Users
<primary users, their context; secondary if real>

## Key business flows
1. **<flow>** — <one sentence>
...

## Domain glossary
- **<term>** — <definition>

## Access & rules
<who can do what; status transitions; constraints>

## External systems
- **<system>** — <what/why>

## Running it locally
<shortest clone-to-running path; link to setup docs if they exist>

## Open questions
<!-- OPEN: <thing not yet decided / not yet built> -->
```

Confirm the draft with the user before saving. Then create/update the file with the native
file tool.

### Step 5 — Recommend next steps

Close by pointing the user at the natural follow-ups, in order:

1. **Keep the brain accurate** — re-run `/harness-kit init` after a meaningful change, or let the
   re-run it when a fact changes mid-task; it writes
   the same file, so neither duplicates the other's work.
2. **Baseline readiness** — run the
   the scoring rubric
   to see the repo's level and gaps.
3. **Adopt the instruction layer** — wire `AGENTS.md` + `.github/instructions/*` so every
   tool follows the same rules (see [cross-tool setup](../../../02-agentic-preparation/cross-tool-setup.md)).

If the repo is greenfield or thin (little structure yet), also point the user at an
opinionated reference structure
(minimal, frontend-only or full-stack) so the layout matches what the kit's instructions and agents
expect — offer it, don't impose it.
