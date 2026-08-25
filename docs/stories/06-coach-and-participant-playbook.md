# Story 6 — docs: Coach field guide and participant intro

## Intent

Five coaches supporting ten-plus teams for 8-16 hours will give inconsistent guidance
unless they share one rubric and one idea of when to help. Participants need the rules,
the scoring criteria and the consent notice before they write a line of code — a rubric
revealed at the end is a gotcha, not a lesson.

## Current Behaviour

This capability does not exist yet. The kit's facilitation material was written for
one-to-one adoption interviews at a client and is deleted by story 1.

## New Behaviour

Coaches carry a one-page field guide: the six dimensions as a two-minute mental card, an
intervention ladder for when to answer versus when to let a team struggle, a checkpoint
cadence for the day, and the failure modes to watch for. Participants receive a one-pager
and a 30-minute intro covering what they are building, how they will be scored, the
starting tips that matter most, the consent notice for transcript reading, and an explicit
warning that the scorer is adversarially tested.

## Decisions & Rationale

- **The full rubric is published on day one**: teams will optimise toward it, and with a
  rubric weighted to reward real verification loops, optimising toward it is the workshop.
  _(Alternative considered: withholding the weights to prevent gaming — rejected because
  it converts a teaching tool into a trap and produces scores nobody can learn from.)_
- **The injection penalty is announced, not sprung**: a published dare is fun and teaches
  the concept; an unannounced one just feels unfair.
- **An intervention ladder rather than a rule**: the most valuable coaching moment is a
  team discovering their agent lied to them about tests passing, and a coach who answers
  too early destroys it.
- **A mid-point practice run is scheduled**: it costs coaches nothing and is the largest
  single learning lever, since teams see their gaps while they can still close them.

## Requirements

- Provide a coach field guide summarising the six dimensions as a card assessable in two
  to three minutes per team.
- Provide an intervention ladder describing when to observe, when to ask a question, and
  when to answer directly.
- Provide a checkpoint cadence sized for two teams per coach across an 8-16 hour event.
- List the failure modes coaches should watch for, including teams that accept agent
  output without verification and teams that build harness documents they never use.
- Provide a participant one-pager stating the use case expectations, the six dimensions
  with their weights, and how the final score is produced.
- State in participant material that transcripts are read locally for scoring, what is
  extracted, and what is never copied.
- State in participant material that attempts to instruct the scorer are detected,
  penalised with a zero, and shown publicly.
- Provide a starting tips list covering what to set up first and what earns the most
  points.
- Warn coaches that running the scorer against a team's repo executes that repo's test
  command, so it should be run on the team's own machine with the team present — never
  pointed at ten unknown repos from a coach's laptop. `--no-run-tests` skips execution.
- Provide the 30-minute intro as a section-by-section outline with timings.
- Instruct teams how to run practice mode and when the mid-point run happens.

## Acceptance Criteria

- [x] Verify the coach card covers all six dimensions and fits on one printed page.
      (Re-verified after the judging section was added: it had grown to 96 lines, and was
      trimmed back to 79 by folding the duplicated failure-mode list into the card table.)
- [x] Verify the dimension weights in participant material match the rubric from story 1
      exactly.
- [x] Verify the intro outline's section timings sum to 30 minutes.
- [x] Verify the consent notice states what is read, what is extracted and what is never
      copied.
- [x] Verify the participant one-pager describes the injection penalty before the event
      rather than after.
- [x] Verify the field guide names at least one failure mode per dimension.
- [x] Verify the field guide states that scoring executes the team's test command, and
      names the flag that avoids it.
- [x] Verify no material references any client, or any tool the teams are not using.

## Technical Proposal

- **Affected files**: new `docs/coach-field-guide.md`, `docs/participant-one-pager.md` and
  `docs/intro-outline.md`.
- **Database changes**: None.
- **API changes**: None.
- **Key implementation notes**: the weights appear in the rubric, the scorer and this
  material; a change to one must update all three, which is worth stating in `AGENTS.md`.

## Edge Cases & Out of Scope

**Edge cases to handle:**

- A team uses an AI tool the harvester cannot read, and needs to know at the start that
  the session journal is their fallback.
- More than ten teams show up, breaking the two-teams-per-coach cadence.
- A team finishes the use case early and needs guidance on what to improve.

**Out of scope:**

- Slide design or any produced deck; the outline is the deliverable.
- Choosing or specifying the hackathon use case itself.
- Post-event retrospective or feedback collection material.

## Delivered

`docs/coach-field-guide.md` (75 lines, one page), `docs/participant-one-pager.md`,
`docs/intro-outline.md` (7 sections, 30 minutes exactly). All acceptance criteria verified
with a script, not by eye — see the commit for the exact checks run.

## Dependencies

- Story 1 — provides the rubric whose weights this material must match.
