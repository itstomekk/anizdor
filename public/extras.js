// Extra data that GEDCOM 5.5.1 only partly covers, kept in model.ext and mapped to standard GEDCOM tags on export.
//   ext.sources  : { id: {id, title, author, note, url} }
//   ext.tasks    : [ {id, text, done, person, created} ]
//   ext.places   : { 'Place name': {lat, lng} }
//   person.events: [ {id, type, date, place, note, sources:[sourceId]} ]   // beyond BIRT/DEAT (marriage stays on the family)
//   person.photos: [ {id, title, mime, w, h, primary} ]                      // the pixels live in IndexedDB, keyed by id
import { yearOf, parseDate } from './dates.js';

export const EVENT_TYPES = {
  BAPM: 'Chrzest', CHR: 'Chrzest (dziecka)', CONF: 'Bierzmowanie', FCOM: 'Pierwsza komunia', BURI: 'Pochówek', CREM: 'Kremacja',
  RESI: 'Zamieszkanie', OCCU: 'Zawód', EDUC: 'Wykształcenie', GRAD: 'Ukończenie szkoły', MILI: 'Służba wojskowa', EMIG: 'Emigracja', IMMI: 'Imigracja',
  NATU: 'Naturalizacja', RETI: 'Emerytura', PROB: 'Testament zatwierdzony', WILL: 'Testament', EVEN: 'Inne wydarzenie', DIV: 'Rozwód',
};

export function ensureExt(model) {
  model.ext = model.ext || { sources: {}, tasks: [], places: {} };
  model.ext.sources = model.ext.sources || {}; model.ext.tasks = model.ext.tasks || []; model.ext.places = model.ext.places || {};
  for (const p of Object.values(model.persons)) { p.events = p.events || []; p.photos = p.photos || []; p.sources = p.sources || []; }
  return model.ext;
}

let seq = 0;
export const uid = (prefix) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ---------- sources ----------
export function addSource(model, { title = '', author = '', note = '', url = '' } = {}) {
  ensureExt(model);
  let n = Object.keys(model.ext.sources).length + 1;
  while (model.ext.sources[`@S${n}@`]) n++;
  const id = `@S${n}@`;
  model.ext.sources[id] = { id, title, author, note, url };
  return id;
}
export function removeSource(model, id) {
  delete model.ext.sources[id];
  for (const p of Object.values(model.persons)) { p.sources = (p.sources || []).filter((s) => s !== id); for (const e of p.events || []) e.sources = (e.sources || []).filter((s) => s !== id); }
}
export const sourceUsage = (model, id) => Object.values(model.persons).filter((p) => (p.sources || []).includes(id) || (p.events || []).some((e) => (e.sources || []).includes(id)));

// ---------- tasks ----------
export function addTask(model, text, person = '') {
  ensureExt(model);
  const t = { id: uid('t'), text, done: false, person, created: new Date().toISOString().slice(0, 10) };
  model.ext.tasks.push(t); return t;
}

// ---------- places ----------
/** Every distinct place string used anywhere, with counts and the people using it. */
export function collectPlaces(model) {
  const map = new Map();
  const add = (name, pid, what) => { if (!name) return; const k = name.trim(); if (!k) return; const e = map.get(k) || { name: k, n: 0, people: new Set(), uses: [] }; e.n++; e.people.add(pid); e.uses.push({ pid, what }); map.set(k, e); };
  for (const p of Object.values(model.persons)) {
    add(p.birth.place, p.id, 'ur.'); add(p.death.place, p.id, 'zm.');
    for (const e of p.events || []) add(e.place, p.id, EVENT_TYPES[e.type] || e.type);
  }
  for (const f of Object.values(model.families)) add(f.marriage.place, f.husband || f.wife, 'ślub');
  return [...map.values()].map((e) => ({ ...e, people: [...e.people] })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'pl'));
}

/** Rename a place everywhere (find & replace restricted to place fields). Returns number of changes. */
export function renamePlace(model, from, to) {
  let n = 0;
  const fix = (o) => { if (o && o.place === from) { o.place = to; n++; } };
  for (const p of Object.values(model.persons)) { fix(p.birth); fix(p.death); for (const e of p.events || []) fix(e); }
  for (const f of Object.values(model.families)) fix(f.marriage);
  if (model.ext?.places?.[from]) { model.ext.places[to] = model.ext.places[to] || model.ext.places[from]; delete model.ext.places[from]; }
  return n;
}

