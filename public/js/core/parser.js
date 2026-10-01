// Stage 1 — Parser. Turns PYQ text into papers → questions → raw topic keywords.
//
// Input format (plain text, one directive or question per line):
//
//   // comment
//   @alias BST = Binary Search Tree      abbreviation the LCS merge cannot catch
//   @hours AVL Tree = 3                  estimated study hours for a topic
//   === 2023 ===                         start of a paper (year)
//   [Unit 2]                             syllabus unit for the following questions
//   Q4 (10): Kruskal's Algorithm, Prim's Algorithm
//   Q5: BFS; DFS                         marks optional; topics split on , or ;
//
// A line that is not a directive or a header is read as a question.

const PAPER = /^(?:={2,}\s*(\d{4})\s*={2,}|@paper\s+(\d{4}))\s*$/i;
const UNIT = /^\[\s*unit\s*(\d+)\s*\]$|^@unit\s+(\d+)$/i;
const ALIAS = /^@alias\s+(.+?)\s*=\s*(.+)$/i;
const HOURS = /^@hours\s+(.+?)\s*=\s*([\d.]+)\s*h?$/i;
const QUESTION = /^(Q[\w.]*)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*(?:marks?)?\s*\))?\s*[:\-–]\s*(.+)$/i;

export function parse(text) {
  const papers = [];
  const aliases = new Map();
  const hours = new Map();
  const warnings = [];
  let paper = null;
  let unit = 0;

  String(text).split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) return;
    let m;
    if ((m = line.match(ALIAS))) { aliases.set(m[1], m[2]); return; }
    if ((m = line.match(HOURS))) { hours.set(m[1], parseFloat(m[2])); return; }
    if ((m = line.match(PAPER))) {
      paper = { year: Number(m[1] || m[2]), questions: [] };
      papers.push(paper);
      unit = 0;
      return;
    }
    if ((m = line.match(UNIT))) { unit = Number(m[1] || m[2]); return; }
    if (line.startsWith('@')) { warnings.push(`Line ${i + 1}: unknown directive "${line}"`); return; }

    if (!paper) {
      warnings.push(`Line ${i + 1}: question before any "=== YEAR ===" header — filed under year 0`);
      paper = { year: 0, questions: [] };
      papers.push(paper);
    }
    const q = line.match(QUESTION);
    const id = q ? q[1].toUpperCase() : `Q${paper.questions.length + 1}`;
    const marks = q && q[2] ? parseFloat(q[2]) : null;
    const body = q ? q[3] : line;
    const topics = body.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
    if (!topics.length) { warnings.push(`Line ${i + 1}: no topics found`); return; }
    if (!unit) warnings.push(`Line ${i + 1}: no [Unit n] header — unit left as 0`);
    paper.questions.push({ id, unit, marks, topics, line: i + 1 });
  });

  return { papers, aliases, hours, warnings };
}
