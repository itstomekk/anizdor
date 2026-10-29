// Cloud vault crypto and sync decisions. Pure (WebCrypto only), so it runs in browsers and in Node tests.
// Format of an encrypted item: base64( version byte | 12-byte IV | AES-GCM ciphertext ). Version 2 = gzip inside.
// The item's logical name ("tree" or the photo id) is bound as AES-GCM additional data, so the server cannot swap items.

export const KDF_ITER = 600_000;
const te = new TextEncoder(), td = new TextDecoder('utf-8', { ignoreBOM: true }); // keep a BOM: round trips must be byte-exact

export function b64(u8) {
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) { const bin = atob(s); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
export const randomSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

/** Password -> { key: AES-GCM CryptoKey (non-extractable), auth: hex string sent to the server }. */
export async function deriveKeys(password, salt, iter = KDF_ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: iter }, base, 512));
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, auth: hex(bits.slice(32)) };
}
export async function authHash(auth) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(auth)))); }

async function pipe(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }

/** bytes -> base64 ciphertext. gzip=true compresses first (use for text, not for JPEGs). */
export async function seal(key, name, bytes, { gzip = false } = {}) {
  const plain = gzip ? await pipe(bytes, new CompressionStream('gzip')) : bytes;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(name) }, key, plain));
  const out = new Uint8Array(13 + ct.length); out[0] = gzip ? 2 : 1; out.set(iv, 1); out.set(ct, 13);
  return b64(out);
}
/** base64 ciphertext -> bytes. Throws on a wrong key, a tampered body or a wrong name. */
export async function open(key, name, text) {
  const u8 = unb64(text.trim());
  if (u8[0] !== 1 && u8[0] !== 2) throw new Error('Nieznany format danych w chmurze.');
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(1, 13), additionalData: te.encode(name) }, key, u8.subarray(13)));
  return u8[0] === 2 ? pipe(plain, new DecompressionStream('gzip')) : plain;
}
export const sealText = (key, name, s) => seal(key, name, te.encode(s), { gzip: true });
export const openText = async (key, name, text) => td.decode(await open(key, name, text));

/**
 * What to do with the family tree. `synced` = rev we last downloaded or uploaded (null = never),
 * `dirty` = local edits since then, `local` = number of people in this browser, `remote` = cloud rev (0 = none).
 * Returns 'idle' | 'pull' | 'push' | 'conflict'.
 */
export function decide({ synced, dirty, local, remote }) {
  const hasLocal = local > 0;
  if (!remote) return hasLocal ? 'push' : 'idle';
  if (!hasLocal) return 'pull'; // empty browser (new device or cleared storage): always restore from the cloud
  if (synced === remote) return dirty ? 'push' : 'idle';
  // The cloud moved on (or this browser never synced).
  if (synced == null || dirty) return 'conflict';
  return 'pull';
}