// ---------- find & replace ----------
export const FR_FIELDS = { given: 'Imię', surname: 'Nazwisko', birthPlace: 'Miejsce urodzenia', deathPlace: 'Miejsce śmierci', notes: 'Notatki' };
export function findReplace(model, field, from, to, { dry = true, whole = false } = {}) {
  if (!from) return { count: 0, people: [] };
  const hits = [];
  const swap = (s) => (whole ? (s === from ? to : s) : s.split(from).join(to));
  const touch = (p, get, set) => { const v = get(p) || ''; if (!v) return; const nv = swap(v); if (nv !== v) { hits.push({ id: p.id, before: v, after: nv }); if (!dry) set(p, nv); } };
  for (const p of Object.values(model.persons)) {
    if (field === 'given') touch(p, (x) => x.given, (x, v) => { x.given = v; });
    else if (field === 'surname') touch(p, (x) => x.surname, (x, v) => { x.surname = v; });
    else if (field === 'birthPlace') touch(p, (x) => x.birth.place, (x, v) => { x.birth.place = v; });
    else if (field === 'deathPlace') touch(p, (x) => x.death.place, (x, v) => { x.death.place = v; });
    else if (field === 'notes') touch(p, (x) => x.notes.join('\n'), (x, v) => { x.notes = v ? [v] : []; });
  }
  return { count: hits.length, people: hits };
}

// ---------- timeline ----------
export const eventLabel = (e) => (e.type === 'EVEN' ? (e.label || 'Wydarzenie') : (EVENT_TYPES[e.type] || e.type) + (e.value && e.value !== 'Y' ? ': ' + e.value : ''));

/** All dated events of a person (or of everyone) as [{year, month, day, date, label, kind, pid}], sorted. */
export function personEvents(model, p) {
  const out = [];
  const push = (date, label, kind, place, extra = {}) => { const d = parseDate(date); if (d || date) out.push({ pid: p.id, date: date || '', year: d?.year ?? null, month: d?.month || 0, day: d?.day || 0, label, kind, place: place || '', ...extra }); };
  if (p.birth.date || p.birth.place) push(p.birth.date, 'Urodzenie', 'birth', p.birth.place);
  for (const e of p.events || []) push(e.date, eventLabel(e), 'event', e.place, { note: e.note, eid: e.id, etype: e.type });
  for (const fid of p.fams || []) {
    const f = model.families[fid]; if (!f) continue;
    const sp = f.husband === p.id ? f.wife : f.husband;
    if (f.marriage.date || f.marriage.place) push(f.marriage.date, 'Ślub', 'marriage', f.marriage.place, { with: sp });
    for (const c of f.children) { const ch = model.persons[c]; if (ch && ch.birth.date) push(ch.birth.date, 'Urodziny dziecka', 'child', ch.birth.place, { with: c }); }
  }
  if (p.death.date || p.death.place) push(p.death.date, 'Śmierć', 'death', p.death.place);
  return out;
}
const key = (e) => (e.year ?? 9999) * 10000 + e.month * 100 + e.day;
export const sortEvents = (list) => list.sort((a, b) => key(a) - key(b));

export function timelineFor(model, pid) {
  const p = model.persons[pid];
  const evs = sortEvents(personEvents(model, p)).filter((e) => e.year != null);
  const by = yearOf(p.birth.date);
  return evs.map((e) => ({ ...e, age: by != null && e.year != null ? e.year - by : null }));
}

/** Global timeline of births/deaths/marriages (+ extra events) with filters. */
export function globalTimeline(model, { kinds = ['birth', 'death', 'marriage', 'event'], from = null, to = null, surname = '' } = {}) {
  const out = [];
  for (const p of Object.values(model.persons)) {
    if (surname && p.surname !== surname) continue;
    for (const e of personEvents(model, p)) {
      if (e.kind === 'child' || e.year == null || !kinds.includes(e.kind)) continue;
      if (from != null && e.year < from) continue; if (to != null && e.year > to) continue;
      if (e.kind === 'marriage' && e.with && e.with < p.id) continue; // list each marriage once
      out.push(e);
    }
  }
  return sortEvents(out);
}

