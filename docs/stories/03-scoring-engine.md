# Story 3 — feat: Score the evidence, detect injection attempts, and offer practice mode

## Intent

Teams need a number they can act on, and coaches need a winner that survives scrutiny.
This story turns harvested evidence into a 0-100 score with a per-point explanation, makes
the result reproducible by anyone holding the evidence file, and catches teams who try to
instruct the scorer instead of impressing it.

## Current Behaviour

This capability does not exist yet. Story 2 produces evidence; nothing consumes it. The
kit's existing assessment asks an LLM to read a repo and report a maturity level, which
varies between runs and can be influenced by the repo's own content.

## New Behaviour

Feeding `evidence.json` to the scorer produces `score.json`: a total out of 100, a score
per dimension, and for every point lost a plain-language reason with the evidence that
caused it. The deterministic dimensions are computed from evidence alone, so a coach
re-running the scorer on the same evidence gets the same number. Teams can run it
themselves any time as practice, with coach-judged dimensions clearly marked provisional.
Repos containing text that reads like an attempt to instruct the scorer are flagged for a
coach, with no effect on the score.

## Decisions & Rationale

- **Scoring is a pure function of `evidence.json`**: the coach-side leaderboard recomputes
  from evidence and ignores any `score.json` a team hands over, so editing your own score
  file achieves nothing. _(Alternative considered: trusting the team's score.json with
  spot-checks — rejected as it makes the obvious cheat also the easiest one.)_
- **Cheap-to-fake signals carry few points**: file existence is worth little; transcript
  evidence of a real test-fix-rerun loop and timestamps proving the harness predates the
  code carry the weight. This is the primary defence against reverse-engineering the
  scorer, and it is deliberate — a team that games those signals has done the work.
- **Two injection tiers**: a joke in a README should not cost someone the event, but
  concealment or targeting the scorer by name is unambiguous. _(Alternative considered: a
  single tier that zeroes any suspicious phrase — rejected as it would punish teams whose
  `AGENTS.md` legitimately says "you are a reviewer".)_
