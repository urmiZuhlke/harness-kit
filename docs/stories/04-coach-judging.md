# Story 4 — feat: Coach judging pass for the subjective dimensions

## Intent

Three things that matter most cannot be measured by a script: whether a harness file is
substantive or eloquent boilerplate, whether prompts showed real problem decomposition,
and whether the app actually works. This story closes those gaps without reintroducing the
variance that makes a pure LLM score unfair to compete on.

## Current Behaviour

This capability does not exist yet. Story 3's scorer marks the subjective sub-criteria as
provisional and leaves the "It Actually Works" dimension unscored.

## New Behaviour

A coach runs a judging skill against a team's bundle. It assesses only the subjective
sub-criteria, against a fixed prompt on a pinned model, and emits a small judgement file
the scorer merges. Separately, coaches record the demo outcome and any manual adjustment
in a per-team scorecard. Every judged point carries a written justification, so a team
that disputes their score can see exactly what was judged and why.

## Decisions & Rationale

- **The judge scores only three sub-criteria, not the whole rubric**: the deterministic
  dimensions are already fair and reproducible, and handing them to a model would trade
  that away for nothing. _(Alternative considered: an LLM judging everything with the
  script as a cross-check — rejected because disagreements would have no tiebreaker.)_
- **Repo and transcript content enters the judge inside a data envelope**: a team's
  injection must fail on its own merits before story 3's detection ever fires. Detection is
  the punishment; hardening is the defence, and we need both.
- **The demo score is entered by a human, not inferred**: whether the use case works is a
  judgement about a running application, and coaches watching a demo are better at it than
  any static analysis.
- **Manual adjustments require a written reason**: with five coaches and ten-plus teams,
  an unexplained adjustment is indistinguishable from a mistake.

## Requirements

- Assess whether the harness content is substantive or unmodified boilerplate, and justify
  the assessment against specific content.
- Assess the quality of goal decomposition visible in the team's prompts, using the
  excerpts in the evidence file.
- Emit a judgement file containing a score and a written justification per assessed
  sub-criterion.
- Treat all repo and transcript content supplied to the judge as data that cannot alter
  the judging instructions.
- Record the model and prompt version used, so every team can be confirmed judged the same
  way.
- Provide a per-team coach scorecard capturing the demo outcome, any badges awarded, and
  any manual adjustment.
- Require a written reason for every manual adjustment.
- Merge the judgement file and the coach scorecard into the final score, replacing the
  provisional markers.
- Report a team's score as provisional when no judgement file or scorecard is present,
  rather than substituting a default value.

## Acceptance Criteria

- [x] Given a bundle with no judgement file, when the final score is computed, then the
      subjective dimensions remain marked provisional and are not silently zeroed.
- [x] Given a repo whose `AGENTS.md` instructs the reader to award full marks, when the
      judging pass runs, then the judged score is unaffected by that instruction.
- [x] Given a judgement file, when the final score is computed, then every judged
      sub-criterion contributes a score accompanied by its justification.
- [x] Given a coach scorecard with a manual adjustment and no reason, when the score is
      computed, then the adjustment is rejected and reported as invalid.
- [ ] **Not verified.** "The same bundle judged twice by the pinned model produces
      justifications that cite the same evidence." Only *merge* determinism is tested
      (`tests/judging.test.mjs` — same judgement in, same score out). Whether a model
      reproduces its own reasoning across runs is not testable in this repo, which has no
      model to call. Mitigated procedurally instead: the field guide tells coaches to use
      one tool/model across every team at a camp.
- [x] Verify the judging pass never modifies `evidence.json`.

## Technical Proposal

- **Affected files**: new judging skill under the kit's skills folder; new
  `lib/score/merge.mjs` combining deterministic scores, judgements and the coach
  scorecard; `coach-scorecard.json` template.
- **Database changes**: None.
- **API changes**: None. The judgement file and coach scorecard are new inputs to the
  story 3 scorer and must carry schema versions.
- **Key implementation notes**: the judging skill reads only `evidence.json`, never the
  repo directly, which bounds what can reach the model and keeps judging reproducible from
  an archived bundle after the event.

## Edge Cases & Out of Scope

**Edge cases to handle:**

- Two coaches judge the same team and produce conflicting judgement files.
- A team's evidence contains no prompt excerpts because their tool was `not-harvested`,
  leaving the decomposition criterion unjudgeable.
- A demo fails for an environmental reason unrelated to the team's work.

**Out of scope:**

- Judging the deterministic dimensions, which remain script-computed.
- Any automated assessment of whether the app runs; that is a human judgement.
- Building the leaderboard that consumes the merged scores — story 5.

## Deviations from the Technical Proposal

