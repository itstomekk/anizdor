import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeGedcom, parseGedcom, serializeGedcom, validate } from '../public/gedcom.js';

const sample = readFileSync(new URL('../fixtures/sample.ged', import.meta.url));

test('parses the sample .ged', () => {
  const m = parseGedcom(decodeGedcom(sample));
  assert.equal(Object.keys(m.persons).length, 3);
  assert.equal(m.persons['@I2@'].surname, 'Przykładowa');
  assert.equal(m.persons['@I3@'].death.date, '4 APR 2040');
  assert.equal(m.families['@F1@'].children[0], '@I3@');
  assert.deepEqual(validate(m), []);
  assert.match(m.persons['@I3@'].notes[0], /\nna kilka linii\.$/);
});

test('round trip keeps the data', () => {
  const a = parseGedcom(decodeGedcom(sample));
  const b = parseGedcom(serializeGedcom(a));
  assert.deepEqual(b.persons, a.persons);
  assert.deepEqual(b.families, a.families);
});

test('long values are split with CONC and rejoined', () => {
  const m = parseGedcom(decodeGedcom(sample));
  m.persons['@I1@'].notes = ['x'.repeat(650)];
  const text = serializeGedcom(m);
  assert.ok(text.split('\r\n').every((l) => l.length <= 255));
  assert.equal(parseGedcom(text).persons['@I1@'].notes[0], 'x'.repeat(650));
});

test('decodes ANSI (Windows-1250) files as Ahnenblatt exports them', () => {
  const txt = '0 HEAD\r\n1 CHAR ANSI\r\n0 @I1@ INDI\r\n1 NAME Żaneta /Łącka/\r\n0 TRLR\r\n';
  const cp1250 = { 'Ż': 0xaf, 'ą': 0xb9, 'Ł': 0xa3, 'ć': 0xe6 };
  const bytes = Uint8Array.from([...txt].map((c) => cp1250[c] ?? c.charCodeAt(0)));
  const m = parseGedcom(decodeGedcom(bytes));
  assert.equal(m.persons['@I1@'].given, 'Żaneta');
  assert.equal(m.persons['@I1@'].surname, 'Łącka');
});

test('UTF-8 BOM is stripped', () => {
  const body = new TextEncoder().encode('0 HEAD\n0 @I1@ INDI\n1 NAME A /B/\n0 TRLR\n');
  const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...body]);
  assert.equal(parseGedcom(decodeGedcom(bytes)).persons['@I1@'].surname, 'B');
});
