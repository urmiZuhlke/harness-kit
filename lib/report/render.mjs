/**
 * render.mjs — turn score.json into a single self-contained HTML page.
 *
 * Three rules shape this file:
 *
 *   1. **No network.** Camp wifi must not be a dependency on the one moment the day
 *      builds to, so all CSS and JS are inline and there are no external references.
 *   2. **The explanation is the product.** The counter is theatre; what a team takes home
 *      is knowing what was measured and what to do about it. Every criterion is shown —
 *      passed, partial and failed alike — with the same three lines: what was looked for,
 *      what was found, what to do next. An earlier version listed only the deductions,
 *      which left a team unable to see what the rubric even contained, and made a good
 *      score read as a list of complaints.
 *   3. **Everything is escaped at the template.** Values here originate in a team's own
 *      repo. Upstream already defangs invisible characters; this layer escapes again
 *      rather than trusting it.
 *   4. **Nothing here accuses anyone.** Injection-scan notes are not rendered at all —
 *      they reach a coach through the CLI. See rule 9 in AGENTS.md.
 */
import { escapeHtml } from '../integrity/injection.mjs';
import { deriveBadges } from './badges.mjs';

const e = escapeHtml;

/** Inline stylesheet. Light and dark, no external font. */
const STYLES = `
:root {
  --bg: #f6f7f9; --panel: #ffffff; --ink: #14171a; --muted: #5c6670;
  --line: #dfe3e8; --accent: #2f6f4f; --accent-soft: #e4f0e9;
  --warn: #8a6d1f; --bad: #a32b2b; --bad-soft: #fbeaea; --good: #2f6f4f;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1216; --panel: #171b21; --ink: #e8ebee; --muted: #98a2ac;
    --line: #2a313a; --accent: #6fd39b; --accent-soft: #172b21;
    --warn: #e0bd63; --bad: #ff8a8a; --bad-soft: #2a1618; --good: #6fd39b;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1.25rem 4rem; background: var(--bg); color: var(--ink);
  font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.wrap { max-width: 62rem; margin: 0 auto; }
h1 { font-size: 1.35rem; margin: 0 0 .25rem; font-weight: 650; }
.sub { color: var(--muted); font-size: .9rem; margin: 0 0 2rem; }
.scoreboard { text-align: center; padding: 2.5rem 1rem 2rem; }
.counter {
  font-size: clamp(4.5rem, 18vw, 9rem); font-weight: 800; line-height: 1;
  font-variant-numeric: tabular-nums; letter-spacing: -.03em; color: var(--accent);
}
.outof { color: var(--muted); font-size: 1rem; margin-top: .35rem; }
.panel {
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 1.25rem 1.4rem; margin-bottom: 1.25rem;
}
h2 { font-size: .95rem; text-transform: uppercase; letter-spacing: .07em;
     color: var(--muted); margin: 0 0 1rem; font-weight: 650; }
.dim { display: grid; grid-template-columns: minmax(9rem, 14rem) 1fr auto;
       gap: .85rem; align-items: center; padding: .5rem 0; }
.dim + .dim { border-top: 1px solid var(--line); }
.dim-name { font-weight: 600; }
.dim-by { display: block; font-weight: 400; font-size: .78rem; color: var(--muted); }
.track { background: var(--line); border-radius: 999px; height: .55rem; overflow: hidden; }
.fill { height: 100%; width: 0; background: var(--accent); border-radius: 999px;
        transition: width 1.1s cubic-bezier(.2,.8,.2,1); }
.no-js .fill { transition: none; }
.dim-score { font-variant-numeric: tabular-nums; font-weight: 650; min-width: 4.5rem;
             text-align: right; }
.unassessed .fill { background: repeating-linear-gradient(45deg,
  var(--line), var(--line) 6px, transparent 6px, transparent 12px); width: 100% !important; }
.unassessed .dim-score { color: var(--muted); font-weight: 500; }
.loss { border-left: 3px solid var(--warn); padding: .1rem 0 .1rem .9rem; margin: 1.1rem 0; }
.loss-head { font-weight: 650; }
.loss-cost { color: var(--bad); font-variant-numeric: tabular-nums; }
.loss-why { margin: .3rem 0 .25rem; }
.ev, .ev-inline { color: var(--muted); font-size: .85rem; font-family: ui-monospace,
           SFMono-Regular, Menlo, Consolas, monospace; word-break: break-word; }
.win { margin-bottom: .8rem; }
.win-head { font-weight: 650; }
.win-pts { color: var(--good); font-variant-numeric: tabular-nums; }
.dim-group { margin-bottom: 1.8rem; }
.dim-group h3 { font-size: 1rem; margin-bottom: .6rem; padding-bottom: .35rem;
                border-bottom: 1px solid var(--line); }
.dim-group h3 .note { font-weight: 400; }
.crit { border-left: 3px solid var(--line); padding: .1rem 0 .1rem .8rem;
        margin-bottom: 1rem; }
.crit-pass { border-left-color: var(--good); }
.crit-partial { border-left-color: var(--warn); }
.crit-fail { border-left-color: var(--bad); }
.crit-head { display: flex; flex-wrap: wrap; gap: .5rem; align-items: baseline;
             justify-content: space-between; }
.crit-name { font-weight: 650; }
.crit-pts { font-variant-numeric: tabular-nums; white-space: nowrap; }
.crit-line { margin: .35rem 0; font-size: .92rem; }
.crit-tag { display: block; font-size: .7rem; text-transform: uppercase;
            letter-spacing: .06em; color: var(--muted); font-weight: 600; }
.badges { display: flex; flex-wrap: wrap; gap: .6rem; }
.badge { background: var(--accent-soft); border: 1px solid var(--line); border-radius: 999px;
         padding: .35rem .8rem; font-size: .88rem; }
.badge .b-em { margin-right: .35rem; }
.badge .b-desc { color: var(--muted); }
.note { color: var(--muted); font-size: .85rem; }
table { border-collapse: collapse; width: 100%; font-size: .92rem; }
th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; font-size: .8rem; text-transform: uppercase;
     letter-spacing: .05em; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.scroll { overflow-x: auto; }
`;

