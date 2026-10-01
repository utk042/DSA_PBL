// The full pipeline (Section 2 of the report), wired stage by stage.

import { parse } from './parser.js';
import { Normaliser, canonical } from './normalise.js';
import { AVLTree, PlainBST } from './avl.js';
import { topN, heapSort } from './heap.js';
import { TopicGraph } from './graph.js';
import { knapsack, greedyByValue, lcs } from './dp.js';

export const DEFAULTS = {
  threshold: 0.88,     // LCS similarity needed to merge two keyword variants
  topN: 10,
  edgeScope: 'question', // 'question' | 'unit'
  budgetHours: 12,
  value: 'frequency',  // 'frequency' | 'marks'
  defaultHours: 2,     // study-hour estimate for topics without an @hours line
};

const now = () => (globalThis.performance ? performance.now() : Date.now());
const mostCommon = (counts) => [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];

export function analyse(text, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const timings = {};
  const time = (name, fn) => { const t = now(); const r = fn(); timings[name] = now() - t; return r; };

  // [1] Parser
  const parsed = time('parse', () => parse(text));

  // [2] Normaliser — every raw keyword resolved to one canonical key
  const normaliser = new Normaliser({ threshold: opt.threshold, aliases: parsed.aliases });
  const questions = time('normalise', () => {
    const out = [];
    for (const paper of parsed.papers) {
      for (const q of paper.questions) {
        const keys = [];
        const raws = [];
        for (const raw of q.topics) {
          const key = normaliser.resolve(raw);
          if (key && !keys.includes(key)) { keys.push(key); raws.push(raw); }
        }
        if (keys.length) out.push({ year: paper.year, id: q.id, unit: q.unit, marks: q.marks, keys, raws });
      }
    }
    return out;
  });
  const hoursByKey = new Map();
  for (const [raw, hrs] of parsed.hours) {
    const key = normaliser.resolve(raw);
    if (key) hoursByKey.set(key, hrs);
  }

  // [3] Topic store — AVL search-then-update, with a plain BST fed the same keys for comparison
  const tree = new AVLTree();
  const bst = new PlainBST();
  const insertionOrder = [];
  time('store', () => {
    for (const q of questions) {
      const share = q.marks ? q.marks / q.keys.length : 0;
      q.keys.forEach((key, i) => {
        tree.upsert(
          key,
          () => {
            insertionOrder.push(key);
            bst.insert(key);
            return {
              key, frequency: 0, marks: 0, years: [], unitCounts: new Map(), variants: new Map(),
              studyHours: hoursByKey.get(key) ?? opt.defaultHours, hoursEstimated: !hoursByKey.has(key),
            };
          },
          (d) => {
            d.frequency++;
            d.marks += share;
            if (!d.years.includes(q.year)) { d.years.push(q.year); d.years.sort((a, b) => a - b); }
            d.unitCounts.set(q.unit, (d.unitCounts.get(q.unit) || 0) + 1);
            d.variants.set(q.raws[i], (d.variants.get(q.raws[i]) || 0) + 1);
          },
        );
      });
    }
  });
  for (const n of tree.inOrder()) {
    n.data.unit = mostCommon(n.data.unitCounts) ?? 0;
    // Prefer a spelled-out variant ("Binary Search Tree") over an alias ("BST") for display
    const spelled = [...n.data.variants].filter(([raw]) => canonical(raw) === n.key);
    n.data.display = mostCommon(spelled.length ? spelled : n.data.variants) ?? n.key;
  }

  // In-order → alphabetical table, the input to every later stage
  const table = time('inorder', () => tree.inOrder().map((n) => n.data));
  const topic = new Map(table.map((d) => [d.key, d]));

  // [4] Ranking — Max-Heap, Top-N via the priority queue, Heap Sort for the full list
  const top = time('topN', () => topN(table, opt.topN));
  const ranked = time('heapSort', () => heapSort(table));

  // [5] Co-occurrence graph
  const graph = new TopicGraph();
  time('graph', () => {
    for (const d of table) graph.addVertex(d.key);
    const groups = opt.edgeScope === 'unit' ? groupByUnit(questions) : questions.map((q) => q.keys);
    for (const keys of groups) {
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) graph.addCooccurrence(keys[i], keys[j]);
    }
  });

  // [6] Clusters — DFS connected components, each ordered by frequency
  const clusters = time('components', () =>
    graph.components(ranked.map((d) => d.key)).map((keys) => {
      const members = heapSort(keys.map((k) => topic.get(k)));
      return { keys: members.map((d) => d.key), frequency: members.reduce((s, d) => s + d.frequency, 0) };
    }),
  );

  // [7] Revision routes — Kruskal backbone (whole forest) and Prim order from each cluster's top topic
  const kruskal = time('kruskal', () => graph.kruskal());
  const prim = time('prim', () => clusters.map((c) => graph.prim(c.keys[0])));

  // [9] Allocator — 0/1 Knapsack vs greedy baseline
  const items = table.map((d) => ({
    key: d.key,
    hours: d.studyHours,
    value: opt.value === 'marks' ? Math.round(d.marks * 10) / 10 : d.frequency,
  }));
  const allocation = time('knapsack', () => knapsack(items, opt.budgetHours));
  const greedy = greedyByValue(items, opt.budgetHours);

  // Paper-level LCS: how much one year's topic sequence repeats another's
  const years = parsed.papers.map((p) => p.year);
  const sequences = new Map(years.map((y) => [y, questions.filter((q) => q.year === y).flatMap((q) => q.keys)]));
  const paperSimilarity = time('paperLCS', () =>
    years.map((a) => years.map((b) => {
      const A = sequences.get(a);
      const B = sequences.get(b);
      const longest = Math.max(A.length, B.length);
      return longest ? lcs(A, B).length / longest : 0;
    })),
  );

  return {
    options: opt,
    parsed,
    warnings: parsed.warnings,
    questions,
    normaliser,
    tree,
    bstHeight: bst.height,
    insertionOrder,
    table,
    topic,
    top,
    ranked,
    graph,
    clusters,
    kruskal,
    prim,
    items,
    allocation,
    greedy,
    years,
    paperSimilarity,
    unitMatrix: graph.unitMatrix((k) => topic.get(k).unit),
    timings,
  };
}

/** Edge scope "unit": every topic in the same unit of the same paper is linked. */
function groupByUnit(questions) {
  const groups = new Map();
  for (const q of questions) {
    const id = `${q.year}|${q.unit}`;
    if (!groups.has(id)) groups.set(id, []);
    for (const k of q.keys) if (!groups.get(id).includes(k)) groups.get(id).push(k);
  }
  return [...groups.values()];
}
