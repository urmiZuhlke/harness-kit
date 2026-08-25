/**
 * index.mjs — turn evidence.json into score.json.
 *
 * Scoring is a pure function of the evidence file plus, optionally, a coach's scorecard
 * and a judging pass. That is deliberate: the coach-side leaderboard recomputes from
 * evidence and ignores whatever score.json a team hands over, so editing your own score
 * achieves nothing.
 *
 * Three rules the rest of the kit depends on:
 *   1. Every deduction carries a reason and a citation. The number is the headline; the
 *      reasons are the product.
 *   2. `not-harvested` is excluded from both earned and available points — never scored
 *      as zero — so a team is not punished for a tool this kit cannot read.
 *   3. A deliberate injection attempt sets the final score to zero, after everything else
 *      has been computed, so the report can still show what the score would have been.
 */
import { DIMENSIONS, JUDGED_CRITERIA } from './dimensions.mjs';
import { detectInjection } from '../integrity/injection.mjs';

/**
 * Bump on any change to the shape *or meaning* of score.json.
 *
 * v2 redefined `provisional`: it used to mean "something went unassessed" and now means
 * "a human still owes an action", with permanent data limits reported by `complete`
 * alone. That is a semantic change, not an additive one — two files both stamped v1 would
 * have asserted different things — so the version moves even though no field was removed.
 * v2 also adds `awaiting`, `dimensions[].coachScored`, `dimensions[].criteria[].judged`
 * and `judgement`.
 */
export const SCORE_SCHEMA_VERSION = 2;

/** Bump when a criterion changes. Coaches compare this across teams to confirm fairness. */
export const SCORER_VERSION = '1.1.0';

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
    // A coach-scored dimension nobody has scored yet.
    if (d.coachScored && d.status === 'not-harvested') {
      pending.push({ dimension: d.label, needs: 'a coach’s score' });
      continue;
    }
    // A criterion a coach could judge, still sitting on its deterministic fallback.
    // `status !== 'not-harvested'` is the distinction that matters: a criterion with no
    // prompts to read is unjudgeable, not awaiting judgement.
    for (const c of d.criteria) {
      if (c.judged === false && c.status !== 'not-harvested') {
        pending.push({ dimension: d.label, criterion: c.label, needs: 'a coach’s judgement' });
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
          + '). This is a fault in the scorer, not in your work — tell a coach.',
      };
    }
    return {
      id: criterion.id,
      label: criterion.label,
      points: criterion.points,
      earned: outcome.earned ?? 0,
      status: outcome.status,
      evidence: outcome.evidence ?? null,
      // Only a criterion that lost points owes an explanation.
      lostBecause: outcome.status === 'pass' ? null : (outcome.reason ?? null),
      // Present only for criteria a coach's judging pass can override (see
      // JUDGED_CRITERIA). Distinguishes "a human confirmed this" from "still on the
      // deterministic fallback, pending a coach" — the latter keeps the whole score
      // provisional even though the criterion itself already has a real number.
      judged: JUDGED_CRITERIA.includes(criterion.id) ? Boolean(outcome.judged) : undefined,
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
    // Carried through so `awaitingAction` can tell "no coach has scored this yet"
    // (actionable) from "there was nothing to measure" (not).
    coachScored: Boolean(dimension.coachScored),
    errors: errored.length,
    criteria: results,
  };
}

/**
 * @param {object} evidence         parsed evidence.json
 * @param {object} [options]
 * @param {object} [options.coachScorecard]  demo score, badges, manual adjustment
 * @param {object} [options.judgement]       output of the coach judging pass (story 4)
 * @param {string} [options.repoPath]        overrides evidence.repo.path for the scan
 * @param {boolean} [options.practice]       mark the result as a practice run
 */
export function score(evidence, options = {}) {
  const { coachScorecard = null, judgement = null, practice = false } = options;
  const repoPath = options.repoPath ?? evidence?.repo?.path;

  const context = { coachScorecard, judgement };
  const dimensions = DIMENSIONS.map((d) => scoreDimension(d, evidence, context));

  const earned = dimensions.reduce((sum, d) => sum + d.earned, 0);
  const available = dimensions.reduce((sum, d) => sum + d.available, 0);

  const integrity = repoPath
    ? detectInjection(repoPath, evidence, { kitRoot: options.kitRoot })
    : { scanned: null, deliberate: [], ambiguous: [], penalised: false };

  // Everything above is computed first so the report can still show what was thrown away.
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

  const manual = coachScorecard?.adjustment;
  const adjustment = manual && typeof manual.points === 'number'
    ? (manual.reason
      ? { points: manual.points, reason: manual.reason, applied: true }
      : { points: 0, reason: null, applied: false, rejected: 'a manual adjustment requires a written reason' })
    : null;

  // Applied to `earned`, not to `total`: when a penalty has already zeroed the score we
  // still want `wouldHaveScored` to report the real figure the team built.
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
    total: integrity.penalised ? 0 : adjusted,
    earned,
    available,
    // available < 100 means some dimension could not be assessed; say so rather than
    // letting a partial result read as a low one.
    complete: available === 100,
    // `provisional` means **a human still owes an action** — not merely that something
    // was unassessable. Those are different states and conflating them left teams whose
    // AI tool couldn't be read flagged provisional forever, with nothing any coach could
    // do to clear it before ranking. Permanent data limitations are what `complete: false`
    // already reports.
    //
    // Two things are actionable: a judgeable criterion nobody has judged yet, and a
    // coach-scored dimension nobody has scored yet.
    provisional: awaitingAction(dimensions).length > 0,
    awaiting: awaitingAction(dimensions),
    dimensions,
    lostPoints,
    integrity: {
      penalised: integrity.penalised,
      wouldHaveScored: integrity.penalised ? adjusted : null,
      deliberate: integrity.deliberate,
      ambiguous: integrity.ambiguous,
      scanned: integrity.scanned,
    },
    badges: coachScorecard?.badges ?? [],
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
      // be dropped in silence, leaving a coach convinced they judged something they
      // didn't. Surface it so the mistake is visible rather than inferred from a score.
      ignoredCriteria: Object.keys(judgement?.criteria ?? {})
        .filter((id) => !JUDGED_CRITERIA.includes(id)),
    },
  };
}
