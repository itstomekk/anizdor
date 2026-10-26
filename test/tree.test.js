import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeGedcom, parseGedcom, serializeGedcom, validate } from '../public/gedcom.js';
import { emptyModel, addPerson, addSpouse, addChild, addParent, parentsOf, childrenOf, spousesOf, removePerson, layoutAncestors, layoutDescendants, layoutToSvg } from '../public/tree.js';

const sample = () => parseGedcom(decodeGedcom(readFileSync(new URL('../fixtures/sample.ged', import.meta.url))));

test('relations from sample', () => {
  const m = sample();
  assert.deepEqual(parentsOf(m, '@I3@'), { father: '@I1@', mother: '@I2@', family: '@F1@' });
  assert.deepEqual(childrenOf(m, '@I1@'), ['@I3@']);
  assert.equal(spousesOf(m, '@I2@')[0].spouse, '@I1@');
});

test('build a family from scratch and export a valid .ged', () => {
  const m = emptyModel();
  const dad = addPerson(m, { given: 'Adam', surname: 'Nowak', sex: 'M' });
  const mom = addPerson(m, { given: 'Ewa', surname: 'Nowak', sex: 'F' });
  const kid = addPerson(m, { given: 'Zuzia', surname: 'Nowak', sex: 'F' });
  const fam = addSpouse(m, mom, dad); // order of args must not matter
  addChild(m, fam, kid);
  assert.equal(m.families[fam].husband, dad);
  assert.equal(m.families[fam].wife, mom);
  assert.deepEqual(validate(m), []);
  const back = parseGedcom(serializeGedcom(m));
  assert.equal(Object.keys(back.persons).length, 3);
  assert.deepEqual(parentsOf(back, kid), { father: dad, mother: mom, family: fam });
});

test('addParent creates then completes the parents family', () => {
  const m = emptyModel();
  const kid = addPerson(m, { given: 'K', sex: 'M' });
  const f = addPerson(m, { given: 'F', sex: 'M' });
  const mo = addPerson(m, { given: 'M', sex: 'F' });
  addParent(m, kid, f); addParent(m, kid, mo);
  assert.deepEqual(parentsOf(m, kid), { father: f, mother: mo, family: m.persons[kid].famc[0] });
  assert.equal(Object.keys(m.families).length, 1);
  assert.deepEqual(validate(m), []);
});

test('removePerson keeps the model consistent', () => {
  const m = sample();
  removePerson(m, '@I3@');
  assert.deepEqual(validate(m), []);
  assert.deepEqual(childrenOf(m, '@I1@'), []);
  removePerson(m, '@I1@'); removePerson(m, '@I2@');
  assert.equal(Object.keys(m.families).length, 0);
  assert.deepEqual(validate(m), []);
});

test('layouts: ancestors and descendants, with svg', () => {
  const m = sample();
  const a = layoutAncestors(m, '@I3@');
  assert.equal(a.nodes.length, 3);
  assert.equal(a.links.length, 2);
  const d = layoutDescendants(m, '@I1@');
  assert.equal(d.nodes.length, 2);
  const svg = layoutToSvg(m, a);
  assert.match(svg, /^<svg/);
  assert.match(svg, /Przykładowa/);
});

test('svg escapes markup in names', () => {
  const m = emptyModel();
  const p = addPerson(m, { given: '<img onerror=x>', surname: '&', sex: 'M' });
  const svg = layoutToSvg(m, layoutAncestors(m, p));
  assert.ok(!svg.includes('<img'));
});

test('cycle in data does not hang the layout', () => {
  const m = emptyModel();
  const a = addPerson(m, { given: 'A', sex: 'M' }), b = addPerson(m, { given: 'B', sex: 'M' });
  const f1 = addSpouse(m, a, null); addChild(m, f1, b);
  const f2 = addSpouse(m, b, null); addChild(m, f2, a);
  assert.ok(layoutAncestors(m, a).nodes.length >= 1);
  assert.ok(layoutDescendants(m, a).nodes.length >= 1);
});

test('layouts on the real private file (skipped when absent)', { skip: !(await import('node:fs')).existsSync(new URL('../data/kolodziejczuki-myheritage-2026-06-04.ged', import.meta.url)) }, () => {
  const m = parseGedcom(decodeGedcom(readFileSync(new URL('../data/kolodziejczuki-myheritage-2026-06-04.ged', import.meta.url))));
  let max = 0;
  for (const id of Object.keys(m.persons)) {
    const a = layoutAncestors(m, id, 8), d = layoutDescendants(m, id, 8);
    max = Math.max(max, a.nodes.length, d.nodes.length);
    layoutToSvg(m, a); layoutToSvg(m, d);
  }
  assert.ok(max > 10);
});