/**
 * Count-up script. Written so the page is fully readable without it: every number is in
 * the markup already, and the script only animates towards it.
 */
const SCRIPT = `
document.documentElement.classList.remove('no-js');
(function () {
  var el = document.querySelector('[data-count-to]');
  if (!el) return;
  var target = Number(el.getAttribute('data-count-to'));
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var bars = function () {
    document.querySelectorAll('.fill[data-width]').forEach(function (b) {
      b.style.width = b.getAttribute('data-width') + '%';
    });
  };
  if (reduce) { el.textContent = target; bars(); return; }

  var start = null, DURATION = 1600;
  function frame(now) {
    if (start === null) start = now;
    var t = Math.min(1, (now - start) / DURATION);
    var eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased);
    if (t < 1) { requestAnimationFrame(frame); return; }
    el.textContent = target;
    bars();
  }
  requestAnimationFrame(frame);
})();
`;

/** An emoji favicon as an inline SVG, percent-encoded so the data URI is conforming. */
function faviconHref(emoji) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">`
    + `<text y="14" font-size="14">${emoji}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function page({ title, favicon, body }) {
  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<link rel="icon" href="${faviconHref(favicon)}">
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

function dimensionRows(score) {
  return score.dimensions.map((d) => {
    if (d.status === 'not-harvested') {
      const why = d.criteria.find((c) => c.lostBecause)?.lostBecause ?? d.measuredBy;
      return `<div class="dim unassessed">
  <div class="dim-name">${e(d.label)}<span class="dim-by">${e(why)}</span></div>
  <div class="track"><div class="fill"></div></div>
  <div class="dim-score">not scored</div>
</div>`;
    }
    const pct = d.available ? Math.round((d.earned / d.available) * 100) : 0;
    const partial = d.status === 'partial' ? ' &middot; partly assessed' : '';
    // Say which dimensions still carry an unjudged criterion, since the rubric tells
    // participants those points are settled by a coach rather than by the script.
    const awaiting = d.criteria.some((c) => c.judged === false && c.status !== 'not-harvested')
      ? ' &middot; awaiting a coach’s judgement'
      : (d.criteria.some((c) => c.judged === true) ? ' &middot; coach-judged' : '');
    return `<div class="dim">
  <div class="dim-name">${e(d.label)}<span class="dim-by">${e(d.measuredBy)}${partial}${awaiting}</span></div>
  <div class="track"><div class="fill" data-width="${pct}" style="width:0"></div></div>
  <div class="dim-score">${d.earned}<span class="note"> / ${d.available}</span></div>
</div>`;
  }).join('\n');
}

/**
 * The strongest criteria, named. A report that lists only deductions reads as a list of
 * things you got wrong, however good the score at the top — and the first question a team
 * asks about a rubric is "what does it actually want", which the passes answer better than
 * the failures do.
 */
function wins(score) {
  const passed = score.dimensions
    .flatMap((d) => d.criteria.map((c) => ({ ...c, dimension: d.label })))
    .filter((c) => c.status === 'pass' && c.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 5);
  if (!passed.length) return '';
  return `<section class="panel">
