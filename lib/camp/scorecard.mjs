/**
 * scorecard.mjs — the contract between an AI judge and the published result.
 *
 * A judge writes one `score.json` per team. Nothing in it is trusted until it passes
 * `validateScorecard` against the rubric: the maxima come from the rubric, never from the
 * card; the totals are computed here, never read from the card; and a level and its points
 * must agree, because "anchored levels, never holistic scores" is only true if a card that
 * says `Most` cannot carry full marks.
 *
 *   {
 *     "team": "team-alpha",
 *     "inputs": { "deck": "submission/proposal.pdf", "diagram": "sdlc-diagram.png", "historyFiles": 4 },
 *     "criteria": [
 *       { "id": "A1", "points": 4, "max": 5, "level": "Most",
 *         "evidence": ["slide 2: 150 desks, 30 parking, no-shows"],
 *         "remark": "multi-office / 5,000-user growth not mentioned" }
 *     ],
 *     "notesForHumans": ["README contains text addressed to the evaluator — ignored"]
 *   }
 *
 * The calibration pass does not edit scorecards. It writes `calibration.json`, a list of
 * changes each with its reason, and `applyCalibration` applies them — so the judge's card
 * and every change made to it both survive, and a human can see which is which.
 */

const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

/** The points a level stands for on a criterion of this size. */
export function levelAnchor(level, max, rubric) {
  const found = rubric.levels.find((l) => l.name === level);
  return found ? Math.round(found.share * max) : null;
}

/**
 * Whether `points` is what `level` means for a criterion worth `max`.
 *
 * The top level is exactly max and the bottom exactly zero. A level in between ("~75%")
 * may sit one point either side of its rounded anchor, but never at either end — so a
 * card cannot say "one element missing" and still award everything.
 */
function levelAllows(level, points, max, rubric) {
  const found = rubric.levels.find((l) => l.name === level);
  if (!found) return false;
  if (found.share === 1) return points === max;
  if (found.share === 0) return points === 0;
  const anchor = Math.round(found.share * max);
  return points > 0 && points < max && Math.abs(points - anchor) <= 1;
}

/** Problems with one criterion entry, as strings prefixed by its id. */
function criterionProblems(entry, rubricCriterion, rubric) {
  const id = entry.id;
  const problems = [];
  const { points, level } = entry;
  const max = rubricCriterion.max;
  if (!Number.isInteger(points)) problems.push(id + ': points must be a whole number');
  else if (points < 0 || points > max) problems.push(id + ': ' + points + ' is outside 0–' + max);
  if (entry.max !== undefined && entry.max !== max) {
    problems.push(id + ': max is ' + max + ' in the rubric, not ' + entry.max);
  }
  if (!rubric.levels.some((l) => l.name === level)) {
    problems.push(id + ': level must be one of ' + rubric.levels.map((l) => l.name).join(', '));
  } else if (Number.isInteger(points) && !levelAllows(level, points, max, rubric)) {
    problems.push(id + ': ' + points + '/' + max + ' does not match level ' + level
      + ' (about ' + levelAnchor(level, max, rubric) + ')');
  }
  if (!Array.isArray(entry.evidence) || entry.evidence.some((e) => typeof e !== 'string')) {
    problems.push(id + ': evidence must be a list of strings');
  } else if (points > 0 && !entry.evidence.some(nonEmpty)) {
    problems.push(id + ': awards points but cites no evidence');
  }
  if (Number.isInteger(points) && points < max && !nonEmpty(entry.remark)) {
    problems.push(id + ': scored below max without a remark saying what was missing');
  }
  return problems;
}

