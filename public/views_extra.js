// Extra views and sections. `ctx` is supplied by app.js: { model(), mutate(fn), say(t), go(path), goPerson(id,tab), render(), ui, sortedIds(), label(p), reload(blobbed) }.
import { el, svg, avatar, bars, download, personLabel } from './ui.js';
import { displayName, years, parentsOf } from './tree.js';
import { formatDate, formatLong, toGedcomDate, yearOf } from './dates.js';
import { EVENT_TYPES, eventLabel, addSource, removeSource, sourceUsage, addTask, collectPlaces, renamePlace, findReplace, FR_FIELDS, timelineFor, globalTimeline, lifeBars, historyBetween, HISTORY, addPhotoMeta, setPrimaryPhoto, removePhotoMeta, uid } from './extras.js';
import { putPhoto, deletePhoto, prepareImage, photoUrl, forgetUrl, makeZip, allPhotoIds, getPhoto } from './media.js';
import { serializeGedcom } from './gedcom.js';
import { personSheet, descendantBook, ahnentafel, indexReport, openReport } from './reports.js';

const KIND_ICON = { birth: '✶', death: '†', marriage: '⚭', event: '•', child: '👶' };
const KIND_NAME = { birth: 'Urodzenia', death: 'Zgony', marriage: 'Śluby', event: 'Inne wydarzenia' };

// ---------- events & sources on the person card ----------
export function eventsSection(panel, id, ctx) {
  const m = ctx.model(), p = m.persons[id];
  const places = collectPlaces(m).map((x) => x.name);
  const dl = el('datalist', { id: 'dl-places' }, places.slice(0, 300).map((n) => el('option', { value: n })));
  panel.append(el('h3', {}, `Wydarzenia (${p.events.length})`), dl);
  const key = (e) => (e.type === 'EVEN' ? 'label' : 'value');
  for (const e of p.events) {
    const f = (ph, val, set, extra = {}, withList = false) => { const i = el('input', { value: val || '', placeholder: ph, ...extra }); if (withList) i.setAttribute('list', 'dl-places'); i.addEventListener('change', () => ctx.mutate(() => set(i.value.trim()))); return i; };
    panel.append(el('div', { class: 'evrow' },
      el('b', {}, EVENT_TYPES[e.type] || e.type),
      f(e.type === 'EVEN' ? 'nazwa wydarzenia' : 'opis (np. zawód, szkoła)', e[key(e)], (v) => { e[key(e)] = v; }),
      f('data', e.date, (v) => { e.date = toGedcomDate(v); }), f('miejsce', e.place, (v) => { e.place = v; }, { placeholder: 'miejsce' }, true),
      f('notatka', e.note, (v) => { e.note = v; }),
      el('button', { class: 'sm danger', title: 'Usuń wydarzenie', onclick: () => ctx.mutate(() => { p.events = p.events.filter((x) => x !== e); }) }, '✕')));
  }
  const type = el('select', {}, Object.entries(EVENT_TYPES).map(([k, v]) => el('option', { value: k }, v)));
  const desc = el('input', { placeholder: 'opis (opcjonalnie)' }), date = el('input', { placeholder: 'data, np. 5.01.1900' }), place = el('input', { placeholder: 'miejsce' }); place.setAttribute('list', 'dl-places');
  panel.append(el('div', { class: 'add' }, type, desc, date, place, el('button', { onclick: () => ctx.mutate(() => {
    const ev = { id: uid('e'), type: type.value, value: type.value === 'EVEN' ? '' : desc.value.trim(), label: type.value === 'EVEN' ? desc.value.trim() : '', date: toGedcomDate(date.value), place: place.value.trim(), note: '', sources: [] };
    p.events.push(ev);
  }) }, 'Dodaj wydarzenie')));
}

