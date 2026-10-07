import { analyse, DEFAULTS } from './core/analyser.js';
import { extractQuestions, detectYear, toStructured, isStructured } from './core/extract.js';
import { readFile, ACCEPT } from './files.js';
import { treeSVG, graphSVG, clusterColor } from './viz.js';
import { esc, barChart, heatmap, stackedRows, compareBars, unitLegend, attachTooltips, UNITS, unitName, unitVar } from './charts.js';

const $ = (id) => document.getElementById(id);
const num = (x, d = 1) => (Number.isInteger(x) ? String(x) : x.toFixed(d));
const hrs = (h) => `${num(h)} h`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const state = {
  files: [],               // { id, name, ext, status, label, text, questions, blocks, unmatched, note, error }
  threshold: DEFAULTS.threshold,
  edgeScope: DEFAULTS.edgeScope,
  topN: 10,
  value: 'frequency',
  budget: 10,
  defaultHours: 2,
  hours: new Map(),        // per-topic overrides
  done: new Set(),         // ticked in the study plan
  tab: 'overview',
  hoursOpen: false,
  query: '',
  sort: 'count',
  showAll: false,
  bfsFrom: null,
  djFrom: null,
  djTo: null,
};
let result = null;
let fileSeq = 0;

attachTooltips(document.body);

// ---------- input ----------

$('file').accept = ACCEPT;
$('file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });

let typing = null;
$('text').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(run, 300); });

$('files').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  state.files = state.files.filter((f) => f.id !== Number(btn.dataset.remove));
  if (!state.files.length) resetPicks();
  rebuildFromFiles();
});
$('files').addEventListener('change', (e) => {
  const input = e.target.closest('[data-label]');
  if (!input) return;
  const f = state.files.find((x) => x.id === Number(input.dataset.label));
  if (f) { f.label = input.value.trim() || f.name; rebuildFromFiles(); }
});

$('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  store.set('theme', document.documentElement.dataset.theme);
});

async function addFiles(list) {
  const incoming = [...list].map((file) => ({
    id: ++fileSeq, file, name: file.name, ext: (file.name.match(/\.([a-z0-9]+)$/i) || [, '?'])[1].toLowerCase(),
    status: 'reading', label: '', questions: [], blocks: 0, unmatched: 0, note: null, error: null,
  }));
  if (!incoming.length) return;
  state.files.push(...incoming);
  renderFiles();
  await Promise.all(incoming.map(async (f) => {
    try {
      const { text, note } = await readFile(f.file);
      f.note = note;
      if (!text.trim()) throw new Error('No text found. A scanned PDF needs OCR first.');
      if (isStructured(text)) {
        f.structured = text;
        f.label = f.name;
      } else {
        const ex = extractQuestions(text);
        Object.assign(f, ex);
        const year = detectYear(text, f.name);
        f.label = uniqueLabel(year ? String(year) : f.name.replace(/\.[^.]+$/, ''), f.id);
        if (!ex.questions.length) f.error = `Read ${plural(ex.blocks, 'question')}, but none matched a known topic.`;
      }
      f.status = 'ok';
    } catch (err) {
      f.status = 'error';
      f.error = err.message || String(err);
    }
    delete f.file;
    renderFiles();
  }));
  rebuildFromFiles();
}

function resetPicks() {
  state.hours.clear();
  state.done.clear();
  state.bfsFrom = state.djFrom = state.djTo = null;
}

function uniqueLabel(label, id) {
  const taken = new Set(state.files.filter((f) => f.id !== id && f.label).map((f) => f.label));
  if (!taken.has(label)) return label;
  for (let i = 2; ; i++) if (!taken.has(`${label} (${i})`)) return `${label} (${i})`;
}

function rebuildFromFiles() {
  const ok = state.files.filter((f) => f.status === 'ok');
  const parts = ok.filter((f) => f.structured).map((f) => f.structured);
  const extracted = ok.filter((f) => !f.structured && f.questions.length).map((f) => ({ label: f.label, questions: f.questions }));
  $('text').value = [...parts, toStructured(extracted)].filter((s) => s.trim()).join('\n');
  renderFiles();
  run();
}

