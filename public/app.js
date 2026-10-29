import { decodeGedcom, parseGedcom, serializeGedcom, validate } from './gedcom.js';
import { emptyModel, addPerson, addSpouse, addChild, addParent, parentsOf, childrenOf, spousesOf, removePerson, displayName, years,
  layoutAncestors, layoutDescendants, layoutForest, layoutToSvg } from './tree.js';
import { formatDate, formatLong, toGedcomDate, yearOf } from './dates.js';
import { fold, lifeStatus, isLiving, mergePersons, anonymizeLiving, toCsv } from './ops.js';
import { computeStats, upcomingBirthdays } from './stats.js';
import { runChecks } from './checks.js';
import { relate } from './kin.js';
import { $, el, avatar, bars, hist, stack, download, personLabel } from './ui.js';
import { ensureExt } from './extras.js';
import { eventsSection, sourcesSection, timelineTab, photosTab, viewTimeline, viewPlaces, viewSources, toolCards, buildZip } from './views_extra.js';
import { putPhoto, readZip, allPhotoIds, deletePhoto, clearPhotos } from './media.js';
import { viewBoard as viewViz } from './views_viz.js';
import { createCloud } from './cloud.js';

const KEY = 'rodzina.ged.v1';
let model = emptyModel();
const adopt = (m) => { ensureExt(m); return m; };
let version = 0;
const ui = { q: '', filter: 'all', sort: 'name', gens: 5, zoom: 1, find: '' };
const undoStack = [], redoStack = [];
const memo = { v: -1, stats: null, issues: null };
let ignored = new Set();
try { ignored = new Set(JSON.parse(localStorage.getItem('rodzina.ignored') || '[]')); } catch {}
const issueKey = (i) => `${i.code}:${[...i.ids].sort().join(',')}`;
const saveIgnored = () => { try { localStorage.setItem('rodzina.ignored', JSON.stringify([...ignored])); } catch {} };
const count = () => Object.keys(model.persons).length;
const strip = (id) => id.replace(/@/g, '');
const unstrip = (s) => `@${s}@`;
let msgTimer = null;
const say = (t) => { $('msg').textContent = t; clearTimeout(msgTimer); msgTimer = setTimeout(() => { $('msg').textContent = ''; }, 9000); };

// ---------- persistence, undo ----------
let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try { if (count()) localStorage.setItem(KEY, serializeGedcom(model)); else localStorage.removeItem(KEY); } catch (e) { say('Nie udało się zapisać w przeglądarce: ' + e.message); }
}
const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); };
addEventListener('beforeunload', () => saveTimer && saveNow());
document.addEventListener('visibilitychange', () => document.hidden && saveTimer && saveNow());

const snapshot = () => serializeGedcom(model);
function restore(text) { model = adopt(text ? parseGedcom(text) : emptyModel()); version++; scheduleSave(); cloud.changed(); }
function updateUndoButtons() { $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length; $('export').disabled = !count(); }

/** Run a change to the model: snapshot for undo, save, re-render. */
function mutate(fn, { keepView = true } = {}) {
  undoStack.push(count() ? snapshot() : ''); if (undoStack.length > 40) undoStack.shift(); redoStack.length = 0;
  fn(); ensureExt(model); version++; scheduleSave(); cloud.changed(); refreshBadge(); updateUndoButtons(); render();
}

/** A newer tree arrived from the cloud: replace the model without marking it as a local edit. Ctrl+Z brings the old one back. */
function applyRemote(text) {
  if (count()) { undoStack.push(snapshot()); if (undoStack.length > 40) undoStack.shift(); redoStack.length = 0; }
  model = adopt(parseGedcom(text)); version++; saveNow(); refreshBadge(); updateUndoButtons();
  if (!location.hash && count()) location.hash = '#/osoby'; else render();
}
const cloud = createCloud({
  text: () => serializeGedcom(model), count: () => count(), apply: applyRemote,
  restore: (text) => mutate(() => { model = adopt(parseGedcom(text)); }),
  photos: () => new Map(Object.values(model.persons).flatMap((p) => (p.photos || []).map((x) => [x.id, x.mime]))),
  say: (t) => say(t), onPhotos: () => { if (!document.activeElement?.closest?.('#main')) render(); },
  download: () => download('rodzina.ged', serializeGedcom(model), 'text/plain;charset=utf-8'),
  button: $('cloud'),
});
function undo() { if (!undoStack.length) return; redoStack.push(count() ? snapshot() : ''); restore(undoStack.pop()); refreshBadge(); updateUndoButtons(); render(); say('Cofnięto.'); }
function redo() { if (!redoStack.length) return; undoStack.push(count() ? snapshot() : ''); restore(redoStack.pop()); refreshBadge(); updateUndoButtons(); render(); say('Ponowiono.'); }