<h2>What you did well</h2>
${passed.map((c) => `<div class="win">
  <div class="win-head"><span class="win-pts">+${c.points}</span>&nbsp;${e(c.label)}</div>
  ${c.evidence ? `<div class="ev">${e(c.evidence)}</div>` : ''}
</div>`).join('\n')}
</section>`;
}

/**
 * The fixes worth doing next, ranked by what they are worth.
 *
 * `lostPoints` is already sorted by points lost, which is the right order: it is the
 * closest honest proxy for value, and inventing an effort estimate we cannot measure would
 * be worse than not ranking at all.
 */
function nextSteps(score) {
  if (!score.lostPoints.length) {
    return '<p class="note">Nothing was deducted. That is rare — well done.</p>';
  }
  return score.lostPoints.map((l) => `<div class="loss">
  <div class="loss-head"><span class="loss-cost">&minus;${l.lost}</span>
    &nbsp;${e(l.criterion)}<span class="note"> &middot; ${e(l.dimension)}</span></div>
  <p class="loss-why">${e(l.reason ?? '')}</p>
  ${l.evidence ? `<div class="ev">${e(l.evidence)}</div>` : ''}
</div>`).join('\n');
}

const STATUS_LABEL = {
  pass: 'full marks',
  partial: 'partly earned',
  fail: 'not earned',
  'not-harvested': 'not scored',
  error: 'scorer failed',
};

/**
 * What the third line is actually saying, which depends on why the criterion did not pass.
 * For a criterion nobody could score, `lostBecause` holds the reason it was unscorable, not
 * advice — labelling that "What to do" produced "What to do: awaiting a coach's demo score",
 * an instruction the team cannot act on.
 */
const WHY_TAG = {
  'not-harvested': 'Why this wasn’t scored',
  error: 'What went wrong (our fault, not yours)',
};

/**
 * Every criterion, in full, whatever it scored.
 *
 * This is the answer to "what are all the criteria, what do they mean, and what do I do
 * about them" — which a report showing only the deductions cannot give. Each one reads the
 * same way: what was looked for, what was found, and what to do next if anything.
 */
function allCriteria(score) {
  return score.dimensions.map((d) => `<div class="dim-group">
<h3>${e(d.label)} <span class="note">${d.status === 'not-harvested' ? 'not scored yet' : d.earned + ' / ' + d.available} &middot; from ${e(d.measuredBy)}</span></h3>
${d.criteria.map((c) => `<div class="crit crit-${e(c.status)}">
  <div class="crit-head">
    <span class="crit-name">${e(c.label)}</span>
    <span class="crit-pts">${c.status === 'not-harvested' ? '&ndash;' : c.earned} / ${c.points}<span class="note"> ${e(STATUS_LABEL[c.status] ?? c.status)}</span></span>
  </div>
  ${c.lookedFor ? `<p class="crit-line"><span class="crit-tag">What we looked for</span>${e(c.lookedFor)}</p>` : ''}
  ${c.evidence ? `<p class="crit-line"><span class="crit-tag">What we found</span><span class="ev-inline">${e(c.evidence)}</span></p>` : ''}
  ${c.lostBecause ? `<p class="crit-line"><span class="crit-tag">${e(WHY_TAG[c.status] ?? 'What to do')}</span>${e(c.lostBecause)}</p>` : ''}
</div>`).join('\n')}
</div>`).join('\n');
}

function badgeList(badges) {
  if (!badges.length) return '';
  return `<section class="panel">
<h2>Badges</h2>
<div class="badges">
${badges.map((b) => `  <span class="badge"><span class="b-em">${e(b.emoji)}</span><strong>${e(b.label)}</strong> <span class="b-desc">${e(b.description)}</span></span>`).join('\n')}
</div>
</section>`;
}

/**
 * @param {object} score     parsed score.json
 * @param {object} [evidence] parsed evidence.json — enables evidence-derived badges
 * @param {object} [options]  { team }
 */
export function renderReport(score, evidence, options = {}) {
  const team = options.team ?? score.repo?.name ?? 'This team';
  const badges = deriveBadges(score, evidence);

  const status = [
    score.practice ? 'practice run' : 'final',
    score.complete ? null : `${score.available} of 100 points assessable`,
    // Say *what* is pending, not just that something is. "Provisional" on its own leaves
    // a team guessing whether they can do anything about it — they can't; a coach can.
    score.provisional
      ? `provisional &mdash; awaiting ${e(String(score.awaiting?.length ?? 0))} coach action(s)`
      : null,
  ].filter(Boolean).join(' &middot; ');

  const body = `<h1>${e(team)}</h1>
