/**
 * review.mjs — the facilitators' side-by-side page for checking the judges.
 *
 * results.html is the table anyone may see. This page is the working view behind it: every
 * sub-criterion as a row and every team as a column (the top five shown, any other team a
 * checkbox away), with what each judge awarded, the evidence it cited, what it said was
 * missing, and links straight to the files it read — so a human can check a judgement
 * against its source in one click.
 *
 * It also carries what results.html deliberately does not: the judges' notes for humans and
 * the injection scan's notes. Those decide nothing (kit rule 9) and are for the people
 * reviewing the top places only, so this page is not for sharing.
 */
import { join } from 'node:path';
import { escapeHtml as e } from '../integrity/injection.mjs';
import { REHEARSAL_TEXT } from './report.mjs';

const fileUrl = (path) => 'file://' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F');

/** Links to what the judge read for one team, from the paths prepare recorded. */
function linksOf(team, facts, evalDir) {
  const repo = facts?.repo?.path;
  const links = [];
  if (facts?.submission?.deck?.copiedTo) links.push(['Deck', join(evalDir, team, facts.submission.deck.copiedTo)]);
  if (facts?.submission?.diagram?.copiedTo) links.push(['Diagram', join(evalDir, team, facts.submission.diagram.copiedTo)]);
  if (repo) {
    links.push(['Repository', repo]);
    if (facts.repoFacts?.readme?.present) links.push(['README', join(repo, 'README.md')]);
    for (const f of (facts.harness?.instructionFiles ?? []).slice(0, 2)) links.push([f, join(repo, f)]);
    const agentDir = (facts.harness?.agentDefinitions ?? [])[0]?.split('/').slice(0, -1).join('/');
    if (agentDir) links.push(['Agents', join(repo, agentDir)]);
  }
  links.push(['Facts', join(evalDir, team, 'facts.json')], ['Scorecard', join(evalDir, team, 'score.json')]);
  return links;
}

/** One line of the facts a reviewer checks first. */
function factsLine(facts) {
  if (!facts) return '';
  const s = facts.submission ?? {};
  const d = s.deck ?? {};
  const parts = [
    'deck ' + d.status + (d.pages ? ', ' + d.pages + ' pages' : '') + (d.megabytes ? ', ' + d.megabytes + ' MB' : ''),
    'diagram image ' + (s.diagram?.status ?? '—'),
    (facts.history?.members ?? 0) + ' history file(s) / ' + (facts.git?.authors ?? '?') + ' git author(s)',
    (facts.history?.totals?.prompts ?? 0) + ' prompts',
    (facts.repoFacts?.testFiles ?? 0) + ' test file(s)',
    (facts.repoFacts?.secretFindingsTotal ?? 0) + ' secret finding(s)',
  ];
  return parts.join(' · ');
}

/**
 * @param {object[]} rows  from rankTeams, best first
 * @param {object} rubric
 * @param {{evalDir: string, facts: Map<string, object>, calls?: object[], applied?: object[],
 *          excluded?: string[], generatedAt?: string, show?: number}} options
 */