const ctx = {
  model: () => model, mutate: (fn) => mutate(fn), say: (t) => say(t), go: (p) => go(p), goPerson: (id, t) => goPerson(id, t), render: () => render(), ui,
  sortedIds: () => sortedIds(),
  defaultFocus: () => stats().generations.deepest || Object.keys(model.persons)[0],
  exportZip: async () => { say('Przygotowuję kopię…'); const { blob, photos, missing } = await buildZip(model); download('rodzina-kopia.zip', blob, 'application/zip'); say(`Kopia ZIP gotowa: zdjęć ${photos}` + (missing ? `, brakujących plików ${missing}` : '') + '.'); },
  cleanPhotos: async () => { const used = new Set(Object.values(model.persons).flatMap((p) => (p.photos || []).map((x) => x.id))); const ids = (await allPhotoIds()).filter((i) => !used.has(i)); for (const i of ids) await deletePhoto(i); say(`Usunięto nieużywanych zdjęć: ${ids.length}.`); },
};
const stats = () => (memo.v === version && memo.stats) || (memo.stats = computeStats(model), memo.issues = null, memo.v = version, memo.stats);
const issues = () => { stats(); return memo.issues || (memo.issues = runChecks(model)); };
function refreshBadge() { const b = $('issues'); const n = count() ? issues().filter((i) => i.sev !== 'info' && !ignored.has(issueKey(i))).length : 0; b.hidden = !n; b.textContent = n; }

// ---------- routing ----------
const route = () => { const [v, a, b] = location.hash.replace(/^#\/?/, '').split('/'); return { view: v || 'osoby', a, b }; };
const go = (path) => { if (location.hash === '#/' + path) render(); else location.hash = '#/' + path; };
const goPerson = (id, tab = 'info') => go(`osoby/${strip(id)}/${tab}`);

function render() {
  const r = route();
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === r.view));
  updateUndoButtons();
  const main = $('main');
  if (!count()) { main.replaceChildren(emptyState()); return; }
  ensureExt(model);
  const views = { osoby: viewPersons, tablica: (mn, rt) => viewViz(mn, rt, ctx, { classic: viewClassic, download }), 'os-czasu': (mn) => viewTimeline(mn, ctx), miejsca: (mn) => viewPlaces(mn, ctx), zrodla: (mn) => viewSources(mn, ctx), statystyki: viewStats, kontrola: viewChecks, narzedzia: viewTools };
  (views[r.view] || viewPersons)(main, r);
}

// ---------- empty state ----------
function emptyState() {
  const box = el('div', { class: 'empty' },
    el('h2', {}, 'Twoje drzewo rodzinne'),
    el('div', { class: 'card cloud-empty' }, el('h3', {}, 'Rodzina w chmurze'), cloud.mount()),
    el('p', { class: 'mut' }, 'Albo wczytaj plik GEDCOM (.ged) z Ahnenblatt, MyHeritage, Gramps lub innego programu. Bez chmury dane zostają tylko w tej przeglądarce.'),
    el('div', { class: 'drop' }, el('p', {}, 'Przeciągnij tu plik .ged'), el('label', { class: 'btn primary' }, 'Wybierz plik', el('input', { type: 'file', accept: '.ged,.gedcom,text/plain', hidden: true, onchange: (e) => e.target.files[0] && importFile(e.target.files[0]) }))),
    el('p', {}, el('button', { onclick: loadDemo }, 'Wypróbuj na zmyślonej rodzinie')));
  return box;
}
async function loadDemo() {
  const t = await (await fetch('demo.ged')).text();
  mutate(() => { model = adopt(parseGedcom(t)); });
  goPerson(Object.keys(model.persons)[0]);
}

// ---------- persons view ----------
const FILTERS = [['all', 'Wszyscy'], ['living', 'Żyjący (lub brak danych)'], ['dead', 'Zmarli'], ['noparents', 'Bez znanych rodziców'], ['nobirth', 'Bez daty urodzenia'], ['nosex', 'Bez płci']];
const SORTS = [['name', 'Nazwisko'], ['birth', 'Data urodzenia'], ['recent', 'Ostatnio dodani']];

function matches(p, toks) {
  if (!toks.length) return true;
  const hay = fold(`${p.given} ${p.surname} ${p.birth.place} ${p.death.place} ${p.birth.date} ${p.id}`);
  return toks.every((t) => hay.includes(t));
}
function passFilter(p) {
  switch (ui.filter) {
    case 'living': return isLiving(p);
    case 'dead': return !isLiving(p);
    case 'noparents': return !p.famc.length;
    case 'nobirth': return yearOf(p.birth.date) == null;
    case 'nosex': return !p.sex;
    default: return true;
  }
}
function sortedIds() {
  const ids = Object.keys(model.persons);
  const nameCmp = (a, b) => {
    const A = model.persons[a], B = model.persons[b];
    const ea = !A.surname && !A.given, eb = !B.surname && !B.given;
    if (ea !== eb) return ea ? 1 : -1;
    return (A.surname || '\uffff').localeCompare(B.surname || '\uffff', 'pl') || (A.given || '').localeCompare(B.given || '', 'pl');
  };
  if (ui.sort === 'birth') return ids.sort((a, b) => (yearOf(model.persons[a].birth.date) ?? 99999) - (yearOf(model.persons[b].birth.date) ?? 99999) || nameCmp(a, b));
  if (ui.sort === 'recent') return ids.sort((a, b) => b.localeCompare(a, 'pl', { numeric: true }));
  return ids.sort(nameCmp);
}

