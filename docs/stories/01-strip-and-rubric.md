# Story 1 — chore: Strip the kit to client-agnostic and publish the hackathon rubric

## Intent

The kit was built for one client and carries their name, their tech stack, and ten real
colleagues' interview transcripts. Before it can be handed to hackathon teams it must be
client-agnostic, and its core document must become the scoring rubric teams are judged
against — published on day one so nobody is scored on criteria they never saw.

## Current Behaviour

The repo is `msd-kit`: 111 files, 37 of them referencing MSD/MSDirect. It contains an
8-segment x 4-level *brownfield maturity model* aimed at long-lived client repos, an
opinionated tech stack (NestJS/Drizzle/Terraform/Azure), six domain skills, and
`05-adoption-interviews/` holding real names and quotes.

## New Behaviour

The repo is `harness-kit`: no client identity anywhere, no stack opinions, no interview
material. Its centrepiece is a one-page rubric — six weighted dimensions totalling 100
points, tuned for an 8-16 hour build starting from an empty repo — that teams receive at
the start of the event. The harness templates, the generic instruction files, the agent
roster and the installer survive; everything stack-specific or client-specific is gone.

## Decisions & Rationale

- **Kit named `harness-kit`, scorer command named `vibecheck`**: the kit is a durable
  artefact reusable past this camp and deserves a boring descriptive name; the command
  teams type all day deserves a memorable one. _(Alternative considered: one name for both
  — rejected because "vibecheck" reads badly on a repo handed to a client, and
  "harness-kit" is forgettable as an event brand.)_
- **Rubric replaces the maturity model rather than extending it**: the eight segments
  assume a repo with history, CI and coverage baselines. A team starting from nothing in
  8-16 hours cannot clear S1, S6 or S7, so scoring against them would be noise.
  _(Alternative considered: keeping the model and marking segments N/A — rejected as it
  leaves teams reading bars that will never apply to them.)_
- **The two readiness skills are deleted, not retargeted**: retargeting
  `agent-readiness-assessment` at the new rubric would create a second way to obtain a
  score alongside the scorer, which is exactly the confusion a simple kit must avoid.
  Story 4's judging skill is written fresh and narrow instead. _(Alternative considered:
  retargeting it as a day-one self-check — rejected on simplicity grounds.)_
- **`using-msd-kit`, `business-context` and `msd-kit-install` are deleted**: the first
  installed an invariants baseline globally, which would hand teams the Context & Harness
  points without them doing the work and remove the learning the dimension exists to
  create. The other two served skills that no longer exist.
- **The git remote is removed**: it pointed at the client's GitHub org, so the client name
  was in `.git/config` and an accidental push would have reached them.
- **The six standalone audit skills are deleted, not kept as optional depth**: they audit
  code quality, not AI harness. The specific probes the score needs (tests run, secrets
  absent, CI present) are absorbed into the evidence harvester. _(Alternative considered:
  keeping them behind a flag — rejected as it re-introduces the scope the strip exists to
  remove.)_
- **Coverage percentage is not a scored bar**: at 8-16 hours from empty, "tests exist and
  actually run" is the meaningful signal and a percentage target only rewards padding.

## Requirements

- Delete all client-specific and out-of-scope material: `05-adoption-interviews/`, both
  `.docx` files, both `.code-workspace` files, `01-technical/preferred-tech-stack.md`,
  `01-technical/reference-structures/`, and the six domain skills under
  `02-agentic-preparation/skills/`.
- Delete the six standalone validation skills and the `project-health-audit` orchestrator.
- Delete the five superseded design docs: `brain-blueprint.md`, `installer-design.md`,
  `kit-review-and-recommendations.md`, `vision-and-roadmap.md`,
  `user-level-install-design.md` (the last describes a rollout on client-managed machines).
- Delete `04-readiness-assessment/` entirely, including both skills built on the old model.
- Delete the `using-msd-kit`, `business-context` and `msd-kit-install` skills.
- Remove the git remote pointing at the client's organisation.
- Remove every occurrence of the client name across all remaining files, including skill
  names, plugin metadata and marketplace metadata.
- Rename the three `msd-kit*` skills to client-neutral equivalents and reset the kit
  version to a fresh starting number.
- Replace `04-readiness-assessment/readiness-model.md` with a one-page rubric defining six
  weighted dimensions summing to 100 points.
- Weight the dimensions Context & Harness 20, Working Method 25, Verification Loop 25,
  Safety & Boundaries 10, Reproducibility & Handover 10, It Actually Works 10.
- State for each dimension what earns points and what a zero looks like, in language a
  participant can act on without a coach present.
- Publish an explicit "what we do not reward" list naming token volume, lines of code and
  commit count.
- Rewrite `README.md` and `AGENTS.md` to describe the kit's two jobs: giving teams harness
  templates, and scoring how they worked.
- Retain the harness templates, the generic path-scoped instruction files, the
  `systematic-debugging` skill, the agent roster and the installer.

## Acceptance Criteria

- [ ] Confirm a case-insensitive search for the client name across the kit returns zero
      results, including inside `.json` metadata, script comments and `.git/config`. The
      story files under `docs/stories/` are exempt — they describe the prior state on
      purpose.
- [ ] Confirm `node plugin/scripts/install.mjs --dry-run` completes with no errors and
      reports only the retained skills.
- [ ] Confirm the CI `kit-check` workflow passes against the stripped tree.
- [ ] Confirm every retained `SKILL.md` still has parseable YAML frontmatter with `name`
      and `description`.
- [ ] Confirm the rubric's six dimension weights sum to exactly 100.
- [ ] Verify no deleted path is still referenced by any surviving file, including
      `.gitignore`, `docs/repo-structure.md` and the CI workflow.
- [ ] Verify the rubric fits on one printed page.

## Technical Proposal

- **Affected files**: delete the paths listed in Requirements; rewrite `README.md`,
  `AGENTS.md`, `docs/repo-structure.md`, `.gitignore`, `.claude-plugin/marketplace.json`,
  `plugin/.claude-plugin/plugin.json`, `.github/scripts/kit-check.mjs`; replace
  `04-readiness-assessment/readiness-model.md` with `docs/rubric.md`.
- **Database changes**: None.
- **API changes**: None.
- **Key implementation notes**: `install.mjs` enumerates skill folders dynamically, so
  deleting folders needs no installer change — but its skill-count assertions and the
  counts quoted in `README.md` and `plugin/README.md` must be updated together.

## Edge Cases & Out of Scope

**Edge cases to handle:**

- The client name appears inside binary `.docx` files and inside `.gitignore` rules that
  exist solely to exclude deleted paths; both must go with the files.
- `plugin/skills/*` are bundled copies of the canonical skills — deleting one side without
  the other leaves the installer copying a skill that no longer exists.

**Out of scope:**

- Building any part of the scorer, harvester or reveal — those are stories 2, 3 and 5.
- Connecting the repo to a git remote or publishing it anywhere.
- Rewriting the retained instruction files' content beyond removing client references.

## Dependencies

None. This story is the prerequisite for all others.
