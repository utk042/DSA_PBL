// Stage 2 — Normaliser. Merges keyword variants into one canonical key.
//
// Two layers:
//   1. canonical()  cheap, deterministic clean-up: case, punctuation,
//                   plurals, filler words ("algorithm", "problem", ...).
//   2. LCS merge    a key that is not an exact match is compared with every
//                   existing key; if similarity >= threshold it is merged.
// Abbreviations (BST, MST) cannot be caught by LCS, so the input may declare
// them with "@alias BST = Binary Search Tree".

import { similarity } from './dp.js';

const STOP_WORDS = new Set([
  'the', 'of', 'using', 'algorithm', 'algo', 'method', 'problem', 'technique', 'approach',
]);

export function canonical(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[-_/]/g, ' ')
    .replace(/[^a-z0-9+#\s]/g, '')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

export class Normaliser {
  constructor({ threshold = 0.88, aliases = new Map() } = {}) {
    this.threshold = threshold;
    this.keys = [];               // canonical keys in first-seen order
    this.keySet = new Set();
    this.memo = new Map();        // canonical form -> resolved key
    this.aliases = new Map();     // canonical alias -> canonical target
    for (const [from, to] of aliases) this.aliases.set(canonical(from), canonical(to));
    this.merges = [];             // first resolution of each merged form: { raw, form, key, score, via }
    this.comparisons = 0;
  }

  resolve(raw) {
    let form = canonical(raw);
    if (!form) return null;
    let via = null;
    if (this.aliases.has(form)) { form = this.aliases.get(form); via = 'alias'; }
    if (this.memo.has(form)) return this.memo.get(form);
    if (this.keySet.has(form)) {
      this.memo.set(form, form);
      if (via) this.merges.push({ raw, form, key: form, score: 1, via });
      return form;
    }
    let best = null;
    let bestScore = 0;
    for (const k of this.keys) {
      this.comparisons++;
      const s = similarity(form, k);
      if (s > bestScore) { bestScore = s; best = k; }
    }
    if (best !== null && bestScore >= this.threshold) {
      this.memo.set(form, best);
      this.merges.push({ raw, form, key: best, score: bestScore, via: via || 'lcs' });
      return best;
    }
    this.keys.push(form);
    this.keySet.add(form);
    this.memo.set(form, form);
    if (via) this.merges.push({ raw, form, key: form, score: 1, via });
    return form;
  }
}
