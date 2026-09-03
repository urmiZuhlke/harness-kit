/**
 * index.mjs — turn evidence.json into score.json.
 *
 * Scoring is a pure function of the evidence file plus, optionally, a facilitator's scorecard
 * and a judging pass. That is deliberate: the facilitator-side leaderboard recomputes from
 * evidence and ignores whatever score.json a team hands over, so editing your own score
 * achieves nothing.
 *
 * Three rules the rest of the kit depends on:
 *   1. Every deduction carries a reason and a citation. The number is the headline; the
 *      reasons are the product.
 *   2. `not-harvested` is excluded from both earned and available points — never scored
 *      as zero — so a team is not punished for a tool this kit cannot read.
 *   3. Nothing in this file can zero a score. The injection scan produces notes for a
 *      facilitator and no penalty — a misfiring regex must never be able to accuse a team.
 */
import { DIMENSIONS, FACILITATOR_SCORED, JUDGED_CRITERIA } from './dimensions.mjs';
import { detectInjection } from '../integrity/injection.mjs';

/**
 * Bump on any change to the shape *or meaning* of score.json.
 *
 * v2 redefined `provisional`: it used to mean "something went unassessed" and now means
 * "a human still owes an action", with permanent data limits reported by `complete`
 * alone. That is a semantic change, not an additive one — two files both stamped v1 would
 * have asserted different things — so the version moves even though no field was removed.
 * v2 also adds `awaiting`, `dimensions[].facilitatorScored`, `dimensions[].criteria[].judged`
 * and `judgement`.
 *
 * v3 removes `integrity` and replaces it with `facilitatorNotes`. The old field carried a
 * verdict — `penalised` forced `total` to zero, and `wouldHaveScored` recorded what the
 * team had actually earned before that. Both are gone: the scan now produces observations
 * for a human and cannot move a number. Renaming rather than repurposing is deliberate,
 * so a consumer written against v2 fails loudly instead of reading a field that no longer
 * means what it did.
 *
 * v4 renames the scoring role from coach to facilitator throughout — `facilitatorNotes`,
 * `dimensions[].facilitatorScored` — and adds `dimensions[].criteria[].facilitatorScored`
 * for the criteria a person settles one at a time rather than a whole dimension at once.
 * The rubric's weights changed in the same release, so a v3 and a v4 file are not
 * comparable scores even where they share a field name; the version is what says so.
 */
export const SCORE_SCHEMA_VERSION = 4;

/** Bump when a criterion changes. Facilitators compare this across teams to confirm fairness. */
// 2.0.0: dimension weights changed, three criteria were added, and the transcript
// thresholds became proportional to observed volume. Scores from 1.x cannot be compared
// with these, which is exactly what a major version is for. Pin this for the duration of
// an event — re-weighting midway makes teams measured before and after incomparable.
export const SCORER_VERSION = '2.0.0';

/** The rubric promises 100 points. A change that breaks that is a bug, not a tweak. */
function assertWeightsSumTo100() {
  const total = DIMENSIONS.reduce((sum, d) => sum + d.points, 0);
  if (total !== 100) {
    throw new Error('Rubric weights must sum to 100, got ' + total
      + '. Fix lib/score/dimensions.mjs and docs/rubric.md together.');
  }
  for (const d of DIMENSIONS) {
    const criteria = d.criteria.reduce((sum, c) => sum + c.points, 0);
    if (criteria !== d.points) {
      throw new Error('Dimension "' + d.id + '" declares ' + d.points
        + ' points but its criteria sum to ' + criteria + '.');
    }
  }
}
assertWeightsSumTo100();

/**
 * What a human could still do to finalise this score. Empty means nothing is pending —
 * whatever is unassessed is unassessable, not merely unattended.
 */
