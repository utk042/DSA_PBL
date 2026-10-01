// Stage 3 — Topic store. AVL tree keyed on the canonical topic key.
// The dominant operation is search-then-update: find an existing topic and
// bump its frequency; insert (with rebalancing) only when it is new.

export class TopicNode {
  constructor(key, data) {
    this.key = key;
    this.data = data;       // { display, frequency, years, unit, studyHours, ... }
    this.left = null;
    this.right = null;
    this.height = 1;
  }
}

const h = (n) => (n ? n.height : 0);
const fix = (n) => { n.height = 1 + Math.max(h(n.left), h(n.right)); };
const balance = (n) => (n ? h(n.left) - h(n.right) : 0);

export class AVLTree {
  constructor() {
    this.root = null;
    this.size = 0;
    this.comparisons = 0;
    this.rotations = { LL: 0, RR: 0, LR: 0, RL: 0 };
  }

  get height() { return h(this.root); }

  search(key) {
    let n = this.root;
    while (n) {
      this.comparisons++;
      if (key === n.key) return n;
      n = key < n.key ? n.left : n.right;
    }
    return null;
  }

  /** Search-then-update. `create()` builds data for a new key, `update(data)` mutates an existing one. */
  upsert(key, create, update) {
    const found = this.search(key);
    if (found) { update(found.data); return found; }
    let created = null;
    const insert = (n) => {
      if (!n) { created = new TopicNode(key, create()); return created; }
      this.comparisons++;
      if (key < n.key) n.left = insert(n.left);
      else n.right = insert(n.right);
      return this.#rebalance(n, key);
    };
    this.root = insert(this.root);
    this.size++;
    update(created.data);
    return created;
  }

  #rotateRight(y) {
    const x = y.left;
    y.left = x.right;
    x.right = y;
    fix(y); fix(x);
    return x;
  }

  #rotateLeft(x) {
    const y = x.right;
    x.right = y.left;
    y.left = x;
    fix(x); fix(y);
    return y;
  }

  #rebalance(n, key) {
    fix(n);
    const b = balance(n);
    if (b > 1 && key < n.left.key) { this.rotations.LL++; return this.#rotateRight(n); }
    if (b < -1 && key > n.right.key) { this.rotations.RR++; return this.#rotateLeft(n); }
    if (b > 1 && key > n.left.key) {
      this.rotations.LR++;
      n.left = this.#rotateLeft(n.left);
      return this.#rotateRight(n);
    }
    if (b < -1 && key < n.right.key) {
      this.rotations.RL++;
      n.right = this.#rotateRight(n.right);
      return this.#rotateLeft(n);
    }
    return n;
  }

  /** In-order: alphabetical topic table, O(n). Iterative, explicit stack. */
  inOrder() {
    const out = [];
    const stack = [];
    let n = this.root;
    while (n || stack.length) {
      while (n) { stack.push(n); n = n.left; }
      n = stack.pop();
      out.push(n);
      n = n.right;
    }
    return out;
  }

  /** Pre-order: used to save the tree, O(n). */
  preOrder() {
    const out = [];
    const stack = this.root ? [this.root] : [];
    while (stack.length) {
      const n = stack.pop();
      out.push(n);
      if (n.right) stack.push(n.right);
      if (n.left) stack.push(n.left);
    }
    return out;
  }

  /** Post-order: children before parent — the safe order to free nodes, O(n). */
  postOrder() {
    const out = [];
    const stack = this.root ? [this.root] : [];
    while (stack.length) {
      const n = stack.pop();
      out.push(n);
      if (n.left) stack.push(n.left);
      if (n.right) stack.push(n.right);
    }
    return out.reverse();
  }

  /** Pre-order serialisation with null markers; reload rebuilds the exact same shape. */
  serialize() {
    const out = [];
    const walk = (n) => {
      if (!n) { out.push(null); return; }
      out.push({ key: n.key, data: n.data });
      walk(n.left);
      walk(n.right);
    };
    walk(this.root);
    return out;
  }

  static deserialize(list) {
    const tree = new AVLTree();
    let i = 0;
    const build = () => {
      const item = list[i++];
      if (!item) return null;
      const n = new TopicNode(item.key, item.data);
      n.left = build();
      n.right = build();
      fix(n);
      tree.size++;
      return n;
    };
    tree.root = build();
    return tree;
  }

  /** Free the tree in post-order; returns the keys in the order they were released. */
  destroy() {
    const order = this.postOrder().map((n) => {
      n.left = n.right = null;
      return n.key;
    });
    this.root = null;
    this.size = 0;
    return order;
  }
}

/** Unbalanced BST, kept only to measure what AVL balancing buys (Section 4.2). */
export class PlainBST {
  constructor() { this.root = null; this.comparisons = 0; }

  insert(key) {
    if (!this.root) { this.root = { key, left: null, right: null }; return; }
    let n = this.root;
    for (;;) {
      this.comparisons++;
      if (key === n.key) return;
      const side = key < n.key ? 'left' : 'right';
      if (!n[side]) { n[side] = { key, left: null, right: null }; return; }
      n = n[side];
    }
  }

  get height() {
    let depth = 0;
    let level = this.root ? [this.root] : [];
    while (level.length) {
      depth++;
      level = level.flatMap((n) => [n.left, n.right].filter(Boolean));
    }
    return depth;
  }
}
