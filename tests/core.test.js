import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AVLTree, PlainBST } from '../public/js/core/avl.js';
import { BinaryHeap, topN, heapSort } from '../public/js/core/heap.js';
import { TopicGraph } from '../public/js/core/graph.js';
import { lcs, similarity, knapsack, greedyByValue } from '../public/js/core/dp.js';
import { canonical, Normaliser } from '../public/js/core/normalise.js';
import { parse } from '../public/js/core/parser.js';
import { analyse } from '../public/js/core/analyser.js';
import { WORKED_EXAMPLE, FIVE_YEARS } from '../public/js/samples.js';

const isAVL = (n) => {
  if (!n) return 0;
  const l = isAVL(n.left);
  const r = isAVL(n.right);
  assert.ok(Math.abs(l - r) <= 1, `unbalanced at ${n.key}`);
  if (n.left) assert.ok(n.left.key < n.key);
  if (n.right) assert.ok(n.right.key > n.key);
  assert.equal(n.height, 1 + Math.max(l, r));
  return n.height;
};

test('AVL stays balanced on sorted input where a plain BST degenerates', () => {
  const tree = new AVLTree();
  const bst = new PlainBST();
  const keys = Array.from({ length: 200 }, (_, i) => `topic ${String(i).padStart(3, '0')}`);
  for (const k of keys) {
    tree.upsert(k, () => ({ frequency: 0 }), (d) => d.frequency++);
    bst.insert(k);
  }
  isAVL(tree.root);
  assert.equal(bst.height, 200);
  assert.ok(tree.height <= Math.ceil(1.44 * Math.log2(202)));
  assert.deepEqual(tree.inOrder().map((n) => n.key), keys);
});

test('AVL exercises all four rotation cases', () => {
  const t = new AVLTree();
  for (const k of ['c', 'b', 'a', 'd', 'e', 'g', 'f', 'h', 'j', 'i', 'k', 'm', 'l']) t.upsert(k, () => ({ frequency: 0 }), (d) => d.frequency++);
  const t2 = new AVLTree();
  for (const k of ['c', 'a', 'b']) t2.upsert(k, () => ({ frequency: 0 }), (d) => d.frequency++);
  isAVL(t.root);
  assert.ok(t.rotations.LL > 0 && t.rotations.RR > 0 && t.rotations.RL > 0);
  assert.equal(t2.rotations.LR, 1);
});

test('upsert updates instead of duplicating', () => {
  const t = new AVLTree();
  for (const k of ['x', 'y', 'x', 'x']) t.upsert(k, () => ({ frequency: 0 }), (d) => d.frequency++);
  assert.equal(t.size, 2);
  assert.equal(t.search('x').data.frequency, 3);
});

test('pre-order serialise/deserialise preserves shape; post-order frees children first', () => {
  const t = new AVLTree();
  for (const k of 'mfqbhpzae'.split('')) t.upsert(k, () => ({ frequency: 1 }), () => {});
  const copy = AVLTree.deserialize(JSON.parse(JSON.stringify(t.serialize())));
  assert.deepEqual(copy.preOrder().map((n) => n.key), t.preOrder().map((n) => n.key));
  assert.equal(copy.height, t.height);
  const rootKey = t.root.key;
  const freed = t.destroy();
  assert.equal(freed.at(-1), rootKey);
  assert.equal(freed.length, 9);
});

test('heap: Top-N and heap sort give descending frequency', () => {
  const pairs = [3, 9, 1, 7, 7, 2, 8].map((f, i) => ({ key: `k${i}`, frequency: f }));
  assert.deepEqual(topN(pairs, 3).map((p) => p.frequency), [9, 8, 7]);
  assert.deepEqual(heapSort(pairs).map((p) => p.frequency), [9, 8, 7, 7, 3, 2, 1]);
  const minHeap = new BinaryHeap((a, b) => a < b);
  [5, 2, 8, 1].forEach((x) => minHeap.push(x));
  assert.deepEqual([minHeap.pop(), minHeap.pop(), minHeap.pop(), minHeap.pop()], [1, 2, 5, 8]);
});

test('graph: components, BFS levels, MST weights agree, Dijkstra path', () => {
  const g = new TopicGraph();
  [['a', 'b'], ['a', 'b'], ['b', 'c'], ['a', 'c'], ['c', 'd'], ['x', 'y']].forEach(([u, v]) => g.addCooccurrence(u, v));
  g.addVertex('solo');
  const comps = g.components().map((c) => c.sort().join(''));
  assert.deepEqual(comps.sort(), ['abcd', 'solo', 'xy']);
  assert.deepEqual(g.bfs('a').map((v) => [v.key, v.level]), [['a', 0], ['b', 1], ['c', 1], ['d', 2]]);
  const k = g.kruskal();
  assert.equal(k.edges.length, 4); // 3 for abcd + 1 for xy
  const p = g.prim('a');
  const kAbcd = k.edges.filter((e) => 'abcd'.includes(e.u)).reduce((s, e) => s + e.weight, 0);
  assert.ok(Math.abs(p.total - kAbcd) < 1e-12);
  assert.deepEqual(g.shortestPath('a', 'd').path, ['a', 'c', 'd']);
  assert.equal(g.shortestPath('a', 'x'), null);
});