function viewPersons(main, r) {
  const sel = r.a && model.persons[unstrip(r.a)] ? unstrip(r.a) : null;
  const q = el('input', { type: 'search', id: 'q', placeholder: matchMedia('(pointer: coarse)').matches ? 'Szukaj osoby…' : 'Szukaj: imię, nazwisko, miejsce…  ( / )', autocomplete: 'off', value: ui.q });
  const fsel = el('select', { onchange: (e) => { ui.filter = e.target.value; fill(); } }, FILTERS.map(([v, t]) => el('option', { value: v, selected: ui.filter === v }, t)));
  const ssel = el('select', { onchange: (e) => { ui.sort = e.target.value; fill(); } }, SORTS.map(([v, t]) => el('option', { value: v, selected: ui.sort === v }, t)));
  const list = el('ul', { id: 'list' });
  const info = el('div', { class: 'mut', style: '' });
  const fill = () => {
    const toks = fold(ui.q).split(/\s+/).filter(Boolean);
    const rows = sortedIds().filter((id) => matches(model.persons[id], toks) && passFilter(model.persons[id]));
    list.replaceChildren();
    for (const id of rows.slice(0, 500)) {
      const p = model.persons[id];
      list.append(el('li', { class: id === sel ? 'on' : '', onclick: () => goPerson(id, route().b || 'info') }, avatar(p), el('span', { class: 'n' }, displayName(p)), el('small', {}, years(p))));
    }
    info.textContent = `${rows.length} z ${count()}` + (rows.length > 500 ? ' (pokazano 500)' : '');
    const on = list.querySelector('li.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  q.addEventListener('input', () => { ui.q = q.value; fill(); });
  const side = el('aside', { class: 'card side' }, q, el('div', { class: 'filters' }, fsel, ssel), info, list,
    el('button', { class: 'sm', style: '', onclick: () => { let id; mutate(() => { id = addPerson(model, { given: 'Nowa', surname: 'Osoba' }); }); goPerson(id); } }, '+ Nowa osoba'));
  const panel = el('section', { class: 'card', id: 'panel' });
  main.replaceChildren(el('div', { class: 'split', style: '' }, side, panel));
  if (sel) personPanel(panel, sel, r.b || 'info'); else panel.append(el('div', { class: 'empty' }, el('h2', {}, 'Wybierz osobę z listy'), el('p', { class: 'mut' }, `${count()} osób w drzewie.`)), upcomingBox(30));
  fill();
}

function chip(id, role) {
  const p = model.persons[id];
  return el('div', { class: 'chip', onclick: () => goPerson(id) }, avatar(p), el('span', {}, displayName(p), el('small', {}, [role, years(p)].filter(Boolean).join(' · '))));
}

function field(label, value, onset, { type = 'text', wide = false, area = false, hint } = {}) {
  const i = area ? el('textarea', { rows: 3, value: value || '' }) : el('input', { type, value: value || '', placeholder: hint || '' });
  i.addEventListener('change', () => mutate(() => onset(i.value.trim())));
  return el('label', { class: wide ? 'wide' : '' }, label, i);
}

function picker(selId, onpick, label) {
  const others = sortedIds().filter((i) => i !== selId);
  const s = el('select', {}, el('option', { value: '' }, 'wybierz istniejącą…'), others.map((i) => el('option', { value: i }, personLabel(model.persons[i]))));
  const g = el('input', { placeholder: 'lub nowa: imię' }), sn = el('input', { placeholder: 'nazwisko', value: '' });
  const sex = el('select', {}, el('option', { value: '' }, 'płeć?'), el('option', { value: 'M' }, 'mężczyzna'), el('option', { value: 'F' }, 'kobieta'));
  const b = el('button', { onclick: () => {
    if (!s.value && !g.value.trim() && !sn.value.trim()) return say('Wybierz osobę albo wpisz imię i nazwisko.');
    mutate(() => { const id = s.value || addPerson(model, { given: g.value.trim(), surname: sn.value.trim(), sex: sex.value }); onpick(id); });
  } }, label);
  return el('div', { class: 'add' }, s, g, sn, sex, b);
}

function lifeLine(p) {
  const st = lifeStatus(p);
  const label = { dead: 'zmarł(a)', living: 'żyje', 'probably-dead': 'prawdopodobnie nie żyje', 'unknown-living': 'brak danych' }[st];
  const bits = [];
  const by = yearOf(p.birth.date), dy = yearOf(p.death.date);
  if (by != null && dy != null && dy >= by) bits.push(`${dy - by} lat`);
  else if (by != null && st === 'living') bits.push(`${new Date().getFullYear() - by} lat`);
  return el('span', {}, el('span', { class: `pill ${st === 'dead' ? '' : st === 'living' ? 'ok' : 'warn'}` }, label), bits.join(' · '));
}

function personPanel(panel, id, tab) {
  const p = model.persons[id];
  panel.replaceChildren();
  const head = el('div', { class: 'ph' }, avatar(p, true), el('div', {}, el('h2', {}, displayName(p)),
    el('div', {}, lifeLine(p), el('small', {}, ` ${formatLong(p.birth.date) ? '* ' + formatLong(p.birth.date) : ''}${formatLong(p.death.date) ? '  † ' + formatLong(p.death.date) : ''}`))));
  panel.append(head);
  panel.append(el('nav', { class: 'tabs' }, [['info', 'Osoba'], ['czas', 'Oś czasu'], ['foto', `Zdjęcia${p.photos?.length ? ' (' + p.photos.length + ')' : ''}`], ['anc', 'Przodkowie'], ['desc', 'Potomkowie']].map(([t, n]) => el('button', { class: tab === t ? 'on' : '', onclick: () => goPerson(id, t) }, n))));
  if (tab === 'info') return personInfo(panel, id);
  if (tab === 'czas') return timelineTab(panel, id, ctx);
  if (tab === 'foto') return photosTab(panel, id, ctx);
  const gens = el('select', { onchange: (e) => { ui.gens = +e.target.value; render(); } }, [3, 5, 7, 9].map((n) => el('option', { selected: n === ui.gens }, n)));
  const canvas = el('div', { id: 'canvas', class: 'canvas' });
  const lay = tab === 'anc' ? layoutAncestors(model, id, ui.gens - 1) : layoutDescendants(model, id, ui.gens - 1);
  const svgText = layoutToSvg(model, lay, { spouse: tab === 'desc', mark: new Set([id]) });
  mountSvg(canvas, svgText, (gid) => goPerson(gid));
  panel.append(el('div', { class: 'treebar' }, el('label', {}, 'Pokolenia ', gens), el('span', { class: 'mut' }, `${lay.nodes.length} osób`),
    el('button', { onclick: () => download(`drzewo-${tab}-${strip(id)}.svg`, svgText, 'image/svg+xml') }, 'Pobierz SVG'), el('button', { onclick: () => print() }, 'Drukuj / PDF')), canvas);
}

function mountSvg(canvas, svgText, onNode) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const node = document.importNode(doc.documentElement, true);
  canvas.replaceChildren(node);
  node.querySelectorAll('g[data-id]').forEach((g) => g.addEventListener('click', () => onNode(g.dataset.id)));
  return node;
}

function personInfo(panel, id) {
  const p = model.persons[id];
  const sexSel = el('select', { onchange: (e) => mutate(() => { p.sex = e.target.value; }) }, [['', 'nieznana'], ['M', 'mężczyzna'], ['F', 'kobieta'], ['U', 'inna']].map(([v, t]) => el('option', { value: v, selected: p.sex === v }, t)));
  const dateHint = 'np. 12.03.1950, 1950, ok. 1900';
  const ds = (ev) => (v) => { ev.date = toGedcomDate(v); };
  panel.append(el('div', { class: 'grid' },
    field('Imię (imiona)', p.given, (v) => { p.given = v; }), field('Nazwisko', p.surname, (v) => { p.surname = v; }), el('label', {}, 'Płeć', sexSel),
    field('Data urodzenia', formatDateInput(p.birth.date), ds(p.birth), { hint: dateHint }), field('Miejsce urodzenia', p.birth.place, (v) => { p.birth.place = v; }),
    field('Data śmierci', formatDateInput(p.death.date), ds(p.death), { hint: dateHint }), field('Miejsce śmierci', p.death.place, (v) => { p.death.place = v; }),
    field('Notatki', p.notes.join('\n'), (v) => { p.notes = v ? [v] : []; }, { wide: true, area: true })));

  const { father, mother } = parentsOf(model, id);
  panel.append(el('h3', {}, 'Rodzice'), el('div', { class: 'rel' }, father && chip(father, 'ojciec'), mother && chip(mother, 'matka'), !father && !mother && el('span', { class: 'mut' }, 'brak')));
  if (!(father && mother)) panel.append(picker(id, (pid) => addParent(model, id, pid), 'Dodaj rodzica'));

  const sp = spousesOf(model, id);
  panel.append(el('h3', {}, 'Partnerzy'), el('div', { class: 'rel' }, sp.filter((s) => s.spouse).map((s) => chip(s.spouse, s.marriage.date ? 'ślub ' + formatDate(s.marriage.date) : '')), !sp.some((s) => s.spouse) && el('span', { class: 'mut' }, 'brak')));
  panel.append(picker(id, (pid) => addSpouse(model, id, pid), 'Dodaj partnera'));

  const kids = childrenOf(model, id);
  panel.append(el('h3', {}, `Dzieci (${kids.length})`), el('div', { class: 'rel' }, kids.map((c) => chip(c)), !kids.length && el('span', { class: 'mut' }, 'brak')));
  panel.append(picker(id, (pid) => { const fid = sp.length ? sp[sp.length - 1].family : addSpouse(model, id, null); addChild(model, fid, pid); }, 'Dodaj dziecko'));

  eventsSection(panel, id, ctx);
  sourcesSection(panel, id, ctx);

  // kinship to anyone
  const out = el('div');
  const other = el('select', { class: 'big', onchange: (e) => { out.replaceChildren(); if (e.target.value) out.append(el('div', { class: 'result' }, relate(model, id, e.target.value).text)); } },
    el('option', { value: '' }, 'wybierz osobę…'), sortedIds().filter((i) => i !== id).map((i) => el('option', { value: i }, personLabel(model.persons[i]))));
  panel.append(el('h3', {}, 'Jak jesteśmy spokrewnieni?'), other, out);

  panel.append(el('div', { class: 'row no-print', style: 'margin-top:1.5rem' },
    el('button', { class: 'danger', onclick: () => { if (confirm(`Usunąć ${displayName(p)} z drzewa? Można cofnąć (Ctrl+Z). Plik .ged na dysku się nie zmieni.`)) { mutate(() => removePerson(model, id)); go('osoby'); } } }, 'Usuń osobę'),
    el('small', { class: 'mut' }, `ID w pliku: ${p.id}`)));
}
const formatDateInput = (d) => d || '';

// ---------- whole family board ----------
function viewClassic(main, head) {
  const lay = layoutForest(model);
  const mark = new Set();
  let svgNode = null, svgText = '';
  const canvas = el('div', { class: 'canvas', id: 'canvas', style: '' });
  const zoomTo = (z) => {
    ui.zoom = Math.min(3, Math.max(0.2, z));
    if (!svgNode) return;
    const vb = svgNode.viewBox.baseVal;
    svgNode.setAttribute('width', Math.round(vb.width * ui.zoom)); svgNode.setAttribute('height', Math.round(vb.height * ui.zoom));
    zl.textContent = Math.round(ui.zoom * 100) + '%';
  };
  const draw = () => {
    svgText = layoutToSvg(model, lay, { spouse: true, mark });
    svgNode = mountSvg(canvas, svgText, (gid) => goPerson(gid));
    zoomTo(ui.zoom);
  };
  const zl = el('span', { class: 'mut' }, '');
  const find = el('input', { type: 'search', placeholder: 'Podświetl osobę…', value: ui.find, style: '', oninput: (e) => {
    ui.find = e.target.value; mark.clear();
    const toks = fold(ui.find).split(/\s+/).filter(Boolean);
    if (toks.length) for (const n of lay.nodes) if (matches(model.persons[n.id], toks)) mark.add(n.id);
    draw();
    const first = lay.nodes.find((n) => mark.has(n.id));
    if (first) { const g = canvas.querySelector(`g[data-id="${CSS.escape(first.id)}"]`); g?.scrollIntoView({ block: 'center', inline: 'center' }); }
    cur = -1; info.textContent = toks.length ? `Znaleziono: ${mark.size}` : '';
  } });
  const info = el('span', { class: 'mut' });
  let cur = -1;
  const nextMatch = () => {
    const hits = lay.nodes.filter((n) => mark.has(n.id)); if (!hits.length) return;
    cur = (cur + 1) % hits.length;
    canvas.querySelector(`g[data-id="${CSS.escape(hits[cur].id)}"]`)?.scrollIntoView({ block: 'center', inline: 'center' });
    info.textContent = `Znaleziono: ${hits.length} (pokazano ${cur + 1})`;
  };
  const fit = () => { const vb = svgNode.viewBox.baseVal; zoomTo((canvas.clientWidth - 8) / vb.width); };
  main.replaceChildren(el('div', { class: 'card', style: 'margin-top:.5rem' },
    el('h2', {}, 'Tablica rodziny'), head,
    el('p', { class: 'mut' }, `${lay.nodes.length} osób w ${lay.trees} gałęziach (potomkowie osób bez znanych rodziców; partnerzy pod ⚭; niebieski = mężczyzna, różowy = kobieta). ${lay.alone ? lay.alone + ' osób bez powiązań nie jest narysowanych.' : ''} Kliknij osobę, aby otworzyć jej kartę.`),
    el('div', { class: 'treebar' }, find, el('button', { onclick: nextMatch }, 'Następny'), info, el('button', { onclick: () => zoomTo(ui.zoom - 0.15), title: 'Pomniejsz' }, '−'), zl, el('button', { onclick: () => zoomTo(ui.zoom + 0.15), title: 'Powiększ' }, '+'), el('button', { onclick: () => zoomTo(1) }, '100%'), el('button', { onclick: fit }, 'Dopasuj szerokość'),
      el('button', { onclick: () => download('tablica-rodziny.svg', svgText, 'image/svg+xml') }, 'Pobierz SVG'), el('button', { onclick: () => print() }, 'Drukuj / PDF')),
    canvas));
  draw();
  if (ui.find) find.dispatchEvent(new Event('input'));
}

// ---------- statistics ----------
const nf = (n, d = 1) => (n == null ? '–' : (Math.round(n * 10 ** d) / 10 ** d).toString().replace('.', ','));
function viewStats(main) {
  const s = stats();
  const t = s.totals;
  const tile = (b, span) => el('div', { class: 'tile' }, el('b', {}, b), el('span', {}, span));
  const searchFor = (name) => { ui.q = name; ui.filter = 'all'; go('osoby'); };
  const lifeParts = [
    { name: 'zmarli', n: t.life.dead + t.life['probably-dead'], color: 'var(--c-dead, #7d8da6)' },
    { name: 'żyjący', n: t.life.living, color: 'var(--c-live, #2f9e6b)' },
    { name: 'brak danych', n: t.life['unknown-living'], color: 'var(--c-unk, #d9a441)' }];
  main.replaceChildren(el('div', { style: 'margin-top:.5rem' },
    el('div', { class: 'tiles' },
      tile(t.persons, 'osób'), tile(t.families, 'rodzin'), tile(s.generations.max, 'pokoleń (najdłuższa linia)'), tile(s.surnameCount, 'różnych nazwisk'),
      tile(s.span ? `${s.span.from}–${s.span.to}` : '–', 'zakres lat urodzin'), tile(nf(s.family.avgChildren), 'dzieci na rodzinę z dziećmi')),
    el('div', { class: 'cols' },
      card('Płeć', stack([{ name: 'mężczyźni', n: t.sex.M, color: 'var(--c-m, #5b8bd6)' }, { name: 'kobiety', n: t.sex.F, color: 'var(--c-f, #d9739b)' }, { name: 'brak', n: t.sex.other, color: '#aaa' }])),
      card('Żyjący i zmarli', stack(lifeParts), el('p', { class: 'mut' }, '„Brak danych” to osoby bez daty urodzenia i bez zapisu śmierci; nie wiadomo, czy żyją.')),
      card('Kompletność danych', bars(s.completeness.map((c) => ({ name: c.key, n: c.pct })), { fmt: (n) => n + '%', max: 100 })),
      card('Urodzenia według dekad', hist(s.birthsByDecade)),
      card('Zgony według dekad', hist(s.deathsByDecade)),
      card('Długość życia (lata)', hist(s.lifespan.hist), el('p', { class: 'mut' }, s.lifespan.n ? `Na podstawie ${s.lifespan.n} osób z pełnymi datami. Średnio ${nf(s.lifespan.avg)} lat, mediana ${nf(s.lifespan.median, 0)}. Mężczyźni ${nf(s.lifespan.avgM)}, kobiety ${nf(s.lifespan.avgF)}. ` : 'Za mało pełnych dat. ', s.lifespan.max && el('a', { onclick: () => goPerson(s.lifespan.max.id) }, `Najstarsza: ${displayName(model.persons[s.lifespan.max.id])} (${s.lifespan.max.age} lat)`))),
      card('Najczęstsze nazwiska', bars(s.topSurnames, { onclick: (i) => searchFor(i.name) })),
      card('Najczęstsze imiona', bars(s.topGiven, { onclick: (i) => searchFor(i.name) })),
      card('Zawody (z wydarzeń)', bars(occupations(), {})),
      card('Miejsca', bars(s.topPlaces), s.topPlaces.length < 5 && el('p', { class: 'mut' }, 'Mało miejsc w danych. Uzupełnienie miejsc urodzenia da tu ciekawszy obraz.')),
      card('Liczba dzieci w rodzinie', hist(s.family.sizes), el('p', { class: 'mut' }, `Rodzin bez dzieci: ${s.family.childless}. `, s.family.largest && el('a', { onclick: () => { const f = model.families[s.family.largest]; goPerson(f.husband || f.wife); } }, `Największa: ${model.families[s.family.largest].children.length} dzieci`))),
      card('Wiek rodziców przy narodzinach dziecka (średnio, lata)', bars([{ name: `Ojcowie (${s.parentAge.nM})`, n: Math.round((s.parentAge.M || 0) * 10) / 10 }, { name: `Matki (${s.parentAge.nF})`, n: Math.round((s.parentAge.F || 0) * 10) / 10 }], { max: 50, fmt: (n) => nf(n) }), el('p', { class: 'mut' }, 'Tylko dzieci i rodzice ze znanym rokiem urodzenia.')),
      card('Śluby według dekad', hist(s.marriagesByDecade)),
      cardSpan('Rodowód', el('p', {}, `Najdłuższa linia ma ${s.generations.max} pokoleń`, s.generations.deepest && [' (', el('a', { onclick: () => goPerson(s.generations.deepest, 'anc') }, `przodkowie: ${displayName(model.persons[s.generations.deepest])}`), ')'], `. Gałęzi początkowych (osoby bez znanych rodziców, z dziećmi): ${s.generations.roots}.`)))));
}
const card = (title, ...body) => el('div', { class: 'card' }, el('h3', {}, title), ...body);
const cardSpan = (title, ...body) => { const c = card(title, ...body); c.classList.add('span'); return c; };

function occupations() {
  const c = {};
  for (const p of Object.values(model.persons)) for (const e of p.events || []) if (e.type === 'OCCU' && e.value && e.value !== 'Y') c[e.value] = (c[e.value] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, n }));
}