export function sourcesSection(panel, id, ctx) {
  const m = ctx.model(), p = m.persons[id];
  const all = Object.values(m.ext.sources);
  panel.append(el('h3', {}, `Źródła (${(p.sources || []).length})`));
  panel.append(el('div', { class: 'rel' }, (p.sources || []).map((sid) => el('div', { class: 'chip', onclick: () => ctx.go('zrodla') }, el('span', {}, m.ext.sources[sid]?.title || sid, el('small', {}, m.ext.sources[sid]?.author || ''))))));
  const s = el('select', {}, el('option', { value: '' }, all.length ? 'dodaj istniejące źródło…' : 'brak źródeł, utwórz w zakładce Źródła'), all.filter((x) => !(p.sources || []).includes(x.id)).map((x) => el('option', { value: x.id }, x.title || x.id)));
  s.addEventListener('change', () => { if (s.value) ctx.mutate(() => { p.sources.push(s.value); }); });
  const t = el('input', { placeholder: 'lub nowe źródło: tytuł' });
  panel.append(el('div', { class: 'add' }, s, t, el('button', { onclick: () => { if (!t.value.trim()) return; ctx.mutate(() => { const sid = addSource(m, { title: t.value.trim() }); p.sources.push(sid); }); } }, 'Utwórz i dodaj')));
}

// ---------- person timeline tab ----------
export function timelineTab(panel, id, ctx) {
  const m = ctx.model(), p = m.persons[id];
  const evs = timelineFor(m, id);
  const by = yearOf(p.birth.date), dy = yearOf(p.death.date);
  panel.append(el('p', { class: 'mut' }, evs.length ? `${evs.length} wydarzeń z datą. Szare wiersze to tło historyczne (Polska) w czasie życia tej osoby.` : 'Brak wydarzeń z datą. Dodaj daty lub wydarzenia na karcie osoby.'));
  const hist = by != null ? historyBetween(by, dy ?? Math.min(new Date().getFullYear(), by + 90)) : [];
  const rows = [...evs.map((e) => ({ y: e.year * 10000 + e.month * 100 + e.day, e })), ...hist.map(([y, t]) => ({ y: y * 10000 + 650, h: [y, t] }))].sort((a, b) => a.y - b.y);
  const ul = el('ol', { class: 'tl' });
  for (const r of rows) {
    if (r.h) { ul.append(el('li', { class: 'hist' }, el('span', { class: 'yr' }, String(r.h[0])), el('span', { class: 'ic' }, '·'), el('span', {}, r.h[1]))); continue; }
    const e = r.e;
    const who = e.with && m.persons[e.with] ? el('a', { onclick: () => ctx.goPerson(e.with) }, ' ' + displayName(m.persons[e.with])) : null;
    ul.append(el('li', { class: `k-${e.kind}` }, el('span', { class: 'yr' }, formatDate(e.date) || String(e.year)), el('span', { class: 'ic' }, KIND_ICON[e.kind] || '•'),
      el('span', {}, el('b', {}, e.label), who, e.place ? ` · ${e.place}` : '', e.age != null && e.age >= 0 ? el('small', { class: 'mut' }, ` (${e.age} lat)`) : null, e.note ? el('small', { class: 'mut' }, ` – ${e.note}`) : null)));
  }
  panel.append(ul);
}

// ---------- photos tab ----------
export function photosTab(panel, id, ctx) {
  const m = ctx.model(), p = m.persons[id];
  const grid = el('div', { class: 'gallery' });
  const upload = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async (e) => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    ctx.say(`Dodaję ${files.length} zdjęć…`);
    const metas = [];
    for (const f of files) { try { const r = await prepareImage(f); const meta = { title: f.name.replace(/\.[^.]+$/, ''), mime: r.mime, w: r.w, h: r.h }; metas.push({ meta, blob: r.blob }); } catch { ctx.say(`Pominięto ${f.name} (nie da się odczytać jako obraz).`); } }
    ctx.mutate(() => { for (const x of metas) { const ph = addPhotoMeta(m, id, x.meta); x.id = ph.id; } });
    for (const x of metas) await putPhoto(x.id, x.blob);
    ctx.render(); ctx.say(`Dodano zdjęć: ${metas.length}.`);
  } });
  panel.append(el('div', { class: 'treebar' }, el('label', { class: 'btn primary' }, 'Dodaj zdjęcia', upload), el('span', { class: 'mut' }, 'Zdjęcia są zmniejszane do 1600 px i zostają w tej przeglądarce. Do przeniesienia na inne urządzenie użyj kopii ZIP w Narzędziach.')), grid);
  if (!p.photos.length) grid.append(el('p', { class: 'mut' }, 'Brak zdjęć.'));
  for (const ph of p.photos) {
    const img = el('img', { alt: ph.title || '', loading: 'lazy' });
    photoUrl(ph.id).then((u) => { if (u) img.src = u; else img.replaceWith(el('div', { class: 'missing' }, 'brak pliku (ta przeglądarka go nie ma)')); });
    const title = el('input', { value: ph.title || '', placeholder: 'podpis' }); title.addEventListener('change', () => ctx.mutate(() => { ph.title = title.value.trim(); }));
    grid.append(el('figure', { class: ph.primary ? 'primary' : '' }, img, title,
      el('div', { class: 'row' }, el('button', { class: 'sm', disabled: ph.primary, onclick: () => ctx.mutate(() => setPrimaryPhoto(m, id, ph.id)) }, ph.primary ? '★ główne' : '☆ ustaw jako główne'),
        el('button', { class: 'sm danger', onclick: async () => { if (!confirm('Usunąć to zdjęcie?')) return; ctx.mutate(() => removePhotoMeta(m, id, ph.id)); await deletePhoto(ph.id); forgetUrl(ph.id); } }, 'Usuń'))));
  }
}

