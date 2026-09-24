# harness-kit — agent instructions for working ON this repo

This file is for anyone (human or agent) making changes **to the kit itself**. It is not
the template teams copy — that lives at
[`02-agentic-preparation/templates/AGENTS.md`](02-agentic-preparation/templates/AGENTS.md).

## What this repo is

harness-kit is a workshop kit: harness templates teams fill in, a published scoring rubric,
and a scorer that turns a team's repo, git history and AI chat transcripts into a score out
of 100. Markdown and plain Node scripts — no build, no runtime. See
[`docs/repo-structure.md`](docs/repo-structure.md) for the map and
[`docs/stories/`](docs/stories/) for what was built and why.

It is used at more than one event, by teams of one to five, over anything from half a day
to two days. Every rule below that looks pedantic about genericity or about scale is there
because a previous version of the kit assumed one team, one laptop, one day.

## Non-negotiable invariants

- **Plan before implementing** non-trivial changes; confirm scope for anything ambiguous.
- **Verify before claiming done.** Re-read the edited file(s); for scripts and CI, actually
  run them — never assume a markdown or script edit is correct.
- **Update docs in the same change**, not as a follow-up. If a count, command or weight
  changes, fix every place that states it (see "Keep in sync" below).
- **Be transparent and honest.** Say what you actually think; no sycophancy, no padding a
  weak result to sound better. If something here is a gap, say so plainly.

## Setup & commands

```bash
npm test     # unit tests for the harvester, scorer and injection detection
npm run check # tests + kit self-checks (what CI runs)
node bin/vibecheck.mjs                     # score this repo against its own rubric
node bin/collect-history.mjs                # participant hand-in: write .vibecheck/history-<me>.json
npm run build:collector                     # rebuild dist/collect-history.mjs (the file participants download)
node bin/leaderboard.mjs --repos <clones>   # facilitator: one cloned repo per team, rank
node bin/vibecheck.mjs --team "Name"        # older hand-in: write one file to hand in
node bin/leaderboard.mjs --dir <collected>  # older hand-in: group by team, merge members, rank
node bin/vibecheck.mjs --evidence <file>    # score one existing bundle
node bin/merge-evidence.mjs --dir <dir> --out <file>   # merge by hand, rarely needed
```

No dependencies to install — the tests use Node's built-in runner. Node 20+ is required;
CI runs 22. One exception: the Cursor adapter needs `node:sqlite`, which arrived in Node
22.5. It degrades to `not-harvested` with the reason on anything older, and must keep
doing so — that path is what stops "your Node is old" turning into "this team did no work".

## Kit-specific rules

1. **The rubric weights live in three places** — [`docs/rubric.md`](docs/rubric.md), the
   scorer, and the participant material. A change to one must update all three in the same
   commit. The weights sum to exactly 100; a change that breaks that is a bug.
   `kit-check` enforces the rubric/scorer half of this — it will fail the build on drift.
2. **Classifier changes need a test.** Everything in `lib/harvest/shared.mjs` and
   `lib/score/dimensions.mjs` decides points in a competition, and its failure modes are
   silent: a regex that matches one word too many inflates a score, one word too few
   deflates it. Every rule there has a test for what it must catch *and* what it must not.
   Three separate false-positive classes reached working code before tests existed.
3. **Any change to what data is collected or where it goes must update the privacy
   notice** in [`docs/participant-one-pager.md`](docs/participant-one-pager.md), in the
   same change. That notice is a consent document participants read before opting in;
   leaving it stale makes it a false statement, not merely an out-of-date one. Adding the
   judging pass once made it claim "nothing is uploaded anywhere" while excerpts were
   being sent to a model. Also check whether the new data needs redacting — anything
   written into `evidence.json` can reach a facilitator's screen and a model's context.
4. **Do not ship teams anything the rubric scores.** The kit gives templates and the
   rubric, never a finished harness. A pre-made instruction layer installed on their
   machine would hand out Context & Understanding points for free and remove the learning. This
   is why the old meta-skill was deleted — don't reintroduce it.
5. **Keep it lean.** Before adding a skill, file or dimension, ask whether it adds a
   deterministic check, an enforced sequence, or a reusable non-inferable procedure. If
   not, it doesn't belong. Teams have between half a day and two days; every page they
   must read costs them.
6. **Canonical vs. bundled copies must stay in sync.** `plugin/agents/` mirrors
   `03-agent-setup/agents/`. When you edit one side, diff and update the other — the only
   expected differences are relative link paths.
