import { analyse, DEFAULTS } from './core/analyser.js';
import { PRESETS } from './samples.js';
import { treeSVG, graphSVG, clusterColor } from './viz.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x, d = 2) => (Number.isInteger(x) ? String(x) : x.toFixed(d));

let result = null;
const state = { djFrom: null, djTo: null, bfsFrom: null };

// ---------- input wiring ----------

$('preset').innerHTML = PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
$('threshold').value = DEFAULTS.threshold;
$('topn').value = DEFAULTS.topN;
$('scope').value = DEFAULTS.edgeScope;
$('value').value = DEFAULTS.value;

function loadPreset(id) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  $('preset').value = p.id;
  $('text').value = p.text;
  $('budget').value = p.budgetHours;
  Object.assign(state, { djFrom: null, djTo: null, bfsFrom: null });
  run();
}

$('preset').addEventListener('change', (e) => loadPreset(e.target.value));
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $('text').value = await f.text();
  Object.assign(state, { djFrom: null, djTo: null, bfsFrom: null });
  run();
});
$('format-toggle').addEventListener('click', (e) => {
  const open = $('format-help').hidden;
  $('format-help').hidden = !open;
  e.currentTarget.setAttribute('aria-expanded', String(open));
});

let timer = null;
const later = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
$('text').addEventListener('input', later);
for (const id of ['threshold', 'topn', 'scope', 'value', 'budget']) $(id).addEventListener('input', run);

$('bfs-from').addEventListener('change', (e) => { state.bfsFrom = e.target.value; renderBFS(); });
$('dj-from').addEventListener('change', (e) => { state.djFrom = e.target.value; renderDijkstra(); });
$('dj-to').addEventListener('change', (e) => { state.djTo = e.target.value; renderDijkstra(); });

// ---------- pipeline ----------

function run() {
  $('threshold-out').textContent = Number($('threshold').value).toFixed(2);
  $('budget-out').textContent = `${$('budget').value} h`;
  result = analyse($('text').value, {
    threshold: Number($('threshold').value),
    topN: Math.max(1, Number($('topn').value) || DEFAULTS.topN),
    edgeScope: $('scope').value,
    value: $('value').value,
    budgetHours: Number($('budget').value),
  });
  const keys = result.ranked.map((d) => d.key);
  if (!keys.includes(state.bfsFrom)) state.bfsFrom = keys[0] ?? null;
  if (!keys.includes(state.djFrom)) state.djFrom = keys[0] ?? null;
  if (!keys.includes(state.djTo)) state.djTo = pickTarget(keys) ?? null;

  const w = result.warnings;
  $('warnings').hidden = !w.length;
  $('warnings').textContent = w.slice(0, 6).join('\n') + (w.length > 6 ? `\n…and ${w.length - 6} more` : '');

  renderStats();
  renderNormaliser();
  renderStore();
  renderRanking();
  renderClusters();
  renderSelects();
  renderBFS();
  renderDijkstra(); // also draws the graph
  renderUnitMatrix();
  renderAllocation();
  renderPaperLCS();
  renderComplexity();
}

/** Default bridge target: the farthest reachable topic from the source, so the path is interesting. */
function pickTarget(keys) {
  if (!state.djFrom) return keys[1];
  const { dist } = result.graph.dijkstra(state.djFrom);
  let best = null;
  for (const [k, d] of dist) if (k !== state.djFrom && (best === null || d > dist.get(best))) best = k;
  return best ?? keys[1];
}

const name = (k) => result.topic.get(k)?.display ?? k;

// ---------- renderers ----------

function renderStats() {
  const r = result;
  const raw = r.parsed.papers.reduce((s, p) => s + p.questions.reduce((t, q) => t + q.topics.length, 0), 0);
  const stats = [
    [r.parsed.papers.length, 'papers'],
    [r.questions.length, 'questions'],
    [raw, 'raw keywords'],
    [r.table.length, 'distinct topics'],
    [`${r.tree.height} <small class="muted">vs ${r.bstHeight}</small>`, 'AVL vs plain BST height'],
    [`${r.graph.vertexCount} / ${r.graph.edgeCount}`, 'vertices / edges'],
    [r.clusters.length, 'clusters'],
  ];
  $('stats').innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
}