// ---------- checks ----------
let showIgnored = false;
function viewChecks(main) {
  const all = issues().filter((i) => showIgnored || !ignored.has(issueKey(i)));
  const hidden = issues().length - all.length;
  const sevName = { err: 'Błędy', warn: 'Ostrzeżenia', info: 'Wskazówki' };
  const cnt = (s) => all.filter((i) => i.sev === s).length;
  main.replaceChildren(el('div', { style: 'margin-top:.5rem' },
    el('h2', {}, 'Kontrola danych'),
    el('p', { class: 'mut' }, `Błędy: ${cnt('err')} · ostrzeżenia: ${cnt('warn')} · wskazówki: ${cnt('info')}. To podpowiedzi, nie wyroki: prawdziwe rodziny bywają nietypowe. „Ignoruj” ukrywa daną uwagę na stałe w tej przeglądarce.`),
    (hidden > 0 || showIgnored) && el('p', {}, el('button', { class: 'sm', onclick: () => { showIgnored = !showIgnored; render(); } }, showIgnored ? 'Ukryj zignorowane' : `Pokaż zignorowane (${ignored.size})`)),
    !all.length && el('div', { class: 'card' }, '✓ Nic podejrzanego.'),
    ['err', 'warn', 'info'].map((sev) => {
      const list = all.filter((i) => i.sev === sev);
      if (!list.length) return null;
      return el('div', {}, el('h3', {}, `${sevName[sev]} (${list.length})`), list.slice(0, 200).map(issueRow), list.length > 200 && el('p', { class: 'mut' }, `…i ${list.length - 200} kolejnych.`));
    })));
}
function issueRow(i) {
  const who = i.ids.filter((id) => model.persons[id]);
  const icon = { err: '⛔', warn: '⚠', info: 'ℹ' }[i.sev];
  const key = issueKey(i), isIgn = ignored.has(key);
  const row = el('div', { class: `issue ${i.sev}` }, el('span', { class: 'ic' }, icon), el('div', { class: 't' }, i.text, isIgn && el('small', {}, ' (zignorowane)')),
    who.slice(0, 4).map((id) => el('button', { class: 'sm', onclick: () => goPerson(id) }, personLabel(model.persons[id]))));
  if (i.code === 'dup' && who.length === 2) {
    const score = (p) => [p.given, p.surname, p.sex, p.birth.date, p.birth.place, p.death.date, p.death.place].filter(Boolean).length + p.famc.length + p.fams.length + (p._raw ? p._raw.children.length / 10 : 0);
    const [a, b] = [...who].sort((x, y) => score(model.persons[y]) - score(model.persons[x]));
    row.append(el('button', { class: 'sm', title: 'Zachowuje osobę z większą liczbą danych, przenosi powiązania', onclick: () => {
      if (!confirm(`Scalić ${personLabel(model.persons[b])} z ${personLabel(model.persons[a])}?
Zostaje pierwsza, jej brakujące dane zostaną uzupełnione. Można cofnąć (Ctrl+Z).`)) return;
      mutate(() => mergePersons(model, a, b)); say('Scalono dwie osoby.');
    } }, 'Scal'));
  }
  row.append(el('button', { class: 'sm ghost', onclick: () => { if (isIgn) ignored.delete(key); else ignored.add(key); saveIgnored(); refreshBadge(); render(); } }, isIgn ? 'Przywróć' : 'Ignoruj'));
  return row;
}

