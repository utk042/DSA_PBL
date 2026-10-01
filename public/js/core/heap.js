// Stage 4 — Ranking. Array-backed binary heap.
// `higher(a, b)` returns true when a should sit above b. With frequency as
// the priority it is a Max-Heap; Dijkstra and Prim reuse the same class with
// "smaller distance is higher" to get a min-priority queue.

export class BinaryHeap {
  constructor(higher) {
    this.higher = higher;
    this.items = [];
  }

  /** Bottom-up heapify, O(n). */
  static build(items, higher) {
    const heap = new BinaryHeap(higher);
    heap.items = [...items];
    for (let i = (heap.items.length >> 1) - 1; i >= 0; i--) heap.#siftDown(i);
    return heap;
  }

  get size() { return this.items.length; }
  peek() { return this.items[0]; }

  push(item) {
    this.items.push(item);
    this.#siftUp(this.items.length - 1);
  }

  pop() {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length) { a[0] = last; this.#siftDown(0); }
    return top;
  }

  #siftUp(i) {
    const a = this.items;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.higher(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }

  #siftDown(i) {
    const a = this.items;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let top = i;
      if (l < a.length && this.higher(a[l], a[top])) top = l;
      if (r < a.length && this.higher(a[r], a[top])) top = r;
      if (top === i) return;
      [a[i], a[top]] = [a[top], a[i]];
      i = top;
    }
  }
}

/** Highest frequency first; ties broken alphabetically so output is stable. */
export const byFrequency = (a, b) => a.frequency > b.frequency || (a.frequency === b.frequency && a.key < b.key);

/** Priority queue Top-N: O(n + N log n). */
export function topN(pairs, N, higher = byFrequency) {
  const heap = BinaryHeap.build(pairs, higher);
  const out = [];
  while (out.length < N && heap.size) out.push(heap.pop());
  return out;
}

/** Heap Sort to exhaustion: the full ranked list, O(n log n). */
export function heapSort(pairs, higher = byFrequency) {
  return topN(pairs, pairs.length, higher);
}
