import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { readDocx, readPptx, readLegacyOffice } from '../public/js/core/readers.js';
import { findTopics, extractQuestions, detectYear, toStructured, isStructured } from '../public/js/core/extract.js';
import { parse } from '../public/js/core/parser.js';
import { analyse } from '../public/js/core/analyser.js';

const file = (name) => {
  const b = readFileSync(new URL(`../public/samples/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

test('findTopics prefers the longest phrase and handles spelling forms', () => {
  assert.deepEqual(findTopics('Build a max heap, then run heap sort'), ['Max Heap', 'Heap Sort']);
  assert.deepEqual(findTopics("Apply Dijkstra's algorithm"), ['Dijkstra']);
  assert.deepEqual(findTopics('Insert keys into a B-Tree and a B+ tree'), ['B Tree', 'B+ Tree']);
  assert.deepEqual(findTopics('Construct an optimal binary search tree'), ['Optimal BST']);
  assert.deepEqual(findTopics('Explain the primary key'), []);
});

test('question splitting, marks, units and generic topics', () => {
  const text = [
    'UNIT II',
    'Q3. Find the MST using Kruskal\'s algorithm. (10 marks)',
    'continued on this line with Prim',
    '(a) Solve 0/1 knapsack using dynamic programming.',
    '(b) What is dynamic programming?',
    'Attempt all questions.',
  ].join('\n');
  const ex = extractQuestions(text);
  assert.deepEqual(ex.questions, [
    { id: 'Q3', unit: 2, marks: 10, topics: ['Minimum Spanning Tree', 'Kruskal', 'Prim'] },
    { id: 'Q3a', unit: 2, marks: null, topics: ['0/1 Knapsack'] },
    { id: 'Q3b', unit: 2, marks: null, topics: ['Dynamic Programming'] },
  ]);
});

test('detectYear uses the file name, then the paper heading', () => {
  assert.equal(detectYear('Exam 2019', 'dsa-2023.pdf'), 2023);
  assert.equal(detectYear('Theory Examination 2021-22'), 2021);
  assert.equal(detectYear('no year here'), null);
});

test('docx and pptx sample papers are read and turned into analyser input', async () => {
  const docx = await readDocx(file('paper-2024.docx'));
  const pptx = await readPptx(file('paper-2022.pptx'));
  assert.match(docx, /Construct an AVL Tree/);
  assert.match(pptx, /Bellman-Ford/);
  const papers = [
    { label: String(detectYear(pptx)), questions: extractQuestions(pptx).questions },
    { label: String(detectYear(docx)), questions: extractQuestions(docx).questions },
  ];
  const text = toStructured(papers);
  assert.ok(isStructured(text));
  assert.deepEqual(parse(text).warnings, []);
  const r = analyse(text);
  assert.deepEqual(r.years, [2022, 2024]);
  assert.equal(r.topic.get('avl tree').frequency, 2);
});

test('legacy .doc/.ppt text is recovered from UTF-16 runs', () => {
  const body = Buffer.from('Q2. Construct an AVL Tree. (10 marks)\rQ3. Explain Prim\'s algorithm.', 'utf16le');
  const noise = Buffer.from(Array.from({ length: 200 }, (_, i) => (i * 37) % 7));
  const text = readLegacyOffice(Buffer.concat([noise, body, noise]));
  assert.deepEqual(extractQuestions(text).questions.map((q) => q.topics), [['AVL Tree'], ['Prim']]);
});

test('paper labels other than years are accepted', () => {
  const p = parse('=== Mid-sem A ===\nQ1: Heap Sort');
  assert.equal(p.papers[0].year, 'Mid-sem A');
});
