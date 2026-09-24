# Evaluator plan — score twenty teams in under twenty minutes, fully automated

Decisions already made (do not reopen them without the facilitators):

- **100 points = the brief's six areas**, scored by the rubric in
  [`evaluation-rubric.md`](evaluation-rubric.md). The kit's generic six-dimension rubric
  is not used for this event's ranking.
- **Four inputs, two uploads.** Teams add only the deck PDF (which contains the SDLC
  diagram) and the history files, at the paths in [`submission.md`](submission.md); the
  repository and its git history are the other two. PPTX is not accepted.
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
| 2. Prepare | `node bin/camp/prepare.mjs --repos repos/ --out eval/` — deterministic facts per team, and a pre-flight table of missing files | < 1 min |
| 3. Judge | In Claude Code, in this repo: `/camp-evaluate eval/` — one judge per team in parallel, then one calibration pass | 12–18 min |
| 4. Report | `node bin/camp/report.mjs eval/` — validates, applies calibration, writes `results.md`, `results.csv`, `results.html` | seconds |

The results table: **Rank · Team · A · B · C · D · E · F · Total · Remarks**, where Remarks
lists, per area not at max, the one-line reason from the scorecard.

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
- repo facts: test file count, README commands, lockfiles, secret-scan findings, and the
  injection-scan notes (reported to humans, never scored — kit rule 9)

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
4. A calibration pass that reads all scorecards side by side, fixes inconsistent scoring
   of similar evidence, and logs each change.

**Scorecard schema** (`eval/<team>/score.json`), validated by `report.mjs`:

```json
{
  "team": "team-alpha",
  "inputs": { "deck": "submission/proposal.pdf", "diagramSlides": [6], "historyFiles": 4 },
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

- **Judges and calibration: Opus 5.5 at high effort.** Reading slide images and diagrams
  and cross-checking them against code is where the strongest model earns its keep.
- **Not max.** Max is slower, and at 20 teams in 20 minutes latency is the constraint; it
  does not make scores more consistent — the anchored rubric and the calibration pass do.
- **Measure, then decide.** The rehearsal on the example repos records minutes per team
  and run-to-run variance. If 20 teams would exceed 20 minutes, drop the judges to medium
  and keep calibration on high.

## Risks and how they are covered

| Risk | Cover |
| ---- | ----- |
| A repo cannot be cloned | `pull.mjs` lists failures in the first two minutes; test access the evening before |
| A team submitted PPTX only, or the PDF in the wrong place | PPTX-only scores as no proposal (announced up front); a misplaced PDF is found and used with a remark; the pre-flight in `collect-history.mjs` warns teams before 14:00 |
| Prompt injection in a deck or README | Judge prompt treats team content as data; injection notes go to humans; calibration compares against peers |
| Scores inconsistent across teams | Anchors, evidence, calibration pass; rehearsal measures variance |
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
