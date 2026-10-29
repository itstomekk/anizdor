// Cloud vault: crypto round trips, sync decisions, and the Pages Function API on an in-memory D1 stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { deriveKeys, authHash, randomSalt, seal, open, sealText, openText, decide } from '../public/cloud-core.js';
import { onRequest } from '../functions/api/[[path]].js';

const ITER = 100_000; // the minimum the server accepts; keeps tests fast

// ---------- crypto ----------
test('derived keys are deterministic and the auth secret is not the key', async () => {
  const salt = randomSalt();
  const a = await deriveKeys('hasło rodzinne', salt, ITER), b = await deriveKeys('hasło rodzinne', salt, ITER);
  assert.equal(a.auth, b.auth);
  assert.match(a.auth, /^[0-9a-f]{64}$/);
  assert.notEqual((await deriveKeys('inne hasło!!', salt, ITER)).auth, a.auth);
  assert.equal(a.key.extractable, false);
  const ct = await sealText(a.key, 'tree', 'x'); assert.equal(await openText(b.key, 'tree', ct), 'x');
});

test('seal/open round trip, gzip for text, Polish characters survive', async () => {
  const { key } = await deriveKeys('pass-word-123', randomSalt(), ITER);
  const ged = '0 HEAD\n1 CHAR UTF-8\n' + '0 @I1@ INDI\n1 NAME Józef /Kołodziejczuk/\n'.repeat(500);
  const ct = await sealText(key, 'tree', ged);
  assert.ok(ct.length < ged.length / 4, 'gzip should shrink repetitive GEDCOM');
  assert.equal(await openText(key, 'tree', ct), ged);
  const withBom = '\uFEFF0 HEAD\r\n1 CHAR UTF-8\r\n';
  assert.equal(await openText(key, 'tree', await sealText(key, 'tree', withBom)), withBom);
  const bin = new Uint8Array(3000).map((_, i) => (i * 7) & 255);
  assert.deepEqual(await open(key, 'p1', await seal(key, 'p1', bin)), bin);
});

test('wrong key, wrong item name or tampering fails to decrypt', async () => {
  const salt = randomSalt();
  const { key } = await deriveKeys('right password', salt, ITER), { key: bad } = await deriveKeys('wrong password', salt, ITER);
  const ct = await sealText(key, 'tree', 'secret');
  await assert.rejects(openText(bad, 'tree', ct));
  await assert.rejects(openText(key, 'photo', ct));
  const u = Buffer.from(ct, 'base64'); u[u.length - 1] ^= 1;
  await assert.rejects(openText(key, 'tree', u.toString('base64')));
});

test('decide: pull, push, idle, conflict', () => {
  assert.equal(decide({ synced: null, dirty: false, local: 0, remote: 0 }), 'idle');
  assert.equal(decide({ synced: null, dirty: false, local: 5, remote: 0 }), 'push');     // first upload
  assert.equal(decide({ synced: null, dirty: false, local: 0, remote: 3 }), 'pull');     // new device
  assert.equal(decide({ synced: null, dirty: false, local: 5, remote: 3 }), 'conflict'); // never synced, both have data
  assert.equal(decide({ synced: 3, dirty: false, local: 5, remote: 3 }), 'idle');
  assert.equal(decide({ synced: 3, dirty: true, local: 5, remote: 3 }), 'push');
  assert.equal(decide({ synced: 3, dirty: false, local: 5, remote: 4 }), 'pull');        // someone else saved
  assert.equal(decide({ synced: 3, dirty: true, local: 5, remote: 4 }), 'conflict');
  assert.equal(decide({ synced: 3, dirty: true, local: 0, remote: 3 }), 'pull');         // cleared browser: restore, never upload an empty tree
  assert.equal(decide({ synced: 3, dirty: false, local: 0, remote: 3 }), 'pull');
  assert.equal(decide({ synced: 3, dirty: true, local: 0, remote: 0 }), 'idle');
});

