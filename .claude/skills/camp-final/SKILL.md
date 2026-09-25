---
name: camp-final
description: "Facilitator only. After /camp-evaluate has written the results, compare the top teams side by side with one camp-finalist agent and write final-round.md — an independent ranked order with reasons, run while the facilitators review the top five by hand. Changes no score."
disable-model-invocation: true
argument-hint: "<eval folder, e.g. eval/> [--top 5]"
---

# /camp-final — a side-by-side second opinion on the top teams

Runs **after** `/camp-evaluate` (the results exist) and **in parallel** with the
facilitators' manual review of the top places. It is off the critical path: the results
are already published to the facilitators; this adds a comparative opinion, it changes no
score and no scorecard.

## Steps

1. The argument is the eval folder; resolve it to an absolute path (`EVAL`). `EVAL/results.md`
   and `EVAL/estimates.json` must exist — if not, tell the facilitator to run
   `/camp-evaluate` (or `node bin/camp/report.mjs EVAL`) first, and stop.
2. Finalists: run `node bin/camp/report.mjs EVAL --check` and take every team whose rank is
   **5 or better** (or `--top N`), ties included, in points order. You read only that
   table — no team's deck, repository or facts.
3. Record the start time (`date +%s`), then launch the **`camp-finalist`** subagent in the
   background with only this prompt:

   > Eval folder: `EVAL`. Finalists, in points order: `<team-1>, <team-2>, …`. Compare them
   > side by side and write `EVAL/final-round.md`.

   Tell the facilitators it is running (typically 5–8 minutes) and that they can review the
   top teams in `EVAL/review.html` meanwhile.
4. When it finishes, check that `EVAL/final-round.md` exists and tell the facilitators, in
   three lines: the recommended order, whether it agrees with the points order (and where
   not), and that the file is `EVAL/final-round.md`. Do not summarise its reasons further —
   they read it themselves.

If the agent type is not found, tell the facilitator to restart Claude Code in this
repository; do not substitute a general-purpose agent.
