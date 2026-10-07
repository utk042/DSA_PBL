// Small HTML charts built from the analysis. Plain markup + CSS so text stays
// sharp and the layout reflows on narrow screens. Hover text lives in data-tip.

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (lines) => `data-tip="${esc(lines.filter(Boolean).join('\n'))}" tabindex="0"`;
const pct = (x) => `${Math.round(x * 100)}%`;

export const UNITS = [1, 2, 3, 4, 5];
export const unitVar = (u) => (u >= 1 && u <= 5 ? `var(--u${u})` : 'var(--u0)');
export const unitName = (u) => (u >= 1 && u <= 5 ? `Unit ${u}` : 'No unit');

export function unitLegend(units) {
  return `<ul class="legend">${units.map((u) => `<li><i style="background:${unitVar(u)}"></i>${unitName(u)}</li>`).join('')}</ul>`;
}

/**
 * Horizontal bars, one per topic, coloured by unit.
 * rows: [{ label, value, unit, tip: [] }]
 */
export function barChart(rows, { unitLabel = '' } = {}) {
  if (!rows.length) return '<p class="muted small">Nothing to show.</p>';
  const max = Math.max(...rows.map((r) => r.value)) || 1;
  const ticks = niceTicks(max);
  const top = ticks.at(-1);
  return `<div class="bars" role="list">
    ${rows.map((r) => `<div class="bar-row" role="listitem" ${tip(r.tip ?? [r.label, `${r.value}${unitLabel}`])}>
      <span class="bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(100 * r.value) / top}%;background:${unitVar(r.unit)}"></span></span>
      <span class="bar-value">${r.value}</span>
    </div>`).join('')}
    <div class="bar-axis" aria-hidden="true"><span></span><span class="ticks">${ticks.map((t) => `<span style="left:${(100 * t) / top}%">${t}</span>`).join('')}</span><span></span></div>
  </div>`;
}

function niceTicks(max) {
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 50) * 10;
  const out = [];
  for (let t = 0; t < max + step; t += step) { out.push(t); if (t >= max) break; }
  return out;
}

/**
 * Topic × paper grid. cells[i][j] = times topic i was asked in paper j.
 */
export function heatmap(topics, papers, cells) {
  const max = Math.max(1, ...cells.flat());
  const level = (v) => (v ? 2 + Math.round((3 * (v - 1)) / Math.max(1, max - 1)) : 0);
  return `<div class="heat-wrap"><table class="heat">
    <thead><tr><th scope="col"><span class="sr-only">Topic</span></th>${papers.map((p) => `<th scope="col">${esc(p)}</th>`).join('')}<th scope="col" class="heat-total">Papers</th></tr></thead>
    <tbody>${topics.map((t, i) => {
      const inPapers = cells[i].filter(Boolean).length;
      return `<tr><th scope="row" title="${esc(t)}">${esc(t)}</th>${cells[i].map((v, j) => `<td><span class="cell h${level(v)}" ${tip([t, `${papers[j]}: ${v ? `asked ${v}×` : 'not asked'}`])}>${v || ''}</span></td>`).join('')}
        <td class="heat-total">${inPapers}/${papers.length}</td></tr>`;
    }).join('')}</tbody>
  </table></div>
  <div class="scale" aria-hidden="true"><span>Fewer</span>${[0, 1, 2, 3, 4, 5].map((l) => `<i class="cell h${l}"></i>`).join('')}<span>More</span></div>`;
}

/**
 * One 100% bar per paper, split into units.
 * rows: [{ label, counts: Map(unit -> n) }]
 */
export function stackedRows(rows, units) {
  return `<div class="stack">${rows.map((r) => {
    const total = [...r.counts.values()].reduce((s, x) => s + x, 0) || 1;
    return `<div class="stack-row"><span class="stack-label">${esc(r.label)}</span>
      <span class="stack-bar">${units.filter((u) => r.counts.get(u)).map((u) => {
        const n = r.counts.get(u);
        return `<span class="seg-fill" style="flex:${n};background:${unitVar(u)}" ${tip([`${r.label} · ${unitName(u)}`, `${n} of ${total} questions (${pct(n / total)})`])}>${n / total >= 0.12 ? n : ''}</span>`;
      }).join('')}</span>
      <span class="stack-total">${total}</span></div>`;
  }).join('')}</div>`;
}

/** Two bars on one 0–100% scale: the chosen plan against the greedy baseline. */
export function compareBars(items) {
  return `<div class="compare-bars">${items.map((it) => `
    <div class="cmp-row" ${tip([it.label, `${pct(it.value)} covered`, it.note])}>
      <span class="cmp-label">${esc(it.label)}</span>
      <span class="cmp-track"><span class="cmp-fill${it.muted ? ' muted-fill' : ''}" style="width:${Math.max(0.5, it.value * 100)}%"></span></span>
      <span class="cmp-value">${pct(it.value)}</span>
    </div>`).join('')}</div>`;
}

/** Floating tooltip for every [data-tip] element under root. */
export function attachTooltips(root) {
  const box = document.createElement('div');
  box.className = 'tooltip';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  document.body.append(box);
  let current = null;
  const place = (x, y) => {
    const r = box.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
    const top = y - r.height - 12 < 8 ? y + 18 : y - r.height - 12;
    box.style.transform = `translate(${left}px, ${top}px)`;
  };
  const show = (el, x, y) => {
    current = el;
    box.textContent = el.dataset.tip;
    box.hidden = false;
    place(x, y);
  };
  const hide = () => { current = null; box.hidden = true; };
  root.addEventListener('pointermove', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) { if (current) hide(); return; }
    if (el !== current) show(el, e.clientX, e.clientY);
    else place(e.clientX, e.clientY);
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.top);
  });
  root.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
}
