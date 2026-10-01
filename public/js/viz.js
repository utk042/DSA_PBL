// SVG renderers for the AVL tree and the co-occurrence graph. No dependencies.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CLUSTER_COLORS = ['#2a78d6', '#d9622b', '#1f9e78', '#b8467c', '#7a5bd1', '#b58a0f', '#3a9fb0', '#c4433a'];
export const clusterColor = (i) => (i < CLUSTER_COLORS.length ? CLUSTER_COLORS[i] : 'var(--muted)');

const short = (s, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** AVL tree: x from in-order rank, y from depth. */
export function treeSVG(root, label = (n) => n.key) {
  if (!root) return '<p class="muted">Empty tree.</p>';
  const nodes = [];
  let rank = 0;
  const walk = (n, depth) => {
    if (!n) return null;
    const l = walk(n.left, depth + 1);
    const me = { n, depth, x: rank++ };
    nodes.push(me);
    const r = walk(n.right, depth + 1);
    me.l = l; me.r = r;
    return me;
  };
  walk(root, 0);
  const dx = 64;
  const dy = 62;
  const W = rank * dx + 20;
  const H = (Math.max(...nodes.map((p) => p.depth)) + 1) * dy + 10;
  const px = (p) => 10 + p.x * dx + dx / 2;
  const py = (p) => 26 + p.depth * dy;
  const lines = nodes.flatMap((p) => [p.l, p.r].filter(Boolean).map((c) =>
    `<line x1="${px(p)}" y1="${py(p)}" x2="${px(c)}" y2="${py(c)}" class="edge"/>`)).join('');
  const circles = nodes.map((p) => `
    <g class="tnode"><title>${esc(label(p.n))}: asked ${p.n.data.frequency}×, height ${p.n.height}</title>
      <circle cx="${px(p)}" cy="${py(p)}" r="15"/>
      <text x="${px(p)}" y="${py(p) + 4}" class="freq">${p.n.data.frequency}</text>
      <text x="${px(p)}" y="${py(p) + 30}" class="lbl">${esc(short(label(p.n), 11))}</text>
    </g>`).join('');
  return `<svg class="tree-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="AVL tree">${lines}${circles}</svg>`;
}

/**
 * Deterministic force-directed layout (Fruchterman–Reingold). Each cluster is
 * laid out in its own box, sized by cluster size, and boxes are shelf-packed.
 */
export function layout(graph, clusters, W) {
  const pos = new Map();
  const boxes = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of clusters) {
    const n = c.keys.length;
    const bw = Math.min(W, n === 1 ? 170 : Math.max(320, 125 * Math.sqrt(n) * 1.5));
    const bh = n === 1 ? 90 : Math.max(140, 100 * Math.sqrt(n));
    if (x + bw > W) { x = 0; y += rowH; rowH = 0; }
    boxes.push({ c, x, y, w: bw, h: bh });
    x += bw;
    rowH = Math.max(rowH, bh);
  }
  const H = y + rowH;
  for (const box of boxes) placeCluster(graph, box, pos);
  return { pos, H };
}

function placeCluster(graph, { c, x, y, w, h }, pos) {
  const keys = c.keys;
  const padX = 70;
  const padY = 26;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const local = new Map();
  keys.forEach((k, i) => {
    const a = (2 * Math.PI * i) / keys.length;
    const r = keys.length > 1 ? Math.min(w, h) * 0.3 : 0;
    local.set(k, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  });
  if (keys.length > 1) {
    const inC = new Set(keys);
    const edges = graph.edges().filter((e) => inC.has(e.u));
    const k = Math.max(keys.length <= 3 ? 110 : 0, Math.sqrt(((w - 2 * padX) * (h - 2 * padY)) / keys.length) * 0.75);
    let t = Math.min(w, h) / 6;
    for (let iter = 0; iter < 300; iter++) {
      const disp = new Map(keys.map((v) => [v, { x: 0, y: 0 }]));
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const a = local.get(keys[i]);
          const b = local.get(keys[j]);
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d = Math.hypot(dx, dy);
          if (d < 0.01) { dx = 0.01 * (i - j); dy = 0.01; d = Math.hypot(dx, dy); }
          const f = (k * k) / d;
          disp.get(keys[i]).x += (dx / d) * f; disp.get(keys[i]).y += (dy / d) * f;
          disp.get(keys[j]).x -= (dx / d) * f; disp.get(keys[j]).y -= (dy / d) * f;
        }
      }
      for (const e of edges) {
        const a = local.get(e.u);
        const b = local.get(e.v);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const f = (d * d) / k;
        disp.get(e.u).x -= (dx / d) * f; disp.get(e.u).y -= (dy / d) * f;
        disp.get(e.v).x += (dx / d) * f; disp.get(e.v).y += (dy / d) * f;
      }
      for (const v of keys) {
        const p = local.get(v);
        const dv = disp.get(v);
        dv.x += (cx - p.x) * 0.05; // gravity keeps the cluster centred
        dv.y += (cy - p.y) * 0.05;
        const d = Math.max(0.01, Math.hypot(dv.x, dv.y));
        p.x = Math.min(x + w - padX, Math.max(x + padX, p.x + (dv.x / d) * Math.min(d, t)));
        p.y = Math.min(y + h - padY, Math.max(y + padY, p.y + (dv.y / d) * Math.min(d, t)));
      }
      t = Math.max(0.5, t * 0.98);
    }
  }
  for (const [kk, p] of local) pos.set(kk, p);
}

export function graphSVG(graph, clusters, topic, { highlight = [], mst = [] } = {}) {
  const W = 960;
  const linked = clusters.filter((c) => c.keys.length > 1);
  const { pos, H } = layout(graph, linked, W);
  const clusterOf = new Map();
  clusters.forEach((c, i) => c.keys.forEach((k) => clusterOf.set(k, i)));
  if (!linked.length) return '<p class="graph-empty">No two topics are asked in the same question yet.</p>';
  const maxF = Math.max(1, ...[...topic.values()].map((d) => d.frequency));
  const onPath = new Set();
  for (let i = 0; i + 1 < highlight.length; i++) onPath.add([highlight[i], highlight[i + 1]].sort().join('|'));
  const inMst = new Set(mst.map((e) => [e.u, e.v].sort().join('|')));
  const lines = graph.edges().map((e) => {
    const a = pos.get(e.u);
    const b = pos.get(e.v);
    const id = [e.u, e.v].sort().join('|');
    const cls = onPath.has(id) ? 'gedge path' : inMst.has(id) ? 'gedge mst' : 'gedge';
    return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="${cls}" style="stroke-width:${(1 + Math.min(e.count, 5) * 0.9).toFixed(1)}"><title>${esc(topic.get(e.u).display)} and ${esc(topic.get(e.v).display)}: asked together ${e.count}×</title></line>`;
  }).join('');
  const hl = new Set(highlight);
  const nodes = [...pos].map(([k, p]) => {
    const d = topic.get(k);
    const r = 6 + 10 * (d.frequency / maxF);
    return `<g class="gnode${hl.has(k) ? ' on' : ''}"><title>${esc(d.display)}: asked ${d.frequency}×, group ${clusterOf.get(k) + 1}</title>
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" style="fill:${clusterColor(clusterOf.get(k))}"/>
      <text x="${p.x.toFixed(1)}" y="${(p.y + r + 12).toFixed(1)}">${esc(short(d.display, 18))}</text></g>`;
  }).join('');
  return `<svg class="graph-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Topic co-occurrence graph">${lines}${nodes}</svg>`;
}
