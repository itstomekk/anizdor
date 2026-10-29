// Encrypted family vault (Cloudflare Pages Function + D1).
// The server never sees the family password or any plaintext. Clients derive two values from the password:
// an AES-GCM key (stays in the browser) and an auth secret. D1 stores only SHA-256(auth secret) and
// base64 ciphertext, split into chunks. Writes to the tree use optimistic locking on `rev`.

const CHUNK = 1_500_000;           // base64 chars per D1 row (D1 row limit is 2 MB)
const MAX_ITEM = 16_000_000;       // base64 chars per item (~12 MB of ciphertext)
const KEEP_HISTORY = 30;           // older tree versions kept for restore
const HISTORY_GAP_MS = 30 * 60e3;  // archive at most one tree version per 30 min
const ORPHAN_TMP_MS = 60 * 60e3;
const ID_RE = /^(tree|tree_h\d{1,9}|photo_[A-Za-z0-9_-]{1,58})$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const HEX64 = /^[0-9a-f]{64}$/;
// Password guessing guard: the family password may be short, so wrong guesses are rate limited
// per client IP and globally. Under a global lockout even correct guesses wait (no oracle).
const FAIL_WINDOW_MS = 60 * 60e3, FAIL_PER_IP = 10;
const FAIL_DAY_MS = 24 * 60 * 60e3, FAIL_GLOBAL = 200;

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS vault_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, rev INTEGER NOT NULL, size INTEGER NOT NULL, chunks INTEGER NOT NULL, updated_at INTEGER NOT NULL, writer TEXT)',
  'CREATE INDEX IF NOT EXISTS items_kind ON items (kind, rev)',
  'CREATE TABLE IF NOT EXISTS chunks (id TEXT NOT NULL, n INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (id, n))',
  'CREATE TABLE IF NOT EXISTS auth_fail (ip TEXT NOT NULL, t INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS auth_fail_t ON auth_fail (t)',
];
let schemaReady = null;
const ensureSchema = (db) => (schemaReady ||= db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { schemaReady = null; throw e; }));

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, error, extra = {}) => json({ ok: false, error, ...extra }, status);

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
const randomId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
const kindOf = (id) => (id === 'tree' ? 'tree' : id.startsWith('photo_') ? 'photo' : 'tree-old');

async function readMeta(db) {
  const { results } = await db.prepare('SELECT k, v FROM vault_meta').all();
  return Object.fromEntries(results.map((r) => [r.k, r.v]));
}

async function authorized(request, meta) {
  const h = request.headers.get('x-vault-auth') || '';
  if (!meta.auth_hash || !HEX64.test(h)) return false;
  return safeEq(await sha256hex(h), meta.auth_hash);
}

const clientIp = (request) => request.headers.get('cf-connecting-ip') || 'unknown';

