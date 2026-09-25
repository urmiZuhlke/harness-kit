# Evaluator plan — score twenty teams in under twenty minutes, fully automated

Decisions already made (do not reopen them without the facilitators):

- **100 points = the brief's six areas**, scored by the rubric in
  [`evaluation-rubric.md`](evaluation-rubric.md). The kit's generic six-dimension rubric
  is not used for this event's ranking.
- **Five inputs, three uploads.** Teams add the deck PDF, the AI SDLC diagram as its own
  PNG/JPEG, and the history files, at the paths in [`submission.md`](submission.md); the
  repository and its git history are the other two. The diagram image is read first; the
  deck's diagram slide is the fallback. PPTX is not accepted.
- **The estimate is judged on realism, not arithmetic** (F2): is the investment stated,
  and could that effort deliver the full scope? Cheaper earns more only when the saving is
  explained; an implausibly low figure scores as unrealistic.
- **No calibration pass by default.** One judge per team, then a script merges the
  scorecards into one table; the humans' top-five review is the sanity check.
  `/camp-evaluate eval/ --calibrate` adds the comparison pass (≈ 3–5 min) if wanted.
- **Complete is not excellent.** A deck that ticks every listed element earns `Most`;
  `Full` needs it to hold together (the rubric's consistency chain) and convince a
  demanding client — so teams that polish against the rubric do not all reach 90–100.
- **An elegant agentic SDLC scores higher**: routine work automated, humans on the loop by
  default and in the loop only at real decisions.
- **Value for money is compared across teams**: judges record each estimate's numbers, the
  report flags estimates far below or above the median; between realistic offers, faster
  and cheaper is better value.
- **A final round, off the critical path**: `/camp-final eval/` compares the top five side
  by side while the facilitators review them by hand — a second opinion with reasons,
  changing no score.
- **The shareable page** (`results.html`) starts with a scoreboard naming each area in
  full — the part to screenshot for teams.
- **Nothing is run, and running does not count.** Neither the judge nor the facilitators
  execute a team's application or tests; whether it runs influences no score.
- **No manual scoring.** All twenty teams get points; humans then review the top three to
  five to check the result is sane.
- **Budget:** 45 minutes in total for pull + evaluate + top-five review, so the automated
  part must finish in **≤ 20 minutes for 20 teams**.

## The run, on the day

| Step | Command | Time |
| ---- | ------- | ---: |
| 1. Pull | `node bin/camp/pull.mjs --list repos.txt --out repos/` — `repos.txt` is the submitted URLs, one per line (optionally `team-name,url`); clones all of them in parallel, re-running updates existing clones, `--before "<deadline>"` pins each to its last commit before the deadline, and it prints which failed | ~2 min |
| 2. Prepare | `node bin/camp/prepare.mjs --repos repos/ --out eval/ --rubric docs/examples/zrs-camp-2026/evaluation-rubric.md` — deterministic facts per team, and a pre-flight table of missing files. **Read its `!!` lines**: an unreadable deck (Git LFS pointer, corrupt PDF) or a deck over 20 MB without poppler must be fixed before judging | < 1 min |
| 3. Judge | In Claude Code, in this repo: `/camp-evaluate eval/` — one judge per team, 8 at a time (add `--calibrate` for the optional comparison pass) | ≈ 9 min |
| 4. Report | `node bin/camp/report.mjs eval/` — a script, no AI: validates every scorecard, computes totals, writes `results.html` / `.md` / `.csv` (shareable) and **`review.html`** (facilitators only: every team side by side, evidence, links to the files, notes for the human review, **close calls** within 3 points). The skill runs it for you. A team that cannot be judged in time: `--exclude <team>` publishes the rest and says so | seconds |
| 5. Final round (optional, in parallel with the human review) | `/camp-final eval/` — one agent reads the top five side by side and writes `eval/final-round.md`: its recommended order, pair-by-pair reasons, value for money, agentic SDLC, anything that looks off. Changes no score | 5–8 min |

About 11–12 minutes from pull to results for 20 teams, leaving the rest of the 20–30
minutes for the humans' review of the top three to five in `review.html`.

**The evening before:**

1. `brew install poppler git-lfs && git lfs install` — poppler lets the judge read decks
   over 10 pages or 20 MB (page ranges); git-lfs makes a clone contain the real files if a
   team stored its PDF or diagram in LFS. prepare refuses to go on without them when a
   team needs them.
2. Open Claude Code **in this repository**, so `.claude/settings.json` applies: it lets the
   background judges read `repos/` and write `eval/` without a permission prompt. Keep
   `repos/` and `eval/` inside the repository (both are git-ignored) — rules for paths
   elsewhere do not apply.
3. Test cloning two real team repositories with the facilitator account.
4. Dry run: `pull` → `prepare` → `/camp-evaluate eval/` → open `review.html`, in exactly
   the mode and account you will use tomorrow, on a fresh `eval/` folder. Delete `eval/`
   afterwards so tomorrow's run starts clean.

The results table: **Rank · Team · A · B · C · D · E · F · Total · Remarks**, where Remarks
lists, per area not at max, the one-line reason from the scorecard.

**What is where** (built): `bin/camp/` holds the three scripts, `lib/camp/` their logic,
`.claude/skills/camp-evaluate/` the orchestrating skill and `.claude/agents/` the
`camp-judge` and `camp-calibrator` subagents (Opus, high effort, tools Read/Glob/Grep/Write
— no shell). `prepare` writes, per team, `eval/<team>/facts.json`, a copy of the deck as
`eval/<team>/proposal.pdf`, a copy of the diagram image as `eval/<team>/sdlc-diagram.png`
(or `.jpg`), and `eval/<team>/human-notes.json` (injection-scan notes, which
the judge is never given); plus `eval/rubric.md`, `manifest.json` and `preflight.md`. The
judge writes `eval/<team>/score.json`; the optional calibrator writes `eval/calibration.json`
(a list of changes with reasons — it never edits a scorecard); `report` refuses to write
anything while any card is missing or invalid. A card is invalid when a level and its
points disagree: the top level is exactly max, the bottom exactly 0, and a level between
is within one point of round(share × max). `report --check --team <id>` validates one card,
which is how the skill retries a judge whose card was rejected.

## Architecture

**Deterministic where possible, AI only where judgement is needed.** `prepare.mjs` reuses
the kit's harvester (`harvest(repo, { chat: false, runTestSuite: false })` plus the
committed history files via `mergeEvidence`, exactly as `leaderboard --repos` does) and adds
submission facts, so the judge starts from the same normalised facts for every team:

- submission files present / missing; PDF page count; any PDF found elsewhere in the
  repo when `submission/proposal.pdf` is missing (used, with a remark); a PPTX with no
  PDF is reported as "no proposal PDF" — PPTX is not read
- history summary: members, sessions, prompts, corrections, planning signals, test runs
  and fail→pass loops, and the prompt excerpts
- harness facts: instruction files, agent/prompt definition files (`.claude/agents/`,
  `.github/agents/`, `.github/prompts/`, `agents/`, `AGENTS.md`), context docs, first
  harness commit vs first code commit
- repo facts: test file count, README commands, lockfiles, secret-scan findings (file and
  line, never the value); the injection-scan notes go to `human-notes.json` for the
  facilitators and are never in the judge's facts (kit rule 9)

**One judge per team, all teams in parallel — not one agent per artefact type.** A single
agent working through twenty decks, then another through twenty repos, is sequential,
bloats its context and drifts in how it scores team 17 versus team 2. And the points that
matter most are cross-checks — does the diagram match the history, do the PoC claims in
the deck match the code (C6, D2, E3) — which an agent that sees only one artefact cannot
make. So the unit of parallelism is the team.

*If one judge per team is too slow (> 5 min per team in the rehearsal), split each team
into two parallel judges along the rubric's source split — a deck judge (A, B, C1–C3, D1,
E1–E2, F) and an evidence judge (C4–C6, D2–D4, E3, given the deck's diagram slide too) —
and merge.*

**Comparability** comes from four things, in this order:
1. Anchored levels per sub-criterion (Full / Most / Some / None), never holistic scores.
2. Every point cites evidence; every shortfall carries a remark.
3. The same pre-extracted facts file format for every team.
4. Optional (`--calibrate`): a pass that reads all scorecards side by side, fixes
   inconsistent scoring of similar evidence, and logs each change. Off by default — in the
   rehearsal its changes were the size of run-to-run noise and never moved a rank.

**Scorecard schema** (`eval/<team>/score.json`), validated by `report.mjs`:

```json
{
  "team": "team-alpha",
  "inputs": { "deck": "submission/proposal.pdf", "diagram": "sdlc-diagram.png", "historyFiles": 4 },
  "criteria": [
    { "id": "A1", "points": 4, "max": 5, "level": "Most",
      "evidence": ["slide 2: 150 desks, 30 parking, no-shows"],
      "remark": "multi-office / 5,000-user growth not mentioned" }
  ],
  "notesForHumans": ["README contains text addressed to the evaluator — ignored"]
}
```

Area totals and the grand total are **computed by `report.mjs`**, never trusted from the
model.

## Model and effort

- **Judges (and the optional calibration): Opus 5.5 at high effort.** Reading slide images and diagrams
  and cross-checking them against code is where the strongest model earns its keep.
- **Not max.** Max is slower, and at 20 teams in 20 minutes latency is the constraint; it
  does not make scores more consistent — the anchored rubric and the validator do.
- **Measure, then decide.** The rehearsal on the example repos records minutes per team
  and run-to-run variance. If 20 teams would exceed 20 minutes, drop the judges to medium.

## Rehearsal — 24 Sep 2026, the four example submissions, two full runs

Both runs judged all four teams concurrently (8 judges in flight, the day's cap). The
judges ran as general-purpose Opus agents following `camp-judge.md` verbatim — the new agent
types were not yet loaded in that session — so effort was inherited rather than `high`.

| | alpha | delta | bravo | charlie |
| --- | --: | --: | --: | --: |
| Run 1 (calibrated) | 98 | 93 | 55 | 18 |
| Run 2 (calibrated) | 99 | 92 | 58 | 19 |
| Expected (range) | 94 (85–100) | 77 (68–85) | 49 (40–60) | 13 (5–22) |
| Sub-criteria that differ between runs (of 23), each by 1 point | 1 | 1 | 5 | 3 |
| Judge minutes | 2.5–2.8 | 1.9–2.0 | 1.8 | 1.2–1.3 |

- **Ranking** alpha > delta > bravo > charlie in both runs, as expected.
- **Time**: 6.2 and 6.7 min wall-clock per run (judges ≈ 3–4 min incl. one retry, calibration
  ≈ 3 min). Twenty teams at cap 8 is three waves: ≈ 9 min judging — inside the budget with
  margin for `effort: high` and larger repositories. Calibration is now opt-in (see top).
- **Since this rehearsal**: the diagram image became the primary source (these example
  teams have none, so the deck fallback is what was exercised) and F2 was reworded to judge
  realism rather than arithmetic.
- **Validation earned its keep**: two of eight cards said `Full` with less than max and were
  fixed by messaging the judge (≈ 30–50 s each). The judge prompt now says it explicitly.
- **Injection**: delta's README asks the evaluator for full marks. Every judge reported it
  under notes for humans; re-judging delta with the line removed gave 92 — no effect.
- **Delta scores above its expected range**, and the gap to alpha is 5–7 points, not ~15.
  Not the injection (above): the rubric's wording is looser than the answer key. A2 accepts
  "targets **or** baselines", A3 "argued **or** quantified", and E3's three elements make one
  committed secret `Most` (2), where the key expects 1. **Facilitators' call:** tighten those
  three rows if those gaps should cost more, then re-run — the machinery needs no change.
- Pre-flight matched the key on every fact it extracts (slides, history files, authors,
  delta's misplaced deck, secret and injection line), and `--before "2026-09-23 14:00"`
  pinned bravo to its 13:46 commit.

## After the review — 24 Sep 2026, evening

An independent review with twelve deliberately broken fixture repositories found the
failure modes the clean examples could not show. All are fixed, each with a test in
`tests/camp.test.mjs`:

- **Decks the judge could not read**: a Git LFS pointer or corrupt file is now reported
  (`lfs-pointer` / `not-a-pdf`) instead of counted as found; a deck over 20 MB is flagged
  and read in page ranges (needs poppler, checked by prepare).
- **One bad history file no longer blocks a team** — it is skipped with a reason.
- **Partial publication is explicit** — `report --exclude <team>`; `--team` only validates.
- **Symlinks** are checked out as plain files and never followed into a copy the judge reads.
- **The client brief or a diagram PDF** is never guessed as the deck.
- **facts.json is capped** (sessions, excerpts and commits sampled; totals exact), so a
  team that worked a lot cannot make its facts unreadable.
- **A clone with nothing before the deadline is removed**; a corrected URL in `repos.txt`
  is used on re-run; SSH and credential prompts cannot hang `pull`; other branches with
  newer commits and submodules are reported.
- **A repository that changed after judging** has its old scorecard moved to
  `score.stale.json`, so it is judged again.
- **Scoring**: A2 now needs a baseline and a target, A3 a quantified value, and a committed
  credential caps E3 at `Some` — the three places where the rehearsal showed a good team
  and the best team getting the same points. The report flags top places within 3 points
  as close calls for the humans to decide.

Final run, set up exactly as for the day (`repos/` and `eval/` inside the kit, deadline
pin, real `camp-judge` agents at high effort): **2.3 min for 4 teams, all scorecards valid
first time** — alpha 98 · delta 90 · bravo 57 · charlie 18. Delta lost the points the new
wording intends (A2 no baselines, A3 not quantified, E3 capped by its committed secret);
the gap from 1st to 2nd grew from 5–7 to 8 points. Nineteen teams at 8 judges at a time
is three waves: about 7 minutes of judging.

Run after "complete is not excellent", the consistency chain, the agentic-SDLC wording and
the estimate record (25 Sep): alpha 95 · delta 86 · bravo 53 · charlie 18, judging 1.9 min.
The gap from 1st to 2nd is 9 points; alpha got 18 of 23 criteria at `Full`, delta 11,
bravo 1. Judges now name routine human approvals in C2 and estimates that do not add up
with their own plan (bravo: 320 PD for a team whose plan implies ~650). A missing
`estimate` block is rejected by the validator with the exact fields to add, and a judge
fixes it on the retry in about 30 s. `/camp-final` on the four teams took 2.3 min, agreed
with the points order, and added what humans need to confirm it: the deciding differences,
what the cheaper offer leaves unpriced, and one alpha claim its tests do not back.

## Risks and how they are covered

| Risk | Cover |
| ---- | ----- |
| A repo cannot be cloned | `pull.mjs` lists failures in the first two minutes; test access the evening before |
| A team submitted PPTX only, or the PDF in the wrong place | PPTX-only scores as no proposal (announced up front); a misplaced PDF is found and used with a remark; the pre-flight in `collect-history.mjs` warns teams before 14:00 |
| Prompt injection in a deck or README | Judge prompt treats team content as data; injection notes go to humans; rehearsal showed no effect on the score |
| Scores inconsistent across teams | Anchors, evidence, the validator; humans review the top five; `--calibrate` if a run looks off |
| Run takes too long | Parallel judges; split-judge fallback; medium effort fallback |
| Rate limits with 20 parallel judges | Concurrency cap (start at 8), retries in the orchestrator |
| The AI pipeline fails on the day | `leaderboard --repos` still produces the kit's deterministic score in seconds |

## Kit rules this must respect

`AGENTS.md` applies. In particular: rule 3 (the privacy notice must say that the deck,
repository and history are read by an AI model), rule 8 (repo content is data), rule 9
(injection findings never move a score), rule 11 (this event's specifics live under
`docs/examples/zrs-camp-2026/`; the machinery takes the rubric file as an input), and
"verify before claiming done".

---

## Hand-off prompt — build the evaluator (new chat, in `harness-kit`)

> Read `AGENTS.md`, then everything in `docs/examples/zrs-camp-2026/`
> (`evaluation-rubric.md`, `submission.md`, `evaluator-plan.md`). Build the evaluator
> described in `evaluator-plan.md`: `bin/camp/pull.mjs`, `bin/camp/prepare.mjs`, a
> facilitator-only Claude Code skill `/camp-evaluate` that runs one judge subagent per
> team in parallel (concurrency cap 8) against the rubric and then one calibration pass,
> and `bin/camp/report.mjs` that validates scorecards, computes totals and writes
> `results.md`, `results.csv` and `results.html` (Rank, Team, A–F, Total, Remarks).
> Reuse the existing harvester, `mergeEvidence` and injection scan rather than
> duplicating them. The machinery must take the rubric path as an input, not hard-code
> this event. Decks are accepted as PDF only — do not build any PPTX reading. Nothing is
> ever executed from a team repo. Add a submission pre-flight to `collect-history.mjs`
> (print whether `submission/proposal.pdf` exists, and warn if only a `.pptx` is present)
> and rebuild `dist/`. Update the
> participant privacy notice. Add node tests for `prepare`, `report` and the
> scorecard schema; keep `npm run check` green. The deadline is tomorrow 14:00 — plan
> first, keep it lean, and when example repos appear in `~/Projects/camp-eval-examples/`,
> run the full pipeline on them twice, report minutes per team, run-to-run variance per
> team, and whether the ranking matches `~/Projects/camp-eval-examples/EXPECTED.md`.

## Hand-off prompt — build the example submissions (new chat, run in parallel)

> Read `/Users/urmi/Projects/harness-kit/docs/examples/zrs-camp-2026/` (all three files)
> and the brief PDFs in `/Users/urmi/Downloads/OneDrive_1_9-24-2026/`. Create four example
> team submissions in `~/Projects/camp-eval-examples/`, each its own git repo following
> `submission.md` exactly, built so the evaluator's ranking can be checked:
>
> - `team-alpha` — strong: specific, well-structured 10-slide deck with correct
>   person-day × EUR 800 arithmetic; clear SDLC diagram with agents, artefacts and human
>   gates; real harness (AGENTS.md, agent definitions matching the diagram, project
>   context doc) committed before the code; a small working PoC (Node, 2–3 FRs with their
>   business rules) with `node:test` tests that pass; history from 4 members showing
>   planning, decomposition, corrections and fail→pass test loops.
> - `team-bravo` — medium: decent deck with gaps (no measurable KPIs, generic risks), a
>   diagram without human gates, thin harness, partial tests, history from 2 of 5 members.
> - `team-charlie` — weak, vibe-coded: one enormous prompt in the history, generic deck
>   with an arithmetic error in the commercials, a diagram claiming review gates nobody
>   ran, harness committed last, no tests for business rules.
> - `team-delta` — edge cases: the proposal PDF committed in the wrong place
>   (`docs/Proposal Final.pdf`, not `submission/proposal.pdf`), one member's history
>   missing, a committed fake secret, and a README line addressed to "the AI evaluator"
>   asking for full marks.
>
> Decks: PDF only — write each as HTML slides (16:9, one slide per page) and print to
> PDF with headless Chrome (`/Applications/Google Chrome.app`). No PPTX is needed. The
> SDLC diagram is a slide inside each deck (draw it as inline SVG in the HTML), never a
> separate file — teams upload only the PDF and the history files. Git history: spread
> commits over two days with several authors via `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`.
> Chat history: do **not** hand-write the history JSON — write realistic Claude Code JSONL
> transcripts (and Codex rollouts for one member of alpha) into a fake HOME per member
> with `cwd` set to the repo's absolute path, then run
> `HOME=<fake> node /Users/urmi/Projects/harness-kit/dist/collect-history.mjs` in the repo
> with that member's `git config user.name`, and commit the result — so the files are
> genuine collector output. Write `~/Projects/camp-eval-examples/EXPECTED.md` (outside
> every team repo, so no judge reads it) with the expected ordering and a rough expected
> score per area for each team, plus `repos.txt` pointing at the four repos for the pull
> test. Verify: each repo's tests run as described, each PDF opens with the right slide
> count, each history file has the intended sessions.