const ICON_X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function renderFiles() {
  drop.classList.toggle('compact', state.files.length > 0);
  $('files').innerHTML = state.files.map((f) => {
    let meta;
    let cls = '';
    if (f.status === 'reading') { meta = '<span class="meta">Reading…</span>'; cls = 'reading'; }
    else if (f.status === 'error' || f.error) { meta = `<span class="meta err">${esc(f.error)}</span>`; cls = 'failed'; }
    else if (f.structured) meta = '<span class="meta">Read as analyser text</span>';
    else {
      meta = `<span class="meta">${plural(f.questions.length, 'question')}${f.unmatched ? ` · ${f.unmatched} without a known topic` : ''}${f.note ? ` · <span class="warn">${esc(f.note)}</span>` : ''}</span>`;
    }
    const label = f.status === 'ok' && !f.structured && !f.error
      ? `<label class="year"><span class="sr-only">Paper name for ${esc(f.name)}</span><input data-label="${f.id}" value="${esc(f.label)}"></label>`
      : '';
    return `<li class="file ${cls}"><span class="ext">${esc(f.ext)}</span>
      <span class="file-main"><span class="name" title="${esc(f.name)}">${esc(f.name)}</span>${meta}</span>
      ${label}
      <button class="icon-btn" type="button" data-remove="${f.id}" aria-label="Remove ${esc(f.name)}">${ICON_X}</button></li>`;
  }).join('');
}

// ---------- tabs ----------

const TABS = ['overview', 'plan', 'links', 'how'];
TABS.forEach((t, i) => {
  const el = $(`tab-${t}`);
  el.addEventListener('click', () => selectTab(t));
  el.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const next = TABS[(i + d + TABS.length) % TABS.length];
    selectTab(next);
    $(`tab-${next}`).focus();
  });
});

function selectTab(tab, scroll = false) {
  state.tab = tab;
  TABS.forEach((t) => {
    const on = t === tab;
    $(`tab-${t}`).setAttribute('aria-selected', String(on));
    $(`tab-${t}`).tabIndex = on ? 0 : -1;
    $(t).hidden = !on;
  });
  renderTab();
  if (scroll) document.querySelector('.tabs-bar').scrollIntoView({ behavior: 'smooth' });
}

let resizeT = null;
let lastW = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastW) return;
  lastW = window.innerWidth;
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (state.tab === 'links' && result) drawPath(); }, 150);
});

// ---------- pipeline ----------

function run() {
  result = analyse($('text').value, {
    threshold: state.threshold,
    topN: state.topN,
    edgeScope: state.edgeScope,
    value: state.value,
    budgetHours: state.budget,
    defaultHours: state.defaultHours,
    hoursOverride: state.hours,
  });
  const keys = result.ranked.map((d) => d.key);
  const linked = keys.find((k) => result.graph.adj.get(k).size) ?? keys[0] ?? null;
  if (!keys.includes(state.bfsFrom)) state.bfsFrom = linked;
  if (!keys.includes(state.djFrom)) state.djFrom = linked;
  if (!keys.includes(state.djTo) || state.djTo === state.djFrom) state.djTo = farthestFrom(state.djFrom) ?? keys[1] ?? null;
  const has = result.table.length > 0;
  document.body.classList.toggle('has-data', has);
  $('results').hidden = !has;
  renderNotice();
  if (has) renderTab();
}

function farthestFrom(src) {
  if (!src) return null;
  let best = null;
  let bestD = -1;
  for (const [k, d] of result.graph.dijkstra(src).dist) if (k !== src && d > bestD) { best = k; bestD = d; }
  return best;
}

const name = (k) => result.topic.get(k)?.display ?? k;
const byCount = (keys) => [...keys].sort((x, y) => result.topic.get(y).frequency - result.topic.get(x).frequency);

function renderNotice() {
  const out = [];
  const reading = state.files.some((f) => f.status === 'reading');
  if (!result.table.length && state.files.length && !reading) {
    out.push('<p class="banner">No known DSA-II topics were found in these files. Open "Type or edit papers as text" to see what was read.</p>');
  }
  const w = result.warnings;
  if (w.length) out.push(`<p class="banner">${w.length > 3 ? `${w.length} lines could not be read, for example: ` : 'Could not read: '}${esc(w.slice(0, 3).join('; '))}</p>`);
  $('notice').innerHTML = out.join('');
}