test('LCS and similarity', () => {
  assert.equal(lcs('ABCBDAB', 'BDCABA').length, 4);
  assert.deepEqual(lcs(['a', 'b', 'c'], ['a', 'c']).sequence, ['a', 'c']);
  assert.ok(similarity('avl tree', 'avl trees') > 0.88);
  assert.ok(similarity('avl tree', 'b tree') < 0.7);
});

test('knapsack is optimal and beats greedy on the report example at 6 hours', () => {
  const items = [
    { key: 'avl', hours: 3, value: 7 }, { key: 'bst', hours: 2, value: 6 }, { key: 'heap', hours: 2, value: 5 },
    { key: 'graph', hours: 3, value: 4 }, { key: 'dijkstra', hours: 2, value: 3 }, { key: 'mcm', hours: 4, value: 2 },
  ];
  const brute = (W) => {
    let best = 0;
    for (let mask = 0; mask < 1 << items.length; mask++) {
      let h = 0; let v = 0;
      items.forEach((it, i) => { if (mask & (1 << i)) { h += it.hours; v += it.value; } });
      if (h <= W) best = Math.max(best, v);
    }
    return best;
  };
  for (let W = 0; W <= 16; W++) assert.equal(knapsack(items, W).value, brute(W), `W=${W}`);
  assert.equal(knapsack(items, 7).value, 18);
  assert.equal(knapsack(items, 6).value, 14);
  assert.equal(greedyByValue(items, 6).value, 13);
});

test('normaliser merges variants and keeps distinct topics apart', () => {
  assert.equal(canonical('A.V.L. Trees'), 'avl tree');
  assert.equal(canonical("Dijkstra's Algorithm"), 'dijkstra');
  assert.equal(canonical('N-Queens Problem'), 'n queen');
  const n = new Normaliser({ aliases: new Map([['BST', 'Binary Search Tree']]) });
  const k = (s) => n.resolve(s);
  assert.equal(k('Binary Search Tree'), k('BST'));
  assert.equal(k('Heap Sort'), k('Heapsort'));
  assert.equal(k('Graph Colouring'), k('Graph Coloring'));
  for (const [a, b] of [['B Tree', 'B+ Tree'], ['Max Heap', 'Min Heap'], ['BFS', 'DFS'], ['AVL Tree', 'B Tree']]) {
    assert.notEqual(k(a), k(b), `${a} vs ${b}`);
  }
});

test('parser reads directives, years, units and marks', () => {
  const p = parse('@alias X = Y\n@hours Y = 1.5\n=== 2021 ===\n[Unit 3]\nQ1 (10): A, B; C\nD');
  assert.equal(p.papers[0].year, 2021);
  assert.deepEqual(p.papers[0].questions[0], { id: 'Q1', unit: 3, marks: 10, topics: ['A', 'B', 'C'], line: 5 });
  assert.deepEqual(p.papers[0].questions[1].topics, ['D']);
  assert.equal(p.hours.get('Y'), 1.5);
  assert.equal(p.aliases.get('X'), 'Y');
  assert.deepEqual(p.warnings, []);
});

test('worked example (report §7) reproduces frequencies, clusters and Prim route', () => {
  const r = analyse(WORKED_EXAMPLE, { budgetHours: 7 });
  assert.deepEqual(r.ranked.map((d) => [d.display, d.frequency]), [
    ['AVL Tree', 7], ['Binary Search Tree', 6], ['Heap Sort', 5], ['Graph Traversal', 4], ['Dijkstra', 3], ['Matrix Chain', 2],
  ]);
  assert.deepEqual(r.clusters.map((c) => c.keys), [
    ['avl tree', 'binary search tree', 'heap sort'], ['graph traversal', 'dijkstra'], ['matrix chain'],
  ]);
  assert.deepEqual(r.prim[0].order, ['avl tree', 'binary search tree', 'heap sort']);
  assert.equal(r.allocation.value, 18);
});

test('five-year sample runs clean and AVL is shorter than the plain BST', () => {
  const r = analyse(FIVE_YEARS);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.table.length, 32);
  assert.ok(r.tree.height < r.bstHeight);
  isAVL(r.tree.root);
  assert.ok(r.allocation.value >= r.greedy.value);
});
