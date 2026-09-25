/**
 * report.mjs — rank validated scorecards and render them three ways.
 *
 * The table is fixed: Rank · Team · one column per rubric area · Total · Remarks. Remarks
 * list, per area not at max, each shortfall's one-line remark from the card, so a team's
 * row says why it is not higher without anyone opening a file.
 *
 * These three files can be shown to anyone. Notes for humans — the judge's own
 * `notesForHumans` and the injection scan's notes — are not in them at all: they live in
 * review.html (see review.mjs), which is for the facilitators' top-five review only, and
 * move nothing (kit rule 9).
 */
import { escapeHtml } from '../integrity/injection.mjs';
import { totalsOf } from './scorecard.mjs';

/**
 * @param {{team: string, card: object, humanNotes?: object}[]} teams  validated, calibrated
 * @returns {object[]} rows, best first; equal totals share a rank
 */
export function rankTeams(teams, rubric) {
  const rows = teams.map(({ team, card, humanNotes }) => {
    const { areas, total } = totalsOf(card, rubric);
    const byId = new Map(card.criteria.map((c) => [c.id, c]));
    const remarks = rubric.areas
      .filter((a) => areas[a.id] < a.max)
      .map((a) => ({
        area: a.id,
        items: a.criteria
          .filter((c) => (byId.get(c.id)?.points ?? 0) < c.max)
          .map((c) => c.id + ' ' + String(byId.get(c.id)?.remark ?? '').trim()),
      }));
    return { team, areas, total, remarks, card, humanNotes: humanNotes ?? null };
  });
  rows.sort((a, b) => b.total - a.total || a.team.localeCompare(b.team));
  rows.forEach((row, i) => {
    row.rank = i > 0 && rows[i - 1].total === row.total ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

/**
 * Neighbouring places near the top whose totals are within `margin` points. In rehearsal
 * the same team's total moved by 1–3 points between two runs of the judges, so a gap that
 * small is not evidence that one team is better: humans decide those by the remarks.
 */
export function closeCalls(rows, { top = 5, margin = 3 } = {}) {
  const calls = [];
  // By rank, not position: five teams tied at 5th are all "in the top five".
  for (let i = 0; i + 1 < rows.length && rows[i].rank <= top; i++) {
    const gap = rows[i].total - rows[i + 1].total;
    if (gap <= margin) calls.push({ a: rows[i].team, b: rows[i + 1].team, aTotal: rows[i].total, bTotal: rows[i + 1].total, gap });
  }
  return calls;
}

const median = (values) => {
  const v = values.filter((x) => typeof x === 'number' && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

/**
 * Every team's estimate against the others. A judge sees one team, so "is twelve months
 * too long?" can only be answered here. Nothing is scored from this: an estimate far below
 * its peers is flagged for humans as possibly implausible (never rewarded), one far above
 * as possibly padded, and the final round weighs value for money among the realistic ones.
 */
export function compareEstimates(rows, { low = 0.5, high = 2 } = {}) {
  const withEstimate = rows.filter((r) => r.card.estimate);
  const med = {
    personDays: median(withEstimate.map((r) => r.card.estimate.personDays)),
    weeks: median(withEstimate.map((r) => r.card.estimate.weeks)),
    priceEUR: median(withEstimate.map((r) => r.card.estimate.priceEUR)),
  };
  const ratio = (v, m) => (typeof v === 'number' && v > 0 && m ? Math.round((v / m) * 100) / 100 : null);
  return {
    median: med,
    teams: rows.map((r) => {
      const e = r.card.estimate ?? null;
      const pd = ratio(e?.personDays, med.personDays);
      const price = ratio(e?.priceEUR, med.priceEUR);
      const flags = [];
      if (!e || e.realism === 'not-stated') flags.push('no estimate stated');
      if (e?.consistent === false) flags.push('does not add up with its own plan');
      if ((pd !== null && pd < low) || (price !== null && price < low)) flags.push('far below peers — check it is realistic');
      if ((pd !== null && pd > high) || (price !== null && price > high)) flags.push('far above peers — padded?');
      if (e?.realism === 'implausibly-low' || e?.realism === 'padded') flags.push('judge: ' + e.realism);
      return { team: r.team, rank: r.rank, estimate: e, vsMedian: { personDays: pd, priceEUR: price }, flags };
    }),
  };
}

const closeCallText = (c) => c.a + ' (' + c.aTotal + ') vs ' + c.b + ' (' + c.bTotal + ')'
  + (c.gap ? ' — ' + c.gap + ' point' + (c.gap === 1 ? '' : 's') + ' apart' : ' — tied');

const remarkText = (row) => row.remarks.map((r) => r.items.join('; ')).join(' · ');

// Team text is escaped for Markdown renderers too: a remark quoting `</table>` must not
// end the table it sits in.
const mdCell = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

export function toMarkdown(rows, rubric, { applied = [], generatedAt = new Date().toISOString(), excluded = [], calls = [] } = {}) {
  const head = ['Rank', 'Team', ...rubric.areas.map((a) => a.id + ' /' + a.max), 'Total /' + rubric.total, 'Remarks'];
  const out = [
    '# Results',
    '',
    'Generated ' + generatedAt + '. Areas: '
      + rubric.areas.map((a) => a.id + ' ' + a.title + ' (' + a.max + ')').join(', ') + '.',
    '',
    '| ' + head.join(' | ') + ' |',
    '| ' + head.map((h, i) => (i === 1 || i === head.length - 1 ? '---' : '---:')).join(' | ') + ' |',
    ...rows.map((r) => '| ' + [r.rank, mdCell(r.team), ...rubric.areas.map((a) => r.areas[a.id]), r.total,
      mdCell(remarkText(r) || '—')].join(' | ') + ' |'),
  ];
  if (excluded.length) out.push('', '**Not scored:** ' + excluded.map(mdCell).join(', ') + ' — excluded from this table by the facilitators.');
  if (calls.length) {
    out.push('', '## Close calls — decide by hand', '',
      'Totals this close are within the judges\' run-to-run variation; compare the remarks.', '');
    for (const c of calls) out.push('- ' + mdCell(closeCallText(c)));
  }
  if (applied.length) {
    out.push('', '## Calibration changes', '');
    for (const c of applied) out.push('- ' + c.team + ' ' + c.id + ': ' + c.from + ' → ' + c.to + ' — ' + mdCell(c.reason));
  }
  return out.join('\n') + '\n';
}

const csvCell = (s) => {
  const text = String(s);
  // A leading =, +, - or @ is a formula to a spreadsheet; a team name is not.
  const safe = /^[=+\-@]/.test(text) ? "'" + text : text;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
};

export function toCsv(rows, rubric, { excluded = [] } = {}) {
  const lines = [['Rank', 'Team', ...rubric.areas.map((a) => a.id), 'Total', 'Remarks']];
  for (const r of rows) lines.push([r.rank, r.team, ...rubric.areas.map((a) => r.areas[a.id]), r.total, remarkText(r)]);
  for (const team of excluded) lines.push(['', team, ...rubric.areas.map(() => ''), '', 'not scored']);
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function toHtml(rows, rubric, { applied = [], generatedAt = new Date().toISOString(), excluded = [], calls = [] } = {}) {
  const e = escapeHtml;
  // The scoreboard is the top of the page on purpose: a screenshot of it is what teams are
  // shown, so the areas carry their full names, never letters.
  const areaHead = rubric.areas.map((a) => '<th class="n area">' + e(a.title) + '<small>of ' + a.max + '</small></th>').join('');
  const board = rows.map((r) => '<tr><td class="n rank">' + r.rank + '</td><td class="team">' + e(r.team) + '</td>'
    + rubric.areas.map((a) => '<td class="n' + (r.areas[a.id] === a.max ? ' full' : '') + '">' + r.areas[a.id] + '</td>').join('')
    + '<td class="n total">' + r.total + '</td></tr>').join('\n');
  const details = rows.map((r) => {
    const byArea = r.remarks.length
      ? '<ul>' + r.remarks.map((x) => '<li><b>' + e(rubric.areas.find((a) => a.id === x.area)?.title ?? x.area) + ':</b> '
        + x.items.map((i) => e(i.replace(/^[A-Z]\d+ /, ''))).join('; ') + '</li>').join('') + '</ul>'
      : '<p>Full marks in every area.</p>';
    const detail = rubric.areas.map((a) => a.criteria.map((c) => {
      const entry = r.card.criteria.find((x) => x.id === c.id);
      return '<tr><td>' + e(c.id) + '</td><td class="n">' + entry.points + '/' + c.max + '</td><td>'
        + e(entry.level) + '</td><td>' + (entry.evidence ?? []).map(e).join('<br>') + '</td><td>'
        + e(entry.remark ?? '') + '</td></tr>';
    }).join('')).join('');
    return '<section class="teamblock"><h3>' + r.rank + '. ' + e(r.team) + ' <span class="total">' + r.total + '/' + rubric.total + '</span></h3>'
      + byArea + '<details><summary>Every criterion, with the evidence</summary><table class="detail"><tr><th>ID</th><th>Points</th>'
      + '<th>Level</th><th>Evidence</th><th>What was missing</th></tr>' + detail + '</table></details></section>';
  }).join('\n');
  const extra = (excluded.length ? '<p><strong>Not scored:</strong> ' + excluded.map(e).join(', ') + '</p>' : '')
    + (calls.length ? '<h2>Close calls — decide by hand</h2><p class="meta">Totals this close are within the judges\' run-to-run variation; compare the remarks.</p><ul>'
      + calls.map((c) => '<li>' + e(closeCallText(c)) + '</li>').join('') + '</ul>' : '');
  const calibration = applied.length
    ? '<h2>Calibration changes</h2><ul>' + applied.map((c) => '<li>' + e(c.team + ' ' + c.id + ': ' + c.from
      + ' → ' + c.to + ' — ' + c.reason) + '</li>').join('') + '</ul>' : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Camp Results</title>
<style>
:root{--bg:#fbfbfa;--fg:#1c1c1a;--muted:#6b6b66;--line:#e2e1dc;--accent:#2f6f4f;--full:#e3f1e8;--head:#f1f0ec}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#a3a29c;--line:#34332f;--accent:#7cc79e;--full:#1f3328;--head:#201f1d}}
body{background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;margin:0;padding:24px 16px}
main{max-width:1280px;margin:0 auto}h1{margin:0 0 4px}p.meta{color:var(--muted);margin:0 0 18px}h2{margin:32px 0 8px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:8px 8px;text-align:left;vertical-align:top}
table.board th{font-size:13px;color:var(--muted);font-weight:600;background:var(--head);vertical-align:bottom}
table.board th.area{width:13%;line-height:1.25}th small{display:block;font-weight:400}
table.board td{font-size:17px}td.rank{color:var(--muted)}td.team{font-weight:600}
.n{text-align:right;font-variant-numeric:tabular-nums}.full{background:var(--full)}.total{font-weight:700;color:var(--accent)}
.teamblock{border-top:1px solid var(--line);padding:6px 0 10px}.teamblock h3{margin:10px 0 4px;font-size:17px}.teamblock ul{margin:4px 0;padding-left:20px}
details{margin-top:6px}summary{cursor:pointer;color:var(--muted);font-size:13px}table.detail{margin-top:6px;font-size:13px}
</style></head><body><main>
<h1>Results</h1>
<p class="meta">${rows.length} team(s) · ${rubric.total} points · generated ${e(generatedAt.slice(0, 16).replace('T', ' '))} UTC</p>
<div class="wrap"><table class="board"><thead><tr><th class="n">Rank</th><th>Team</th>${areaHead}<th class="n">Total<small>of ${rubric.total}</small></th></tr></thead>
<tbody>
${board}
</tbody></table></div>
<h2>Where each team lost points</h2>
${details}
${extra}
${calibration}
</main></body></html>
`;
}

