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
  const areaHead = rubric.areas.map((a) => '<th class="n" title="' + e(a.title) + '">' + e(a.id)
    + '<small>/' + a.max + '</small></th>').join('');
  const body = rows.map((r) => {
    const cells = rubric.areas.map((a) => '<td class="n' + (r.areas[a.id] === a.max ? ' full' : '') + '">'
      + r.areas[a.id] + '</td>').join('');
    const remarks = r.remarks.length
      ? '<ul>' + r.remarks.flatMap((x) => x.items).map((i) => '<li>' + e(i) + '</li>').join('') + '</ul>' : '—';
    const detail = rubric.areas.map((a) => a.criteria.map((c) => {
      const entry = r.card.criteria.find((x) => x.id === c.id);
      return '<tr><td>' + e(c.id) + '</td><td class="n">' + entry.points + '/' + c.max + '</td><td>'
        + e(entry.level) + '</td><td>' + (entry.evidence ?? []).map(e).join('<br>') + '</td><td>'
        + e(entry.remark ?? '') + '</td></tr>';
    }).join('')).join('');
    return '<tr><td class="n">' + r.rank + '</td><td><strong>' + e(r.team) + '</strong></td>' + cells
      + '<td class="n total">' + r.total + '</td><td class="remarks">' + remarks
      + '<details><summary>Evidence per criterion</summary><table class="detail"><tr><th>ID</th><th>Pts</th>'
      + '<th>Level</th><th>Evidence</th><th>Remark</th></tr>' + detail + '</table>'
      + '</details></td></tr>';
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
:root{--bg:#fbfbfa;--fg:#1c1c1a;--muted:#6b6b66;--line:#e2e1dc;--accent:#2f6f4f;--full:#e3f1e8}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#a3a29c;--line:#34332f;--accent:#7cc79e;--full:#1f3328}}
body{background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;margin:0;padding:24px 16px}
main{max-width:1200px;margin:0 auto}h1{margin:0 0 4px}p.meta{color:var(--muted);margin:0 0 20px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}
th{font-size:13px;color:var(--muted);font-weight:600}th small{font-weight:400;margin-left:1px}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.full{background:var(--full)}.total{font-weight:700;color:var(--accent)}
.remarks ul{margin:0;padding-left:18px}.remarks li{margin:2px 0}details{margin-top:6px}summary{cursor:pointer;color:var(--muted);font-size:13px}
table.detail{margin-top:6px;font-size:13px}.notes{font-size:13px;color:var(--muted)}
</style></head><body><main>
<h1>Results</h1>
<p class="meta">Generated ${e(generatedAt)} · ${rows.length} team(s) · ${rubric.total} points: ${rubric.areas.map((a) => e(a.id + ' ' + a.title + ' ' + a.max)).join(' · ')}</p>
<div class="wrap"><table><thead><tr><th class="n">Rank</th><th>Team</th>${areaHead}<th class="n">Total<small>/${rubric.total}</small></th><th>Remarks</th></tr></thead>
<tbody>
${body}
</tbody></table></div>
${extra}
${calibration}
</main></body></html>
`;
}
