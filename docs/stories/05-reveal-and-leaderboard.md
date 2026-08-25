# Story 5 — feat: The reveal, the leaderboard, and the Nice Try wall

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
their score, per-dimension bars fill in, and every lost point is listed with its reason and
evidence. Teams flagged for a deliberate injection attempt see the counter climb, then
slam to zero under a NICE TRY stamp quoting exactly what was found and where. A coach
command ranks all bundles into one leaderboard showing where each team stands per
dimension, with flagged teams in their own row.

## Decisions & Rationale

- **The reveal is one self-contained offline HTML file**: camp wifi is not a dependency
  worth taking on the one moment the whole day builds to. _(Alternative considered: a
  hosted dashboard — rejected as an outage would cost the event its climax.)_
- **Lost points are shown, not just earned points**: the score is a teaching artefact, and
  the reason a team is at 68 is more valuable than the 68.
- **The injection penalty is shown publicly and playfully**: announced in advance it
  becomes a dare rather than a trap, and it teaches prompt injection as a real
  vulnerability class from both the attacking and defending side.
- **The leaderboard compares per dimension, not just by total**: a team that placed fourth
  overall but first on verification should find that out.

## Requirements

- Render a team's score as a self-contained HTML page that works with no network access.
- Animate the total counting up to the final score on load.
- Show each dimension's score against its maximum.
- List every lost point with its plain-language reason and its evidence citation.
- Show badges the team earned.
- Show partial or provisional dimensions distinctly from scored ones, so an incomplete
  result is never mistaken for a low one.
- Present a flagged team's reveal as a count-up that resets to zero under a clearly marked
  penalty, quoting the detected file, line and text.
- Rank all collected bundles into a single leaderboard with per-dimension comparison.
- List flagged teams in a distinct leaderboard section rather than omitting them.
- Escape all evidence-derived and detection-derived text before rendering it.

## Acceptance Criteria

- [x] Given a `score.json`, when the report is opened with networking disabled, then it
      renders fully with no missing assets.
- [x] Given a flagged team's bundle, when the report is opened, then the displayed final
      score is zero and the detected text, file and line are shown.
- [x] Given a bundle with a `not-harvested` source, when the report is opened, then the
      affected dimension is shown as partial and is visually distinct from a zero.
- [x] Given detection text containing HTML or script markup, when the report renders it,
      then it appears as literal text and does not execute.
- [x] Given ten bundles, when the leaderboard runs, then all ten appear ranked, with
      flagged teams in their own section.
- [x] Verify the leaderboard's per-team totals match each team's recomputed score.
- [x] Verify the report is a single file with no external references.

## Technical Proposal

- **Affected files**: new `lib/report/render.mjs` producing `report.html`; extend
  `bin/leaderboard.mjs` to emit `leaderboard.html`.
- **Database changes**: None.
- **API changes**: None. Consumes `score.json` from stories 3 and 4.
- **Key implementation notes**: inline all CSS and JS; the count-up animation and the
  penalty reset are the only motion, and both must degrade to a static readable number if
  scripting is unavailable. Rendering runs after story 3's escaping boundary but must
  escape again at the template rather than trusting upstream.

## Edge Cases & Out of Scope

**Edge cases to handle:**

- A team scores zero legitimately, which must look different from a penalty zero.
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
Responsible Disclosure, Built Something Reusable, Best Question). A penalised team keeps
none — the penalty is meant to cost everything.

## Dependencies

- Story 3 — provides `score.json`, the injection flag and the recomputation entry point.
- Story 4 — provides judged scores and badges; the reveal renders provisional results
  without it.
