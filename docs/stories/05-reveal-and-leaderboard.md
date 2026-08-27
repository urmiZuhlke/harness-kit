# Story 5 — feat: The reveal and the leaderboard

## Intent

A number in a JSON file teaches nobody anything. The final hour of the camp is where the
learning lands: teams should watch their score count up, immediately see which points they
lost and why, compare themselves to the room, and — if they tried to hack the scorer —
find out in front of everyone.

## Current Behaviour

This capability does not exist yet. Stories 3 and 4 produce `score.json` per team; there
is no way to present it, compare teams, or rank them.

## New Behaviour

Each team's bundle renders as a single self-contained HTML page: a counter races up to
their score, per-dimension bars fill in, the strongest criteria are named first, and then
every criterion is listed — passed as well as failed — each saying what was looked for,
what was found, and what to do about it. Every team's page looks the same way, whatever the injection scan found — that
originally slammed the counter to zero under a NICE TRY stamp, and it was removed after
the rules misfired on ordinary emoji and ordinary CSS. A coach command ranks all bundles
into one leaderboard showing where each team stands per dimension.

## Decisions & Rationale

- **The reveal is one self-contained offline HTML file**: camp wifi is not a dependency
  worth taking on the one moment the whole day builds to. _(Alternative considered: a
  hosted dashboard — rejected as an outage would cost the event its climax.)_
- **Lost points are shown, not just earned points**: the score is a teaching artefact, and
  the reason a team is at 68 is more valuable than the 68.
- **The injection dare is announced, and costs nothing**: announcing it in advance makes
  it a dare rather than a trap, and teaches prompt injection as a real vulnerability class
  from both sides. A detection is a note for a coach — never a deduction, and never shown
  publicly, because a misfiring regex would otherwise accuse a team in front of the room.
- **The leaderboard compares per dimension, not just by total**: a team that placed fourth
  overall but first on verification should find that out.

## Requirements

- Render a team's score as a self-contained HTML page that works with no network access.
- Animate the total counting up to the final score on load.
- Show each dimension's score against its maximum.
- List every criterion, whatever it scored, each with what was looked for, what was found,
  and what to do next. Showing only the deductions leaves a team unable to see what the
  rubric contains, and makes a good score read as a list of complaints.
- Show badges the team earned.
- Show partial or provisional dimensions distinctly from scored ones, so an incomplete
  result is never mistaken for a low one.
- Present every team's reveal as a straight count-up to the score they earned. A flagged
  team's reveal is identical to anyone else's; the note reaches a coach through the CLI.
- Rank all collected bundles into a single leaderboard with per-dimension comparison.
- Rank flagged teams in the ordinary table on what they scored, with the coach's notes
  listed separately below it.
- Escape all evidence-derived and detection-derived text before rendering it.

## Acceptance Criteria

- [x] Given a `score.json`, when the report is opened with networking disabled, then it
      renders fully with no missing assets.
- [x] Given a flagged team's bundle, when the report is opened, then it is indistinguishable
      from any other team's — the score is what they earned, and no detection appears.
- [x] Given a bundle with a `not-harvested` source, when the report is opened, then the
      affected dimension is shown as partial and is visually distinct from a zero.
- [x] Given repo-supplied text containing HTML or script markup, when the report renders,
      then it appears as literal text and does not execute.
- [x] Given ten bundles, when the leaderboard runs, then all ten appear ranked in one
      table, with any coach's notes listed separately below it.
- [x] Verify the leaderboard's per-team totals match each team's recomputed score.
- [x] Verify the report is a single file with no external references.

## Technical Proposal

- **Affected files**: new `lib/report/render.mjs` producing `report.html`; extend
  `bin/leaderboard.mjs` to emit `leaderboard.html`.
- **Database changes**: None.
- **API changes**: None. Consumes `score.json` from stories 3 and 4.
- **Key implementation notes**: inline all CSS and JS; the count-up animation is the only
  motion, and it must degrade to a static readable number if scripting is unavailable. Rendering runs after story 3's escaping boundary but must
  escape again at the template rather than trusting upstream.

## Edge Cases & Out of Scope

**Edge cases to handle:**

- A team scores zero legitimately, which must read as a low score and nothing more —
  there is no other kind of zero any more.
- Two teams tie, requiring badges to break the tie visibly.
- A bundle is missing its coach scorecard, so the total is provisional at reveal time.
- Detection text contains characters that break out of an HTML attribute context.

**Out of scope:**

- Any hosted, shared or multi-user version of the leaderboard.
- Live updating during the event; the leaderboard is generated on demand.
- Historical comparison across camps.

## Delivered

`lib/report/render.mjs` renders both pages; `lib/report/badges.mjs` holds the catalogue.
`vibecheck` writes `.vibecheck/report.html` beside the JSON, and `leaderboard --html
<file>` writes the ranked view. 13 renderer tests, 79 across the kit.

**Two defects the rendered page exposed that the unit tests did not:**

- Running with `--no-run-tests` deducted 8 points for "no runnable test command" — the
  scorer punished a team for how the operator invoked it. A skipped run is now
  `not-harvested` and leaves the denominator.
- The favicon data URI carried unencoded `<`/`>`. Browsers tolerate it; it is now
  percent-encoded, which also removed the last literal URL from the page.

**Badges** are earned two ways. Six are derived from the evidence and cost a coach nothing
(Harness First, Tight Loop, Clean Hands, Green at the Buzzer, Read the Output, Kept a
Journal); four are coach-awarded for things no script can see (Caught It Lying,
Responsible Disclosure, Built Something Reusable, Best Question). Badges are never
stripped: the injection scan produces notes for a coach, not a finding of guilt, and a
badge records work the team actually did.

## Dependencies

- Story 3 — provides `score.json`, the injection flag and the recomputation entry point.
- Story 4 — provides judged scores and badges; the reveal renders provisional results
  without it.
