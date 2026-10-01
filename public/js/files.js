// Reads an uploaded File into plain text, picking a reader by extension.

import { readDocx, readPptx, readLegacyOffice } from './core/readers.js';

export const ACCEPT = '.pdf,.docx,.pptx,.doc,.ppt,.txt,.md';

let pdfjs = null;
async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

/** PDF text, rebuilt into lines by grouping items that share a baseline. */
async function readPdf(buffer) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    const rows = new Map();
    for (const it of items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      out.push(rows.get(y).sort((a, b) => a.x - b.x).map((r) => r.s).join(' ').replace(/\s+/g, ' ').trim());
    }
  }
  return out.filter(Boolean).join('\n');
}

export async function readFile(file) {
  const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (ext === 'txt' || ext === 'md') return { text: await file.text(), note: null };
  const buffer = await file.arrayBuffer();
  if (ext === 'pdf') return { text: await readPdf(buffer), note: null };
  if (ext === 'docx') return { text: await readDocx(buffer), note: null };
  if (ext === 'pptx') return { text: await readPptx(buffer), note: null };
  if (ext === 'doc' || ext === 'ppt') {
    return { text: readLegacyOffice(buffer), note: `Old .${ext} format: topics found, question numbers may be missing. Saving as .${ext}x or PDF gives better results.` };
  }
  throw new Error(`.${ext || '?'} files are not supported`);
}
