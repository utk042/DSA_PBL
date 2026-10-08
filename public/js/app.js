import { analyse, DEFAULTS } from './core/analyser.js';
import { extractQuestions, detectYear, toStructured, isStructured } from './core/extract.js';
import { PRESETS } from './samples.js';
import { readFile, ACCEPT } from './files.js';
import { treeSVG, graphSVG, clusterColor } from './viz.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (x, d = 1) => (Number.isInteger(x) ? String(x) : x.toFixed(d));
const hrs = (h) => `${num(h)} h`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const state = {
  source: 'sample',        // 'sample' | 'files'
  preset: 'five',
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
  bfsFrom: null,
  djFrom: null,
  djTo: null,
};
let result = null;
let fileSeq = 0;

// ---------- input ----------

$('file').accept = ACCEPT;
$('file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });

document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => loadPreset(b.dataset.preset)));

let typing = null;
$('text').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(run, 300); });

$('files').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  state.files = state.files.filter((f) => f.id !== Number(btn.dataset.remove));
  if (!state.files.length) loadPreset(state.preset);
  else rebuildFromFiles();
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

function loadPreset(id) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  state.source = 'sample';
  state.preset = p.id;
  state.files = [];
  state.budget = p.budgetHours;
  resetPicks();
  $('text').value = p.text;
  renderFiles();
  run();
}

async function addFiles(list) {
  const incoming = [...list].map((file) => ({
    id: ++fileSeq, file, name: file.name, ext: (file.name.match(/\.([a-z0-9]+)$/i) || [, '?'])[1].toLowerCase(),
    status: 'reading', label: '', questions: [], blocks: 0, unmatched: 0, note: null, error: null,
  }));
  if (!incoming.length) return;
  if (state.source === 'sample') { state.files = []; resetPicks(); }
  state.source = 'files';
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

function renderFiles() {
  drop.classList.toggle('compact', state.files.length > 0);
  $('files').innerHTML = state.files.map((f) => {
    let meta;
    if (f.status === 'reading') meta = '<div class="meta">Reading…</div>';
    else if (f.status === 'error' || f.error) meta = `<div class="meta err">${esc(f.error)}</div>`;
    else if (f.structured) meta = '<div class="meta">Read as analyser text</div>';
    else {
      meta = `<div class="meta"><label>Paper <input data-label="${f.id}" value="${esc(f.label)}" aria-label="Paper name for ${esc(f.name)}"></label>
        <span>${plural(f.questions.length, 'question')} with topics${f.unmatched ? `, ${f.unmatched} skipped` : ''}</span></div>
        ${f.note ? `<div class="meta note">${esc(f.note)}</div>` : ''}`;
    }
    return `<li class="file"><span class="ext">${esc(f.ext)}</span><span class="name" title="${esc(f.name)}">${esc(f.name)}</span>
      <button class="icon-btn" type="button" data-remove="${f.id}" aria-label="Remove ${esc(f.name)}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      ${meta}</li>`;
  }).join('');
}

// ---------- tabs ----------

const TABS = ['overview', 'plan', 'topics', 'groups', 'links', 'how'];
const tabEls = TABS.map((t) => $(`tab-${t}`));
tabEls.forEach((el, i) => {
  el.addEventListener('click', () => selectTab(TABS[i]));
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
  $(`tab-${tab}`).scrollIntoView({ block: 'nearest', inline: 'nearest' });
  renderTab();
  if (scroll) document.querySelector('.tabs-bar').scrollIntoView({ behavior: 'smooth' });
}

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
  renderNotice();
  renderTab();
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
  if (state.source === 'sample') {
    out.push(`<p class="banner info">Showing ${state.preset === 'worked' ? 'the worked example from the report' : 'sample data (made-up papers, not real exams)'}. Upload your own papers above to replace it.</p>`);
  }
  const w = result.warnings;
  if (w.length) out.push(`<p class="banner">${w.length > 3 ? `${w.length} lines could not be read, for example: ` : ''}${esc(w.slice(0, 3).join('; '))}</p>`);
  $('notice').innerHTML = out.join('');
}

function renderTab() {
  if (!result) return;
  const empty = !result.table.length;
  $('results').classList.toggle('is-empty', empty);
  const el = $(state.tab);
  if (empty) {
    el.innerHTML = `<div class="card empty">No topics found yet. ${state.files.some((f) => f.status === 'reading') ? 'Still reading files…' : 'Add papers above, or open "Check or edit the extracted text" to see what was read.'}</div>`;
    return;
  }
  ({ overview, plan, topics, groups, links, how })[state.tab](el);
}

// ---------- Overview ----------

function overview(el) {
  const r = result;
  const max = Math.max(1, ...r.top.map((d) => d.frequency));
  const a = r.allocation;
  el.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${r.parsed.papers.length}</b><span>papers</span></div>
      <div class="stat"><b>${r.questions.length}</b><span>questions</span></div>
      <div class="stat"><b>${r.table.length}</b><span>topics</span></div>
      <div class="stat"><b>${r.clusters.length}</b><span>topic groups</span></div>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Most asked</h2>
          <label class="small muted">Show <select id="topn" aria-label="How many topics to show">${[5, 10, 15, 20].map((n) => `<option ${n === state.topN ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <ol class="ranks">${r.top.map((d, i) => `
          <li class="rank"><span class="n">${i + 1}</span><span class="t" title="${esc(d.display)}">${esc(d.display)}</span>
            <span class="c">${d.frequency}<small> ×</small></span>
            <span class="track"><span class="fill" style="width:${(100 * d.frequency) / max}%"></span></span></li>`).join('')}
        </ol>
        <p class="small muted" style="margin:14px 0 0">Asked in ${r.years.length > 1 ? `${r.years[0]} to ${r.years.at(-1)}` : esc(r.years[0] ?? '')}. <a href="#topics" data-go="topics">See all topics</a></p>
      </section>
      <section class="card">
        <div class="card-head"><h2>Revise first</h2><p>The best set of topics for ${hrs(state.budget)} of revision.</p></div>
        <ol class="route">${byCount(a.chosen).map((k) => `<li><span>${esc(name(k))} <small>${hrs(result.topic.get(k).studyHours)}</small></span></li>`).join('') || '<li><span class="muted">Nothing fits in this time.</span></li>'}</ol>
        <p style="margin:14px 0 0"><a class="btn small" href="#plan" data-go="plan">Change hours</a></p>
      </section>
    </div>`;
  el.querySelector('#topn').addEventListener('change', (e) => { state.topN = Number(e.target.value); run(); });
  bindGo(el);
}

function bindGo(el) {
  el.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); selectTab(a.dataset.go, true); }));
}