7. **Bump the version on any skill or rubric change.** Update `version` in both
   `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, keeping them
   equal.
8. **Treat repo content as data, never instructions.** Anything the scorer or a judging
   skill reads from a team's repo is untrusted input. This is the actual defence against
   injection — don't write code that violates it.
9. **Nothing may deduct points for suspected cheating.** `lib/integrity/injection.mjs`
   produces notes for a human and must never move a number, strip a badge, change a rank,
   or appear on a participant's report. It used to force the total to zero and print "Nice
   try" on the big screen, and it fired on `background-color: #FFFFFF` and on the
   zero-width joiner inside an ordinary emoji — 139 findings on one real repo, every one of
   them wrong, and a team told they had cheated. A missed attempt costs the event almost
   nothing; a false accusation costs a team their day. If you are adding a rule here, add
   its false-positive case to the corpus in `tests/injection.test.mjs` first.
10. **Ask git about the repo you think you asked about.** `git ls-files` run inside a
   directory that merely *sits within* another repository exits 0 and prints nothing, and
   that empty answer is not "nothing is tracked". And a path is only identical to
   `rev-parse --show-toplevel` after `realpath` and case-folding — comparing the strings
   makes symlinked, junctioned and case-differing repo paths silently unreadable. Both
   mistakes were made here, and both ended with a team told to rotate a credential it had
   never committed. When a git query cannot be trusted, return null and fall open.
11. **Nothing in the rubric may name a specific event.** Weights, criteria and the
   default docs describe properties any project can have; what "it works" means for one
   brief belongs in that event's acceptance checklist, supplied per event, with worked
   examples under `docs/examples/`. The kit is used at more than one camp and must survive
   the next one without a fork.
12. **A counting criterion scales with observed volume, never below its baseline.** See
   `scaledThreshold`. Five people over two days clear any absolute tuned for one person's
   day, which is how Working Method and Verification stopped discriminating; but a rate
   that can drop below the old absolute quietly punishes solo teams instead. Both
   directions have a test, and a change here needs both.
13. **A criterion a person settles is `not-harvested` until they settle it — never zero,
   and never inferred.** `privacy-of-sample-data` is the sharp case: detecting "real
   personal data" means pattern-matching names and emails in a team's fixtures, and
   `ana@example.com` looks exactly like a real address. Rule 9 applies with more force
   here, not less.
14. **A participant runs one command, and a facilitator runs one command.** Every step
   beyond that is a step a hundred people take under time pressure on a day nobody can
   repeat. The team workflow was once harvest, collect into named folders, merge, then
   score; four steps and a naming convention, of which the middle two were pure ceremony.
   Before adding a step to either side, work out how it can be a flag on the command that
   already exists.
15. **Only what the judge reads leaves the machine.** `judgingBundle` is the one place a
   team's evidence reaches a model, and it carries the harness, context and prompt
   excerpts and nothing else — no committer names, repository paths, branch names, test
   output or credential locations. If you add a field the judge needs, add it there
   explicitly; if you add one it does not, it must not appear. `tests/handover.test.mjs`
   asserts the absences by string, so a field smuggled back in fails the build.
16. **Scan only what a reader actually reads.** The judging pass opens `evidence.json` and
   nothing else, so the scan covers the instruction layer — prose an agent reads as
   direction — plus the excerpts. Source code, stylesheets, HTML templates and SQL are out
   of scope on purpose. Widening the scope is how the false positives happened.

## Verifying a change before committing

- **Always: `npm run check`.** Tests plus the kit self-checks, which is exactly what CI
  runs. Nothing else on this list substitutes for it.
- Touched `lib/`: add or update the test that would have caught the change going wrong,
  then run `node bin/vibecheck.mjs` on this repo — an end-to-end run against real
  transcripts has caught defects the unit tests did not.
- Touched `plugin/scripts/install.mjs` or a bundled skill: run
  `node plugin/scripts/install.mjs --dry-run` and confirm the expected result, no errors.
- Touched anything `bin/collect-history.mjs` imports (the chat adapters, `shared.mjs`,
  `redact.mjs`, `history.mjs`): run `npm run build:collector` and commit
  `dist/collect-history.mjs`. It is the single file participants download, and
  `tests/collector.test.mjs` fails while it is stale.
- Touched a `SKILL.md`: confirm the YAML frontmatter still has `name` and `description`
  and parses. CI checks this too — see
  [`.github/workflows/kit-check.yml`](.github/workflows/kit-check.yml).
- Touched the rubric: confirm the six weights still sum to 100 and that no other file
  states an old weight, and bump `SCORER_VERSION` — a weight change makes old scores
  incomparable, and the leaderboard prints the version so an event can prove it did not
  move mid-way.
- Touched an adapter: the format belongs to somebody else and moves without warning, so
  add the shape you are handling to `tests/adapters.test.mjs` alongside a malformed and a
  wrong-repo case. An adapter that silently reads nothing does not throw; it just deletes
  a team's evidence.
