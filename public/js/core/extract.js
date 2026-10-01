// Turns free text from an uploaded paper (PDF, Word, PowerPoint, plain text)
// into the analyser's input format: questions, units, marks and topics.

import { canonical } from './normalise.js';
import { VOCABULARY } from './vocabulary.js';

// Longest phrase first, so "max heap" is taken before "heap".
const PHRASES = VOCABULARY
  .flatMap(([name, unit, ...phrases]) => phrases.map((p) => ({ name, unit, form: canonical(p) })))
  .filter((p) => p.form)
  .sort((a, b) => b.form.length - a.form.length);

// Broad method names: only counted when a question names nothing more specific.
const GENERIC = new Set(['Dynamic Programming', 'Backtracking', 'Binary Tree', 'Heap']);

const UNIT_OF = new Map(VOCABULARY.map(([name, unit]) => [name, unit]));

/** Topics mentioned in a piece of text, in order of first appearance. */
export function findTopics(text) {
  let t = ` ${canonical(text)} `;
  const hits = [];
  for (const p of PHRASES) {
    const needle = ` ${p.form} `;
    let at = t.indexOf(needle);
    if (at < 0) continue;
    if (!hits.some((h) => h.name === p.name)) hits.push({ name: p.name, at });
    while (at >= 0) {
      t = `${t.slice(0, at)} |${' '.repeat(needle.length - 3)}| ${t.slice(at + needle.length)}`;
      at = t.indexOf(needle);
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name);
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
const UNIT_LINE = /^\s*unit\s*[-–:.]?\s*(\d|i{1,3}|iv|v)\b/i;
const Q_START = /^\s*(?:q(?:ues(?:tion)?)?\s*\.?\s*(\d{1,2})\s*[.):-]?|(\d{1,2})\s*[.)]|\(\s*([a-j]|[ivx]{1,4})\s*\)|([a-j])\s*[.)])\s+(?=\S)/i;
const MARKS = /(?:\(|\[)?\s*(\d{1,2})\s*marks?\b|\[\s*(\d{1,2})\s*\]\s*$/i;

/** Year from the file name first, then from the top of the paper. */
export function detectYear(text, fileName = '') {
  const fromName = fileName.match(/(?:19|20)\d{2}/);
  if (fromName) return Number(fromName[0]);
  const fromText = text.slice(0, 3000).match(/\b(?:19|20)\d{2}\b/);
  return fromText ? Number(fromText[0]) : null;
}

/**
 * Split a paper into questions and find the topics in each.
 * Returns { questions: [{ id, unit, marks, topics }], blocks, unmatched }.
 */
export function extractQuestions(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const blocks = [];
  let unit = 0;
  let current = null;
  let lastNumber = '';
  for (const line of lines) {
    const u = line.match(UNIT_LINE);
    if (u) { unit = ROMAN[u[1].toLowerCase()] || Number(u[1]) || 0; }
    const q = line.match(Q_START);
    if (q) {
      const num = q[1] || q[2];
      if (num) lastNumber = num;
      const sub = q[3] || q[4];
      current = { id: `Q${num || lastNumber || blocks.length + 1}${sub ? sub.toLowerCase() : ''}`, unit, text: line.slice(q[0].length) };
      blocks.push(current);
    } else if (current && !u) {
      current.text += ` ${line}`;
    }
  }
  // No numbered questions at all (slides, notes): treat every line as one question.
  if (!blocks.length) lines.forEach((line, i) => blocks.push({ id: `Q${i + 1}`, unit: 0, text: line }));

  const questions = [];
  let unmatched = 0;
  for (const b of blocks) {
    let topics = findTopics(b.text);
    // "Solve using dynamic programming" names a method, not the topic asked.
    if (topics.some((t) => !GENERIC.has(t))) topics = topics.filter((t) => !GENERIC.has(t));
    if (!topics.length) { unmatched++; continue; }
    const m = b.text.match(MARKS);
    questions.push({
      id: b.id,
      unit: b.unit || UNIT_OF.get(topics[0]) || 0,
      marks: m ? Number(m[1] || m[2]) : null,
      topics,
    });
  }
  return { questions, blocks: blocks.length, unmatched };
}

/** True if the text is already in the analyser's own format. */
export const isStructured = (text) => /^\s*(?:={2,}.+={2,}|@paper\b)/m.test(text);

/** Write papers back out in the analyser's input format, grouped by unit. */
export function toStructured(papers) {
  const out = [];
  for (const p of papers) {
    out.push(`=== ${p.label} ===`);
    const byUnit = new Map();
    for (const q of p.questions) {
      if (!byUnit.has(q.unit)) byUnit.set(q.unit, []);
      byUnit.get(q.unit).push(q);
    }
    for (const unit of [...byUnit.keys()].sort((a, b) => a - b)) {
      if (unit) out.push(`[Unit ${unit}]`);
      for (const q of byUnit.get(unit)) out.push(`${q.id}${q.marks ? ` (${q.marks})` : ''}: ${q.topics.join(', ')}`);
    }
    out.push('');
  }
  return out.join('\n');
}