export function toReviewHtml(rows, rubric, options) {
  const { evalDir, facts, calls = [], applied = [], excluded = [], generatedAt = new Date().toISOString(), show = 5, estimates = null, rehearsal = false } = options;
  // By rank, so every team tied at the last shown place is shown.
  const shown = (i) => rows[i].rank <= show || rows.length <= show + 1;

  const summary = rows.map((r, i) => '<tr data-t="' + i + '"><td class="n">' + r.rank + '</td>'
    + '<td><label><input type="checkbox" data-pick="' + i + '"' + (shown(i) ? ' checked' : '') + '> <b>' + e(r.team) + '</b></label></td>'
    + rubric.areas.map((a) => '<td class="n' + (r.areas[a.id] === a.max ? ' full' : '') + '">' + r.areas[a.id] + '</td>').join('')
    + '<td class="n total">' + r.total + '</td></tr>').join('');

  const teamHead = rows.map((r, i) => {
    const f = facts.get(r.team);
    const notes = [
      ...(r.card.notesForHumans ?? []),
      ...(r.humanNotes?.strong ?? []).map((n) => 'Scan: ' + n.label + ' at ' + n.file + ':' + n.line + (n.text ? ' — “' + n.text + '”' : '')),
    ];
    return '<th class="team" data-t="' + i + '"><div class="tname">' + r.rank + '. ' + e(r.team) + ' <span class="total">' + r.total + '</span></div>'
      + '<div class="links">' + linksOf(r.team, f, evalDir).map(([l, p]) => '<a href="' + e(fileUrl(p)) + '">' + e(l) + '</a>').join(' · ') + '</div>'
      + '<div class="facts">' + e(factsLine(f)) + '</div>'
      + (notes.length ? '<div class="notes"><b>For the human review — no points affected:</b><ul>' + notes.map((n) => '<li>' + e(n) + '</li>').join('') + '</ul></div>' : '')
      + '</th>';
  }).join('');

  const cell = (r, i, c) => {
    const x = r.card.criteria.find((k) => k.id === c.id);
    const cls = x.points === c.max ? 'full' : x.points === 0 ? 'zero' : 'part';
    return '<td class="' + cls + '" data-t="' + i + '"><div class="pts">' + x.points + '<small>/' + c.max + '</small> <span class="lvl">' + e(x.level) + '</span></div>'
      + (x.remark ? '<div class="remark">' + e(x.remark) + '</div>' : '')
      + ((x.evidence ?? []).length ? '<details><summary>evidence</summary><ul>' + x.evidence.map((v) => '<li>' + e(v) + '</li>').join('') + '</ul></details>' : '')
      + '</td>';
  };
  const matrix = rubric.areas.map((a) => '<tr class="area"><th>' + e(a.id + '. ' + a.title) + ' <small>/' + a.max + '</small></th>'
    + rows.map((r, i) => '<td class="n" data-t="' + i + '"><b>' + r.areas[a.id] + '</b>/' + a.max + '</td>').join('') + '</tr>'
    + a.criteria.map((c) => '<tr><th class="crit"><b>' + e(c.id) + '</b> <small>(' + c.max + ')</small><p>' + e(c.text) + '</p></th>'
      + rows.map((r, i) => cell(r, i, c)).join('') + '</tr>').join('')).join('');

  const num = (v, unit = '') => (typeof v === 'number' ? v.toLocaleString('en-US') + unit : '—');
  const pct = (v) => (typeof v === 'number' ? Math.round(v * 100) + '%' : '—');
  const estimateTable = estimates && estimates.teams.length
    ? '<h2>Estimates side by side</h2><p class="meta">As each judge read them from the deck. Median: '
      + num(estimates.median.personDays, ' PD') + ' · ' + num(estimates.median.weeks, ' weeks') + ' · EUR ' + num(estimates.median.priceEUR)
      + '. Far below peers is flagged, never rewarded; between realistic offers, faster and cheaper is better value.</p>'
      + '<div class="wrap"><table class="sum"><thead><tr><th class="n">#</th><th>Team</th><th class="n">Person-days</th><th class="n">vs median</th>'
      + '<th class="n">Weeks</th><th class="n">FTE</th><th class="n">Price EUR</th><th class="n">vs median</th><th class="n">3rd party EUR</th>'
      + '<th>Adds up</th><th>Judge</th><th>Flags</th></tr></thead><tbody>'
      + estimates.teams.map((t) => {
        const x = t.estimate ?? {};
        return '<tr><td class="n">' + t.rank + '</td><td><b>' + e(t.team) + '</b>' + (x.note ? '<div class="facts">' + e(x.note) + '</div>' : '') + '</td>'
          + '<td class="n">' + num(x.personDays) + '</td><td class="n">' + pct(t.vsMedian.personDays) + '</td>'
          + '<td class="n">' + num(x.weeks) + '</td><td class="n">' + num(x.fte) + '</td>'
          + '<td class="n">' + num(x.priceEUR) + '</td><td class="n">' + pct(t.vsMedian.priceEUR) + '</td><td class="n">' + num(x.thirdPartyEUR) + '</td>'
          + '<td>' + (x.realism === 'not-stated' ? '—' : x.consistent === true ? 'yes' : x.consistent === false ? '<b>no</b>' : '—') + '</td>'
          + '<td>' + e(x.realism ?? '—') + '</td><td>' + (t.flags.length ? '<b>' + t.flags.map(e).join('; ') + '</b>' : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
    : '';

  const lists = [
    rehearsal ? '<div class="box warn"><b>' + e(REHEARSAL_TEXT) + '</b></div>' : '',
    calls.length ? '<div class="box warn"><b>Close calls — decide by hand.</b> Within the judges\' run-to-run variation:<ul>'
      + calls.map((c) => '<li>' + e(c.a + ' (' + c.aTotal + ') vs ' + c.b + ' (' + c.bTotal + ')') + '</li>').join('') + '</ul></div>' : '',
    excluded.length ? '<div class="box"><b>Not scored:</b> ' + excluded.map(e).join(', ') + '</div>' : '',
    applied.length ? '<div class="box"><b>Calibration changes</b><ul>' + applied.map((c) => '<li>' + e(c.team + ' ' + c.id + ': ' + c.from + ' → ' + c.to + ' — ' + c.reason) + '</li>').join('') + '</ul></div>' : '',
  ].join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scoring Review</title>
<style>
:root{--bg:#fbfbfa;--fg:#1c1c1a;--muted:#6b6b66;--line:#e2e1dc;--head:#f1f0ec;--full:#e6f2ea;--part:#fdf4e3;--zero:#fbe9e7;--accent:#2f6f4f;--warn:#fff4d6}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#a3a29c;--line:#34332f;--head:#201f1d;--full:#1d3226;--part:#3a3120;--zero:#3c2221;--accent:#7cc79e;--warn:#3a3218}}
*{box-sizing:border-box}body{margin:0;padding:20px 16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{margin:0 0 4px;font-size:22px}h2{font-size:18px;margin:20px 0 4px}p.meta{color:var(--muted);margin:0 0 14px}a{color:var(--accent)}
.box{border:1px solid var(--line);border-radius:6px;padding:8px 12px;margin:0 0 12px}.box ul{margin:4px 0 0;padding-left:18px}.warn{background:var(--warn)}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}button{font:inherit;padding:4px 10px;border:1px solid var(--line);border-radius:5px;background:var(--head);color:var(--fg);cursor:pointer}
.wrap{overflow-x:auto;max-width:100%}table{border-collapse:collapse}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
table.sum th{font-size:12px;color:var(--muted)}table.sum{margin-bottom:16px}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.total{color:var(--accent);font-weight:700}
table.m{table-layout:fixed}table.m thead th{position:sticky;top:0;background:var(--bg);z-index:1}
th.crit,table.m tr.area th,table.m thead th:first-child{width:260px;min-width:260px;font-weight:400}th.crit p{margin:3px 0 0;color:var(--muted);font-size:12px}
th.team,td[data-t]{width:300px;min-width:300px}th.team{font-weight:400}.tname{font-size:16px;font-weight:600}.links{margin:3px 0;font-size:12.5px}.facts{color:var(--muted);font-size:12px}
.notes{margin-top:6px;font-size:12px;background:var(--warn);border-radius:4px;padding:4px 6px}.notes ul{margin:2px 0 0;padding-left:16px}
tr.area th,tr.area td{background:var(--head);font-size:14px}.pts{font-size:17px;font-weight:600}.lvl{font-size:12px;font-weight:400;color:var(--muted)}
.remark{margin:3px 0;font-weight:600;font-size:13px}details{font-size:12.5px}summary{cursor:pointer;color:var(--muted)}details ul{margin:3px 0 0;padding-left:16px}
td.full{background:var(--full)}td.part{background:var(--part)}td.zero{background:var(--zero)}.full.n{background:var(--full)}
.off{display:none}
</style></head><body>
<h1>Scoring review</h1>
<p class="meta">Facilitators only — contains notes for the human review. Generated ${e(generatedAt)} · ${rows.length} team(s) · green full marks, amber partial, red zero. Links open the files the judge read.</p>
${lists}
<div class="wrap"><table class="sum"><thead><tr><th class="n">#</th><th>Team (tick to compare)</th>${rubric.areas.map((a) => '<th class="n">' + e(a.title) + ' <small>/' + a.max + '</small></th>').join('')}<th class="n">Total</th></tr></thead><tbody>${summary}</tbody></table></div>
${estimateTable}
<div class="bar"><button data-set="top">Top 5</button><button data-set="all">All teams</button><button data-set="none">None</button><button id="ev">Open all evidence</button></div>
<div class="wrap"><table class="m"><thead><tr><th>Criterion — full marks when…</th>${teamHead}</tr></thead><tbody>${matrix}</tbody></table></div>
<script>
(function () {
  var boxes = Array.prototype.slice.call(document.querySelectorAll('input[data-pick]'));
  var ranks = ${JSON.stringify(rows.map((r) => r.rank))};
  function apply() {
    boxes.forEach(function (b) {
      var i = b.getAttribute('data-pick');
      document.querySelectorAll('table.m [data-t="' + i + '"]').forEach(function (el) { el.classList.toggle('off', !b.checked); });
    });
  }
  boxes.forEach(function (b) { b.addEventListener('change', apply); });
  document.querySelectorAll('button[data-set]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var mode = btn.getAttribute('data-set');
      boxes.forEach(function (b, i) { b.checked = mode === 'all' || (mode === 'top' && ranks[i] <= ${show}); });
      apply();
    });
  });
  var open = false;
  document.getElementById('ev').addEventListener('click', function () {
    open = !open;
    document.querySelectorAll('table.m details').forEach(function (d) { d.open = open; });
    this.textContent = open ? 'Close all evidence' : 'Open all evidence';
  });
  apply();
})();
</script>
</body></html>
`;
}
