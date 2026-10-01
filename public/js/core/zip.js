// Minimal ZIP reader for .docx and .pptx (both are ZIP archives of XML).
// Uses the built-in DecompressionStream, so no library is needed.

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

/** Returns Map(name -> { method, size, offset }) from the central directory. */
export function listZip(buffer) {
  const v = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP file');
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const names = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (u32(v, p) !== 0x02014b50) throw new Error('Damaged ZIP directory');
    const method = u16(v, p + 10);
    const size = u32(v, p + 20);
    const nameLen = u16(v, p + 28);
    const extraLen = u16(v, p + 30);
    const commentLen = u16(v, p + 32);
    const local = u32(v, p + 42);
    const name = names.decode(new Uint8Array(buffer, p + 46, nameLen));
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Read one entry as text. */
export async function readZipText(buffer, entry) {
  const v = new DataView(buffer);
  const start = entry.local + 30 + u16(v, entry.local + 26) + u16(v, entry.local + 28);
  const data = new Uint8Array(buffer, start, entry.size);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error(`Unsupported ZIP compression (${entry.method})`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}
