---
name: camp-evaluate
description: "Facilitator only. Score every prepared team of a camp evaluation: one camp-judge subagent per team in parallel (at most 8 at a time), then the results report (optionally a camp-calibrator pass in between). Use when a facilitator runs /camp-evaluate <eval folder> after bin/camp/prepare.mjs."
disable-model-invocation: true
argument-hint: "<eval folder, e.g. eval/> [--fresh] [--calibrate]"
---

# /camp-evaluate — judge every team, report

Runs step 3 of the camp evaluation (see the event's `evaluator-plan.md`): pull and
prepare have already run, and `<eval>/<team>/facts.json` exists for every team. You are
the orchestrator. **You do not read any team's deck, repository or facts yourself** — the
judges do, each in its own context. Keeping team content out of your context keeps it
small enough for twenty teams and keeps any instruction planted in a team's files away
from the one agent that launches everything else.

## 0. Check the folder

- The argument is the eval folder; resolve it to an absolute path (`EVAL`). If none was
  given, ask for it.
- `EVAL/manifest.json` and `EVAL/rubric.md` must exist; if not, tell the facilitator to
  run `node bin/camp/prepare.mjs --repos <repos> --out <eval> --rubric <rubric.md>` and stop.
- Team ids: the `teams` list in `EVAL/manifest.json` — not whatever folders exist, since an
  eval folder reused from a rehearsal can hold teams that are not in this run.
- Read `EVAL/preflight.md` (facilitator facts, no team content). **Stop** and tell the
  facilitator what to fix first, then have them re-run prepare, if any team has:
  - a deck `lfs-pointer` / `not-a-pdf`, or a diagram `lfs-pointer` / `not-an-image`
    (fix: `git lfs install && git -C repos/<team> lfs pull`, or ask the team);
  - a deck over 10 pages or over 20 MB, or with an unknown page count, while
    `manifest.json` says `"poppler": false` (fix: `brew install poppler`) — the judge reads
    such decks in page ranges, which needs poppler;
  - a row saying "not pulled" (fix: pull again, or publish without it via `--exclude`).
  prepare exits non-zero in these cases too. Judging now would score files nobody could read.
- Record the start time: `date +%s`.
- The `camp-judge` and `camp-calibrator` agent types are picked up from `.claude/agents/`.
  If launching one fails with "agent type not found" (the kit was pulled into an open
  session and has not been picked up yet), tell the facilitator to restart Claude Code in
  this repository and stop — do not substitute a general-purpose agent, which has a shell
  and no effort setting.

## 1. Decide who to judge

Run `node bin/camp/report.mjs EVAL --check`. Each error line starts with a team id.

- Default (resume): judge only teams whose `score.json` is missing or invalid; keep
  valid ones. This is what makes an interrupted run cheap to finish.
- With `--fresh`: judge every team. Tell the facilitator that existing scorecards will be
  replaced before you start.

## 2. Judges — one per team, at most 8 at a time

For each team to judge, launch the **`camp-judge`** subagent in the background with this
prompt, and nothing else:

> Eval folder: `EVAL`. Team id: `<team>`. Score this team and write `EVAL/<team>/score.json`.

Keep at most **8** judges running. When one finishes, start the next queued team, then
validate the finished one:

```bash
node bin/camp/report.mjs EVAL --check --team <team>
```

- **Valid** — done.
- **Invalid** — send the finished judge a message (SendMessage to its agent id, which
  resumes it with its reading intact — seconds, not a full re-judge; if SendMessage is a
  deferred tool, load it with ToolSearch first): "Your score.json was rejected: <the error
  lines>. Fix these entries and rewrite the file; change nothing else." Validate again.
- **The judge replied "deck unreadable"** — do not retry; tell the facilitator the reason
  it gave. Usually poppler is missing or the PDF is broken.
- **The judge failed** (error, rate limit, no file) — relaunch it once. A rate-limit
  failure: wait for a running judge to finish before relaunching, and drop the cap to 6
  for the rest of the run.
- **Invalid after the retry** — stop retrying; list the team for the facilitator at the
  end. Do not write or edit a scorecard yourself. If time runs out, the facilitator can
  publish without that team: `node bin/camp/report.mjs EVAL --exclude <team>` — the
  results then say that team was not scored.

Tell the facilitator progress in one short line every few teams (`12/20 scored`).

## 3. Calibration — only with `--calibrate`

Skip this step unless the facilitator passed `--calibrate`. It costs about 3–5 minutes,
and in the rehearsal it moved scores by about as much as run-to-run noise without changing
the ranking; the anchored levels, the validator and the humans' top-five review carry the
consistency. Go straight to step 4.

With `--calibrate`, and only when every team has a valid scorecard (otherwise report which
do not and ask the facilitator whether to retry them or stop), launch the
**`camp-calibrator`** subagent in the foreground:

> Eval folder: `EVAL`. Calibrate every team's scorecard and write `EVAL/calibration.json`.

Then `node bin/camp/report.mjs EVAL --check`. If calibration changes are rejected, relaunch
the calibrator once with the error lines. If still rejected, rename the file to
`calibration.rejected.json`, tell the facilitator, and continue without it.

## 4. Report

```bash
node bin/camp/report.mjs EVAL
```

It writes `results.html` / `.md` / `.csv` (shareable) and `review.html` (facilitators
only: all teams side by side with evidence, links to each team's files, and the notes for
the human review). Then tell the facilitator, briefly:

- minutes elapsed since step 0, and minutes per team (elapsed ÷ teams judged);
- the top five with totals — the ones the humans review next;
- the number of calibration changes, if calibration ran;
- any **close calls** the report printed (top places within 3 points — decide by hand);
- teams with notes for the human review (in `review.html`) — no points were affected;
- where the results are: `EVAL/review.html` for the review, `EVAL/results.html` to share.

## If it is too slow

The budget is about 20 minutes for 20 teams. If judges average more than about 5 minutes
each at a cap of 8, set `effort: medium` in `.claude/agents/camp-judge.md` for the next
run. If one judge per team is still too slow, the plan's
fallback is two judges per team split along the rubric's sources — that needs a change to
the agents, not an improvisation on the day.
