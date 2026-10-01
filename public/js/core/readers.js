// Plain-text readers for uploaded files. PDF is handled in ../files.js
// because it needs pdf.js and a browser worker.

import { listZip, readZipText } from './zip.js';

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

/** Text of every paragraph in an OOXML part, one paragraph per line. */
function paragraphs(xml, para, run) {
  return xml.split(para).map((chunk) => {
    const parts = [];
    for (const m of chunk.matchAll(run)) parts.push(decodeXml(m[1]));
    return parts.join('');
  }).filter((l) => l.trim()).join('\n');
}

export async function readDocx(buffer) {
  const entries = listZip(buffer);
  const doc = entries.get('word/document.xml');
  if (!doc) throw new Error('This .docx has no document body');
  const xml = await readZipText(buffer, doc);
  return paragraphs(xml, /<\/w:p>/, /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g);
}

export async function readPptx(buffer) {
  const entries = listZip(buffer);
  const slides = [...entries.keys()]
    .map((name) => ({ name, n: Number((name.match(/^ppt\/slides\/slide(\d+)\.xml$/) || [])[1]) }))
    .filter((s) => s.n)
    .sort((a, b) => a.n - b.n);
  if (!slides.length) throw new Error('This .pptx has no slides');
  const out = [];
  for (const s of slides) {
    const xml = await readZipText(buffer, entries.get(s.name));
    out.push(paragraphs(xml, /<\/a:p>/, /<a:t>([^<]*)<\/a:t>/g));
  }
  return out.join('\n');
}

/**
 * Old binary .doc / .ppt. There is no light-weight parser for these formats,
 * so this pulls out runs of readable text (UTF-16 and 8-bit) and lets the
 * topic finder ignore the noise. Good enough to count topics; question
 * numbering may be lost.
 */
export function readLegacyOffice(buffer) {
  const b = new Uint8Array(buffer);
  const ok = (c) => c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || (c >= 0xa0 && c <= 0xff) || (c >= 0x2010 && c <= 0x2026);
  const runs = [];
  const take = (s) => {
    for (const line of s.split(/[\r\n\u000b]+/)) {
      const t = line.trim();
      if (t.length >= 4 && (t.match(/[a-z]/gi) || []).length >= 3) runs.push(t);
    }
  };
  for (const offset of [0, 1]) {
    let cur = '';
    for (let i = offset; i + 1 < b.length; i += 2) {
      const c = b[i] | (b[i + 1] << 8);
      if (ok(c)) cur += String.fromCharCode(c);
      else { if (cur.length >= 4) take(cur); cur = ''; }
    }
    take(cur);
  }
  let cur = '';
  for (const c of b) {
    if (ok(c) && c < 127) cur += String.fromCharCode(c);
    else { if (cur.length >= 6) take(cur); cur = ''; }
  }
  take(cur);
  return [...new Set(runs)].join('\n');
}