// ---------- global timeline ----------
export function viewTimeline(main, ctx) {
  const m = ctx.model(), ui = ctx.ui;
  const st = ui.tl || (ui.tl = { mode: 'lista', kinds: ['birth', 'death', 'marriage', 'event'], from: '', to: '', surname: '', hist: true });
  const surnames = [...new Set(Object.values(m.persons).map((p) => p.surname).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
  const body = el('div');
  const draw = () => {
    body.replaceChildren();
    const from = st.from === '' ? null : +st.from, to = st.to === '' ? null : +st.to;
    if (st.mode === 'lista') {
      const list = globalTimeline(m, { kinds: st.kinds, from, to, surname: st.surname });
      body.append(el('p', { class: 'mut' }, `${list.length} wydarzeń z datą.`));
      let lastDec = null; const ol = el('ol', { class: 'tl' });
      for (const e of list) {
        const dec = Math.floor(e.year / 10) * 10;
        if (dec !== lastDec) { lastDec = dec; ol.append(el('li', { class: 'dec' }, `${dec}–${dec + 9}`)); if (st.hist) for (const [y, t] of HISTORY.filter(([y]) => y >= dec && y <= dec + 9)) ol.append(el('li', { class: 'hist' }, el('span', { class: 'yr' }, String(y)), el('span', { class: 'ic' }, '·'), el('span', {}, t))); }
        const p = m.persons[e.pid];
        ol.append(el('li', { class: `k-${e.kind}` }, el('span', { class: 'yr' }, formatDate(e.date) || String(e.year)), el('span', { class: 'ic' }, KIND_ICON[e.kind]),
          el('span', {}, el('b', {}, e.label), ' ', el('a', { onclick: () => ctx.goPerson(e.pid) }, displayName(p)), e.with && m.persons[e.with] ? ' + ' : '', e.with && m.persons[e.with] ? el('a', { onclick: () => ctx.goPerson(e.with) }, displayName(m.persons[e.with])) : '', e.place ? ` · ${e.place}` : '')));
      }
      body.append(ol);
    } else {
      const bs = lifeBars(m, { surname: st.surname }).filter((b) => (from == null || b.to >= from) && (to == null || b.from <= to));
      if (!bs.length) return body.append(el('p', { class: 'mut' }, 'Brak osób z datami w tym zakresie.'));
      const lo = Math.floor(Math.min(...bs.map((b) => b.from)) / 10) * 10, hi = Math.ceil(Math.max(...bs.map((b) => b.to)) / 10) * 10;
      const W = 1100, left = 230, rowH = 20, top = st.hist ? 80 : 52, X = (y) => left + ((y - lo) / (hi - lo || 1)) * (W - left - 20), H = top + bs.length * rowH + 20;
      const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'lives', role: 'img' });
      for (let y = lo; y <= hi; y += 10) { s.append(svg('line', { x1: X(y), x2: X(y), y1: top - 6, y2: H - 14, class: 'grid' })); if ((y - lo) % 20 === 0) s.append(svg('text', { x: X(y), y: 14, 'text-anchor': 'middle', class: 'ax' }, String(y))); }
      if (st.hist) {
        const lanes = [-1e9, -1e9, -1e9];
        HISTORY.forEach(([y, t], i) => {
          if (y < lo || y > hi) return;
          const x = X(y); let k = lanes.findIndex((lx) => x - lx >= 19); if (k < 0) k = lanes.indexOf(Math.min(...lanes)); lanes[k] = x;
          const cy = 30 + k * 18;
          s.append(svg('line', { x1: x, x2: x, y1: cy + 8, y2: H - 14, class: 'hl' }));
          const c = svg('circle', { cx: x, cy, r: 8, class: 'hc' }); c.append(svg('title', {}, `${y}: ${t}`));
          s.append(c, svg('text', { x, y: cy + 4, 'text-anchor': 'middle', class: 'hn' }, String(i + 1)));
        });
      }
      bs.forEach((b, i) => {
        const p = m.persons[b.id], y = top + i * rowH;
        const g = svg('g', { 'data-id': b.id, class: `lifebar ${p.sex || ''}` });
        const r = svg('rect', { x: X(b.from), y, width: Math.max(3, X(b.to) - X(b.from)), height: rowH - 5, rx: 3, class: b.guess ? 'guess' : '' }); r.append(svg('title', {}, `${displayName(p)}  ${years(p)}`));
        g.append(r, svg('text', { x: left - 8, y: y + 11, 'text-anchor': 'end', class: 'nm' }, `${displayName(p).slice(0, 24)} ${years(p)}`.trim()));
        g.addEventListener('click', () => ctx.goPerson(b.id)); s.append(g);
      });
      const keys = st.hist ? HISTORY.map(([y, t], i) => [i + 1, y, t]).filter(([, y]) => y >= lo && y <= hi) : [];
      body.append(el('p', { class: 'mut' }, `${bs.length} osób. Niebieski = mężczyzna, różowy = kobieta, pasek przerywany = brak jednej z dat (zakres zgadnięty). Złote kółka z numerem to wydarzenia historyczne (legenda pod wykresem). Kliknij pasek, aby otworzyć osobę.`), el('div', { class: 'canvas lifewrap' }, s), keys.length ? el('div', { class: 'histkey' }, keys.map(([n, y, t]) => el('span', {}, el('b', {}, String(n)), ` ${y}: ${t}`))) : null);
    }
  };
  const chk = (k) => el('label', { class: 'inl' }, el('input', { type: 'checkbox', checked: st.kinds.includes(k), onchange: (e) => { st.kinds = e.target.checked ? [...st.kinds, k] : st.kinds.filter((x) => x !== k); draw(); } }), KIND_NAME[k]);
  const yr = (key, ph) => el('input', { type: 'number', placeholder: ph, value: st[key], style: 'width:6rem', oninput: (e) => { st[key] = e.target.value; draw(); } });
  const modeBtn = (v, t) => el('button', { class: st.mode === v ? 'on' : '', onclick: () => { st.mode = v; ctx.render(); } }, t);
  main.replaceChildren(el('div', { class: 'card', style: 'margin-top:.5rem' }, el('h2', {}, 'Oś czasu rodziny'),
    el('div', { class: 'tabs' }, modeBtn('lista', 'Lista wydarzeń'), modeBtn('zycie', 'Linie życia')),
    el('div', { class: 'treebar' }, st.mode === 'lista' ? ['birth', 'death', 'marriage', 'event'].map(chk) : null, el('label', { class: 'inl' }, 'od', yr('from', '1800')), el('label', { class: 'inl' }, 'do', yr('to', '2025')),
      el('select', { onchange: (e) => { st.surname = e.target.value; draw(); } }, el('option', { value: '' }, 'wszystkie nazwiska'), surnames.map((s) => el('option', { value: s, selected: st.surname === s }, s))),
      el('label', { class: 'inl' }, el('input', { type: 'checkbox', checked: st.hist, onchange: (e) => { st.hist = e.target.checked; draw(); } }), 'tło historyczne')), body));
  draw();
}