<p class="sub">The Vibe Check &middot; ${status} &middot; scorer ${e(score.scorerVersion ?? '?')}</p>

<section class="scoreboard">
  <div class="counter" data-count-to="${score.total}">${score.total}</div>
  <div class="outof">out of ${score.complete ? 100 : score.available}${score.complete ? '' : ' assessable'}</div>
</section>

<section class="panel">
<h2>By dimension</h2>
${dimensionRows(score)}
</section>

${badgeList(badges)}

${wins(score)}

<section class="panel">
<h2>What to do next</h2>
<p class="note">Ranked by what each is worth. You do not have to do all of them.</p>
${nextSteps(score)}
</section>

<section class="panel">
<h2>Every criterion in full</h2>
<p class="note">All ${score.dimensions.reduce((n, d) => n + d.criteria.length, 0)} of them, whatever they
scored — so nothing about how this number was reached is hidden from you.</p>
${allCriteria(score)}
</section>

<section class="panel">
<h2>How this was worked out</h2>
<p class="note">Every number above comes from your repository, your git history and your AI
chat transcripts, read locally on this machine. Token counts, lines of code and commit
numbers are not inputs to the score.</p>
${score.judgement?.present
    // Stating "nothing was uploaded" unconditionally was false once a coach had run the
    // judging pass — and the two criteria it decides are printed on this very page,
    // labelled "coach judging pass". Naming only "prompts and harness files" was also
    // false: the judging skill loads the whole of evidence.json, so this has to describe
    // that file rather than the two fields it was written to think about.
    ? `<p class="note">Two criteria on this page were scored by a coach running an AI judging
pass${score.judgement.model ? ` (${e(score.judgement.model)})` : ''}. That step sends your whole <code>evidence.json</code> to a model — short
excerpts of your prompts, your instruction and context files with credentials redacted, the
file-and-line of anything credential-shaped, committer names, filenames and counts, and up
to 4,000 characters of whatever your test command last printed. That last one is worth
knowing about: a failing suite often prints file paths and the lines of code around the
failure, so this is not a promise that no source code is included. Your files are not
copied wholesale, and your conversations are not sent. Open the file and read it — it is
the exact thing that was sent. Every other number here was computed on this machine.</p>`
    : '<p class="note">Nothing left this machine.</p>'}
${score.dimensions.some((d) => d.errors) ? '<p class="note"><strong>Some criteria could not be evaluated because the scorer failed on them.</strong> That is our fault, not yours — tell a coach.</p>' : ''}
</section>`;

  return page({ title: `${team} — The Vibe Check`, favicon: '🎯', body });
}

/** Ranked view across every team. */
export function renderLeaderboard(rows, options = {}) {
  const dims = rows[0]?.score.dimensions ?? [];

  const header = dims.map((d) => `<th class="num">${e(d.label.split(/[\s&]+/)[0])}</th>`).join('');
  const bodyRows = rows.map((r, i) => {
    const cells = r.score.dimensions.map((d) => `<td class="num">${d.status === 'not-harvested' ? '&ndash;' : `${d.earned}/${d.available}`}</td>`).join('');
    const badges = deriveBadges(r.score, r.evidence);
    return `<tr>
  <td class="num">${i + 1}</td>
  <td>${e(r.team)}</td>
  <td class="num"><strong>${r.score.total}</strong></td>
  <td class="num">${r.score.available}</td>
  ${cells}
  <td>${badges.map((b) => e(b.emoji)).join(' ')}</td>
</tr>`;
  }).join('\n');

  const incomplete = rows.filter((r) => !r.score.complete);
  const note = incomplete.length ? `<p class="note">Ranked by share of assessable points:
${incomplete.length} team(s) could not be assessed on every dimension. Resolve those before
declaring a winner.</p>` : '';

  const body = `<h1>Leaderboard</h1>
<p class="sub">The Vibe Check &middot; ${rows.length} team(s) &middot; scorer ${e(options.scorerVersion ?? '?')}</p>
<section class="panel">
<div class="scroll"><table>
<thead><tr><th class="num">#</th><th>Team</th><th class="num">Score</th><th class="num">of</th>${header}<th>Badges</th></tr></thead>
<tbody>
${bodyRows}
</tbody></table></div>
${note}
</section>`;

  return page({ title: 'Leaderboard — The Vibe Check', favicon: '🏆', body });
}
