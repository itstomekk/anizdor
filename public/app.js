import { decodeGedcom, parseGedcom, serializeGedcom, validate } from './gedcom.js';
import { emptyModel, addPerson, addSpouse, addChild, addParent, parentsOf, childrenOf, spousesOf, removePerson, displayName, years, layoutAncestors, layoutDescendants, layoutToSvg } from './tree.js';

const KEY = 'rodzina.ged.v1';
const $ = (id) => document.getElementById(id);
let model = emptyModel();
let sel = null;      // selected person id
let tab = 'info';

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined) e[k] = v;
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
};
const say = (t) => { $('msg').textContent = t; };
const count = () => Object.keys(model.persons).length;

function save() {
  try { localStorage.setItem(KEY, serializeGedcom(model)); } catch (e) { say('Nie udało się zapisać w przeglądarce: ' + e.message); }
}
function load() {
  const t = localStorage.getItem(KEY);
  if (!t) return false;
  model = parseGedcom(t);
  return count() > 0;
}
function changed() { save(); renderList(); render(); }

// ---------- list ----------
function sortedIds() {
  return Object.keys(model.persons).sort((a, b) => {
    const A = model.persons[a], B = model.persons[b];
    const ea = !A.surname && !A.given, eb = !B.surname && !B.given;
    if (ea !== eb) return ea ? 1 : -1; // unnamed people go last
    return (A.surname || '\uffff').localeCompare(B.surname || '\uffff', 'pl') || (A.given || '').localeCompare(B.given || '', 'pl');
  });
}
function renderList() {
  const q = $('q').value.trim().toLowerCase();
  const ul = $('list'); ul.replaceChildren();
  let n = 0;
  for (const id of sortedIds()) {
    const p = model.persons[id];
    if (q && !displayName(p).toLowerCase().includes(q)) continue;
    if (++n > 400) { ul.append(el('li', {}, 'Zawęź wyszukiwanie…')); break; }
    ul.append(el('li', { class: id === sel ? 'on' : '', onclick: () => select(id) }, el('span', {}, displayName(p)), el('small', {}, years(p))));
  }
  const has = count() > 0;
  $('export').disabled = !has; $('wipe').disabled = !has;
}

// ---------- main view ----------
function select(id) { sel = id; location.hash = id.replace(/@/g, ''); renderList(); render(); }

function render() {
  const has = count() > 0;
  $('empty').hidden = has && !!sel; $('person').hidden = !sel || !model.persons[sel];
  if (!sel || !model.persons[sel]) return;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('tab-info').hidden = tab !== 'info'; $('tab-tree').hidden = tab === 'info';
  if (tab === 'info') renderInfo(); else renderTree();
}

function field(label, value, onset, type = 'text') {
  const i = el('input', { type, value: value || '' });
  i.addEventListener('change', () => { onset(i.value.trim()); changed(); });
  return el('label', {}, label, i);
}

function chip(id) { return el('span', { class: 'chip', onclick: () => select(id) }, displayName(model.persons[id]), ' ', el('small', {}, years(model.persons[id]))); }

function picker(onpick, placeholder) {
  // existing person (select) or a new one (name typed in)
  const s = el('select', {}, el('option', { value: '' }, 'wybierz istniejącą…'), sortedIds().filter((i) => i !== sel).map((i) => el('option', { value: i }, `${displayName(model.persons[i])} ${years(model.persons[i])}`)));
  const g = el('input', { placeholder: 'lub nowa: imię' });
  const sn = el('input', { placeholder: 'nazwisko' });
  const sex = el('select', {}, el('option', { value: '' }, 'płeć?'), el('option', { value: 'M' }, 'M'), el('option', { value: 'F' }, 'K'));
  const b = el('button', { onclick: () => {
    let id = s.value;
    if (!id) { if (!g.value.trim() && !sn.value.trim()) return say('Wybierz osobę albo wpisz imię i nazwisko.'); id = addPerson(model, { given: g.value.trim(), surname: sn.value.trim(), sex: sex.value }); }
    onpick(id); changed();
  } }, placeholder);
  return el('div', { class: 'add' }, s, g, sn, sex, b);
}