function renderTab() {
  ({ overview, plan, links, how })[state.tab]($(state.tab));
}

// Per-topic, per-paper counts and per-paper unit counts, straight from the questions.
function breakdown() {
  const papers = result.years;
  const col = new Map(papers.map((p, i) => [p, i]));
  const byTopic = new Map(result.table.map((d) => [d.key, papers.map(() => 0)]));
  const byPaper = papers.map((p) => ({ label: String(p), counts: new Map() }));
  for (const q of result.questions) {
    const j = col.get(q.year);
    for (const k of q.keys) byTopic.get(k)[j]++;
    const c = byPaper[j].counts;
    const u = q.unit >= 1 && q.unit <= 5 ? q.unit : 0;
    c.set(u, (c.get(u) || 0) + 1);
  }
  return { papers, byTopic, byPaper };
}

const card = (title, sub, body, extra = '') => `<section class="card">
  <header class="card-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${extra}</header>${body}</section>`;

// ---------- Overview ----------

function overview(el) {
  const r = result;
  const { papers, byTopic, byPaper } = breakdown();
  const lead = r.ranked[0];
  const leadIn = lead.years.length;
  const units = UNITS.filter((u) => r.questions.some((q) => q.unit === u));
  if (r.questions.some((q) => !(q.unit >= 1 && q.unit <= 5))) units.push(0);
  const everyPaper = r.ranked.filter((d) => d.years.length === papers.length).length;
  const totalMarks = r.questions.reduce((s, q) => s + (q.marks || 0), 0);

  const bars = barChart(r.top.map((d) => ({
    label: d.display, value: d.frequency, unit: d.unit,
    tip: [d.display, `Asked ${d.frequency}× in ${d.years.length} of ${papers.length} papers`, d.marks ? `${num(d.marks)} marks in total` : '', d.unit ? unitName(d.unit) : ''],
  })));
  const heatTopics = r.ranked.slice(0, Math.min(12, r.ranked.length));

  el.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="kpi-label">Papers</span><b>${papers.length}</b><span class="kpi-sub">${papers.length > 1 ? `${esc(papers[0])} – ${esc(papers.at(-1))}` : esc(papers[0])}</span></div>
      <div class="kpi"><span class="kpi-label">Questions</span><b>${r.questions.length}</b><span class="kpi-sub">${totalMarks ? `${num(totalMarks)} marks` : 'with a known topic'}</span></div>
      <div class="kpi"><span class="kpi-label">Topics</span><b>${r.table.length}</b><span class="kpi-sub">${papers.length > 1 ? `${everyPaper} in every paper` : `${r.clusters.length} groups`}</span></div>
      <div class="kpi kpi-lead"><span class="kpi-label">Most asked</span><b class="kpi-name" title="${esc(lead.display)}">${esc(lead.display)}</b><span class="kpi-sub">${lead.frequency}× · in ${leadIn} of ${papers.length} papers</span></div>
    </div>

    <div class="grid">
      ${card('Most asked topics', 'Times each topic appears in a question, coloured by unit.', `${bars}${units.length > 1 ? unitLegend(units) : ''}`,
        `<label class="inline-select"><span class="sr-only">How many topics</span><select id="topn">${[5, 10, 15, 20].map((n) => `<option value="${n}" ${n === state.topN ? 'selected' : ''}>Top ${n}</option>`).join('')}</select></label>`)}
      ${card('Questions per unit', papers.length > 1 ? 'How each paper splits its questions across units.' : 'How the paper splits its questions across units.',
        `${stackedRows(byPaper, units)}${unitLegend(units)}${unitTotals(units)}`)}
    </div>

    ${papers.length > 1 ? card('Topic by paper', `How often the ${heatTopics.length} most-asked topics appear in each paper. A full row means it comes up every year.`,
      heatmap(heatTopics.map((d) => d.display), papers.map(String), heatTopics.map((d) => byTopic.get(d.key)))) : ''}

    ${card('All topics', `${plural(r.table.length, 'topic')} found.`, `
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search topics" value="${esc(state.query)}" aria-label="Search topics">
        <select id="sort" aria-label="Sort topics">
          <option value="count" ${state.sort === 'count' ? 'selected' : ''}>Most asked</option>
          <option value="az" ${state.sort === 'az' ? 'selected' : ''}>A to Z</option>
          <option value="unit" ${state.sort === 'unit' ? 'selected' : ''}>By unit</option>
        </select>
      </div>
      <div class="table-wrap"><table class="topics">
        <thead><tr><th>Topic</th><th class="num">Asked</th><th class="hide-sm">Papers</th><th class="num hide-sm">Marks</th></tr></thead>
        <tbody id="topic-rows"></tbody>
      </table></div>
      <button type="button" class="more" id="more" hidden></button>`)}`;

  el.querySelector('#topn').addEventListener('change', (e) => { state.topN = Number(e.target.value); run(); });
  const draw = () => {
    const q = state.query.toLowerCase();
    let list = state.sort === 'az' ? r.table : state.sort === 'unit'
      ? [...r.ranked].sort((a, b) => (a.unit || 99) - (b.unit || 99))
      : r.ranked;
    if (q) list = list.filter((d) => d.display.toLowerCase().includes(q) || [...d.variants.keys()].some((v) => v.toLowerCase().includes(q)));
    const more = el.querySelector('#more');
    const cut = !state.showAll && !q && list.length > 10;
    more.hidden = !cut && !(state.showAll && list.length > 10);
    more.textContent = cut ? `Show all ${list.length} topics` : 'Show fewer';
    if (cut) list = list.slice(0, 10);
    el.querySelector('#topic-rows').innerHTML = list.map((d) => {
      const other = [...d.variants.keys()].filter((v) => v !== d.display);
      const share = d.years.length / papers.length;
      return `<tr>
        <td><span class="dot" style="background:${unitVar(d.unit)}" aria-hidden="true"></span><span class="t">${esc(d.display)}</span>
          <span class="sub">${d.unit ? unitName(d.unit) : 'No unit'}${other.length ? ` · also “${other.map(esc).join('”, “')}”` : ''}</span></td>
        <td class="num strong">${d.frequency}</td>
        <td class="hide-sm"><span class="mini" ${`data-tip="${esc(`${d.display}\nIn ${d.years.join(', ')}`)}" tabindex="0"`}><span class="mini-track"><span style="width:${share * 100}%"></span></span>${d.years.length}/${papers.length}</span></td>
        <td class="num hide-sm">${d.marks ? num(d.marks) : '–'}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="empty">No topic matches that search.</td></tr>';
  };
  el.querySelector('#q').addEventListener('input', (e) => { state.query = e.target.value; draw(); });
  el.querySelector('#sort').addEventListener('change', (e) => { state.sort = e.target.value; draw(); });
  el.querySelector('#more').addEventListener('click', () => { state.showAll = !state.showAll; draw(); });
  draw();
}