// ---------- Study plan ----------

function plan(el) {
  const r = result;
  const a = r.allocation;
  const g = r.greedy;
  const byMarks = state.value === 'marks';
  const total = r.items.reduce((s, it) => s + it.value, 0) || 1;
  const unitWord = byMarks ? 'marks' : 'question appearances';
  const maxBudget = Math.max(10, Math.ceil(r.items.reduce((s, it) => s + it.hours, 0)));
  const chosen = byCount(a.chosen);
  const hasMarks = r.table.some((d) => d.marks > 0);
  el.innerHTML = `
    <section class="card">
      <div class="budget">
        <div class="budget-top"><label for="budget"><strong>Hours you have</strong></label><output id="budget-out">${hrs(state.budget)}</output></div>
        <input id="budget" type="range" min="1" max="${maxBudget}" step="0.5" value="${state.budget}">
        <div class="budget-top">
          <span class="small muted">Pick topics by</span>
          <div class="seg" role="group" aria-label="Pick topics by">
            <button type="button" data-value="frequency" aria-pressed="${!byMarks}">Times asked</button>
            <button type="button" data-value="marks" aria-pressed="${byMarks}" ${hasMarks ? '' : 'disabled title="No marks found in the papers"'}>Marks</button>
          </div>
        </div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Your list</h2></div>
      <div class="plan-sum">
        <span><b>${plural(a.chosen.length, 'topic')}</b></span>
        <span><b>${hrs(a.hours)}</b> of ${hrs(state.budget)}</span>
        <span>covers <b>${Math.round((100 * a.value) / total)}%</b> of ${unitWord}</span>
      </div>
      <ul class="checklist">${chosen.map((k) => {
        const d = r.topic.get(k);
        return `<li class="${state.done.has(k) ? 'done' : ''}"><input type="checkbox" data-done="${esc(k)}" ${state.done.has(k) ? 'checked' : ''} aria-label="Mark ${esc(d.display)} as revised">
          <span class="t"><span>${esc(d.display)}</span><small>Asked ${d.frequency}× · ${d.years.length} of ${r.years.length} papers</small></span>
          <span class="h">${hrs(d.studyHours)}</span></li>`;
      }).join('') || '<li><span></span><span class="t muted">Nothing fits in this time. Add hours or shorten topics below.</span><span></span></li>'}</ul>
      ${a.value > g.value + 1e-9 ? `<p class="compare">Picking the most-asked topics first would only cover ${Math.round((100 * g.value) / total)}% in the same time. This list is chosen with 0/1 knapsack, so long topics don't crowd out several shorter ones.</p>` : ''}
    </section>
    <section class="card">
      <details ${state.hoursOpen ? 'open' : ''}>
        <summary>Set how long each topic takes you</summary>
        <p class="small muted" style="margin:8px 0 0">Papers don't say how long a topic takes. Topics start at ${hrs(state.defaultHours)} unless the text sets <code>@hours</code>.</p>
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

// ---------- All topics ----------

function topics(el) {
  el.innerHTML = `
    <section class="card">
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search topics" value="${esc(state.query)}" aria-label="Search topics">
        <select id="sort" aria-label="Sort topics">
          <option value="count" ${state.sort === 'count' ? 'selected' : ''}>Most asked</option>
          <option value="az" ${state.sort === 'az' ? 'selected' : ''}>A to Z</option>
          <option value="unit" ${state.sort === 'unit' ? 'selected' : ''}>By unit</option>
        </select>
      </div>
      <ul class="topics" id="topic-list"></ul>
    </section>`;
  const draw = () => {
    const q = state.query.toLowerCase();
    let list = state.sort === 'az' ? result.table : state.sort === 'unit'
      ? [...result.ranked].sort((a, b) => (a.unit || 99) - (b.unit || 99))
      : result.ranked;
    if (q) list = list.filter((d) => d.display.toLowerCase().includes(q) || [...d.variants.keys()].some((v) => v.toLowerCase().includes(q)));
    el.querySelector('#topic-list').innerHTML = list.map((d) => {
      const other = [...d.variants.keys()].filter((v) => v !== d.display);
      return `<li class="topic"><span class="t">${esc(d.display)}</span>
        <span class="c">${d.frequency}×${d.marks ? `<small>${num(d.marks)} marks</small>` : ''}</span>
        <span class="d">${d.unit ? `<span class="chip unit">Unit ${d.unit}</span>` : ''}${d.years.map((y) => `<span class="chip">${esc(y)}</span>`).join('')}
          ${other.length ? `<span>also written as ${other.map(esc).join(', ')}</span>` : ''}</span></li>`;
    }).join('') || '<li class="empty">No topic matches that search.</li>';
  };
  el.querySelector('#q').addEventListener('input', (e) => { state.query = e.target.value; draw(); });
  el.querySelector('#sort').addEventListener('change', (e) => { state.sort = e.target.value; draw(); });
  draw();
}

// ---------- Groups ----------

function groups(el) {
  const r = result;
  el.innerHTML = `
    <p class="small muted" style="margin:0 0 12px">Topics asked in the same question are grouped together. Revise a group in one sitting, in the order shown. The order starts at the group's most-asked topic and follows the strongest links.</p>
    <div class="groups">${r.clusters.map((c, i) => {
      const p = r.prim[i];
      const via = new Map(p.edges.map((e) => [e.v, e]));
      return `<section class="card group" style="--c:${clusterColor(i)}">
        <h3>Group ${i + 1} <span>${plural(c.keys.length, 'topic')} · asked ${c.frequency}×</span></h3>
        ${c.keys.length === 1
          ? `<p class="solo">${esc(name(c.keys[0]))} is never asked with another topic. Revise it on its own.</p>`
          : `<ol class="route">${p.order.map((k) => {
            const e = via.get(k);
            return `<li><span>${esc(name(k))}${e ? ` <small>with ${esc(name(e.u))} ${e.count}×</small>` : ''}</span></li>`;
          }).join('')}</ol>`}
      </section>`;
    }).join('')}</div>`;
}

// ---------- Connections ----------

function links(el) {
  const opts = (sel) => result.ranked.map((d) => `<option value="${esc(d.key)}" ${d.key === sel ? 'selected' : ''}>${esc(d.display)}</option>`).join('');
  el.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Topic map</h2><p>Each line joins two topics asked in the same question. Thicker means more often. Colours match the groups.</p></div>
      <div class="graph-box" id="graph"></div>
      ${(() => { const solo = result.clusters.filter((c) => c.keys.length === 1); return solo.length ? `<p class="small muted" style="margin:10px 0 0">Not shown, never asked with another topic: ${solo.map((c) => esc(name(c.keys[0]))).join(', ')}.</p>` : ''; })()}
      <div class="legend"><span><i style="background:var(--accent)"></i>Strongest links (spanning tree)</span><span><i style="background:var(--path)"></i>Path below</span></div>
    </section>
    <div class="grid-2" style="margin-top:12px">
      <section class="card">
        <h3>Asked alongside</h3>
        <div class="fields"><label class="field">Topic<select id="bfs-from">${opts(state.bfsFrom)}</select></label></div>
        <div id="bfs"></div>
      </section>
      <section class="card">
        <h3>From a topic you know to one you don't</h3>
        <div class="fields two">
          <label class="field">I know<select id="dj-from">${opts(state.djFrom)}</select></label>
          <label class="field">I want to learn<select id="dj-to">${opts(state.djTo)}</select></label>
        </div>
        <div id="dj"></div>
      </section>
    </div>`;
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
    ? '<p class="small muted">Never asked with another topic.</p>'
    : `<div class="levels">${[...levels].slice(1).map(([lvl, ks]) => `
        <div><h4>${lvl === 1 ? 'In the same question' : `${lvl} steps away`}</h4>
        <div class="chips">${ks.map((k) => `<span class="chip">${esc(name(k))}${lvl === 1 ? ` · ${g.count(state.bfsFrom, k)}×` : ''}</span>`).join('')}</div></div>`).join('')}</div>`;
}

function drawPath() {
  const r = result;
  let path = null;
  let html;
  if (state.djFrom === state.djTo) html = '<p class="small muted">Pick two different topics.</p>';
  else {
    path = r.graph.shortestPath(state.djFrom, state.djTo);
    if (!path) html = `<p class="small muted">These two are never linked through shared questions. ${esc(name(state.djTo))} is in a different group, so revise it separately.</p>`;
    else {
      const mids = path.path.slice(1, -1);
      html = `<ol class="path">${path.path.map((k, i) => `<li class="${i && i < path.path.length - 1 ? 'mid' : ''}">${esc(name(k))}</li>`).join('')}</ol>
        <p class="small muted" style="margin:10px 0 0">${mids.length ? `Cover ${mids.map((k) => esc(name(k))).join(', ')} on the way. ${mids.length > 1 ? 'They link' : 'It links'} the two most strongly.` : 'These are asked together directly.'}</p>`;
    }
  }
  $('dj').innerHTML = html;
  $('graph').innerHTML = graphSVG(r.graph, r.clusters, r.topic, { highlight: path ? path.path : [], mst: r.kruskal.edges });
}

// ---------- How it works ----------

const PROGRESS = {
  feedback: [
    ['Focus on DSA-II Unit 1 and Unit 2 and study their topics in depth', 'Done'],
    ['Study Heap Sort, AVL Tree and BST in depth', 'Done'],
    ['Start the implementation', 'Done'],
    ['Read more research papers', 'In progress'],
    ['Change the objective of the project', 'Pending'],
    ['Write the report in the proper format', 'Pending'],
  ],
};

const STEPS = [
  ['Read the papers', 'Split into questions, find topics', null, 'parse'],
  ['Merge spellings', 'Longest common subsequence', 'O(mn)', 'normalise'],
  ['Count topics', 'AVL tree, search then update', 'O(log n)', 'store'],
  ['A to Z list', 'In-order traversal', 'O(n)', 'inorder'],
  ['Most asked', 'Max-heap, top N', 'O(n + N log n)', 'topN'],
  ['Full ranking', 'Heap sort', 'O(n log n)', 'heapSort'],
  ['Link topics', 'Weighted adjacency list, weight 1/count', 'O(V + E)', 'graph'],
  ['Find groups', 'DFS connected components', 'O(V + E)', 'components'],
  ['Strongest links', 'Kruskal with union-find', 'O(E log E)', 'kruskal'],
  ['Revision order', 'Prim from the most-asked topic', 'O(E log V)', 'prim'],
  ['Asked alongside', 'BFS', 'O(V + E)', null],
  ['Path between topics', 'Dijkstra', 'O((V + E) log V)', null],
  ['Study plan', '0/1 knapsack', 'O(nW)', 'knapsack'],
  ['Paper overlap', 'LCS of topic sequences', 'O(mn)', 'paperLCS'],
];

function how(el) {
  const r = result;
  const t = r.tree;
  const n = t.size;
  const rot = t.rotations;
  const ms = (k) => (k && r.timings[k] !== undefined ? `${r.timings[k].toFixed(2)} ms` : '');
  const total = Object.values(r.timings).reduce((s, x) => s + x, 0);
  const merges = r.normaliser.merges;
  el.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Settings</h2></div>
      <div class="setting">
        <label for="threshold">Spelling match <output>${state.threshold.toFixed(2)}</output></label>
        <input id="threshold" type="range" min="0.6" max="1" step="0.01" value="${state.threshold}">
        <p>Two names count as one topic when LCS(a, b) / longer length reaches this value. Lower merges more.</p>
      </div>
      <div class="setting">
        <label>Link topics asked in the same</label>
        <div class="seg" role="group" aria-label="Link topics asked in the same">
          <button type="button" data-scope="question" aria-pressed="${state.edgeScope === 'question'}">Question</button>
          <button type="button" data-scope="unit" aria-pressed="${state.edgeScope === 'unit'}">Unit of a paper</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Pipeline</h2><p>Every step and the data structure behind it. Whole run: ${total.toFixed(1)} ms.</p></div>
      <ol class="steps">${STEPS.map(([what, algo, big, key]) => `
        <li><span class="what">${what}</span><span class="how">${algo}${big ? ` <code>${big}</code>` : ''}</span><span class="ms">${ms(key)}</span></li>`).join('')}
      </ol>
    </section>

    <section class="card">
      <div class="card-head"><h2>AVL tree</h2><p>Topics stored by name. Numbers are how often each was asked.</p></div>
      <div class="kv">
        <div><b>${n}</b>topics</div>
        <div><b>${t.height}</b>AVL height</div>
        <div><b>${r.bstHeight}</b>plain BST height</div>
        <div><b>${n ? Math.ceil(Math.log2(n + 1)) : 0}</b>best possible</div>
        <div><b>${rot.LL + rot.RR + rot.LR + rot.RL}</b>rotations (LL ${rot.LL}, RR ${rot.RR}, LR ${rot.LR}, RL ${rot.RL})</div>
      </div>
      <div class="scroll-x">${treeSVG(t.root, (node) => node.data.display)}</div>
      <details style="margin-top:10px"><summary>Traversals</summary>
        <p class="small"><strong>Pre-order</strong> (used to save the tree): ${t.preOrder().map((x) => esc(x.data.display)).join(', ')}</p>
        <p class="small"><strong>Post-order</strong> (safe order to free it): ${t.postOrder().map((x) => esc(x.data.display)).join(', ')}</p>
      </details>
    </section>

    <section class="card">
      <div class="card-head"><h2>Merged spellings</h2><p>Names joined by LCS similarity or by an <code>@alias</code> line.</p></div>
      ${merges.length ? `<div class="scroll-x"><table class="list"><thead><tr><th>Written as</th><th>Counted as</th><th class="num">Match</th></tr></thead><tbody>${
        merges.map((m) => `<tr><td>${esc(m.raw)}</td><td>${esc(name(m.key))}</td><td class="num">${m.via === 'alias' ? 'alias' : m.score.toFixed(2)}</td></tr>`).join('')
      }</tbody></table></div>` : '<p class="small muted">Nothing needed merging.</p>'}
    </section>

    <div class="grid-2" style="margin-top:12px">
      <section class="card">
        <div class="card-head"><h2>Units asked together</h2><p>Fixed 5 × 5 adjacency matrix.</p></div>
        <div class="scroll-x"><table class="grid"><thead><tr><th></th>${r.unitMatrix.map((_, i) => `<th>U${i + 1}</th>`).join('')}</tr></thead><tbody>${
          r.unitMatrix.map((row, i) => `<tr><th>U${i + 1}</th>${row.map((v) => `<td style="background:color-mix(in srgb, var(--accent) ${Math.min(60, v * 6)}%, transparent)">${v}</td>`).join('')}</tr>`).join('')
        }</tbody></table></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Paper overlap</h2><p>How much of one paper's topic order repeats in another.</p></div>
        ${r.years.length < 2 ? '<p class="small muted">Needs two or more papers.</p>' : `<div class="scroll-x"><table class="grid"><thead><tr><th></th>${r.years.map((y) => `<th>${esc(y)}</th>`).join('')}</tr></thead><tbody>${
          r.paperSimilarity.map((row, i) => `<tr><th>${esc(r.years[i])}</th>${row.map((v, j) => (i === j ? '<td>–</td>' : `<td style="background:color-mix(in srgb, var(--accent) ${Math.round(v * 60)}%, transparent)">${Math.round(v * 100)}%</td>`)).join('')}</tr>`).join('')
        }</tbody></table></div>`}
      </section>
    </div>
    <section class="card" style="margin-top:12px">
      <div class="card-head"><h2>Project progress</h2><p>Status after the latest review.</p></div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="60" aria-label="Project progress">
        <span style="width:60%"></span>
      </div>
      <p class="progress-label"><b>60%</b> complete</p>
      <div class="grid-2">
        <div>
          <h3>Review feedback</h3>
          <ul class="status-list">${PROGRESS.feedback.map(([text, st]) => `<li><span>${text}</span><span class="st ${st.toLowerCase().replace(/ /g, '-')}">${st}</span></li>`).join('')}</ul>
        </div>
        <div>
          <h3>Methodology: incremental model</h3>
          <p class="small">The pipeline was split into stages. Each stage adds one data structure and is built and tested before the next one starts: the tree layer in month 1, then the graph and DP layer in month 2. Review feedback goes into the next increment.</p>
          <h3>Work done</h3>
          <ul class="small done-list">
            <li>Implementation of all nine stages, with upload of PDF, Word and PowerPoint papers</li>
            <li>In-depth study of Unit 1 (BST, AVL, heap, heap sort) and Unit 2 (BFS, DFS, MST, Dijkstra)</li>
            <li>Unit 3 concepts: 0/1 knapsack and LCS with dynamic programming</li>
          </ul>
        </div>
      </div>
    </section>
    <p class="small muted" style="margin-top:16px">Design notes and the reasons behind each choice are in the <a href="https://github.com/utk042/DSA_PBL/blob/HEAD/REPORT.md">project report</a>.</p>`;

  const th = el.querySelector('#threshold');
  th.addEventListener('input', () => { th.previousElementSibling.querySelector('output').textContent = Number(th.value).toFixed(2); });
  th.addEventListener('change', () => { state.threshold = Number(th.value); run(); });
  el.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { state.edgeScope = b.dataset.scope; run(); }));
}

loadPreset('five');