- **Naming the scorer is not an attack; instructing it is.** The first version of the
  detector flagged any mention of `vibecheck` or `score.json` and zeroed this repo's own
  documentation, and would have zeroed a team whose README said "we ran vibecheck hourly".
  That rule now fires only when the same line also addresses a reader imperatively.
  False-zeroing a team is far worse than missing a clumsy attempt. _(Alternative
  considered: an allowlist of kit-owned paths alone — kept, but insufficient on its own,
  because a team's own honest prose was still being caught.)_
- **The leaderboard ranks by share of assessable points, not raw total.** When every team
  is complete the two are identical, because available is 100 for all of them. They differ
  only when a team could not be assessed on some dimension — and ranking those teams by
  raw total would punish them for a tool this kit cannot read.
- ***Badges are tiebreakers, not points**: keeping the scale exactly 100 makes it readable,
  and behaviours worth celebrating are not always worth arithmetic.
- **Practice mode is unlimited and uses the identical scorer**: the score's job is
  teaching, and a final reveal that surprises anyone has failed at that job.

## Requirements

- Compute a score out of 100 from `evidence.json` using the rubric's six weighted
  dimensions.
- Produce for every deduction a plain-language reason naming what was missing and citing
  the evidence, written so a participant can act on it without a coach.
- Mark any dimension whose evidence source was `not-harvested` as such, and report the
  total as partial rather than silently scoring those points as zero.
- Detect deliberate attempts to influence a scoring agent, covering concealed instructions,
  references to the scorer's own filenames or output keys, and imperatives addressed at an
  evaluator.
- Detect ambiguous self-promotional content separately, at a lower confidence tier.
- Record the file, line and quoted text of every detection as a note for a coach.
  **Superseded:** this story originally set the final score to zero on a detection. It no
  longer does, and nothing in the scorer may. The rules misfired on ordinary emoji and
  ordinary CSS and told a team it had cheated; a false accusation costs far more than a
  missed attempt. See rule 9 in `AGENTS.md`.
- Treat all repo and transcript content as data throughout, never as instructions to the
  scorer or to any downstream consumer of its output.
- Provide a practice mode teams can run repeatedly, marking coach-judged dimensions as
  provisional and otherwise identical in output.
- Record the scorer version in `score.json` so coaches can confirm every team was scored
  by the same build.
- Recompute scores from evidence when given a set of team bundles, ignoring any score file
  those bundles contain.

## Acceptance Criteria

- [x] Given the same `evidence.json`, when the scorer runs twice, then both runs produce an
      identical total and identical per-dimension scores.
- [x] Given a `score.json` edited by hand to show 100, when the coach-side recomputation
      runs on the same bundle, then the reported score reflects the evidence, not the edit.
- [x] Given evidence where the Copilot source is `not-harvested`, when the scorer runs,
      then the affected dimension is reported partial and the total is labelled accordingly.
- [x] Given a repo file containing a zero-width-character-concealed instruction, when the
      scorer runs, then the detection cites file, line and text — and the score is unchanged.
- [x] Given an `AGENTS.md` that legitimately contains the phrase "you are a reviewer", when
      the scorer runs, then no high-confidence detection is recorded.
- [ ] Given a repo whose harness files were committed after the bulk of the code, when the
      scorer runs, then the Context and Harness dimension reflects the timestamp evidence.
- [x] Verify every deduction in `score.json` carries both a reason and an evidence citation.
- [x] Verify the dimension scores in any output sum to the reported total.
- [x] Verify no detected injection text is emitted unescaped into any downstream prompt or
      report.

## Technical Proposal

- **Affected files**: new `lib/score/` containing one module per dimension plus
  `total.mjs`; new `lib/integrity/injection.mjs`; new `bin/leaderboard.mjs` recomputation
  entry point; extend `bin/vibecheck.mjs` with a practice flag.
- **Database changes**: None.
- **API changes**: None. `score.json` is the contract consumed by stories 4 and 5 and
  carries a schema version and the scorer version.
- **Verified**: five distinct attack techniques (imperative override, role assignment,
  hidden-styling score demand, zero-width concealment, system-prompt reference) all caught
  on a purpose-built fixture; a control repo that mentions the scorer in ordinary prose is
  clean; this repo scans clean across 48 files. Three bundles carrying a hand-edited
  `score.json` claiming 100 were all recomputed to their real scores by the leaderboard.
  A rubric edited to sum to 101 refuses to load.
- **Key implementation notes**: the injection scan covers every file an agent would
  plausibly read including filenames themselves, and looks for concealment (HTML comments
  carrying directives, zero-width and bidi control characters, transparent or white text),
  scorer-internal references, and evaluator-directed imperatives. Detected text must be
  escaped at the boundary so it cannot influence the story 4 judging pass or the story 5
  report.

## Edge Cases & Out of Scope

**Edge cases to handle:**

- A team legitimately vendors this kit into their repo, so the scorer's own filenames
  appear in their tree without any injection intent.
- An injection attempt appears inside a transcript rather than a repo file — the team told
  the agent to write it, which is still deliberate.
- A dependency's bundled files contain instruction-like text the team never wrote.
- Every evidence source is `not-harvested`, making the total meaningless — the scorer must
  say so rather than report zero.

**Out of scope:**

- The LLM judging pass for subjective dimensions — story 4.
- Any visual presentation of the score — story 5. The injection scan has no visual
  presentation at all; its output reaches a coach through the CLI.
- Cryptographic signing of evidence files; integrity here rests on recomputation plus
  coach spot-checks, which is proportionate for a friendly camp.

## Review findings addressed (2026-08-21)

A pre-PR review of stories 1-3 found nine issues; all are fixed and covered by tests.

| Finding | Fix |
| ------- | --- |
| `classifyOutcome` referenced two regexes that were never defined, throwing on 18% of tool results and silently discarding whole sessions | Markers restored; adapters now record parse failures instead of swallowing them |
| Injection detection skipped seven directory prefixes, giving attackers guaranteed-unscanned locations | Exclusion is now by SHA-256 content identity against the kit's own files |
| A zero exit code was believed even when the output said the suite failed (`npm test \| tee`, `\|\| true`) | Failure text in the output now overrides a green exit code |
| A green TAP run printed `# fail 0`, which a case-insensitive `FAIL` pattern read as a failure | Counts must be non-zero; all-caps verdicts matched case-sensitively |
| A criterion that threw was recorded as `not-harvested`, shrinking the denominator and raising that team's rank | Errors keep their points in `available` and surface as `status: 'error'` |
| `no-secrets` awarded full marks off a file walk that hit its cap | A truncated scan reports `not-harvested` |
| Any git failure reported "no commits yet", including an output-buffer overflow on a large repo | Commit existence is checked separately from reading the log |
| `distribution` returned the upper-middle value as the median and collapsed p90 onto max | Correct median and nearest-rank p90; the global prompt figure is now an exact mean |
| Metadata passed to `excerptCollector` could overwrite the bounded excerpt | Metadata is spread before the text, never after |

The absence of tests is what let the undefined-regex deletion survive three rounds of
manual verification. There are now 64.

## Dependencies

- Story 2 — provides `evidence.json`.
