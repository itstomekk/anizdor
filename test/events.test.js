import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decodeGedcom, parseGedcom, parseTree, serializeGedcom, validate } from '../public/gedcom.js';
import { ensureExt, addSource, addTask, addPhotoMeta } from '../public/extras.js';

function canon(text) {
  const rec = {};
  const walk = (n, path, acc) => { const p = `${path}/${n.tag}`; acc.push(`${p}=${n.value}`); for (const c of n.children) walk(c, p, acc); };
  for (const n of parseTree(text)) { const acc = []; for (const c of n.children) walk(c, '', acc); rec[`${n.xref || ''}${n.tag}${n.xref ? '' : n.value}`] = acc.sort(); }
  return rec;
}
const rich = () => decodeGedcom(readFileSync(new URL('../fixtures/sample-rich.ged', import.meta.url)));

test('burial/residence stay lossless after the event model was introduced', () => {
  const src = rich();
  const m = parseGedcom(src);
  assert.equal(m.persons['@I1@'].events.some((e) => e.type === 'BURI'), true);
  assert.deepEqual(canon(serializeGedcom(m)), canon(src));
});

test('adding an event, source, task, photo and place survives export -> import', () => {
  const m = parseGedcom(rich()); ensureExt(m);
  const s = addSource(m, { title: 'Księga parafialna', author: 'Parafia X', url: 'https://example.org/a' });
  const p = m.persons['@I1@'];
  p.events.push({ id: 'new1', type: 'BAPM', date: '5 JAN 1900', place: 'Kościół', note: 'chrzest', sources: [s] });
  p.events.push({ id: 'new2', type: 'OCCU', value: 'Kowal', date: '', place: '', note: '', sources: [] });
  p.sources.push(s);
  addPhotoMeta(m, '@I1@', { title: 'Portret', w: 300, h: 400 });
  const t = addTask(m, 'Znaleźć akt chrztu', '@I1@');
  m.ext.places['Wies'] = { lat: 52.1, lng: 22.5 };
  const text = serializeGedcom(m);
  const b = parseGedcom(text);
  assert.deepEqual(validate(b), []);
  assert.equal(b.ext.sources[s].title, 'Księga parafialna');
  assert.equal(b.ext.tasks[0].text, 'Znaleźć akt chrztu');
  assert.deepEqual(b.ext.places['Wies'], { lat: 52.1, lng: 22.5 });
  const bp = b.persons['@I1@'];
  assert.ok(bp.events.some((e) => e.type === 'BAPM' && e.date === '5 JAN 1900' && e.sources.includes(s)));
  assert.ok(bp.events.some((e) => e.type === 'OCCU' && e.value === 'Kowal'));
  assert.equal(bp.photos[0].title, 'Portret'); assert.equal(bp.photos[0].primary, true);
  assert.ok(t.id);
  // standard tags other programs understand
  assert.match(text, /1 BAPM\r\n2 DATE 5 JAN 1900/);
  assert.match(text, /0 @S1@ SOUR\r\n1 TITL Księga parafialna/);
  // second round trip is stable
  assert.deepEqual(canon(serializeGedcom(b)), canon(text));
});

test('removing an event removes it from the file', () => {
  const m = parseGedcom(rich());
  m.persons['@I1@'].events = m.persons['@I1@'].events.filter((e) => e.type !== 'BURI');
  assert.ok(!/1 BURI/.test(serializeGedcom(m)));
});

const priv = new URL('../data/kolodziejczuki-myheritage-2026-06-04.ged', import.meta.url);
test('real file stays lossless with the event model (skipped when absent)', { skip: !existsSync(priv) }, () => {
  const src = decodeGedcom(readFileSync(priv));
  const a = canon(src), b = canon(serializeGedcom(parseGedcom(src)));
  assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort());
  for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], k);
});