/** Seconds to wait before another password attempt, or 0. */
async function lockedFor(db, ip, now) {
  const r = await db.prepare('SELECT SUM(ip = ? AND t > ?) AS mine, MIN(CASE WHEN ip = ? AND t > ? THEN t END) AS mine_first, COUNT(*) AS all_n, MIN(t) AS all_first FROM auth_fail WHERE t > ?')
    .bind(ip, now - FAIL_WINDOW_MS, ip, now - FAIL_WINDOW_MS, now - FAIL_DAY_MS).first();
  let until = 0;
  if ((r?.mine || 0) >= FAIL_PER_IP) until = Math.max(until, r.mine_first + FAIL_WINDOW_MS);
  if ((r?.all_n || 0) >= FAIL_GLOBAL) until = Math.max(until, r.all_first + FAIL_DAY_MS);
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

async function noteFailure(db, ip, now) {
  await db.batch([
    db.prepare('DELETE FROM auth_fail WHERE t <= ?').bind(now - FAIL_DAY_MS),
    db.prepare('INSERT INTO auth_fail (ip, t) VALUES (?, ?)').bind(ip, now),
  ]);
}

async function init(request, env, db, meta) {
  if (meta.auth_hash) return fail(409, 'already-initialized');
  if (!env.SETUP_CODE) return fail(503, 'setup-disabled');
  let b; try { b = await request.json(); } catch { return fail(400, 'bad-json'); }
  const { setup, salt, iter, authHash } = b || {};
  if (typeof setup !== 'string' || !safeEq(await sha256hex(setup), await sha256hex(env.SETUP_CODE))) return fail(403, 'bad-setup-code');
  if (typeof salt !== 'string' || !B64_RE.test(salt) || salt.length < 20 || salt.length > 64) return fail(422, 'bad-salt');
  if (!Number.isInteger(iter) || iter < 100_000 || iter > 5_000_000) return fail(422, 'bad-iter');
  if (typeof authHash !== 'string' || !HEX64.test(authHash)) return fail(422, 'bad-auth-hash');
  const now = String(Date.now());
  // INSERT (not upsert): if two clients race, the second one fails on the primary key.
  try {
    await db.batch([
      db.prepare('INSERT INTO vault_meta (k, v) VALUES (?, ?)').bind('auth_hash', authHash),
      db.prepare('INSERT INTO vault_meta (k, v) VALUES (?, ?)').bind('salt', salt),
      db.prepare('INSERT INTO vault_meta (k, v) VALUES (?, ?)').bind('iter', String(iter)),
      db.prepare('INSERT INTO vault_meta (k, v) VALUES (?, ?)').bind('created_at', now),
    ]);
  } catch { return fail(409, 'already-initialized'); }
  return json({ ok: true });
}

async function list(db) {
  const { results } = await db.prepare('SELECT id, kind, rev, size, updated_at FROM items ORDER BY kind, id').all();
  return json({ ok: true, items: results });
}

async function getItem(db, id) {
  const [it, ch] = await db.batch([
    db.prepare('SELECT rev, chunks, size FROM items WHERE id = ?').bind(id),
    db.prepare('SELECT n, data FROM chunks WHERE id = ? ORDER BY n').bind(id),
  ]);
  const row = it.results[0];
  if (!row) return fail(404, 'not-found');
  const parts = ch.results;
  if (parts.length !== row.chunks) return fail(409, 'write-in-progress');
  return new Response(parts.map((p) => p.data).join(''), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-rev': String(row.rev) } });
}

async function putItem(request, db, id) {
  const kind = kindOf(id);
  if (kind === 'tree-old') return fail(403, 'history-is-read-only');
  const body = await request.text();
  if (body.length < 40 || body.length > MAX_ITEM || !B64_RE.test(body)) return fail(422, 'bad-body');
  const baseHdr = request.headers.get('x-base-rev');
  const base = baseHdr == null ? null : Number(baseHdr);
  if (kind === 'tree' && (!Number.isInteger(base) || base < 0)) return fail(422, 'base-rev-required');

  const now = Date.now(), writer = randomId();
  const tmp = `tmp_${now}_${writer}`;
  const n = Math.ceil(body.length / CHUNK);
  const ins = db.prepare('INSERT INTO chunks (id, n, data) VALUES (?, ?, ?)');
  // Old aborted uploads: ids sort by their 13-digit millisecond timestamp.
  const stmts = [db.prepare("DELETE FROM chunks WHERE id >= 'tmp_' AND id < ?").bind(`tmp_${now - ORPHAN_TMP_MS}`)];
  for (let i = 0; i < n; i++) stmts.push(ins.bind(tmp, i, body.slice(i * CHUNK, (i + 1) * CHUNK)));
  await db.batch(stmts);

  const won = 'EXISTS (SELECT 1 FROM items WHERE id = ? AND writer = ?)';
  let swap, casIndex;
  if (kind === 'photo') {
    swap = [
      db.prepare('DELETE FROM chunks WHERE id = ?').bind(id),
      db.prepare('INSERT INTO items (id, kind, rev, size, chunks, updated_at, writer) VALUES (?, ?, 1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET rev = rev + 1, size = excluded.size, chunks = excluded.chunks, updated_at = excluded.updated_at, writer = excluded.writer')
        .bind(id, kind, body.length, n, now, writer),
      db.prepare('UPDATE chunks SET id = ? WHERE id = ?').bind(id, tmp),
    ];
    casIndex = 1;
  } else if (base === 0) {
    swap = [
      db.prepare('INSERT INTO items (id, kind, rev, size, chunks, updated_at, writer) VALUES (?, ?, 1, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(id, kind, body.length, n, now, writer),
      db.prepare(`DELETE FROM chunks WHERE id = ? AND ${won}`).bind(id, id, writer),
      db.prepare(`UPDATE chunks SET id = ? WHERE id = ? AND ${won}`).bind(id, tmp, id, writer),
    ];
    casIndex = 0;
  } else {
    const last = await db.prepare("SELECT MAX(updated_at) AS t FROM items WHERE kind = 'tree-old'").first();
    const archive = !last?.t || now - last.t >= HISTORY_GAP_MS;
    const hid = `tree_h${base}`;
    const atBase = 'EXISTS (SELECT 1 FROM items WHERE id = ? AND rev = ?)';
    swap = archive ? [
      db.prepare(`INSERT OR REPLACE INTO items (id, kind, rev, size, chunks, updated_at) SELECT ?, 'tree-old', rev, size, chunks, updated_at FROM items WHERE id = ? AND rev = ?`).bind(hid, id, base),
      db.prepare(`DELETE FROM chunks WHERE id = ? AND ${atBase}`).bind(hid, id, base),
      db.prepare(`UPDATE chunks SET id = ? WHERE id = ? AND ${atBase}`).bind(hid, id, id, base),
    ] : [db.prepare(`DELETE FROM chunks WHERE id = ? AND ${atBase}`).bind(id, id, base)];
    casIndex = swap.length;
    swap.push(
      db.prepare('UPDATE items SET rev = rev + 1, size = ?, chunks = ?, updated_at = ?, writer = ? WHERE id = ? AND rev = ?').bind(body.length, n, now, writer, id, base),
      db.prepare(`UPDATE chunks SET id = ? WHERE id = ? AND ${won}`).bind(id, tmp, id, writer),
    );
  }
  const res = await db.batch(swap);
  if (!res[casIndex].meta.changes) {
    await db.prepare('DELETE FROM chunks WHERE id = ?').bind(tmp).run();
    const cur = await db.prepare('SELECT rev FROM items WHERE id = ?').bind(id).first();
    return fail(409, 'conflict', { rev: cur?.rev ?? 0 });
  }
  if (kind === 'tree') await pruneHistory(db);
  const row = await db.prepare('SELECT rev FROM items WHERE id = ?').bind(id).first();
  return json({ ok: true, rev: row.rev });
}

async function pruneHistory(db) {
  const { results } = await db.prepare("SELECT id FROM items WHERE kind = 'tree-old' ORDER BY rev DESC LIMIT -1 OFFSET ?").bind(KEEP_HISTORY).all();
  if (!results.length) return;
  await db.batch(results.flatMap((r) => [db.prepare('DELETE FROM chunks WHERE id = ?').bind(r.id), db.prepare('DELETE FROM items WHERE id = ?').bind(r.id)]));
}

async function deleteItem(db, id) {
  if (kindOf(id) !== 'photo') return fail(403, 'only-photos-can-be-deleted');
  await db.batch([db.prepare('DELETE FROM chunks WHERE id = ?').bind(id), db.prepare('DELETE FROM items WHERE id = ?').bind(id)]);
  return json({ ok: true });
}

export async function onRequest({ request, env }) {
  const db = env.DB;
  if (!db) return fail(503, 'no-database');
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const m = request.method;
  // Same-origin only for writes (CSRF guard; the app never calls the API cross-origin).
  if (m !== 'GET' && m !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return fail(403, 'bad-origin');
  }
  try {
    await ensureSchema(db);
    const meta = await readMeta(db);
    if (path === 'vault' && m === 'GET') return json({ ok: true, initialized: !!meta.auth_hash, salt: meta.salt || null, iter: meta.iter ? Number(meta.iter) : null, setup: !!env.SETUP_CODE });
    if (path === 'vault/init' && m === 'POST') return await init(request, env, db, meta);
    if (!meta.auth_hash) return fail(404, 'not-initialized');
    const ip = clientIp(request), now = Date.now();
    const wait = await lockedFor(db, ip, now);
    if (wait) return new Response(JSON.stringify({ ok: false, error: 'too-many-attempts', retryAfter: wait }), { status: 429, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': String(wait) } });
    if (!(await authorized(request, meta))) { await noteFailure(db, ip, now); return fail(401, 'unauthorized'); }
    if (path === 'items' && m === 'GET') return await list(db);
    const im = /^items\/([^/]+)$/.exec(path);
    if (im) {
      const id = decodeURIComponent(im[1]);
      if (!ID_RE.test(id)) return fail(400, 'bad-id');
      if (m === 'GET') return await getItem(db, id);
      if (m === 'PUT') return await putItem(request, db, id);
      if (m === 'DELETE') return await deleteItem(db, id);
    }
    return fail(404, 'no-route');
  } catch (e) {
    return fail(500, 'server-error', { detail: String(e?.message || e).slice(0, 200) });
  }
}
