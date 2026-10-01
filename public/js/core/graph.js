// Stages 5–8 — the co-occurrence graph.
// Vertex = canonical topic key. Edge = two topics asked in the same question
// (or the same unit of the same paper). Weight = 1 / count, so "asked
// together often" becomes "close" for the MST and shortest-path algorithms.
// Stored as an adjacency list because the graph is sparse.

import { BinaryHeap } from './heap.js';

export class TopicGraph {
  constructor() {
    this.adj = new Map(); // key -> Map(neighbour -> co-occurrence count)
  }

  addVertex(v) {
    if (!this.adj.has(v)) this.adj.set(v, new Map());
  }

  addCooccurrence(a, b) {
    if (a === b) return;
    this.addVertex(a);
    this.addVertex(b);
    this.adj.get(a).set(b, (this.adj.get(a).get(b) || 0) + 1);
    this.adj.get(b).set(a, (this.adj.get(b).get(a) || 0) + 1);
  }

  get vertexCount() { return this.adj.size; }
  get edgeCount() {
    let deg = 0;
    for (const m of this.adj.values()) deg += m.size;
    return deg / 2;
  }

  count(a, b) { return this.adj.get(a)?.get(b) || 0; }
  weight(a, b) { const c = this.count(a, b); return c ? 1 / c : Infinity; }

  /** Each undirected edge once: { u, v, count, weight }. */
  edges() {
    const out = [];
    for (const [u, m] of this.adj) {
      for (const [v, count] of m) if (u < v) out.push({ u, v, count, weight: 1 / count });
    }
    return out;
  }

  /** BFS, O(V + E): what is asked alongside `start`, level by level. */
  bfs(start) {
    if (!this.adj.has(start)) return [];
    const seen = new Map([[start, { key: start, level: 0, parent: null }]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head];
      const neighbours = [...this.adj.get(u)].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
      for (const [v] of neighbours) {
        if (seen.has(v)) continue;
        seen.set(v, { key: v, level: seen.get(u).level + 1, parent: u });
        queue.push(v);
      }
    }
    return queue.map((k) => seen.get(k));
  }

  /** Iterative DFS from `start`, O(V + E) over the whole graph. */
  dfs(start, visited = new Set()) {
    const order = [];
    const stack = [start];
    while (stack.length) {
      const u = stack.pop();
      if (visited.has(u)) continue;
      visited.add(u);
      order.push(u);
      const neighbours = [...this.adj.get(u).keys()].sort().reverse();
      for (const v of neighbours) if (!visited.has(v)) stack.push(v);
    }
    return order;
  }

  /** Connected components via repeated DFS, O(V + E). */
  components(vertexOrder = [...this.adj.keys()]) {
    const visited = new Set();
    const comps = [];
    for (const v of vertexOrder) if (!visited.has(v)) comps.push(this.dfs(v, visited));
    return comps;
  }

  /** Kruskal's minimum spanning forest with union-find, O(E log E). */
  kruskal() {
    const parent = new Map([...this.adj.keys()].map((v) => [v, v]));
    const rank = new Map([...this.adj.keys()].map((v) => [v, 0]));
    const find = (x) => {
      while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
      return x;
    };
    const union = (a, b) => {
      let ra = find(a);
      let rb = find(b);
      if (ra === rb) return false;
      if (rank.get(ra) < rank.get(rb)) [ra, rb] = [rb, ra];
      parent.set(rb, ra);
      if (rank.get(ra) === rank.get(rb)) rank.set(ra, rank.get(ra) + 1);
      return true;
    };
    const sorted = this.edges().sort((a, b) => a.weight - b.weight || (a.u + a.v < b.u + b.v ? -1 : 1));
    const tree = [];
    for (const e of sorted) if (union(e.u, e.v)) tree.push(e);
    return { edges: tree, total: tree.reduce((s, e) => s + e.weight, 0) };
  }

  /** Prim's MST of the component containing `start`, O(E log V). Returns visit order too. */
  prim(start) {
    const inTree = new Set([start]);
    const order = [start];
    const edges = [];
    const pq = new BinaryHeap((a, b) => a.weight < b.weight || (a.weight === b.weight && a.v < b.v));
    const pushFrom = (u) => {
      for (const [v, count] of this.adj.get(u)) if (!inTree.has(v)) pq.push({ u, v, count, weight: 1 / count });
    };
    pushFrom(start);
    while (pq.size) {
      const e = pq.pop();
      if (inTree.has(e.v)) continue;
      inTree.add(e.v);
      order.push(e.v);
      edges.push(e);
      pushFrom(e.v);
    }
    return { order, edges, total: edges.reduce((s, e) => s + e.weight, 0) };
  }

  /** Dijkstra with the binary heap, O((V + E) log V). Weights are 1/count > 0. */
  dijkstra(source) {
    const dist = new Map([[source, 0]]);
    const prev = new Map();
    const done = new Set();
    const pq = new BinaryHeap((a, b) => a.d < b.d);
    pq.push({ v: source, d: 0 });
    while (pq.size) {
      const { v: u, d } = pq.pop();
      if (done.has(u)) continue;
      done.add(u);
      for (const [v, count] of this.adj.get(u)) {
        const nd = d + 1 / count;
        if (nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd);
          prev.set(v, u);
          pq.push({ v, d: nd });
        }
      }
    }
    return { dist, prev };
  }

  /** Bridge topics: shortest weighted path from `a` to `b`, or null if unreachable. */
  shortestPath(a, b) {
    if (!this.adj.has(a) || !this.adj.has(b)) return null;
    const { dist, prev } = this.dijkstra(a);
    if (!dist.has(b)) return null;
    const path = [b];
    while (path[0] !== a) path.unshift(prev.get(path[0]));
    return { path, cost: dist.get(b) };
  }

  /** Fixed unit × unit adjacency matrix: co-occurrences between syllabus units. */
  unitMatrix(unitOf, units = 5) {
    const M = Array.from({ length: units }, () => new Array(units).fill(0));
    for (const { u, v, count } of this.edges()) {
      const a = unitOf(u) - 1;
      const b = unitOf(v) - 1;
      if (a < 0 || b < 0 || a >= units || b >= units) continue;
      M[a][b] += count;
      if (a !== b) M[b][a] += count;
    }
    return M;
  }
}