// ---------- places ----------
function parseCoords(s) { const m = s.replace(/;/g, ',').match(/(-?\d+(?:[.,]\d+)?)\s*[, ]\s*(-?\d+(?:[.,]\d+)?)/); if (!m) return null; const lat = +m[1].replace(',', '.'), lng = +m[2].replace(',', '.'); return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null; }
export function viewPlaces(main, ctx) {
  const m = ctx.model();
  const places = collectPlaces(m);
  const withC = places.filter((p) => m.ext.places[p.name]);
  const rows = el('div', { class: 'plist' });
  for (const pl of places) {
    const c = m.ext.places[pl.name];
    const ren = el('input', { value: pl.name }); ren.addEventListener('change', () => { const to = ren.value.trim(); if (!to || to === pl.name) return; if (confirm(`Zmienić „${pl.name}” na „${to}” w ${pl.n} miejscach?`)) ctx.mutate(() => { renamePlace(m, pl.name, to); }); else ren.value = pl.name; });
    const co = el('input', { value: c ? `${c.lat}, ${c.lng}` : '', placeholder: 'szer., dł. np. 52.22, 22.72' });
    co.addEventListener('change', () => { const v = co.value.trim(); if (!v) return ctx.mutate(() => { delete m.ext.places[pl.name]; }); const pc = parseCoords(v); if (!pc) return ctx.say('Nie rozumiem współrzędnych. Użyj formatu: 52.22, 22.72'); ctx.mutate(() => { m.ext.places[pl.name] = pc; }); });
    const osm = el('a', { href: c ? `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}#map=11/${c.lat}/${c.lng}` : `https://www.openstreetmap.org/search?query=${encodeURIComponent(pl.name)}`, target: '_blank', rel: 'noopener noreferrer' }, c ? 'mapa' : 'znajdź na OSM');
    const who = el('div', { class: 'rel' }, pl.people.slice(0, 6).map((pid) => m.persons[pid] && el('span', { class: 'chip', onclick: () => ctx.goPerson(pid) }, displayName(m.persons[pid]))), pl.people.length > 6 && el('small', { class: 'mut' }, `+${pl.people.length - 6}`));
    rows.append(el('div', { class: 'prow card' }, el('div', { class: 'ph2' }, ren, el('span', { class: 'pill' }, `${pl.n}×`), osm), co, who));
  }
  // schematic map of places with coordinates
  let map = el('p', { class: 'mut' }, 'Dodaj współrzędne do miejsc, a pojawi się tu schematyczna mapa punktów (bez podkładu, żeby nic nie wysyłać do sieci).');
  if (withC.length) {
    const pts = withC.map((p) => ({ ...m.ext.places[p.name], name: p.name, n: p.n }));
    const la = pts.map((p) => p.lat), lo = pts.map((p) => p.lng); const pad = 0.5;
    const minLa = Math.min(...la) - pad, maxLa = Math.max(...la) + pad, minLo = Math.min(...lo) - pad, maxLo = Math.max(...lo) + pad;
    const W = 640, H = Math.round(Math.max(200, Math.min(520, (W * (maxLa - minLa)) / ((maxLo - minLo) * Math.cos(((minLa + maxLa) / 2) * Math.PI / 180) || 1))));
    const X = (x) => 20 + ((x - minLo) / (maxLo - minLo)) * (W - 40), Y = (y) => H - 20 - ((y - minLa) / (maxLa - minLa)) * (H - 40);
    map = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'schem', role: 'img' });
    map.append(svg('rect', { x: 0, y: 0, width: W, height: H, class: 'bg' }));
    for (let i = 1; i < 4; i++) { map.append(svg('line', { x1: (W / 4) * i, x2: (W / 4) * i, y1: 0, y2: H, class: 'mg' }), svg('line', { x1: 0, x2: W, y1: (H / 4) * i, y2: (H / 4) * i, class: 'mg' })); }
    map.append(svg('text', { x: 8, y: H - 8, class: 'pl' }, `szer. ${minLa.toFixed(1)}–${maxLa.toFixed(1)}, dł. ${minLo.toFixed(1)}–${maxLo.toFixed(1)}`));
    for (const p of pts) { const g = svg('g', {}); const c = svg('circle', { cx: X(p.lng), cy: Y(p.lat), r: Math.min(14, 4 + p.n * 1.2), class: 'pt' }); c.append(svg('title', {}, `${p.name} (${p.n})`)); g.append(c, svg('text', { x: X(p.lng) + 8, y: Y(p.lat) + 4, class: 'pl' }, p.name.slice(0, 24))); map.append(g); }
  }
  main.replaceChildren(el('div', { style: 'margin-top:.5rem' }, el('h2', {}, `Miejsca (${places.length})`),
    el('p', { class: 'mut' }, 'Wszystkie miejsca z urodzeń, zgonów, ślubów i wydarzeń. Zmiana nazwy poprawia ją wszędzie naraz (np. ujednolicenie „Łosice” i „Losice”).'),
    el('div', { class: 'card' }, el('h3', { style: 'margin-top:0;border:0;padding:0' }, 'Mapa schematyczna'), map), el('h3', {}, 'Lista miejsc'), rows));
}

