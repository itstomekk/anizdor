import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decodeGedcom, parseGedcom, serializeGedcom, validate } from '../public/gedcom.js';
import { emptyModel, addPerson, addSpouse, addChild } from '../public/tree.js';
import { ensureExt, addSource, removeSource, sourceUsage, addTask, collectPlaces, renamePlace, findReplace, timelineFor, globalTimeline, lifeBars, historyBetween, addPhotoMeta, setPrimaryPhoto, removePhotoMeta } from '../public/extras.js';
import { personSheet, descendantBook, ahnentafel, indexReport, esc } from '../public/reports.js';

function fam() {
  const m = emptyModel(); ensureExt(m);
  const mk = (g, s, sex, b = '', d = '', bp = '', dp = '') => { const id = addPerson(m, { given: g, surname: s, sex }); const p = m.persons[id]; p.birth.date = b; p.birth.place = bp; p.death.date = d; p.death.place = dp; p.events = []; p.photos = []; p.sources = []; return id; };
  const a = mk('Adam', 'Nowak', 'M', '1900', '1970', 'Łosice', 'Warszawa'), e = mk('Ewa', 'Nowak', 'F', '1905', '1990', 'Łosice');
  const j = mk('Jan', 'Nowak', 'M', '12 MAR 1930', '', 'Łosice'), z = mk('Zofia', 'Nowak', 'F', '1960', '', 'Bydgoszcz');
  const f1 = addSpouse(m, a, e); m.families[f1].marriage = { date: '1925', place: 'Łosice' }; addChild(m, f1, j);
  const f2 = addSpouse(m, j, null); addChild(m, f2, z);
  return { m, a, e, j, z };
}

test('timeline per person: sorted, with ages, includes marriage and children', () => {
  const { m, a, j } = fam();
  m.persons[a].events.push({ id: 'x', type: 'BAPM', date: '1900', place: 'Kościół', sources: [] });
  const t = timelineFor(m, a);
  assert.deepEqual(t.map((x) => x.label), ['Urodzenie', 'Chrzest', 'Ślub', 'Urodziny dziecka', 'Śmierć']);
  assert.equal(t.find((x) => x.label === 'Śmierć').age, 70);
  assert.ok(t.every((x, i) => i === 0 || (t[i - 1].year ?? 0) <= x.year));
  assert.equal(timelineFor(m, j).some((x) => x.label === 'Urodziny dziecka'), true);
});

test('global timeline: marriage listed once, filters work', () => {
  const { m } = fam();
  const all = globalTimeline(m);
  assert.equal(all.filter((e) => e.kind === 'marriage').length, 1);
  assert.ok(all.every((e, i) => i === 0 || all[i - 1].year <= e.year));
  assert.ok(globalTimeline(m, { from: 1950 }).every((e) => e.year >= 1950));
  assert.ok(globalTimeline(m, { kinds: ['death'] }).every((e) => e.kind === 'death'));
});

test('life bars and history', () => {
  const { m } = fam();
  const bars = lifeBars(m);
  assert.equal(bars.length, 4);
  assert.ok(bars.find((b) => b.ongoing));
  assert.deepEqual(historyBetween(1939, 1945).map((x) => x[0]), [1939, 1940, 1943, 1944, 1945]);
});

test('places: collect, rename everywhere, coordinates follow', () => {
  const { m } = fam();
  m.ext.places['Łosice'] = { lat: 52.2, lng: 22.7 };
  const pl = collectPlaces(m);
  assert.equal(pl[0].name, 'Łosice'); assert.equal(pl[0].n, 4);
  const n = renamePlace(m, 'Łosice', 'Łosice (pow. łosicki)');
  assert.equal(n, 4);
  assert.ok(m.ext.places['Łosice (pow. łosicki)'] && !m.ext.places['Łosice']);
  assert.equal(collectPlaces(m).some((p) => p.name === 'Łosice'), false);
});

test('find & replace: dry run does not change, real run does, whole-word mode', () => {
  const { m, a } = fam();
  const dry = findReplace(m, 'surname', 'Nowak', 'Nowakowski', { dry: true });
  assert.equal(dry.count, 4); assert.equal(m.persons[a].surname, 'Nowak');
  findReplace(m, 'surname', 'Nowak', 'Nowakowski', { dry: false });
  assert.equal(m.persons[a].surname, 'Nowakowski');
  assert.equal(findReplace(m, 'given', 'Ad', 'X', { whole: true }).count, 0);
  assert.equal(findReplace(m, 'given', 'Ad', 'X', { whole: false }).count, 1);
  assert.equal(findReplace(m, 'surname', '', 'x').count, 0);
});

test('sources and tasks and photos metadata', () => {
  const { m, a } = fam();
  const s = addSource(m, { title: 'Akt' }); m.persons[a].sources.push(s); m.persons[a].events.push({ id: 'e', type: 'BAPM', sources: [s] });
  assert.equal(sourceUsage(m, s).length, 1);
  removeSource(m, s);
  assert.deepEqual(m.persons[a].sources, []); assert.deepEqual(m.persons[a].events[0].sources, []);
  const t = addTask(m, 'zrobić', a); assert.equal(m.ext.tasks.length, 1); assert.equal(t.done, false);
  const p1 = addPhotoMeta(m, a, { title: '1' }), p2 = addPhotoMeta(m, a, { title: '2' });
  assert.equal(p1.primary, true); assert.equal(p2.primary, false);
  setPrimaryPhoto(m, a, p2.id); assert.equal(m.persons[a].photos.find((x) => x.id === p2.id).primary, true);
  removePhotoMeta(m, a, p2.id); assert.equal(m.persons[a].photos[0].primary, true);
});

test('reports escape hostile names and render all sections', () => {
  const { m, a, j } = fam();
  m.persons[a].given = '<script>alert(1)</script>'; m.persons[a].notes = ['"><img src=x onerror=alert(2)>'];
  const html = personSheet(m, a) + descendantBook(m, a) + ahnentafel(m, j) + indexReport(m);
  assert.ok(!html.includes('<script>alert') && !html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.match(descendantBook(m, a), /1\.1\. Jan Nowak/);
  assert.match(ahnentafel(m, j), /<td>2<\/td><td>.*Adam|<td>2<\/td><td>&lt;script/);
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

const priv = new URL('../data/kolodziejczuki-myheritage-2026-06-04.ged', import.meta.url);
test('real file: places, timeline, reports (skipped when absent)', { skip: !existsSync(priv) }, () => {
  const m = parseGedcom(decodeGedcom(readFileSync(priv))); ensureExt(m);
  assert.ok(collectPlaces(m).length >= 4);
  const tl = globalTimeline(m); assert.ok(tl.length > 100);
  assert.ok(lifeBars(m).length > 50);
  const id = Object.keys(m.persons)[10];
  assert.ok(personSheet(m, id).length > 200);
  const out = parseGedcom(serializeGedcom(m)); assert.deepEqual(validate(out), []);
});