// ---------- tools ----------
function upcomingBox(days = 60, title = true) {
  const up = upcomingBirthdays(model, new Date(), days);
  return el('div', {}, title && el('h3', {}, `Najbliższe urodziny (${days} dni)`), up.length ? el('ul', { class: 'plain' }, up.slice(0, 15).map((u) =>
    el('li', {}, el('a', { onclick: () => goPerson(u.id) }, displayName(model.persons[u.id])), el('span', { class: 'mut' }, `${u.in === 0 ? 'dziś' : u.in === 1 ? 'jutro' : 'za ' + u.in + ' dni'} · ${u.day}.${String(u.month).padStart(2, '0')} · kończy ${u.turns}`)))) : el('p', { class: 'mut' }, 'Brak urodzin z pełną datą w tym okresie.'));
}

function viewTools(main) {
  const ids = sortedIds();
  const mkSel = () => el('select', { class: 'big' }, el('option', { value: '' }, 'wybierz osobę…'), ids.map((i) => el('option', { value: i }, personLabel(model.persons[i]))));
  const A = mkSel(), B = mkSel(), res = el('div');
  const calc = () => { res.replaceChildren(); if (A.value && B.value) res.append(el('div', { class: 'result' }, relate(model, A.value, B.value).text)); };
  A.addEventListener('change', calc); B.addEventListener('change', calc);
  const living = Object.values(model.persons).filter((p) => isLiving(p)).length;
  main.replaceChildren(el('div', { class: 'cols', style: 'margin-top:.5rem' },
    card('Kalkulator pokrewieństwa', el('p', { class: 'mut' }, 'Wybierz dwie osoby. Szukam najbliższego wspólnego przodka.'), el('div', { class: 'row' }, el('label', { class: 'mut' }, 'Osoba 1', A), el('label', { class: 'mut' }, 'Osoba 2', B)), res),
    card(`Najbliższe urodziny (60 dni)`, upcomingBox(60, false)),
    card('Chmura (szyfrowana)', cloud.mount()),
    ...toolCards(ctx, card),
    card('Eksport', el('p', { class: 'mut' }, 'Pełny plik GEDCOM zachowuje wszystko z oryginału (zdjęcia, pochówki, znaczniki programów).'),
      el('div', { class: 'row' },
        el('button', { class: 'primary', onclick: () => download('rodzina.ged', serializeGedcom(model), 'text/plain;charset=utf-8') }, 'Pobierz .ged (pełny)'),
        el('button', { onclick: () => { const { model: m, anonymized } = anonymizeLiving(model); download('rodzina-bez-zyjacych.ged', serializeGedcom(m), 'text/plain;charset=utf-8'); say(`Zanonimizowano ${anonymized} osób (żyjące lub bez danych). Plik nadaje się do udostępnienia.`); } }, 'Pobierz .ged bez danych żyjących'),
        el('button', { onclick: () => download('rodzina.csv', toCsv(model), 'text/csv;charset=utf-8') }, 'Pobierz CSV (Excel)')),
      el('p', { class: 'mut' }, `Wersja bez żyjących zastąpi dane ${living} osób (żyjących lub bez dat) napisem „Żyjąca osoba” i usunie ich daty, miejsca i notatki.`)),
    card('Dane i prywatność', el('p', {}, `W tej przeglądarce: ${count()} osób. Do chmury trafia tylko zaszyfrowana kopia; serwer nie zna hasła ani treści.`),
      el('div', { class: 'row' }, el('button', { class: 'danger', onclick: async () => { if (confirm('Usunąć drzewo i zdjęcia z tej przeglądarki i zapomnieć tu hasło do chmury? Kopia w chmurze zostaje.')) { await cloud.forgetDevice(); mutate(() => { model = adopt(emptyModel()); }); await cloud.forgetDevice(); clearPhotos(); go('osoby'); say('Dane i zdjęcia usunięte z przeglądarki. Kopia w chmurze zostaje.'); } } }, 'Usuń dane z przeglądarki'))),
    card('Skróty', el('ul', { class: 'plain' }, [['/', 'szukaj osoby'], ['Ctrl+Z / Ctrl+Y', 'cofnij / ponów'], ['G potem O, T, C, M, Z, S, K, N', 'przejdź do widoku (osoby, tablica, oś czasu, miejsca, źródła, statystyki, kontrola, narzędzia)']].map(([k, t]) => el('li', {}, el('span', { class: 'kbd' }, k), el('span', { class: 'mut' }, t)))))));
}