function renderInfo() {
  const p = model.persons[sel];
  const root = $('tab-info'); root.replaceChildren();
  root.append(el('h2', {}, displayName(p)));
  const sex = el('select', {}, ['', 'M', 'F', 'U'].map((v) => el('option', { value: v, selected: p.sex === v }, { '': 'nieznana', M: 'mężczyzna', F: 'kobieta', U: 'inna' }[v])));
  sex.addEventListener('change', () => { p.sex = sex.value; changed(); });
  root.append(el('div', { class: 'grid' },
    field('Imię', p.given, (v) => { p.given = v; }), field('Nazwisko', p.surname, (v) => { p.surname = v; }),
    el('label', {}, 'Płeć', sex),
    field('Data urodzenia (np. 12 MAR 1950)', p.birth.date, (v) => { p.birth.date = v; }), field('Miejsce urodzenia', p.birth.place, (v) => { p.birth.place = v; }),
    field('Data śmierci', p.death.date, (v) => { p.death.date = v; }), field('Miejsce śmierci', p.death.place, (v) => { p.death.place = v; })));

  const { father, mother } = parentsOf(model, sel);
  root.append(el('h3', {}, 'Rodzice'), el('div', { class: 'rel' }, [father, mother].filter(Boolean).map(chip), (!father && !mother) ? 'brak' : ''));
  if (!(father && mother)) root.append(picker((id) => addParent(model, sel, id), 'Dodaj rodzica'));

  root.append(el('h3', {}, 'Małżonkowie / partnerzy'));
  const sp = spousesOf(model, sel);
  root.append(el('div', { class: 'rel' }, sp.filter((s) => s.spouse).map((s) => chip(s.spouse)), sp.length ? '' : 'brak'));
  root.append(picker((id) => addSpouse(model, sel, id), 'Dodaj partnera'));

  root.append(el('h3', {}, 'Dzieci'));
  const kids = childrenOf(model, sel);
  root.append(el('div', { class: 'rel' }, kids.map(chip), kids.length ? '' : 'brak'));
  root.append(picker((id) => {
    const fid = sp.length ? sp[sp.length - 1].family : addSpouse(model, sel, null);
    addChild(model, fid, id);
  }, 'Dodaj dziecko'));

  const del = el('button', { class: 'ghost', onclick: () => {
    if (!confirm(`Usunąć ${displayName(p)} z drzewa? (plik .ged na dysku się nie zmieni)`)) return;
    removePerson(model, sel); sel = null; history.replaceState(null, '', location.pathname); changed();
  } }, 'Usuń osobę');
  root.append(el('div', { class: 'danger' }, del));
}

let lastSvg = '';
function renderTree() {
  const gens = +$('gens').value;
  const lay = tab === 'anc' ? layoutAncestors(model, sel, gens - 1) : layoutDescendants(model, sel, gens - 1);
  lastSvg = layoutToSvg(model, lay);
  const doc = new DOMParser().parseFromString(lastSvg, 'image/svg+xml');
  const c = $('canvas'); c.replaceChildren(document.importNode(doc.documentElement, true));
  c.querySelectorAll('g[data-id]').forEach((g) => g.addEventListener('click', () => { tab = 'info'; select(g.dataset.id); }));
}

// ---------- io ----------
async function importFile(f) {
  try {
    const m = parseGedcom(decodeGedcom(new Uint8Array(await f.arrayBuffer())));
    if (!Object.keys(m.persons).length) return say('W pliku nie znalazłem żadnych osób.');
    if (count() && !confirm(`Zastąpić obecne dane (${count()} osób) plikiem ${f.name}?`)) return;
    model = m; sel = null; tab = 'info';
    const bad = validate(m);
    say(`Wczytano ${f.name}: ${Object.keys(m.persons).length} osób, ${Object.keys(m.families).length} rodzin` + (bad.length ? `, ostrzeżeń: ${bad.length}` : ''));
    const first = sortedIds()[0]; save(); renderList(); select(first);
  } catch (e) { say('Błąd wczytywania: ' + e.message); }
}
function download(name, data, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([data], { type })), download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

$('file').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); });
$('export').addEventListener('click', () => download('rodzina.ged', serializeGedcom(model), 'text/plain;charset=utf-8'));
$('new').addEventListener('click', () => { const id = addPerson(model, { given: 'Nowa', surname: 'Osoba' }); save(); renderList(); tab = 'info'; select(id); });
$('wipe').addEventListener('click', () => { if (confirm('Usunąć dane drzewa z tej przeglądarki? Zrób najpierw „Pobierz .ged”.')) { localStorage.removeItem(KEY); model = emptyModel(); sel = null; say('Dane usunięte.'); renderList(); render(); } });
$('q').addEventListener('input', renderList);
$('gens').addEventListener('change', render);
$('svg').addEventListener('click', () => download(`drzewo-${tab}.svg`, lastSvg, 'image/svg+xml'));
$('print').addEventListener('click', () => window.print());
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
window.addEventListener('hashchange', () => { const id = '@' + location.hash.slice(1) + '@'; if (model.persons[id] && id !== sel) { sel = id; renderList(); render(); } });

if (load()) {
  say(`Wczytano z przeglądarki: ${count()} osób.`);
  const h = '@' + location.hash.slice(1) + '@';
  sel = model.persons[h] ? h : sortedIds()[0];
}
renderList(); render();
window.__app = { get model() { return model; } }; // for tests
