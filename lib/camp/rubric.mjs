/**
 * rubric.mjs — read an event's evaluation rubric from its markdown.
 *
 * The evaluator takes the rubric as an input so it survives the next event without a fork
 * (kit rule 11). The markdown a facilitator publishes to teams *is* the machine-readable
 * rubric, so what teams read and what the report enforces cannot drift apart. It needs
 * three shapes, all ordinary markdown:
 *
 *   ## A. Client understanding — 15 (D)        an area: letter, title, points
 *   | A1 | 5 | Full marks when … |             a sub-criterion of the area above it
 *   | Full | … | 100% |                        an anchored level and its share of max
 *
 * Anything that does not add up is refused, not repaired: a rubric whose sub-criteria do
 * not sum to their area would let the report publish a total nobody can reproduce.
 */

const AREA = /^##\s+([A-Z])\.\s+(.+?)\s+[—–-]+\s+(\d+)\b/;
const CRITERION = /^\|\s*([A-Z]\d+)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*$/;
const LEVEL = /^\|\s*([A-Z][A-Za-z]+)\s*\|.*\|\s*~?(\d+)\s*%\s*\|\s*$/;

/**
 * @param {string} markdown
 * @returns {{areas: {id: string, title: string, max: number, criteria: object[]}[],
 *            criteria: {id: string, area: string, max: number, text: string}[],
 *            levels: {name: string, share: number}[], total: number}}
 * @throws when the rubric is incomplete or does not add up — every problem, not the first
 */
export function parseRubric(markdown) {
  const areas = [];
  const criteria = [];
  const levels = [];
  const problems = [];
  let current = null;

  for (const line of String(markdown).split(/\r?\n/)) {
    const area = line.match(AREA);
    if (area) {
      current = { id: area[1], title: area[2].trim(), max: Number(area[3]), criteria: [] };
      if (areas.some((a) => a.id === current.id)) problems.push('area ' + current.id + ' appears twice');
      areas.push(current);
      continue;
    }
    // A level-2 heading that is not an area ends the area before it, so a later table
    // (totals, notes) cannot be read as more sub-criteria.
    if (/^##\s/.test(line)) { current = null; continue; }

    const criterion = line.match(CRITERION);
    if (criterion) {
      const [, id, max, text] = criterion;
      if (!current) { problems.push(id + ' is not under an area heading'); continue; }
      if (id[0] !== current.id) problems.push(id + ' sits under area ' + current.id);
      if (criteria.some((c) => c.id === id)) problems.push(id + ' appears twice');
      const entry = { id, area: current.id, max: Number(max), text: text.replace(/\s+/g, ' ') };
      current.criteria.push(entry);
      criteria.push(entry);
      continue;
    }

    const level = line.match(LEVEL);
    if (level && !current) levels.push({ name: level[1], share: Number(level[2]) / 100 });
  }

  if (!areas.length) problems.push('no areas found (expected headings like "## A. Title — 15")');
  for (const a of areas) {
    const sum = a.criteria.reduce((n, c) => n + c.max, 0);
    if (!a.criteria.length) problems.push('area ' + a.id + ' has no sub-criteria');
    else if (sum !== a.max) problems.push('area ' + a.id + ' is worth ' + a.max + ' but its sub-criteria sum to ' + sum);
  }
  if (!levels.length) problems.push('no anchored levels found (expected rows like "| Full | … | 100% |")');
  else {
    if (!levels.some((l) => l.share === 1)) problems.push('no level is worth 100%');
    if (!levels.some((l) => l.share === 0)) problems.push('no level is worth 0%');
  }
  if (problems.length) throw new Error('rubric: ' + problems.join('; '));

  return { areas, criteria, levels, total: areas.reduce((n, a) => n + a.max, 0) };
}