// ---------- io ----------
async function importFile(f) {
  try {
    let photos = [];
    let bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      const files = await readZip(bytes);
      const g = files.find((x) => x.name === 'rodzina.ged') || files.find((x) => /\.ged$/i.test(x.name) && !x.name.includes('dla-innych'));
      if (!g) return say('W pliku ZIP nie ma pliku .ged.');
      bytes = g.data; photos = files.filter((x) => /^photos\//.test(x.name));
    }
    const m = adopt(parseGedcom(decodeGedcom(bytes)));
    const n = Object.keys(m.persons).length;
    if (!n) return say('W pliku nie znalazłem żadnych osób.');
    if (count() && !confirm(`Zastąpić obecne dane (${count()} osób) plikiem ${f.name}? Można cofnąć (Ctrl+Z).`)) return;
    mutate(() => { model = m; });
    for (const ph of photos) { const id = ph.name.replace(/^photos\//, '').replace(/\.[^.]+$/, ''); const ext = ph.name.split('.').pop().toLowerCase(); await putPhoto(id, new Blob([ph.data], { type: { png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext] || 'image/jpeg' })); }
    const bad = validate(m);
    say(`Wczytano ${f.name}: ${n} osób, ${Object.keys(m.families).length} rodzin` + (photos.length ? `, zdjęć: ${photos.length}` : '') + (bad.length ? `, uszkodzonych powiązań: ${bad.length}` : '') + '.');
    go('osoby');
  } catch (e) { say('Błąd wczytywania: ' + e.message); }
}

// ---------- wiring ----------
$('file').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
addEventListener('dragover', (e) => { e.preventDefault(); });
addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); });
$('export').addEventListener('click', () => download('rodzina.ged', serializeGedcom(model), 'text/plain;charset=utf-8'));
$('undo').addEventListener('click', undo); $('redo').addEventListener('click', redo);
$('theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('rodzina.theme', next); } catch {}
});
try { const th = localStorage.getItem('rodzina.theme'); if (th) document.documentElement.dataset.theme = th; } catch {}
addEventListener('hashchange', render);
let gPending = false;
addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); if (route().view !== 'osoby') go('osoby'); setTimeout(() => $('q')?.focus(), 0); return; }
  if (gPending) { gPending = false; const t = { o: 'osoby', t: 'tablica', c: 'os-czasu', m: 'miejsca', z: 'zrodla', s: 'statystyki', k: 'kontrola', n: 'narzedzia' }[e.key.toLowerCase()]; if (t) go(t); return; }
  if (e.key.toLowerCase() === 'g') { gPending = true; setTimeout(() => { gPending = false; }, 1200); }
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('sw.js').catch(() => {});

try {
  const t = localStorage.getItem(KEY);
  if (t) { model = adopt(parseGedcom(t)); if (count()) say(`Wczytano z przeglądarki: ${count()} osób.`); }
} catch (e) { say('Nie udało się odczytać zapisanych danych: ' + e.message); }
if (count()) refreshBadge();
if (!location.hash && count()) location.hash = '#/osoby';
render();
cloud.start();
window.__app = { get model() { return model; }, get version() { return version; } };