/** Per-person life bars for a "lifespans" chart: [{id, from, to, ongoing}] */
export function lifeBars(model, { surname = '' } = {}) {
  const now = new Date().getFullYear();
  const out = [];
  for (const p of Object.values(model.persons)) {
    if (surname && p.surname !== surname) continue;
    const b = yearOf(p.birth.date), d = yearOf(p.death.date);
    if (b == null && d == null) continue;
    const from = b ?? (d - 70), to = d ?? Math.min(now, b + 90);
    out.push({ id: p.id, from, to, ongoing: d == null, guess: b == null || d == null });
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** Historical context for a lifespan (short, hand-picked list of events relevant to Poland). */
export const HISTORY = [
  [1683, 'Odsiecz wiedeńska'], [1772, 'I rozbiór Polski'], [1791, 'Konstytucja 3 Maja'], [1793, 'II rozbiór Polski'], [1794, 'Insurekcja kościuszkowska'],
  [1795, 'III rozbiór, koniec I Rzeczypospolitej'], [1807, 'Księstwo Warszawskie'], [1812, 'Wyprawa Napoleona na Moskwę'], [1815, 'Kongres wiedeński, Królestwo Polskie'],
  [1830, 'Powstanie listopadowe'], [1831, 'Wielka Emigracja'], [1846, 'Rabacja galicyjska, powstanie krakowskie'], [1848, 'Wiosna Ludów, uwłaszczenie w Galicji'],
  [1863, 'Powstanie styczniowe'], [1864, 'Uwłaszczenie chłopów w Królestwie Polskim'], [1867, 'Autonomia Galicji'], [1905, 'Rewolucja 1905 roku'],
  [1914, 'I wojna światowa (początek)'], [1918, 'Odzyskanie niepodległości, powstanie wielkopolskie'], [1920, 'Wojna polsko-bolszewicka, Bitwa Warszawska'],
  [1921, 'Konstytucja marcowa, III powstanie śląskie'], [1926, 'Przewrót majowy'], [1929, 'Wielki Kryzys'],
  [1939, 'II wojna światowa (początek)'], [1940, 'Zbrodnia katyńska, deportacje na Sybir'], [1943, 'Powstanie w getcie warszawskim, rzeź wołyńska'],
  [1944, 'Powstanie Warszawskie'], [1945, 'Koniec II wojny, nowe granice, przesiedlenia'], [1947, 'Akcja „Wisła”'], [1956, 'Poznański Czerwiec, Październik ’56'],
  [1966, 'Milenium chrztu Polski'], [1968, 'Marzec 1968'], [1970, 'Grudzień 1970'], [1976, 'Czerwiec 1976 (Radom, Ursus)'], [1978, 'Karol Wojtyła papieżem'],
  [1980, 'Powstanie Solidarności'], [1981, 'Stan wojenny'], [1989, 'Okrągły Stół, wybory'], [1990, 'Lech Wałęsa prezydentem'], [1997, 'Powódź tysiąclecia, nowa konstytucja'],
  [1999, 'Polska w NATO'], [2004, 'Polska w UE'], [2005, 'Śmierć Jana Pawła II'], [2010, 'Katastrofa smoleńska'], [2020, 'Pandemia COVID-19'],
  [2022, 'Wojna w Ukrainie, uchodźcy w Polsce'],
];
export const historyBetween = (from, to) => HISTORY.filter(([y]) => y >= from && y <= to);

// ---------- photos: pure helpers (storage is in media.js) ----------
export function addPhotoMeta(model, pid, meta) {
  const p = model.persons[pid]; p.photos = p.photos || [];
  const ph = { id: uid('p'), title: '', mime: 'image/jpeg', w: 0, h: 0, primary: !p.photos.length, ...meta };
  p.photos.push(ph); return ph;
}
export function setPrimaryPhoto(model, pid, photoId) { for (const ph of model.persons[pid].photos) ph.primary = ph.id === photoId; }
export function removePhotoMeta(model, pid, photoId) {
  const p = model.persons[pid]; p.photos = p.photos.filter((x) => x.id !== photoId);
  if (p.photos.length && !p.photos.some((x) => x.primary)) p.photos[0].primary = true;
}