function awaitingAction(dimensions) {
  const pending = [];
  for (const d of dimensions) {
    for (const c of d.criteria) {
      // A criterion only a person can settle, that nobody has settled yet. Reported per
      // criterion rather than per dimension because they are no longer the same thing:
      // "It Actually Works" holds two, and the privacy check sits inside a dimension the
      // scorer otherwise computes on its own.
      if (c.facilitatorScored && c.status === 'not-harvested') {
        pending.push({ dimension: d.label, criterion: c.label, needs: 'a facilitator’s score' });
        continue;
      }
      // A criterion a facilitator could judge, still sitting on its deterministic fallback.
      // `status !== 'not-harvested'` is the distinction that matters: a criterion with no
      // prompts to read is unjudgeable, not awaiting judgement.
      if (c.judged === false && c.status !== 'not-harvested') {
        pending.push({ dimension: d.label, criterion: c.label, needs: 'a facilitator’s judgement' });
      }
    }
  }
  return pending;
}

function scoreDimension(dimension, evidence, context) {
  const results = dimension.criteria.map((criterion) => {
    let outcome;
    try {
      outcome = criterion.evaluate(evidence, context);
    } catch (err) {
      // A criterion that throws is our bug, and it must look like one. Recording it as
      // 'not-harvested' would remove its points from `available`, and because the
      // leaderboard ranks by earned/available that would silently *raise* this team's
      // position on the strength of a crash.
      outcome = {
        status: 'error', earned: 0,
        reason: 'this criterion could not be evaluated (' + err.message
          + '). This is a fault in the scorer, not in your work — tell a facilitator.',
      };
    }
    return {
      id: criterion.id,
      label: criterion.label,
      points: criterion.points,
      earned: outcome.earned ?? 0,
      status: outcome.status,
      // Three fields, always the same three, so a criterion reads the same way whether it
      // passed or failed: what was looked for, what was found, what to do next. A team
      // could previously see only the criteria they lost points on, and only a `reason`
      // that mixed observation with advice.
      lookedFor: criterion.lookedFor ?? null,
      evidence: outcome.evidence ?? null,
      // Only a criterion that lost points owes an explanation.
      lostBecause: outcome.status === 'pass' ? null : (outcome.reason ?? null),
      // Present only for criteria a facilitator's judging pass can override (see
      // JUDGED_CRITERIA). Distinguishes "a human confirmed this" from "still on the
      // deterministic fallback, pending a facilitator" — the latter keeps the whole score
      // provisional even though the criterion itself already has a real number.
      judged: JUDGED_CRITERIA.includes(criterion.id) ? Boolean(outcome.judged) : undefined,
      // Present only where a person, not the scorer, decides. Lets a report separate "we
      // looked and found nothing" from "nobody has looked yet".
      facilitatorScored: FACILITATOR_SCORED.includes(criterion.id) ? true : undefined,
    };
  });

  // An errored criterion stays *in* the available total (it was assessable; we failed to
  // assess it), so a crash costs points instead of quietly improving the ranking.
  const errored = results.filter((r) => r.status === 'error');
  const assessed = results.filter((r) => r.status !== 'not-harvested');
  const earned = assessed.reduce((sum, r) => sum + r.earned, 0);
  const available = assessed.reduce((sum, r) => sum + r.points, 0);

  const status = available === 0
    ? 'not-harvested'
    : (assessed.length < results.length ? 'partial' : 'assessed');

  return {
    id: dimension.id,
    label: dimension.label,
    measuredBy: dimension.measuredBy,
    points: dimension.points,
    earned,
    available,
    // A dimension nothing could be assessed for is reported, not silently zeroed.
    status,
    // Carried through so `awaitingAction` can tell "no facilitator has scored this yet"
    // (actionable) from "there was nothing to measure" (not).
    facilitatorScored: Boolean(dimension.facilitatorScored),
    errors: errored.length,
    criteria: results,
  };
}

/**
 * @param {object} evidence         parsed evidence.json
 * @param {object} [options]
 * @param {object} [options.facilitatorScorecard]  demo score, badges, manual adjustment
 * @param {object} [options.judgement]       output of the facilitator judging pass (story 4)
 * @param {string} [options.repoPath]        overrides evidence.repo.path for the scan
 * @param {boolean} [options.practice]       mark the result as a practice run
 */
