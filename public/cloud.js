// Cloud sync for the family vault: one shared, end-to-end encrypted copy of the tree and photos.
// The password never leaves the browser. See cloud-core.js for the crypto and functions/api for the server.
import { deriveKeys, authHash, randomSalt, KDF_ITER, seal, open, sealText, openText, decide } from './cloud-core.js';
import { el } from './ui.js';
import { getPhoto, putPhoto, allPhotoIds, forgetUrl } from './media.js';

const STATE_KEY = 'rodzina.cloud.v1';
const IDB = 'rodzina-cloud', STORE = 'keys';
const POLL_MS = 120_000, PUSH_DELAY_MS = 3_000, ORPHAN_AGE_MS = 86_400_000;
const MIN_PASSWORD = 5;  // the server rate-limits wrong guesses

// ---------- remembered key (IndexedDB keeps a non-extractable CryptoKey) ----------
function idb() { return new Promise((res, rej) => { const r = indexedDB.open(IDB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbDo(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const r = fn(t.objectStore(STORE)); t.oncomplete = () => { db.close(); res(r?.result); }; t.onerror = () => { db.close(); rej(t.error); }; }); }
const loadCreds = () => idbDo('readonly', (s) => s.get('creds')).catch(() => null);
const saveCreds = (c) => idbDo('readwrite', (s) => s.put(c, 'creds')).catch(() => {});
const dropCreds = () => idbDo('readwrite', (s) => s.delete('creds')).catch(() => {});

const loadState = () => { try { return { synced: null, dirty: false, last: 0, ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}') }; } catch { return { synced: null, dirty: false, last: 0 }; } };
const saveState = (patch) => { const s = { ...loadState(), ...patch }; try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {} return s; };

const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
const kb = (n) => (n > 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' kB');

/**
 * app: { text(), count(), apply(gedText), restore(gedText), photos(): Map<id, mime>, say(t), onPhotos(), button: HTMLElement }
 */
export function createCloud(app) {
  let creds = null;        // { key, auth }
  let vault = null;        // server status: { initialized, salt, iter, setup } | { unavailable: true }
  let status = 'start';    // start | unavailable | setup | locked | sync | ok | conflict | error
  let detail = '';
  let busy = false, again = false, pushTimer = null, changeSeq = 0, conflictRemote = 0;
  const mounts = new Set();

  const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const r = await fetch('/api/' + path, { method, body, headers: { ...(creds ? { 'x-vault-auth': creds.auth } : {}), ...headers }, cache: 'no-store' });
    if (r.status === 401 && creds) { creds = null; await dropCreds(); set('locked', 'Hasło do chmury się zmieniło. Odblokuj ponownie.'); throw new Error('locked'); }
    return r;
  };
  const jsonOk = async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; };

  function set(s, d = '') { status = s; detail = d; paintButton(); for (const m of mounts) if (m.isConnected) { if (!m.contains(document.activeElement)) draw(m); } else mounts.delete(m); }

  function paintButton() {
    const b = app.button; if (!b) return;
    const st = loadState();
    const map = {
      start: ['☁', 'Chmura: sprawdzam…'], unavailable: ['☁', 'Chmura niedostępna'], setup: ['☁ +', 'Chmura: do skonfigurowania'],
      locked: ['☁ 🔒', 'Chmura zablokowana: wpisz hasło rodzinne'], sync: ['☁ …', 'Chmura: synchronizuję'],
      ok: [st.dirty ? '☁ …' : '☁ ✓', st.dirty ? 'Chmura: zmiany czekają na wysłanie' : `Chmura: zsynchronizowano ${fmtTime(st.last)}`],
      conflict: ['☁ !', 'Chmura: inna wersja w chmurze, wybierz którą zostawić'], error: ['☁ ⚠', 'Chmura: błąd. ' + detail],
    };
    const [t, title] = map[status] || map.start;
    b.textContent = t; b.title = title; b.setAttribute('aria-label', title); b.dataset.state = status;
  }

  // ---------- sync ----------
  async function pull(rev) {
    const r = await api('items/tree');
    if (!r.ok) throw new Error('pobieranie drzewa: HTTP ' + r.status);
    const got = Number(r.headers.get('x-rev')) || rev;
    const ged = await openText(creds.key, 'tree', await r.text());
    const before = app.count();
    app.apply(ged);
    saveState({ synced: got, dirty: false, last: Date.now() });
    app.say(before ? `Pobrano nowszą wersję z chmury (${app.count()} osób).` : `Wczytano z chmury: ${app.count()} osób.`);
  }

  async function push(base) {
    if (!app.count()) return true;
    const seq = changeSeq;
    const body = await sealText(creds.key, 'tree', app.text());
    const r = await api('items/tree', { method: 'PUT', body, headers: { 'content-type': 'text/plain', 'x-base-rev': String(base) } });
    if (r.status === 409) { const j = await r.json().catch(() => ({})); conflictRemote = j.rev || 0; return false; }
    const { rev } = await jsonOk(r);
    const dirty = changeSeq !== seq;
    saveState({ synced: rev, dirty, last: Date.now() });
    if (dirty) again = true;
    return true;
  }

  async function syncPhotos(items) {
    const remote = new Map(items.filter((i) => i.kind === 'photo').map((i) => [i.id.slice(6), i]));
    const used = app.photos();
    const local = new Set(await allPhotoIds());
    let up = 0, down = 0;
    for (const [id, mime] of used) {
      if (!remote.has(id) && local.has(id)) {
        const blob = await getPhoto(id); if (!blob) continue;
        const body = await seal(creds.key, id, new Uint8Array(await blob.arrayBuffer()));
        await jsonOk(await api('items/photo_' + encodeURIComponent(id), { method: 'PUT', body, headers: { 'content-type': 'text/plain' } }));
        up++;
      } else if (remote.has(id) && !local.has(id)) {
        const r = await api('items/photo_' + encodeURIComponent(id)); if (!r.ok) continue;
        const bytes = await open(creds.key, id, await r.text());
        await putPhoto(id, new Blob([bytes], { type: mime || 'image/jpeg' })); forgetUrl(id);
        down++;
      }
    }
    return { up, down, remote, used };
  }

  async function cleanOrphans(remote, used) {
    const now = Date.now();
    for (const [id, it] of remote) if (!used.has(id) && now - it.updated_at > ORPHAN_AGE_MS) await api('items/photo_' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
  }

  async function sync() {
    if (!creds || !vault?.initialized) return;
    if (busy) { again = true; return; }
    busy = true; clearTimeout(pushTimer); set('sync');
    try {
      const { items } = await jsonOk(await api('items'));
      const remoteRev = items.find((i) => i.id === 'tree')?.rev || 0;
      const st = loadState();
      const act = decide({ synced: st.synced, dirty: st.dirty, local: app.count(), remote: remoteRev });
      if (act === 'conflict') { conflictRemote = remoteRev; set('conflict'); return; }
      if (act === 'pull') await pull(remoteRev);
      const ph = await syncPhotos(items); // photos go up before the tree that points to them
      if (act === 'push' && !(await push(remoteRev))) { set('conflict'); return; }
      if (ph.down) app.onPhotos();
      const now = loadState();
      if (now.synced != null && !now.dirty) await cleanOrphans(ph.remote, ph.used); // only when this tree is the cloud tree
      set('ok');
    } catch (e) {
      if (e.message !== 'locked') set('error', navigator.onLine === false ? 'Brak internetu, spróbuję później.' : e.message);
    } finally {
      busy = false;
      if (again) { again = false; schedule(500); }
    }
  }
  const schedule = (ms = PUSH_DELAY_MS) => { clearTimeout(pushTimer); pushTimer = setTimeout(sync, ms); };

  // ---------- public ----------
  async function refreshVault() {
    try { const r = await fetch('/api/vault', { cache: 'no-store' }); vault = r.ok ? await r.json() : { unavailable: true }; }
    catch { vault = { unavailable: true }; }
    return vault;
  }

  async function start() {
    await refreshVault();
    if (vault.unavailable) return set('unavailable');
    if (!vault.initialized) return set('setup');
    const c = await loadCreds();
    if (c?.key && c?.auth && c.salt === vault.salt) creds = { key: c.key, auth: c.auth };
    if (!creds) return set('locked');
    await sync();
    startTimers();
  }

  function changed() {
    changeSeq++;
    saveState({ dirty: true });
    if (creds && status !== 'conflict') { paintButton(); schedule(); }
  }

  async function setup(code, password, remember) {
    const salt = randomSalt();
    const k = await deriveKeys(password, salt, KDF_ITER);
    const r = await fetch('/api/vault/init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setup: code.trim(), salt, iter: KDF_ITER, authHash: await authHash(k.auth) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error({ 'bad-setup-code': 'Zły kod konfiguracji.', 'already-initialized': 'Chmura jest już skonfigurowana. Odśwież stronę i odblokuj hasłem.' }[j.error] || 'Błąd: ' + (j.error || r.status));
    await refreshVault();
    creds = { key: k.key, auth: k.auth };
    if (remember) await saveCreds({ ...creds, salt });
    saveState({ synced: null, dirty: false });
    await sync();
    startTimers();
  }

  async function unlock(password, remember) {
    await refreshVault();
    if (!vault.initialized) throw new Error('Chmura nie jest skonfigurowana.');
    const k = await deriveKeys(password, vault.salt, vault.iter);
    const r = await fetch('/api/items', { headers: { 'x-vault-auth': k.auth }, cache: 'no-store' });
    if (r.status === 401) throw new Error('Złe hasło.');
    if (r.status === 429) { const s = Number(r.headers.get('retry-after')) || 3600; throw new Error(`Za dużo błędnych prób. Spróbuj za ${Math.ceil(s / 60)} min.`); }
    if (!r.ok) throw new Error('Serwer odpowiedział ' + r.status);
    creds = { key: k.key, auth: k.auth };
    if (remember) await saveCreds({ ...creds, salt: vault.salt }); else await dropCreds();
    await sync();
    startTimers();
  }
  let timersOn = false;
  function startTimers() {
    if (timersOn) return; timersOn = true;
    setInterval(() => { if (!document.hidden) sync(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    addEventListener('online', () => sync());
  }

  async function lock() { creds = null; clearTimeout(pushTimer); await dropCreds(); set(vault?.initialized ? 'locked' : 'setup'); }
  /** Forget everything cloud-related on this device (the cloud copy stays). */
  async function forgetDevice() { await lock(); try { localStorage.removeItem(STATE_KEY); } catch {} paintButton(); }

  async function takeCloud() { busy = true; try { await pull(conflictRemote); } finally { busy = false; } await sync(); }
  async function keepMine() {
    busy = true;
    try { const { items } = await jsonOk(await api('items')); const rev = items.find((i) => i.id === 'tree')?.rev || 0; if (!(await push(rev))) return set('conflict'); }
    finally { busy = false; }
    await sync();
  }
  async function history() {
    const { items } = await jsonOk(await api('items'));
    return items.filter((i) => i.kind === 'tree-old' || i.id === 'tree').sort((a, b) => b.rev - a.rev);
  }
  async function restoreVersion(id) {
    const r = await api('items/' + id); if (!r.ok) throw new Error('HTTP ' + r.status);
    app.restore(await openText(creds.key, 'tree', await r.text()));
  }

  // ---------- UI ----------
  const pw = (ph) => el('input', { type: 'password', placeholder: ph, autocomplete: 'current-password', minLength: MIN_PASSWORD });
  const busyBtn = (label, fn, cls = 'primary') => {
    const b = el('button', { class: cls, onclick: async () => { const old = b.textContent; b.disabled = true; b.textContent = 'Chwileczkę…'; try { await fn(); } catch (e) { app.say(e.message); } finally { b.disabled = false; b.textContent = old; } } }, label);
    return b;
  };

  function draw(box) {
    box.replaceChildren();
    const st = loadState();
    if (status === 'start') return box.append(el('p', { class: 'mut' }, 'Sprawdzam chmurę…'));
    if (status === 'unavailable') return box.append(el('p', { class: 'mut' }, 'Chmura niedostępna (brak połączenia z serwerem). Dane w tej przeglądarce działają normalnie.'));
    if (status === 'setup') {
      if (!vault?.setup) return box.append(el('p', { class: 'mut' }, 'Chmura nie jest jeszcze włączona na serwerze.'));
      const code = el('input', { placeholder: 'kod konfiguracji', autocomplete: 'off' }), a = pw(`hasło rodzinne (min. ${MIN_PASSWORD} znaków)`), b = pw('powtórz hasło'), rem = el('input', { type: 'checkbox', checked: true });
      a.autocomplete = b.autocomplete = 'new-password';
      return box.append(
        el('p', {}, 'Jedna wspólna kopia drzewa i zdjęć w chmurze. Wszystko jest szyfrowane w przeglądarce hasłem rodzinnym: serwer widzi tylko zaszyfrowane dane.'),
        el('p', { class: 'mut' }, 'Hasła nie da się odzyskać. Zapisz je w bezpiecznym miejscu. Kod konfiguracji jest jednorazowy.'),
        el('div', { class: 'cloud-form' }, code, a, b, el('label', { class: 'mut' }, rem, ' zapamiętaj na tym urządzeniu'),
          busyBtn('Włącz chmurę', async () => {
            if (a.value.length < MIN_PASSWORD) throw new Error(`Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.`);
            if (a.value !== b.value) throw new Error('Hasła się różnią.');
            await setup(code.value, a.value, rem.checked);
            app.say('Chmura włączona. Dane są szyfrowane i wysłane.');
          })));
    }
    if (status === 'locked' || !creds) {
      const p = pw('hasło rodzinne'), rem = el('input', { type: 'checkbox', checked: true });
      const go = busyBtn('Odblokuj', async () => { await unlock(p.value, rem.checked); p.value = ''; });
      p.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
      return box.append(
        detail && el('p', { class: 'warn-text' }, detail),
        el('p', {}, 'Wpisz hasło rodzinne, a drzewo i zdjęcia pobiorą się z chmury. Na zapamiętanym urządzeniu dzieje się to samo przy każdym otwarciu.'),
        el('div', { class: 'cloud-form' }, p, el('label', { class: 'mut' }, rem, ' zapamiętaj na tym urządzeniu'), go));
    }
    const line = { sync: 'Synchronizuję…', ok: st.dirty ? 'Zmiany czekają na wysłanie…' : `Zsynchronizowano: ${fmtTime(st.last)}.`, error: 'Błąd: ' + detail, conflict: 'W chmurze jest inna wersja niż tutaj.' }[status] || '';
    box.append(el('p', {}, el('span', { class: `pill ${status === 'ok' && !st.dirty ? 'ok' : status === 'sync' || status === 'ok' ? '' : 'warn'}` }, status === 'ok' ? 'połączono' : status === 'sync' ? 'w toku' : 'uwaga'), ' ', line, st.synced ? el('small', { class: 'mut' }, ` Wersja ${st.synced}.`) : null));
    if (status === 'conflict') {
      box.append(el('p', { class: 'mut' }, 'Ktoś zmienił drzewo w chmurze, a tutaj też są niewysłane zmiany. Wybierz, którą wersję zostawić. „Pobierz z chmury” zastąpi dane tutaj (Ctrl+Z przywróci je w tej karcie). Na wszelki wypadek najpierw pobierz .ged.'),
        el('div', { class: 'row' }, busyBtn('Pobierz wersję z chmury', takeCloud), busyBtn('Zostaw moją i wyślij', keepMine, ''), el('button', { onclick: () => app.download() }, 'Pobierz .ged (kopia)')));
    }
    const hist = el('div');
    box.append(el('div', { class: 'row' },
      busyBtn('Synchronizuj teraz', sync, ''),
      busyBtn('Wcześniejsze wersje', async () => {
        const vs = await history();
        hist.replaceChildren(el('p', { class: 'mut' }, 'Chmura zachowuje wersję co najmniej co 30 minut (do 30 wersji). Przywrócenie działa jak zwykła zmiana: można cofnąć (Ctrl+Z).'),
          el('ul', { class: 'plain' }, vs.map((v) => el('li', {}, el('span', {}, `${fmtTime(v.updated_at)} · wersja ${v.rev} · ${kb(v.size * 0.75)}`), v.id === 'tree' ? el('small', { class: 'mut' }, ' (obecna)') : busyBtn('Przywróć', async () => { await restoreVersion(v.id); app.say(`Przywrócono wersję ${v.rev} z ${fmtTime(v.updated_at)}.`); }, 'sm')))));
      }, ''),
      busyBtn('Zablokuj na tym urządzeniu', async () => { await lock(); app.say('Klucz usunięty z tego urządzenia. Dane w przeglądarce i w chmurze zostają.'); }, 'ghost')), hist);
  }

  function mount(box = el('div', { class: 'cloud-box' })) { mounts.add(box); draw(box); return box; }

  return { start, sync, changed, setup, unlock, lock, forgetDevice, mount, get status() { return status; }, get unlocked() { return !!creds; }, get vault() { return vault; } };
}