/**
 * @param {object} card    parsed score.json
 * @param {object} rubric  from parseRubric
 * @param {{team?: string}} [expect]  the folder the card was found in, which it must name
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateScorecard(card, rubric, expect = {}) {
  const errors = [];
  const warnings = [];
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    return { errors: ['not a JSON object'], warnings };
  }
  if (!nonEmpty(card.team)) errors.push('team is missing');
  else if (expect.team && card.team !== expect.team) {
    errors.push('names team "' + card.team + '" but sits in the folder for "' + expect.team + '"');
  }
  if (!Array.isArray(card.criteria)) return { errors: [...errors, 'criteria must be a list'], warnings };

  const seen = new Set();
  for (const entry of card.criteria) {
    if (!entry || typeof entry !== 'object') { errors.push('a criteria entry is not an object'); continue; }
    const rubricCriterion = rubric.criteria.find((c) => c.id === entry.id);
    if (!rubricCriterion) { errors.push('unknown criterion "' + entry.id + '"'); continue; }
    if (seen.has(entry.id)) { errors.push(entry.id + ' is scored twice'); continue; }
    seen.add(entry.id);
    errors.push(...criterionProblems(entry, rubricCriterion, rubric));
  }
  const missing = rubric.criteria.filter((c) => !seen.has(c.id)).map((c) => c.id);
  if (missing.length) errors.push('not scored: ' + missing.join(', '));

  if (card.notesForHumans !== undefined
    && (!Array.isArray(card.notesForHumans) || card.notesForHumans.some((n) => typeof n !== 'string'))) {
    errors.push('notesForHumans must be a list of strings');
  }
  if (card.total !== undefined || card.areas !== undefined) {
    warnings.push('totals in the card are ignored — they are computed from the criteria');
  }
  return { errors, warnings };
}

/** Area subtotals and the grand total, from the criteria alone. Assumes a valid card. */
export function totalsOf(card, rubric) {
  const byId = new Map(card.criteria.map((c) => [c.id, c]));
  const areas = {};
  for (const area of rubric.areas) {
    areas[area.id] = area.criteria.reduce((n, c) => n + (byId.get(c.id)?.points ?? 0), 0);
  }
  return { areas, total: Object.values(areas).reduce((a, b) => a + b, 0) };
}

/**
 * Apply the calibration pass's changes to validated cards.
 *
 *   { "changes": [ { "team": "team-bravo", "id": "C5", "from": 3, "to": 2, "level": "Some",
 *                    "remark": "…", "reason": "same thin harness as team-delta, which got 2" } ] }
 *
 * `from` must equal the card's current points, so a change written against an older card
 * (the judge was re-run afterwards) is refused rather than silently applied to different
 * evidence.
 *
 * @param {Map<string, object>} cards  team → validated card; not modified
 * @returns {{cards: Map<string, object>, applied: object[], errors: string[]}}
 */
export function applyCalibration(cards, calibration, rubric) {
  const out = new Map([...cards].map(([team, card]) => [team, structuredClone(card)]));
  const applied = [];
  const errors = [];
  if (calibration === null || calibration === undefined) return { cards: out, applied, errors };
  if (!Array.isArray(calibration.changes)) {
    return { cards: out, applied, errors: ['calibration.json: changes must be a list'] };
  }
  calibration.changes.forEach((change, i) => {
    const where = 'calibration change ' + (i + 1) + ' (' + (change?.team ?? '?') + ' ' + (change?.id ?? '?') + ')';
    const card = out.get(change?.team);
    if (!card) { errors.push(where + ': no scorecard for that team'); return; }
    const entry = card.criteria.find((c) => c.id === change.id);
    if (!entry) { errors.push(where + ': no such criterion'); return; }
    if (!nonEmpty(change.reason)) { errors.push(where + ': every change needs a reason'); return; }
    if (change.from !== entry.points) {
      errors.push(where + ': says it changes ' + change.from + ' but the card has ' + entry.points
        + ' — the card changed after calibration; re-run calibration');
      return;
    }
    const next = {
      ...entry,
      points: change.to,
      level: change.level ?? entry.level,
      remark: change.remark ?? entry.remark,
      evidence: Array.isArray(change.evidence) ? change.evidence : entry.evidence,
    };
    const rubricCriterion = rubric.criteria.find((c) => c.id === change.id);
    const problems = criterionProblems(next, rubricCriterion, rubric);
    if (problems.length) { errors.push(where + ': ' + problems.join('; ')); return; }
    if (next.points === rubricCriterion.max) next.remark = change.remark ?? null;
    Object.assign(entry, next);
    applied.push({ team: change.team, id: change.id, from: change.from, to: change.to, reason: change.reason });
  });
  return { cards: out, applied, errors };
}