// ---------- server ----------
function fakeD1() {
  const s = new DatabaseSync(':memory:');
  const exec = (sql, args) => {
    const st = s.prepare(sql);
    if (/^\s*select/i.test(sql)) return { results: st.all(...args), meta: { changes: 0 } };
    const r = st.run(...args); return { results: [], meta: { changes: Number(r.changes) } };
  };
  const stmt = (sql, args = []) => ({ sql, args, bind: (...a) => stmt(sql, a), all: async () => exec(sql, args), run: async () => exec(sql, args), first: async () => exec(sql, args).results[0] ?? null });
  return {
    raw: s,
    prepare: (sql) => stmt(sql),
    batch: async (list) => { s.exec('BEGIN'); try { const out = list.map((x) => exec(x.sql, x.args)); s.exec('COMMIT'); return out; } catch (e) { s.exec('ROLLBACK'); throw e; } },
  };
}
const env = { DB: fakeD1(), SETUP_CODE: 'setup-code-123' };
const ORIGIN = 'https://rodzina.test';
const call = (path, { method = 'GET', body, headers = {} } = {}) => onRequest({ env, request: new Request(ORIGIN + '/api/' + path, { method, body, headers }) });
const j = async (r) => ({ status: r.status, body: await r.json() });

let salt, keys;
test('vault: setup code required, then initialized once', async () => {
  let r = await j(await call('vault'));
  assert.deepEqual([r.body.initialized, r.body.setup], [false, true]);
  salt = randomSalt(); keys = await deriveKeys('nasza rodzina 1950', salt, ITER);
  const init = (setup, extra = {}) => call('vault/init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setup, salt, iter: ITER, ...extra }) });
  assert.equal((await init('wrong', { authHash: await authHash(keys.auth) })).status, 403);
  assert.equal((await init('setup-code-123', { authHash: 'nothex' })).status, 422);
  assert.equal((await init('setup-code-123', { authHash: await authHash(keys.auth), iter: 10 })).status, 422);
  assert.equal((await init('setup-code-123', { authHash: await authHash(keys.auth) })).status, 200);
  assert.equal((await init('setup-code-123', { authHash: await authHash(keys.auth) })).status, 409);
  r = await j(await call('vault'));
  assert.equal(r.body.initialized, true); assert.equal(r.body.salt, salt); assert.equal(r.body.iter, ITER);
  // The server stores only the hash of the auth secret, never the secret.
  const stored = env.DB.raw.prepare("SELECT v FROM vault_meta WHERE k = 'auth_hash'").get().v;
  assert.notEqual(stored, keys.auth);
});

test('items need the auth secret; cross-origin writes are refused', async () => {
  assert.equal((await call('items')).status, 401);
  assert.equal((await call('items', { headers: { 'x-vault-auth': 'a'.repeat(64) } })).status, 401);
  assert.equal((await call('items', { headers: { 'x-vault-auth': keys.auth } })).status, 200);
  const r = await call('items/tree', { method: 'PUT', body: 'A'.repeat(100), headers: { 'x-vault-auth': keys.auth, 'x-base-rev': '0', origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

const auth = (h = {}) => ({ 'x-vault-auth': keys.auth, ...h });
const putTree = async (text, base) => j(await call('items/tree', { method: 'PUT', body: await sealText(keys.key, 'tree', text), headers: auth({ 'x-base-rev': String(base) }) }));
const getTree = async (id = 'tree') => { const r = await call('items/' + id, { headers: auth() }); return { rev: Number(r.headers.get('x-rev')), text: await openText(keys.key, 'tree', await r.text()) }; };

test('tree: create, optimistic locking, conflict, history', async () => {
  assert.equal((await j(await call('items/tree', { method: 'PUT', body: 'A'.repeat(100), headers: auth() }))).status, 422, 'base rev required');
  let r = await putTree('v1', 0); assert.deepEqual([r.status, r.body.rev], [200, 1]);
  r = await putTree('stale', 0); assert.deepEqual([r.status, r.body.error, r.body.rev], [409, 'conflict', 1]);
  r = await putTree('v2', 1); assert.deepEqual([r.status, r.body.rev], [200, 2]);
  r = await putTree('stale again', 1); assert.equal(r.status, 409);
  assert.deepEqual(await getTree(), { rev: 2, text: 'v2' });
  // v1 was archived (first archive ever); v2 -> v3 within 30 minutes is not archived again.
  r = await putTree('v3', 2); assert.equal(r.body.rev, 3);
  const { body } = await j(await call('items', { headers: auth() }));
  const old = body.items.filter((i) => i.kind === 'tree-old');
  assert.deepEqual(old.map((i) => i.id), ['tree_h1']);
  assert.deepEqual(await getTree('tree_h1'), { rev: 1, text: 'v1' });
  assert.equal((await call('items/tree_h1', { method: 'PUT', body: 'A'.repeat(100), headers: auth({ 'x-base-rev': '1' }) })).status, 403);
  // No chunk rows leak (only tree + one history version, no tmp leftovers).
  const ids = env.DB.raw.prepare('SELECT DISTINCT id FROM chunks ORDER BY id').all().map((x) => x.id);
  assert.deepEqual(ids, ['tree', 'tree_h1']);
});

test('large item is chunked and reassembled', async () => {
  const big = 'x'.repeat(10) + [...Array(400_000)].map((_, i) => String.fromCharCode(33 + ((i * 7919) % 90))).join('');
  const body = await seal(keys.key, 'big1', new TextEncoder().encode(big)); // not gzipped: random-ish text stays large
  const binBody = await seal(keys.key, 'pbig', new Uint8Array(2_400_000).map((_, i) => (i * 31) & 255));
  assert.ok(binBody.length > 3_000_000);
  let r = await j(await call('items/photo_pbig', { method: 'PUT', body: binBody, headers: auth() }));
  assert.equal(r.status, 200);
  const n = env.DB.raw.prepare("SELECT COUNT(*) AS n FROM chunks WHERE id = 'photo_pbig'").get().n;
  assert.ok(n >= 3, 'should span several chunks');
  const got = await (await call('items/photo_pbig', { headers: auth() })).text();
  assert.equal(got, binBody);
  assert.ok(body.length > 0);
});

test('photos: upload, overwrite, delete; bad ids rejected', async () => {
  const body = await seal(keys.key, 'pabc', new Uint8Array([1, 2, 3, 4, 5]));
  assert.equal((await call('items/photo_pabc', { method: 'PUT', body, headers: auth() })).status, 200);
  assert.equal((await call('items/photo_pabc', { method: 'PUT', body, headers: auth() })).status, 200);
  const r = await call('items/photo_pabc', { headers: auth() });
  assert.deepEqual([...await open(keys.key, 'pabc', await r.text())], [1, 2, 3, 4, 5]);
  assert.equal(r.headers.get('x-rev'), '2');
  assert.equal((await call('items/photo_pabc', { method: 'DELETE', headers: auth() })).status, 200);
  assert.equal((await call('items/photo_pabc', { headers: auth() })).status, 404);
  assert.equal((await call('items/tree', { method: 'DELETE', headers: auth() })).status, 403);
  assert.equal((await call('items/..%2Fvault', { headers: auth() })).status, 400);
  assert.equal((await call('items/photo_x', { method: 'PUT', body: 'not base64 !!!'.repeat(5), headers: auth() })).status, 422);
});

test('wrong passwords are rate limited per IP, other IPs and the right password still work', async () => {
  const bad = (ip) => call('items', { headers: { 'x-vault-auth': 'a'.repeat(64), 'cf-connecting-ip': ip } });
  const good = (ip) => call('items', { headers: { 'x-vault-auth': keys.auth, 'cf-connecting-ip': ip } });
  for (let i = 0; i < 10; i++) assert.equal((await bad('10.0.0.1')).status, 401);
  const r = await bad('10.0.0.1');
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 3000);
  assert.equal((await good('10.0.0.1')).status, 429, 'locked IP gets no oracle, even for the right password');
  assert.equal((await good('10.0.0.2')).status, 200);
  env.DB.raw.exec('DELETE FROM auth_fail');
});

test('global lockout after many wrong guesses from many IPs', async () => {
  const now = Date.now(), ins = env.DB.raw.prepare('INSERT INTO auth_fail (ip, t) VALUES (?, ?)');
  for (let i = 0; i < 200; i++) ins.run('192.0.2.' + (i % 250), now - 1000);
  assert.equal((await call('items', { headers: { 'x-vault-auth': keys.auth, 'cf-connecting-ip': '10.9.9.9' } })).status, 429);
  env.DB.raw.exec('DELETE FROM auth_fail');
  assert.equal((await call('items', { headers: { 'x-vault-auth': keys.auth, 'cf-connecting-ip': '10.9.9.9' } })).status, 200);
});
