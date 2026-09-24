# 30-minute intro — section outline

For whoever runs the kickoff. Section timings sum to exactly 30 minutes; treat them as a
budget, not a script.

| # | Section | Minutes | Covers |
| - | ------- | ------: | ------ |
| 1 | The use case | 4 | What they're building today, and why it exists. |
| 2 | Not just "does it work" | 4 | Finishing the use case is necessary, not sufficient. Today also scores *how* it was built — hand out / display [`docs/participant-one-pager.md`](participant-one-pager.md). |
| 3 | The rubric | 8 | Walk the six dimensions and their weights from [`docs/rubric.md`](rubric.md). Say plainly: this is the whole rubric, nothing is added later, optimise for it freely. Hand out this event's acceptance checklist here — it is 5 of the 100 points and must not be a surprise. |
| 4 | How scoring works | 5 | Live-demo `node bin/vibecheck.mjs` against a throwaway repo and show the `report.html` output. Say plainly that it is a plain script, not an AI. **Then the thing teams most often miss: transcripts live on each person's laptop, so every member runs `collect-history.mjs` in the project folder and pushes the file it writes** — show where to download the file, and run it once — and once mid-way, not first at hand-in. |
| 5 | Privacy | 3 | What's read, what's extracted, what's never copied — from the one-pager. Say it out loud, don't just point at the doc. |
| 6 | The injection dare | 3 | Announce the scorer is adversarially tested. Show what a caught attempt looks like on the live demo repo — a note for a facilitator, with the score unchanged. Say plainly that nothing here deducts points automatically, and why. Frame it as a dare, not a trap — and mention the reporting badge. |
| 7 | Logistics & starting tips | 3 | Facilitator assignments, when the authoritative snapshot is taken, where to find help, the six starting tips from the one-pager. |
| | **Total** | **30** | |

## Delivery notes

- **Sections 3, 5 and 6 must happen before anyone opens an editor.** These are exactly the
  three things participant material states must be known up front: the weights, the
  privacy notice, and the injection dare. Don't compress them to make room elsewhere —
  cut section 7's detail instead and put it in writing.
- **Section 4's live demo is worth protecting.** Watching a real `report.html` render
  teaches the shape of the day faster than describing it. If time is short, pre-record it
  rather than cutting it.
- **Section 6 should get a genuine laugh, not a lecture tone.** The reaction you want is
  "wait, we could actually try that" — that's the workshop working.
- **Section 4's "everyone runs it" instruction is the one to repeat.** A team where only
  one person runs it is scored on one person's day, and nothing in the output looks wrong —
  they just come out lower than they earned. Say it in section 4, put it in writing, and
  have facilitators ask about it on their first lap.
- End by pointing at the hand-in deadline on a clock or agenda, and say which snapshot
  ranks them, so both are facts people note down rather than vague promises.
