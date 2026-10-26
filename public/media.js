// Photo storage: IndexedDB (blobs), client-side downscaling, and a dependency-free ZIP writer for backups.
const DB = 'rodzina-media', STORE = 'photos';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => { db.close(); res(out?.result); }; t.onerror = () => { db.close(); rej(t.error); }; }); };

export const putPhoto = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
export const getPhoto = (id) => tx('readonly', (s) => s.get(id));
export const deletePhoto = (id) => tx('readwrite', (s) => s.delete(id));
export const clearPhotos = () => tx('readwrite', (s) => s.clear());
export async function allPhotoIds() { const db = await open(); return new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).getAllKeys(); r.onsuccess = () => { db.close(); res(r.result); }; r.onerror = () => rej(r.error); }); }

/** Downscale an image file to fit maxSide, return {blob, w, h, mime}. Keeps small images untouched. */
export async function prepareImage(file, maxSide = 1600, quality = 0.85) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 600_000) { const r = { blob: file, w: bmp.width, h: bmp.height, mime: file.type || 'image/jpeg' }; bmp.close?.(); return r; }
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close?.();
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
  return { blob, w, h, mime: 'image/jpeg' };
}

const urlCache = new Map();
export async function photoUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await getPhoto(id); if (!b) return null;
  const u = URL.createObjectURL(b); urlCache.set(id, u); return u;
}
export function forgetUrl(id) { const u = urlCache.get(id); if (u) { URL.revokeObjectURL(u); urlCache.delete(id); } }

// ---------- ZIP (store only; images are already compressed) ----------
let CRC = null;
function crc32(u8) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
const enc = new TextEncoder();
/** files: [{name, data: Uint8Array}] -> Blob (zip) */
export function makeZip(files) {
  const parts = [], central = []; let offset = 0;
  const u16 = (v) => new Uint8Array([v & 255, (v >> 8) & 255]);
  const u32 = (v) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
  const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const now = new Date(); const dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)), dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate());
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = cat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dt), u16(dd), u32(crc), u32(size), u32(size), u16(name.length), u16(0), name);
    parts.push(local, f.data);
    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dt), u16(dd), u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name));
    offset += local.length + size;
  }
  const cd = cat(...central);
  const end = cat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0));
  return new Blob([...parts, cd, end], { type: 'application/zip' });
}

/** Read a store-only or deflate ZIP made by makeZip (or other tools). Uses DecompressionStream for deflate. */
export async function readZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('To nie jest plik ZIP.');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = [];
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Uszkodzony ZIP.');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(lho + 26, true), lxlen = dv.getUint16(lho + 28, true), start = lho + 30 + lnlen + lxlen;
    let data = u8.subarray(start, start + csize);
    if (method === 8) { const ds = new DecompressionStream('deflate-raw'); data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer()); }
    else if (method !== 0) throw new Error('Nieobsługiwana kompresja ZIP.');
    out.push({ name, data }); p += 46 + nlen + xlen + clen;
  }
  return out;
}