// ---------- sources & tasks ----------
export function viewSources(main, ctx) {
  const m = ctx.model(), ex = m.ext;
  const srcRows = Object.values(ex.sources).map((s) => {
    const f = (k, ph) => { const i = el('input', { value: s[k] || '', placeholder: ph }); i.addEventListener('change', () => ctx.mutate(() => { s[k] = i.value.trim(); })); return i; };
    const use = sourceUsage(m, s.id);
    return el('div', { class: 'card' }, el('div', { class: 'grid' }, el('label', {}, 'Tytuł', f('title', 'np. Księga urodzeń parafii X')), el('label', {}, 'Autor / archiwum', f('author', '')), el('label', {}, 'Adres WWW', f('url', 'https://…')), el('label', { class: 'wide' }, 'Notatka', f('note', ''))),
      el('div', { class: 'row' }, el('span', { class: 'mut' }, `Użyte przy ${use.length} osobach: `), use.slice(0, 5).map((p) => el('span', { class: 'chip', onclick: () => ctx.goPerson(p.id) }, displayName(p))),
        s.url && /^https?:\/\//.test(s.url) && el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, 'otwórz'), el('button', { class: 'sm danger', onclick: () => { if (confirm(`Usunąć źródło „${s.title || s.id}”? Odnośniki w osobach też znikną.`)) ctx.mutate(() => removeSource(m, s.id)); } }, 'Usuń')));
  });
  const nt = el('input', { placeholder: 'Nowe źródło: tytuł' });
  const tt = el('input', { placeholder: 'Nowe zadanie, np. „znaleźć akt ślubu Jana”' });
  const tp = el('select', {}, el('option', { value: '' }, 'dotyczy osoby (opcjonalnie)'), ctx.sortedIds().map((i) => el('option', { value: i }, personLabel(m.persons[i]))));
  const open = ex.tasks.filter((t) => !t.done), done = ex.tasks.filter((t) => t.done);
  const taskRow = (t) => el('li', { class: t.done ? 'done' : '' }, el('input', { type: 'checkbox', checked: t.done, onchange: (e) => ctx.mutate(() => { t.done = e.target.checked; }) }), el('span', {}, t.text), t.person && m.persons[t.person] ? el('a', { onclick: () => ctx.goPerson(t.person) }, displayName(m.persons[t.person])) : null,
    el('small', { class: 'mut' }, t.created || ''), el('button', { class: 'sm danger', onclick: () => ctx.mutate(() => { ex.tasks = ex.tasks.filter((x) => x !== t); }) }, '✕'));
  main.replaceChildren(el('div', { class: 'cols', style: 'margin-top:.5rem' },
    el('div', {}, el('h2', {}, `Źródła (${srcRows.length})`), el('p', { class: 'mut' }, 'Źródła zapisują się w pliku GEDCOM jako standardowe rekordy SOUR, więc zobaczą je też Ahnenblatt i MyHeritage.'),
      el('div', { class: 'add' }, nt, el('button', { class: 'primary', onclick: () => { if (nt.value.trim()) ctx.mutate(() => addSource(m, { title: nt.value.trim() })); } }, 'Dodaj źródło')), srcRows.length ? srcRows : el('p', { class: 'mut' }, 'Brak źródeł.')),
    el('div', {}, el('h2', {}, `Zadania badawcze (${open.length} otwartych)`), el('p', { class: 'mut' }, 'Lista rzeczy do sprawdzenia. Zapisuje się w pliku .ged pod własnym znacznikiem (inne programy ją pominą).'),
      el('div', { class: 'add' }, tt, tp, el('button', { class: 'primary', onclick: () => { if (tt.value.trim()) ctx.mutate(() => addTask(m, tt.value.trim(), tp.value)); } }, 'Dodaj zadanie')),
      el('ul', { class: 'tasks' }, open.map(taskRow), done.length ? el('li', { class: 'mut' }, `Zrobione (${done.length})`) : null, done.map(taskRow)))));
}

// ---------- tools: reports, backup, find & replace ----------
export function toolCards(ctx, card) {
  const m = ctx.model();
  const sel = el('select', { class: 'big' }, ctx.sortedIds().map((i) => el('option', { value: i }, personLabel(m.persons[i]))));
  const reports = card('Raporty do druku / PDF',
    el('p', { class: 'mut' }, 'Otwierają się w nowej karcie. Wybierz Drukuj i „Zapisz jako PDF”.'),
    el('label', { class: 'mut' }, 'Osoba początkowa', sel),
    el('div', { class: 'row' }, el('button', { onclick: () => openReport(descendantBook(m, sel.value)) }, 'Księga potomków'), el('button', { onclick: () => openReport(ahnentafel(m, sel.value)) }, 'Lista przodków'),
      el('button', { onclick: async () => { const ph = m.persons[sel.value].photos.find((x) => x.primary); openReport(personSheet(m, sel.value, { photoUrl: ph ? await photoUrl(ph.id) : null })); } }, 'Karta osoby'), el('button', { onclick: () => openReport(indexReport(m)) }, 'Indeks wszystkich osób')));

  const backup = card('Kopia zapasowa ze zdjęciami (ZIP)',
    el('p', { class: 'mut' }, 'ZIP zawiera plik .ged, zdjęcia i drugi plik .ged dla innych programów (zdjęcia jako zwykłe odnośniki OBJE). Wczytaj ZIP przyciskiem „Wczytaj .ged”, aby odtworzyć wszystko na innym urządzeniu.'),
    el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => ctx.exportZip() }, 'Pobierz kopię ZIP'), el('button', { onclick: () => ctx.cleanPhotos() }, 'Usuń nieużywane zdjęcia z przeglądarki')));

  const field = el('select', {}, Object.entries(FR_FIELDS).map(([k, v]) => el('option', { value: k }, v)));
  const from = el('input', { placeholder: 'znajdź' }), to = el('input', { placeholder: 'zamień na' }), whole = el('input', { type: 'checkbox' });
  const out = el('div', { class: 'result', hidden: true });
  const preview = () => { const r = findReplace(m, field.value, from.value, to.value, { dry: true, whole: whole.checked }); out.hidden = false; out.replaceChildren(el('b', {}, `Znaleziono: ${r.count}`), ...r.people.slice(0, 6).map((x) => el('div', { class: 'mut' }, `${displayName(m.persons[x.id])}: „${x.before.slice(0, 40)}” → „${x.after.slice(0, 40)}”`))); return r; };
  const find = card('Znajdź i zamień',
    el('p', { class: 'mut' }, 'Masowa poprawka jednego pola we wszystkich osobach (np. ujednolicenie pisowni nazwiska). Najpierw podgląd.'),
    el('div', { class: 'row' }, field, from, to, el('label', { class: 'inl' }, whole, 'całe pole')),
    el('div', { class: 'row' }, el('button', { onclick: preview }, 'Podgląd'), el('button', { class: 'danger', onclick: () => { const r = preview(); if (r.count && confirm(`Zmienić ${r.count} wartości? Można cofnąć (Ctrl+Z).`)) { ctx.mutate(() => findReplace(m, field.value, from.value, to.value, { dry: false, whole: whole.checked })); ctx.say(`Zmieniono: ${r.count}.`); } } }, 'Zamień')), out);
  return [reports, backup, find];
}

export async function buildZip(model) {
  const files = [];
  const enc = new TextEncoder();
  files.push({ name: 'rodzina.ged', data: enc.encode(serializeGedcom(model)) });
  files.push({ name: 'rodzina-dla-innych-programow.ged', data: enc.encode(serializeGedcom(model, { standardMedia: true })) });
  let n = 0, missing = 0;
  for (const p of Object.values(model.persons)) for (const ph of p.photos || []) {
    const b = await getPhoto(ph.id); if (!b) { missing++; continue; }
    const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[ph.mime] || 'jpg';
    files.push({ name: `photos/${ph.id}.${ext}`, data: new Uint8Array(await b.arrayBuffer()) }); n++;
  }
  files.push({ name: 'README.txt', data: enc.encode('Kopia z aplikacji ANIZDOR.\r\nrodzina.ged = pełne dane (do wczytania z powrotem w aplikacji).\r\nrodzina-dla-innych-programow.ged = to samo ze zdjęciami jako zwykłe pliki w photos/ (Ahnenblatt, MyHeritage).\r\n') });
  return { blob: makeZip(files), photos: n, missing };
}
