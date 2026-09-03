/**
 * badges.mjs — the achievement catalogue.
 *
 * Badges are **tiebreakers, not points**. Keeping the scale exactly 100 makes it readable,
 * and the behaviours worth celebrating here are not all worth arithmetic — "caught the AI
 * being wrong" is the best thing that can happen to a team all day, and it is not a
 * number.
 *
 * Some badges are derived from the evidence, so they cost a facilitator nothing and cannot be
 * argued with. The rest are awarded by a facilitator in `facilitator-scorecard.json`, because they
 * reward things no script can see.
 */

export const BADGES = [
  {
    id: 'harness-first',
    emoji: '🧭',
    label: 'Harness First',
    description: 'Wrote the instruction layer before the bulk of the code.',
    auto: (score) => criterion(score, 'context-and-harness', 'harness-preceded-code')?.status === 'pass',
  },
  {
    id: 'tight-loop',
    emoji: '🔁',
    label: 'Tight Loop',
    description: 'Drove failing tests back to green at least three times.',
    auto: (score, evidence) => (evidence?.chat?.totals?.failThenPassSequences ?? 0) >= 3,
  },
  {
    id: 'zero-secrets',
    emoji: '🔒',
    label: 'Clean Hands',
    description: 'No secrets committed, environment files handled properly.',
    auto: (score) => {
      const dim = score.dimensions.find((d) => d.id === 'safety-and-boundaries');
      return dim?.status === 'assessed' && dim.earned === dim.available;
    },
  },
  {
    id: 'green-at-the-buzzer',
    emoji: '✅',
    label: 'Green at the Buzzer',
    description: 'Finished with a test suite that runs and passes.',
    auto: (score) => criterion(score, 'verification-loop', 'suite-runs-green')?.status === 'pass',
  },
  {
    id: 'read-the-output',
    emoji: '👀',
    label: 'Read the Output',
    description: 'Redirected the agent repeatedly instead of accepting what it produced.',
    auto: (score, evidence) => (evidence?.chat?.totals?.corrections ?? 0) >= 5,
  },
  {
    id: 'kept-a-journal',
    emoji: '📓',
    label: 'Kept a Journal',
    description: 'Wrote substantive session notes, not stubs.',
    auto: (score, evidence) => (evidence?.journalEvidence?.substantiveEntries ?? 0) >= 3,
  },

  // --- facilitator-awarded: things no script can see -----------------------------------------
  {
    id: 'caught-the-ai-being-wrong',
    emoji: '🎯',
    label: 'Caught It Lying',
    description: 'Found the agent confidently wrong, and proved it.',
    facilitatorAwarded: true,
  },
  {
    id: 'responsible-disclosure',
    emoji: '🛡️',
    label: 'Responsible Disclosure',
    description: 'Found a way through the scorer and reported it instead of using it.',
    facilitatorAwarded: true,
  },
  {
    id: 'useful-skill',
    emoji: '🔧',
    label: 'Built Something Reusable',
    description: 'Wrote a skill or check a facilitator judged genuinely useful beyond this repo.',
    facilitatorAwarded: true,
  },
  {
    id: 'best-question',
    emoji: '💡',
    label: 'Best Question',
    description: 'Asked the question that changed how the room was thinking.',
    facilitatorAwarded: true,
  },
];

function criterion(score, dimensionId, criterionId) {
  return score?.dimensions
    ?.find((d) => d.id === dimensionId)
    ?.criteria?.find((c) => c.id === criterionId);
}

const BY_ID = new Map(BADGES.map((b) => [b.id, b]));

/**
 * Earned badges: those the evidence proves, plus those a facilitator awarded.
 *
 * Badges used to be stripped from a team the injection scan had flagged. Nothing strips
 * them now — the scan produces notes for a human, and a note is not a finding of guilt.
 */
export function deriveBadges(score, evidence) {
  const earned = new Map();
  for (const badge of BADGES) {
    if (typeof badge.auto !== 'function') continue;
    let hit = false;
    try { hit = Boolean(badge.auto(score, evidence)); } catch { hit = false; }
    if (hit) earned.set(badge.id, { ...describe(badge.id), source: 'evidence' });
  }
  // A hand-edited facilitator-scorecard.json can put anything in `badges`. Iterating a number
  // threw, and because nothing wraps the per-bundle loop that took down the entire
  // leaderboard rather than one row.
  const awarded = Array.isArray(score?.badges) ? score.badges : [];
  for (const id of awarded) {
    if (typeof id !== 'string') continue;
    earned.set(id, { ...describe(id), source: 'facilitator' });
  }
  return [...earned.values()];
}

/** Look up a badge, tolerating an id a facilitator invented on the spot. */
export function describe(id) {
  const known = BY_ID.get(id);
  if (known) {
    return { id, emoji: known.emoji, label: known.label, description: known.description };
  }
  return {
    id,
    emoji: '⭐',
    label: String(id).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    description: 'Awarded by a facilitator.',
  };
}