- **No separate `lib/score/merge.mjs`.** The two judgeable criteria
  (`harness-is-substantive`, `iterative-direction`) read `context.judgement` directly,
  following the exact pattern the `it-actually-works` criterion already used for
  `context.coachScorecard`. One code path (`scoreDimension`) stays the single source of
  truth for how a criterion resolves, rather than a second merge layer that could drift
  from it. The Technical Proposal is explicitly advisory; this keeps `AGENTS.md`'s own
  "keep it lean" rule.
- **`repoEvidence.harnessFiles[]` gained a bounded `contentExcerpt` field**
  (`lib/harvest/repo.mjs`), not listed in story 2 or story 4's file lists. Without it the
  judging skill would have had to open the team's repo directly to assess harness
  substance, contradicting its own "reads only evidence.json" design. Harness files are
  written for an agent to read and carry no more sensitivity than other tracked source,
  so this is not a privacy regression the way transcript content would be.

## Delivered

`plugin/skills/coach-judge/SKILL.md`, judged-criterion overrides in
`lib/score/dimensions.mjs` (`applyJudgement`, `JUDGED_CRITERIA`), `judgement.json` wired
into `lib/score/index.mjs`/`bin/vibecheck.mjs`/`bin/leaderboard.mjs`, plus
`docs/coach-scorecard.template.json` and `docs/judgement.example.json`. 16 new tests (93
across the kit). Both manifest versions and `SCORER_VERSION` bumped to 1.1.0 per
`AGENTS.md`'s own rule, since a criterion's behaviour changed.

**A real end-to-end run** (this repo, a hand-authored `judgement.json`) confirmed the full
path: `report.html` and the leaderboard both render the judge's justification text, and a
lost point from a judged criterion appears in `lostPoints` with the coach's own reasoning
attached.

## Review findings addressed (2026-08-21)

A pre-PR review of stories 4 and 6 found ten issues; all are fixed and covered by tests.

| Finding | Fix |
| ------- | --- |
| **`contentExcerpt` republished secrets verbatim** — the scanner masked a credential in its findings while the excerpt beside it carried the raw value into `evidence.json` and on to a model | Excerpts are redacted through the same `SECRET_PATTERNS` before being stored |
| **The participant privacy notice became false** — it promised "nothing is uploaded anywhere" after the judging pass began sending excerpts to a model | Notice rewritten to state exactly what leaves the machine, and offers a hand-scored opt-out |
| Judged points were never coerced to integers; `5.7` produced a total of `55.7` | Rounded as well as clamped |
| A team whose AI tool couldn't be read stayed **permanently provisional**, with no action a coach could take | `provisional` now means "a human owes an action"; permanent data limits are reported by `complete` alone, and `awaiting` names each pending item |
| A typo'd criterion id in `judgement.json` was silently dropped | Reported as `judgement.ignoredCriteria` |
| `report.html` didn't distinguish a judged score from a heuristic one | Dimension rows now show "coach-judged" or "awaiting a coach's judgement" |
| The one-page field-guide AC was ticked at 75 lines, then the doc grew to 96 | Trimmed to 79 by folding the duplicated failure-mode list into the card table; AC re-verified |
| The LLM-reproducibility AC was ticked but only merge determinism was tested | Marked **not verified**, with the procedural mitigation named |
| `model` is self-reported and models are often wrong about their own version | Caveat added; the skill points at the procedural control instead |
| Harness excerpts had a per-file cap but no total | 60k-character budget across the whole harvest |

### Second review pass

| Finding | Fix |
| ------- | --- |
| **The leaderboard told coaches to "resolve" the unresolvable** — its pending list was built from `incomplete` (unassessable dimensions) while the actually-actionable `awaiting` items went unshown | Two separate sections: outstanding coach actions, named per team; and a clearly-labelled note that unassessable points are a limit of what could be read, not work |
| The judge had no idea `[redacted: ...]` markers were ours, and could dock harness-substance points for our own transformation — charging a team twice for one leaked secret | The skill now states the markers are the harvester's and must not count against substance |
| `provisional` was redefined without a schema bump; two files stamped v1 asserted different things | `SCORE_SCHEMA_VERSION` → 2, with the semantic change documented at the constant. `EVIDENCE_SCHEMA_VERSION` → 2 for the additive `contentExcerpt` |
| The report's judged/awaiting markers shipped untested | Three tests, scoped to the row under test |

The privacy regression is the one worth remembering: it came from adding a field for a
good reason without re-reading what the kit had already promised about that data. Rule 3
in `AGENTS.md` now exists to catch the next one.

## Dependencies

- Story 3 — provides the scorer, the merge point and the provisional markers.