function unitTotals(units) {
  const total = result.questions.length || 1;
  const counts = new Map(units.map((u) => [u, 0]));
  for (const q of result.questions) { const u = q.unit >= 1 && q.unit <= 5 ? q.unit : 0; counts.set(u, (counts.get(u) || 0) + 1); }
  return `<dl class="unit-totals">${units.map((u) => `<div><dt>${unitName(u)}</dt><dd>${Math.round((100 * counts.get(u)) / total)}%</dd></div>`).join('')}</dl>`;
}

// ---------- Study plan ----------

function plan(el) {
  const r = result;
  const a = r.allocation;
  const g = r.greedy;
  const byMarks = state.value === 'marks';
  const total = r.items.reduce((s, it) => s + it.value, 0) || 1;
  const unitWord = byMarks ? 'marks' : 'question appearances';
  const allHours = r.items.reduce((s, it) => s + it.hours, 0);
  const maxBudget = Math.max(10, Math.ceil(allHours));
  const chosen = byCount(a.chosen);
  const hasMarks = r.table.some((d) => d.marks > 0);
  const used = Math.min(1, a.hours / state.budget);

  el.innerHTML = `
    <section class="card plan-top">
      <div class="budget">
        <div class="budget-head">
          <label for="budget">Hours you have</label>
          <output id="budget-out">${hrs(state.budget)}</output>
        </div>
        <input id="budget" type="range" min="1" max="${maxBudget}" step="0.5" value="${state.budget}">
        <div class="budget-scale" aria-hidden="true"><span>1 h</span><span>${hrs(maxBudget)} · everything takes ${hrs(allHours)}</span></div>
      </div>
      <div class="budget-mode">
        <span>Prioritise by</span>
        <div class="seg" role="group" aria-label="Prioritise by">
          <button type="button" data-value="frequency" aria-pressed="${!byMarks}">Times asked</button>
          <button type="button" data-value="marks" aria-pressed="${byMarks}" ${hasMarks ? '' : 'disabled title="No marks found in the papers"'}>Marks</button>
        </div>
      </div>
    </section>

    <div class="grid plan-grid">
      <section class="card">
        <header class="card-head"><div><h2>Your revision list</h2><p>${plural(a.chosen.length, 'topic')} · ${hrs(a.hours)} of ${hrs(state.budget)}</p></div></header>
        <div class="meter" ${`data-tip="${esc(`${hrs(a.hours)} planned of ${hrs(state.budget)}`)}" tabindex="0"`}><span style="width:${used * 100}%"></span></div>
        <ul class="checklist">${chosen.map((k) => {
          const d = r.topic.get(k);
          return `<li class="${state.done.has(k) ? 'done' : ''}"><label>
            <input type="checkbox" data-done="${esc(k)}" ${state.done.has(k) ? 'checked' : ''}>
            <span class="t"><span class="dot" style="background:${unitVar(d.unit)}" aria-hidden="true"></span><span class="nm">${esc(d.display)}</span>
              <small>Asked ${d.frequency}× · ${d.years.length} of ${r.years.length} papers</small></span>
            <span class="h">${hrs(d.studyHours)}</span></label></li>`;
        }).join('') || '<li class="none">Nothing fits in this time. Add hours or shorten topics below.</li>'}</ul>
      </section>

      <section class="card">
        <header class="card-head"><div><h2>Coverage</h2><p>Share of all ${unitWord} the list covers.</p></div></header>
        <div class="big-number">${Math.round((100 * a.value) / total)}<span>%</span></div>
        ${compareBars([
          { label: 'This list', value: a.value / total, note: '0/1 knapsack: best total for the hours' },
          { label: 'Most asked first', value: g.value / total, muted: true, note: 'Greedy: take the top topic until time runs out' },
        ])}
        <p class="note">${a.value > g.value + 1e-9
          ? `Taking the most-asked topics first covers ${Math.round((100 * g.value) / total)}% in the same time. This list uses 0/1 knapsack, so one long topic doesn't crowd out several shorter ones.`
          : 'Here the most-asked-first order happens to be just as good.'}</p>
      </section>
    </div>

    <section class="card">
      <details ${state.hoursOpen ? 'open' : ''}>
        <summary>Set how long each topic takes you</summary>
        <p class="note">Papers don't say how long a topic takes. Every topic starts at ${hrs(state.defaultHours)} unless the text sets <code>@hours</code>.</p>
        <div class="hours-list">${r.ranked.map((d) => `
          <div class="hours-row"><span>${esc(d.display)}</span>
            <span class="stepper"><button type="button" data-step="-0.5" data-key="${esc(d.key)}" aria-label="Less time for ${esc(d.display)}">−</button><span>${hrs(d.studyHours)}</span><button type="button" data-step="0.5" data-key="${esc(d.key)}" aria-label="More time for ${esc(d.display)}">+</button></span></div>`).join('')}
        </div>
      </details>
    </section>`;

  const slider = el.querySelector('#budget');
  slider.addEventListener('input', () => { el.querySelector('#budget-out').textContent = hrs(Number(slider.value)); });
  slider.addEventListener('change', () => { state.budget = Number(slider.value); run(); });
  el.querySelectorAll('[data-value]').forEach((b) => b.addEventListener('click', () => { state.value = b.dataset.value; run(); }));
  el.querySelectorAll('[data-done]').forEach((c) => c.addEventListener('change', () => {
    if (c.checked) state.done.add(c.dataset.done); else state.done.delete(c.dataset.done);
    c.closest('li').classList.toggle('done', c.checked);
  }));
  el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const d = r.topic.get(b.dataset.key);
    state.hours.set(d.key, Math.max(0.5, Math.min(20, d.studyHours + Number(b.dataset.step))));
    run();
  }));
  el.querySelector('details').addEventListener('toggle', (e) => { state.hoursOpen = e.target.open; });
}

// ---------- Topic links ----------

function links(el) {
  const r = result;
  const opts = (sel) => r.ranked.map((d) => `<option value="${esc(d.key)}" ${d.key === sel ? 'selected' : ''}>${esc(d.display)}</option>`).join('');
  const solo = r.clusters.filter((c) => c.keys.length === 1);
  const linked = r.clusters.map((c, i) => ({ c, i })).filter(({ c }) => c.keys.length > 1);
  el.innerHTML = `
    ${card('Topic map', 'Lines join topics asked in the same question; thicker means more often. Circle size shows how often a topic is asked, colour shows its group.', `
      <div class="graph-box" id="graph"></div>
      <ul class="legend"><li><i class="line" style="background:var(--ink)"></i>Strongest links</li><li><i class="line" style="background:var(--path)"></i>Path chosen below</li></ul>
      ${solo.length ? `<p class="note">Never asked with another topic: ${solo.map((c) => esc(name(c.keys[0]))).join(', ')}.</p>` : ''}`)}

    <div class="grid">
      ${card('From what you know to what you don’t', 'The shortest chain of topics that are asked together.', `
        <div class="fields two">
          <label class="field">I know<select id="dj-from">${opts(state.djFrom)}</select></label>
          <label class="field">I want to learn<select id="dj-to">${opts(state.djTo)}</select></label>
        </div>
        <div id="dj"></div>`)}
      ${card('Asked alongside', 'Topics that share questions with this one.', `
        <div class="fields"><label class="field">Topic<select id="bfs-from">${opts(state.bfsFrom)}</select></label></div>
        <div id="bfs"></div>`)}
    </div>

    ${linked.length ? card('Revise in groups', 'Topics in a group are asked together. Revise each group in one sitting, in this order.', `
      <div class="groups">${linked.map(({ c, i }) => {
        const p = r.prim[i];
        const via = new Map(p.edges.map((e) => [e.v, e]));
        return `<div class="group" style="--gc:${clusterColor(i)}">
          <h3><span class="dot" style="background:var(--gc)"></span>Group ${i + 1}<span class="muted">${plural(c.keys.length, 'topic')} · ${c.frequency}×</span></h3>
          <ol class="route">${p.order.map((k) => {
            const e = via.get(k);
            return `<li><span>${esc(name(k))}${e ? ` <small>with ${esc(name(e.u))} ${e.count}×</small>` : ''}</span></li>`;
          }).join('')}</ol></div>`;
      }).join('')}</div>`) : ''}`;

  el.querySelector('#bfs-from').addEventListener('change', (e) => { state.bfsFrom = e.target.value; drawBFS(); });
  el.querySelector('#dj-from').addEventListener('change', (e) => { state.djFrom = e.target.value; drawPath(); });
  el.querySelector('#dj-to').addEventListener('change', (e) => { state.djTo = e.target.value; drawPath(); });
  drawBFS();
  drawPath();
}

function drawBFS() {
  const g = result.graph;
  const levels = new Map();
  for (const v of g.bfs(state.bfsFrom)) {
    if (!levels.has(v.level)) levels.set(v.level, []);
    levels.get(v.level).push(v.key);
  }
  $('bfs').innerHTML = levels.size <= 1
    ? '<p class="note">Never asked with another topic.</p>'
    : `<div class="levels">${[...levels].slice(1).map(([lvl, ks]) => `
        <div><h4>${lvl === 1 ? 'In the same question' : `${lvl} steps away`}</h4>
        <div class="chips">${ks.map((k) => `<span class="chip">${esc(name(k))}${lvl === 1 ? ` <b>${g.count(state.bfsFrom, k)}×</b>` : ''}</span>`).join('')}</div></div>`).join('')}</div>`;
}

function drawPath() {
  const r = result;
  let path = null;
  let html;
  if (state.djFrom === state.djTo) html = '<p class="note">Pick two different topics.</p>';
  else {
    path = r.graph.shortestPath(state.djFrom, state.djTo);
    if (!path) html = `<p class="note">These two are never linked through shared questions. ${esc(name(state.djTo))} is in a different group, so revise it on its own.</p>`;
    else {
      const mids = path.path.slice(1, -1);
      html = `<ol class="path">${path.path.map((k, i) => `<li class="${i && i < path.path.length - 1 ? 'mid' : ''}">${esc(name(k))}</li>`).join('')}</ol>
        <p class="note">${mids.length ? `Cover ${mids.map((k) => esc(name(k))).join(', ')} on the way.` : 'These are asked together directly.'}</p>`;
    }
  }
  $('dj').innerHTML = html;
  const box = $('graph');
  box.innerHTML = graphSVG(r.graph, r.clusters, r.topic, { highlight: path ? path.path : [], mst: r.kruskal.edges, width: box.clientWidth || 960 });
}

// ---------- Method ----------

const STEPS = [
  ['Read the papers', 'Split into questions, find topics', null, 'parse'],
  ['Merge spellings', 'Longest common subsequence', 'O(mn)', 'normalise'],
  ['Count topics', 'AVL tree, search then update', 'O(log n)', 'store'],
  ['A to Z list', 'In-order traversal', 'O(n)', 'inorder'],
  ['Most asked', 'Max-heap, top N', 'O(n + N log n)', 'topN'],
  ['Full ranking', 'Heap sort', 'O(n log n)', 'heapSort'],
  ['Link topics', 'Weighted adjacency list', 'O(V + E)', 'graph'],
  ['Find groups', 'DFS connected components', 'O(V + E)', 'components'],
  ['Strongest links', 'Kruskal with union-find', 'O(E log E)', 'kruskal'],
  ['Revision order', 'Prim from the most-asked topic', 'O(E log V)', 'prim'],
  ['Study plan', '0/1 knapsack', 'O(nW)', 'knapsack'],
  ['Paper overlap', 'LCS of topic sequences', 'O(mn)', 'paperLCS'],
];

function how(el) {
  const r = result;
  const t = r.tree;
  const n = t.size;
  const rot = t.rotations;
  const total = Object.values(r.timings).reduce((s, x) => s + x, 0);
  const maxMs = Math.max(0.001, ...STEPS.map((s) => r.timings[s[3]] ?? 0));
  const merges = r.normaliser.merges;
  const best = n ? Math.ceil(Math.log2(n + 1)) : 0;
  const hMax = Math.max(1, t.height, r.bstHeight);
  el.innerHTML = `
    <div class="grid">
      ${card('Settings', '', `
        <div class="setting">
          <label for="threshold">Spelling match <output>${state.threshold.toFixed(2)}</output></label>
          <input id="threshold" type="range" min="0.6" max="1" step="0.01" value="${state.threshold}">
          <p class="note">Two names count as one topic when LCS(a, b) / longer length reaches this value. Lower merges more.</p>
        </div>
        <div class="setting">
          <span class="setting-label">Link topics asked in the same</span>
          <div class="seg" role="group" aria-label="Link topics asked in the same">
            <button type="button" data-scope="question" aria-pressed="${state.edgeScope === 'question'}">Question</button>
            <button type="button" data-scope="unit" aria-pressed="${state.edgeScope === 'unit'}">Unit of a paper</button>
          </div>
        </div>`)}
      ${card('Tree height', 'Lower is faster to search. Same topics, inserted in the same order.', `
        <div class="compare-bars">
          ${[['AVL tree', t.height], ['Plain BST', r.bstHeight], ['Best possible', best]].map(([l, v], i) => `
          <div class="cmp-row" data-tip="${esc(`${l}: height ${v}`)}" tabindex="0"><span class="cmp-label">${l}</span>
            <span class="cmp-track"><span class="cmp-fill${i ? ' muted-fill' : ''}" style="width:${(100 * v) / hMax}%"></span></span><span class="cmp-value">${v}</span></div>`).join('')}
        </div>
        <p class="note">${plural(rot.LL + rot.RR + rot.LR + rot.RL, 'rotation')} kept the AVL tree balanced (LL ${rot.LL}, RR ${rot.RR}, LR ${rot.LR}, RL ${rot.RL}).</p>`)}
    </div>

    ${card('Pipeline', `Each step and the structure behind it. Whole run took ${total.toFixed(1)} ms.`, `
      <ol class="steps">${STEPS.map(([what, algo, big, key]) => {
        const ms = r.timings[key] ?? 0;
        return `<li><span class="what">${what}</span><span class="how">${algo}${big ? ` <code>${big}</code>` : ''}</span>
          <span class="ms"><span class="ms-bar"><span style="width:${(100 * ms) / maxMs}%"></span></span>${ms.toFixed(2)} ms</span></li>`;
      }).join('')}</ol>`)}

    ${card('AVL tree', 'Topics stored by name; the number is how often each was asked.', `
      <div class="scroll-x">${treeSVG(t.root, (node) => node.data.display)}</div>
      <details><summary>Traversals</summary>
        <p class="note"><strong>Pre-order</strong> (used to save the tree): ${t.preOrder().map((x) => esc(x.data.display)).join(', ')}</p>
        <p class="note"><strong>Post-order</strong> (safe order to free it): ${t.postOrder().map((x) => esc(x.data.display)).join(', ')}</p>
      </details>`)}

    <div class="grid">
      ${card('Units asked together', 'Fixed 5 × 5 adjacency matrix.', `<div class="scroll-x"><table class="matrix"><thead><tr><th></th>${r.unitMatrix.map((_, i) => `<th>U${i + 1}</th>`).join('')}</tr></thead><tbody>${
        r.unitMatrix.map((row, i) => `<tr><th>U${i + 1}</th>${row.map((v) => `<td><span class="cell h${v ? Math.min(5, Math.ceil(v / 2)) : 0}">${v}</span></td>`).join('')}</tr>`).join('')
      }</tbody></table></div>`)}
      ${card('Paper overlap', 'How much of one paper’s topic order repeats in another (LCS).', r.years.length < 2 ? '<p class="note">Needs two or more papers.</p>' : `<div class="scroll-x"><table class="matrix"><thead><tr><th></th>${r.years.map((y) => `<th>${esc(y)}</th>`).join('')}</tr></thead><tbody>${
        r.paperSimilarity.map((row, i) => `<tr><th>${esc(r.years[i])}</th>${row.map((v, j) => (i === j ? '<td><span class="cell h0">–</span></td>' : `<td><span class="cell h${Math.min(5, Math.ceil(v * 5))}">${Math.round(v * 100)}</span></td>`)).join('')}</tr>`).join('')
      }</tbody></table></div>`)}
    </div>

    ${card('Merged spellings', 'Names joined by LCS similarity or an <code>@alias</code> line.', merges.length ? `<div class="table-wrap"><table class="topics"><thead><tr><th>Written as</th><th>Counted as</th><th class="num">Match</th></tr></thead><tbody>${
      merges.map((m) => `<tr><td>${esc(m.raw)}</td><td>${esc(name(m.key))}</td><td class="num">${m.via === 'alias' ? 'alias' : m.score.toFixed(2)}</td></tr>`).join('')
    }</tbody></table></div>` : '<p class="note">Nothing needed merging.</p>')}
    <p class="note">The reasons behind each choice are in the <a href="https://github.com/utk042/DSA_PBL/blob/HEAD/REPORT.md">project report</a>.</p>`;

  // Wide trees scroll sideways; start with the root in view.
  const tw = el.querySelector('.scroll-x');
  const rootNode = tw.querySelector('.root circle');
  if (rootNode) tw.scrollLeft = rootNode.cx.baseVal.value - tw.clientWidth / 2;

  const th = el.querySelector('#threshold');
  th.addEventListener('input', () => { th.previousElementSibling.querySelector('output').textContent = Number(th.value).toFixed(2); });
  th.addEventListener('change', () => { state.threshold = Number(th.value); run(); });
  el.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { state.edgeScope = b.dataset.scope; run(); }));
}

run();