export function score(evidence, options = {}) {
  const { facilitatorScorecard = null, judgement = null, practice = false } = options;
  const repoPath = options.repoPath ?? evidence?.repo?.path;

  const context = { facilitatorScorecard, judgement };
  const dimensions = DIMENSIONS.map((d) => scoreDimension(d, evidence, context));

  const earned = dimensions.reduce((sum, d) => sum + d.earned, 0);
  const available = dimensions.reduce((sum, d) => sum + d.available, 0);

  const integrity = repoPath
    ? detectInjection(repoPath, evidence, { kitRoot: options.kitRoot })
    : { scanned: null, strong: [], weak: [] };

  const lostPoints = dimensions.flatMap((d) => d.criteria
    .filter((c) => c.status !== 'pass' && c.status !== 'not-harvested' && c.earned < c.points)
    .map((c) => ({
      dimension: d.label,
      criterion: c.label,
      lost: c.points - c.earned,
      reason: c.lostBecause,
      evidence: c.evidence,
    })))
    .sort((a, b) => b.lost - a.lost);

  const manual = facilitatorScorecard?.adjustment;
  const adjustment = manual && typeof manual.points === 'number'
    ? (manual.reason
      ? { points: manual.points, reason: manual.reason, applied: true }
      : { points: 0, reason: null, applied: false, rejected: 'a manual adjustment requires a written reason' })
    : null;

  const adjusted = adjustment?.applied
    ? Math.max(0, Math.min(100, earned + adjustment.points))
    : earned;

  return {
    schemaVersion: SCORE_SCHEMA_VERSION,
    scorerVersion: SCORER_VERSION,
    scoredAt: new Date().toISOString(),
    evidenceHarvestedAt: evidence?.harvestedAt ?? null,
    repo: evidence?.repo ?? null,
    practice,
    total: adjusted,
    earned,
    available,
    // available < 100 means some dimension could not be assessed; say so rather than
    // letting a partial result read as a low one.
    complete: available === 100,
    // `provisional` means **a human still owes an action** — not merely that something
    // was unassessable. Those are different states and conflating them left teams whose
    // AI tool couldn't be read flagged provisional forever, with nothing any facilitator could
    // do to clear it before ranking. Permanent data limitations are what `complete: false`
    // already reports.
    //
    // Two things are actionable: a judgeable criterion nobody has judged yet, and a
    // facilitator-scored dimension nobody has scored yet.
    provisional: awaitingAction(dimensions).length > 0,
    awaiting: awaitingAction(dimensions),
    dimensions,
    lostPoints,
    // Renamed from `integrity` in schema v3, because the old name described a verdict and
    // this is not one. These are observations for a human; no field here affects `total`.
    facilitatorNotes: {
      strong: integrity.strong,
      weak: integrity.weak,
      scanned: integrity.scanned,
    },
    badges: facilitatorScorecard?.badges ?? [],
    adjustment,
    // Present regardless of whether a judgement was supplied, so "nobody judged this
    // team yet" is as visible as "here's who did and with what prompt version."
    judgement: {
      present: Boolean(judgement),
      model: judgement?.model ?? null,
      promptVersion: judgement?.promptVersion ?? null,
      judgedAt: judgement?.judgedAt ?? null,
      criteriaJudged: JUDGED_CRITERIA.filter((id) => Boolean(judgement?.criteria?.[id])),
      // A key naming a criterion that cannot be judged — usually a typo — would otherwise
      // be dropped in silence, leaving a facilitator convinced they judged something they
      // didn't. Surface it so the mistake is visible rather than inferred from a score.
      ignoredCriteria: Object.keys(judgement?.criteria ?? {})
        .filter((id) => !JUDGED_CRITERIA.includes(id)),
    },
  };
}
