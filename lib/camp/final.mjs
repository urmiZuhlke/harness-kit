/**
 * final.mjs — final-round.md, as the page facilitators open.
 *
 * The camp-finalist agent writes Markdown, not HTML, on purpose: it reads team content, and
 * an agent writing HTML could carry a team's text into a page as live markup. This renders
 * the small Markdown subset its template uses — headings, paragraphs, lists, tables, bold,
 * inline code, code blocks — and escapes everything else. Links are left as text, so no
 * address a team planted becomes clickable.
 */
import { escapeHtml as e } from '../integrity/injection.mjs';
import { REHEARSAL_TEXT } from './report.mjs';

/** **bold** and `code`, on text that is escaped first — so nothing else can become markup. */
function inline(text) {
  return e(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '')
  .split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

/** The Markdown subset the finalist's template uses, as HTML. Unknown syntax stays text. */
export function markdownToHtml(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => { if (para.length) out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; };
  const flushList = () => {
    if (list) out.push('<' + list.tag + '>' + list.items.map((i) => '<li>' + inline(i) + '</li>').join('') + '</' + list.tag + '>');
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara(); flushList();
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      out.push('<pre>' + e(code.join('\n')) + '</pre>');
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara(); flushList();
      const level = heading[1].length;
      out.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flushPara(); flushList();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const isRule = (r) => /^\s*\|?[\s:|-]+\|?\s*$/.test(r) && r.includes('-');
      const head = rows.length > 1 && isRule(rows[1]) ? cells(rows[0]) : null;
      const align = head ? cells(rows[1]).map((c) => (/-:$/.test(c) ? ' class="n"' : '')) : [];
      const body = (head ? rows.slice(2) : rows).map(cells);
      out.push('<div class="wrap"><table>'
        + (head ? '<thead><tr>' + head.map((c, k) => '<th' + (align[k] ?? '') + '>' + inline(c) + '</th>').join('') + '</tr></thead>' : '')
        + '<tbody>' + body.map((r) => '<tr>' + r.map((c, k) => '<td' + (align[k] ?? '') + '>' + inline(c) + '</td>').join('') + '</tr>').join('')
        + '</tbody></table></div>');
      continue;
    }
    const item = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const tag = item[1] ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(item[3]);
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    // An indented line under a list item continues it; anything else is a paragraph.
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join('\n');
}

/** The whole page. */
export function finalRoundHtml(markdown, { generatedAt = new Date().toISOString(), rehearsal = false } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Final Round</title>
<style>
:root{--bg:#fbfbfa;--fg:#1c1c1a;--muted:#6b6b66;--line:#e2e1dc;--head:#f1f0ec;--accent:#2f6f4f;--code:#efeee9}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#a3a29c;--line:#34332f;--head:#201f1d;--accent:#7cc79e;--code:#262522}}
*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,sans-serif}
main{max-width:980px;margin:0 auto}h1{margin:0 0 6px;font-size:24px}h2{font-size:19px;margin:28px 0 6px;padding-top:12px;border-top:1px solid var(--line)}
h3{font-size:16px;margin:18px 0 4px}p{margin:6px 0}p.meta{color:var(--muted);margin:0 0 16px;font-size:13px}ul,ol{margin:6px 0;padding-left:22px}li{margin:2px 0}
b{font-weight:650}code{font:12.5px/1.4 ui-monospace,monospace;background:var(--code);padding:1px 4px;border-radius:3px;overflow-wrap:anywhere}
pre{font:12.5px/1.45 ui-monospace,monospace;background:var(--code);padding:10px;border-radius:6px;overflow-x:auto}
.wrap{overflow-x:auto;max-width:100%;margin:8px 0}table{border-collapse:collapse;min-width:100%}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{background:var(--head);font-size:13px;color:var(--muted)}.n{text-align:right;font-variant-numeric:tabular-nums}
.rehearsal{border:2px solid #b3261e;color:#b3261e;border-radius:6px;padding:8px 12px;margin:0 0 14px;font-weight:700}
</style></head><body><main>
${rehearsal ? '<p class="rehearsal">' + e(REHEARSAL_TEXT) + '</p>' : ''}
<p class="meta">Facilitators only · a second opinion from one agent, reading the top teams side by side. It changes no score. Generated ${e(generatedAt.slice(0, 16).replace('T', ' '))} UTC.</p>
${markdownToHtml(markdown)}
</main></body></html>
`;
}