function renderNormaliser() {
  const r = result;
  const multi = r.table.filter((d) => d.variants.size > 1).sort((a, b) => b.variants.size - a.variants.size || b.frequency - a.frequency);
  const merges = r.normaliser.merges;
  const mergeRows = merges.map((m) => `<tr><td>${esc(m.raw)}</td><td>${esc(name(m.key))}</td><td>${m.via === 'alias' ? 'alias' : 'LCS'}</td><td class="num">${m.via === 'alias' ? '—' : m.score.toFixed(2)}</td></tr>`).join('');
  $('normalise').innerHTML = `
    <div class="mini-stats">
      <div>Raw spellings → topics: <b>${r.table.reduce((s, d) => s + d.variants.size, 0)} → ${r.table.length}</b></div>
      <div>LCS comparisons: <b>${r.normaliser.comparisons}</b></div>
    </div>
    ${merges.length ? `<h3>Merges the clean-up alone could not make</h3>
    <div class="scroll-x"><table class="data"><thead><tr><th>Keyword as written</th><th>Merged into</th><th>By</th><th class="num">Similarity</th></tr></thead><tbody>${mergeRows}</tbody></table></div>` : ''}
    ${multi.length ? `<h3>Topics that arrived under several spellings</h3>
    <div class="scroll-x"><table class="data"><thead><tr><th>Topic</th><th>Spellings seen (count)</th></tr></thead><tbody>
    ${multi.map((d) => `<tr><td>${esc(d.display)}</td><td>${[...d.variants].map(([v, c]) => `<span class="chip merged">${esc(v)} · ${c}</span>`).join('')}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No variants to merge.</p>'}`;
}

function renderStore() {
  const r = result;
  const t = r.tree;
  const n = t.size;
  const ideal = n ? Math.ceil(Math.log2(n + 1)) : 0;
  const rot = t.rotations;
  $('store-stats').innerHTML = [
    ['Topics (n)', n],
    ['AVL height', t.height],
    ['⌈log₂(n+1)⌉', ideal],
    ['Plain BST height, same insert order', r.bstHeight],
    ['Rotations LL / RR / LR / RL', `${rot.LL} / ${rot.RR} / ${rot.LR} / ${rot.RL}`],
    ['Key comparisons', t.comparisons],
  ].map(([l, v]) => `<div>${l}: <b>${v}</b></div>`).join('');
  $('tree').innerHTML = treeSVG(t.root, (node) => node.data.display);

  const keys = (list) => list.map((node) => esc(node.data.display)).join(' → ');
  $('traversals').innerHTML = `
    <p><b>Pre-order</b> (save / reload preserves shape): ${keys(t.preOrder())}</p>
    <p><b>Post-order</b> (free children before parent): ${keys(t.postOrder())}</p>
    <p><b>Insertion order</b> (first sighting of each topic): ${r.insertionOrder.map((k) => esc(name(k))).join(', ')}</p>`;

  $('table').innerHTML = `<thead><tr><th>Topic</th><th class="num">Frequency</th><th class="num">Marks</th><th>Years</th><th class="num">Unit</th><th class="num">Study hours</th></tr></thead><tbody>${
    r.table.map((d) => `<tr><td>${esc(d.display)}</td><td class="num">${d.frequency}</td><td class="num">${fmt(d.marks, 1)}</td><td>${d.years.join(', ')}</td><td class="num">${d.unit || '—'}</td><td class="num">${fmt(d.studyHours, 1)}${d.hoursEstimated ? ' <span class="est">default</span>' : ''}</td></tr>`).join('')
  }</tbody>`;
}

function renderRanking() {
  const r = result;
  const max = Math.max(1, ...r.top.map((d) => d.frequency));
  $('topn-list').innerHTML = r.top.map((d, i) => `
    <div class="bar"><span class="rank">${i + 1}</span><span class="name" title="${esc(d.display)}">${esc(d.display)}</span>
      <span class="track"><span class="fill" style="width:${(100 * d.frequency) / max}%"></span><span class="val">${d.frequency}</span></span></div>`).join('')
    || '<p class="muted">No topics yet.</p>';
  $('ranked').innerHTML = r.ranked.map((d) => `<li>${esc(d.display)} <span class="muted">(${d.frequency})</span></li>`).join('');
}

function renderClusters() {
  const r = result;
  $('clusters').innerHTML = r.clusters.map((c, i) => {
    const p = r.prim[i];
    const members = new Set(c.keys);
    const kEdges = r.kruskal.edges.filter((e) => members.has(e.u));
    const route = p.order.map((k) => `<span>${esc(name(k))}</span>`).join('<i>→</i>');
    return `<div class="cluster" style="--c:${clusterColor(i)}">
      <h4><span>Cluster ${i + 1}</span><span class="muted">${c.keys.length} topic${c.keys.length > 1 ? 's' : ''} · asked ${c.frequency}×</span></h4>
      <div class="route">${route}</div>
      ${kEdges.length ? `<small>Kruskal backbone: ${kEdges.map((e) => `${esc(name(e.u))} – ${esc(name(e.v))} (${e.count}×)`).join('; ')}<br>Total weight: Kruskal ${fmt(kEdges.reduce((s, e) => s + e.weight, 0))} · Prim ${fmt(p.total)}</small>` : '<small>Isolated topic — revise on its own.</small>'}
    </div>`;
  }).join('');
}

function renderSelects() {
  const opts = result.ranked.map((d) => `<option value="${esc(d.key)}">${esc(d.display)} (${d.frequency})</option>`).join('');
  for (const [id, key] of [['bfs-from', 'bfsFrom'], ['dj-from', 'djFrom'], ['dj-to', 'djTo']]) {
    $(id).innerHTML = opts;
    if (state[key]) $(id).value = state[key];
  }
}

function renderBFS() {
  if (!state.bfsFrom) { $('bfs').innerHTML = ''; return; }
  const levels = new Map();
  for (const v of result.graph.bfs(state.bfsFrom)) {
    if (!levels.has(v.level)) levels.set(v.level, []);
    levels.get(v.level).push(v.key);
  }
  $('bfs').innerHTML = levels.size <= 1
    ? '<p class="note">Never asked together with any other topic.</p>'
    : `<div class="levels">${[...levels].slice(1).map(([lvl, ks]) =>
      `<div><b>${lvl === 1 ? 'Directly with' : `${lvl} hops`}</b>${ks.map((k) => `<span class="chip">${esc(name(k))}${lvl === 1 ? ` · ${result.graph.count(state.bfsFrom, k)}×` : ''}</span>`).join('')}</div>`).join('')}</div>`;
}

function renderDijkstra() {
  const r = result;
  let path = null;
  let html = '';
  if (state.djFrom && state.djTo) {
    if (state.djFrom === state.djTo) html = '<p class="note">Pick two different topics.</p>';
    else {
      path = r.graph.shortestPath(state.djFrom, state.djTo);
      if (!path) html = `<p class="note">No chain links <b>${esc(name(state.djFrom))}</b> to <b>${esc(name(state.djTo))}</b> — they sit in different clusters. Revise the target's cluster on its own.</p>`;
      else {
        const mids = path.path.slice(1, -1);
        html = `<div class="route">${path.path.map((k, i) => `<span class="${i === 0 || i === path.path.length - 1 ? 'end' : 'mid'}">${esc(name(k))}</span>`).join('<i>→</i>')}</div>
          <p class="note" style="margin-top:8px">Path weight ${fmt(path.cost)} (sum of 1/count). ${mids.length ? `Bridge topic${mids.length > 1 ? 's' : ''} to cover next: <b>${mids.map((k) => esc(name(k))).join(', ')}</b>.` : 'They are asked together directly — no bridge needed.'}</p>`;
      }
    }
  }
  $('dijkstra').innerHTML = `<div class="path-out">${html}</div>`;
  $('graph').innerHTML = r.graph.vertexCount
    ? graphSVG(r.graph, r.clusters, r.topic, { highlight: path ? path.path : [], mst: r.kruskal.edges })
    : '<p class="note" style="padding:12px">No topics yet.</p>';
}

function renderUnitMatrix() {
  const M = result.unitMatrix;
  $('unit-matrix').innerHTML = `<thead><tr><th></th>${M.map((_, i) => `<th>U${i + 1}</th>`).join('')}</tr></thead><tbody>${
    M.map((row, i) => `<tr><th>U${i + 1}</th>${row.map((v) => `<td style="background:color-mix(in srgb, var(--accent) ${Math.min(70, v * 7)}%, transparent)">${v}</td>`).join('')}</tr>`).join('')
  }</tbody>`;
}

function renderAllocation() {
  const r = result;
  const { allocation: a, greedy: g, options } = r;
  const unit = options.value === 'marks' ? 'marks' : 'frequency';
  const item = new Map(r.items.map((it) => [it.key, it]));
  const list = (keys) => keys.map((k) => `<li>${esc(name(k))} <span class="muted">— ${fmt(item.get(k).hours, 1)} h, ${unit} ${fmt(item.get(k).value, 1)}</span></li>`).join('');
  const diff = a.value - g.value;
  $('alloc').innerHTML = `
    <p class="note">${options.budgetHours} revision hours. Each topic is taken whole or not at all (0/1), weight = study hours, value = ${unit}. Hours are filled in half-hour slots, so W = ${a.slots}. Change the budget with the slider above.</p>
    <div class="alloc">
      <div class="box win"><h4>0/1 Knapsack (DP)</h4><div class="big">${fmt(a.value, 1)}</div><span class="muted">${unit} in ${fmt(a.hours, 1)} h · ${a.chosen.length} topics</span><ul>${list(a.chosen)}</ul></div>
      <div class="box"><h4>Greedy: most-asked first</h4><div class="big">${fmt(g.value, 1)}</div><span class="muted">${unit} in ${fmt(g.hours, 1)} h · ${g.chosen.length} topics</span><ul>${list(g.chosen)}</ul></div>
    </div>
    <p class="verdict">${diff > 1e-9
      ? `DP beats greedy by <b>${fmt(diff, 1)}</b> ${unit} in the same ${options.budgetHours} hours — greedy commits to big topics early and strands the leftover time.`
      : 'At this budget greedy happens to match the optimum. Move the hours slider — at many budgets it falls short.'}</p>`;
}

function renderPaperLCS() {
  const { years, paperSimilarity: S } = result;
  $('paper-lcs').innerHTML = years.length < 2 ? '<tbody><tr><td>Needs at least two papers.</td></tr></tbody>'
    : `<thead><tr><th></th>${years.map((y) => `<th>${y}</th>`).join('')}</tr></thead><tbody>${
      S.map((row, i) => `<tr><th>${years[i]}</th>${row.map((v, j) => `<td style="background:${i === j ? 'var(--soft)' : `color-mix(in srgb, var(--accent) ${Math.round(v * 70)}%, transparent)`}">${i === j ? '—' : `${Math.round(v * 100)}%`}</td>`).join('')}</tr>`).join('')
    }</tbody>`;
}

const COMPLEXITY = [
  ['Merge topic variants', 'LCS', 'O(mn)', 'normalise'],
  ['Store a topic / find and update', 'AVL insert / search', 'O(log n)', 'store'],
  ['Emit topic table', 'In-order traversal', 'O(n)', 'inorder'],
  ['Top-N', 'Max-Heap build + extract', 'O(n + N log n)', 'topN'],
  ['Full ranked list', 'Heap Sort', 'O(n log n)', 'heapSort'],
  ['Build graph', 'Adjacency list', 'O(V + E)', 'graph'],
  ['Detect clusters', 'DFS + components', 'O(V + E)', 'components'],
  ['Revision backbone', 'Kruskal + union-find', 'O(E log E)', 'kruskal'],
  ['Revision order', 'Prim (binary heap)', 'O(E log V)', 'prim'],
  ['Bridge topics', 'Dijkstra (binary heap)', 'O((V + E) log V)', null],
  ['Time-bounded shortlist', '0/1 Knapsack', 'O(nW)', 'knapsack'],
  ['Paper repetition', 'LCS on sequences', 'O(mn) per pair', 'paperLCS'],
];

function renderComplexity() {
  const t = result.timings;
  const total = Object.values(t).reduce((s, x) => s + x, 0);
  $('timing-total').textContent = `whole pipeline ${total.toFixed(1)} ms`;
  $('complexity').innerHTML = `<thead><tr><th>Stage</th><th>Structure / algorithm</th><th>Worst case</th><th class="num">This run</th></tr></thead><tbody>${
    COMPLEXITY.map(([stage, algo, big, key]) => `<tr><td>${stage}</td><td>${algo}</td><td><code>${big}</code></td><td class="num">${key ? `${t[key].toFixed(2)} ms` : 'on demand'}</td></tr>`).join('')
  }</tbody>`;
}

loadPreset(PRESETS[0].id);
