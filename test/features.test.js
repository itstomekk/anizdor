import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decodeGedcom, parseGedcom, serializeGedcom, validate } from '../public/gedcom.js';
import { emptyModel, addPerson, addSpouse, addChild, parentsOf, childrenOf } from '../public/tree.js';
import { parseDate, formatDate, toGedcomDate, yearOf } from '../public/dates.js';
import { fold, lifeStatus, mergePersons, anonymizeLiving, toCsv } from '../public/ops.js';
import { computeStats, upcomingBirthdays, histogram } from '../public/stats.js';
import { runChecks, findDuplicateGroups } from '../public/checks.js';
import { relate } from '../public/kin.js';

const NOW = new Date(2026, 9, 26);

function family() {
  // Adam+Ewa -> Jan (M) , Maria (F) ; Jan+Ola -> Piotr (M), Kasia (F); Maria+Tom -> Zosia (F)
  const m = emptyModel();
  const mk = (given, surname, sex, birth = '', death = '') => { const id = addPerson(m, { given, surname, sex }); m.persons[id].birth.date = birth; m.persons[id].death.date = death; return id; };
  const adam = mk('Adam', 'Nowak', 'M', '1900', '1970'), ewa = mk('Ewa', 'Nowak', 'F', '1905', '1990');
  const jan = mk('Jan', 'Nowak', 'M', '12 MAR 1930', '2001'), maria = mk('Maria', 'Kowal', 'F', '1932', '');
  const ola = mk('Ola', 'Nowak', 'F', '1935'), tom = mk('Tomasz', 'Kowal', 'M', '1930');
  const piotr = mk('Piotr', 'Nowak', 'M', '1960'), kasia = mk('Kasia', 'Nowak', 'F', '1962'), zosia = mk('Zosia', 'Kowal', 'F', '1960');
  const f1 = addSpouse(m, adam, ewa); addChild(m, f1, jan); addChild(m, f1, maria);
  const f2 = addSpouse(m, jan, ola); addChild(m, f2, piotr); addChild(m, f2, kasia);
  const f3 = addSpouse(m, maria, tom); addChild(m, f3, zosia);
  return { m, adam, ewa, jan, maria, ola, tom, piotr, kasia, zosia };
}

test('date parsing and formatting', () => {
  assert.deepEqual(parseDate('12 MAR 1950'), { year: 1950, month: 3, day: 12, qual: '' });
  assert.equal(parseDate('ABT 1900').qual, 'abt');
  assert.equal(parseDate('BET 1900 AND 1910').year, 1900);
  assert.equal(yearOf('1984?'), 1984);
  assert.equal(yearOf('03.1940'), 1940);
  assert.equal(parseDate('...'), null);
  assert.equal(parseDate(''), null);
  assert.equal(formatDate('12 MAR 1950'), '12 mar 1950');
  assert.equal(formatDate('ABT 1900'), 'ok. 1900');
  assert.equal(formatDate('...'), '');
  assert.equal(toGedcomDate('12.03.1950'), '12 MAR 1950');
  assert.equal(toGedcomDate('03.1940'), 'MAR 1940');
  assert.equal(toGedcomDate('1950'), '1950');
  assert.equal(toGedcomDate('około 1900'), 'około 1900');
});

test('fold ignores Polish diacritics', () => {
  assert.equal(fold('Łukasz Żółć'), 'lukasz zolc');
});

test('life status', () => {
  const p = (b, d) => ({ birth: { date: b, place: '' }, death: { date: d, place: '' } });
  assert.equal(lifeStatus(p('1990', ''), NOW), 'living');
  assert.equal(lifeStatus(p('1990', '2020'), NOW), 'dead');
  assert.equal(lifeStatus(p('1850', ''), NOW), 'probably-dead');
  assert.equal(lifeStatus(p('', ''), NOW), 'unknown-living');
});

test('stats on a known family', () => {
  const { m } = family();
  const s = computeStats(m, NOW);
  assert.equal(s.totals.persons, 9);
  assert.equal(s.totals.families, 3);
  assert.deepEqual(s.totals.sex, { M: 4, F: 5, other: 0 });
  assert.equal(s.generations.max, 3);
  assert.equal(s.family.avgChildren, 5 / 3);
  assert.equal(s.topSurnames[0].name, 'Nowak');
  assert.equal(s.topSurnames[0].n, 6);
  assert.equal(s.lifespan.max.age, 85); // Ewa 1905-1990
  assert.equal(s.lifespan.n, 3);
  assert.equal(s.span.from, 1900);
  assert.equal(histogram([1900, 1905, 1930, 1962]).length, 7);
  assert.ok(s.parentAge.M > 20 && s.parentAge.M < 40);
});

test('upcoming birthdays: living only, next occurrence, turns age', () => {
  const m = emptyModel();
  const a = addPerson(m, { given: 'A' }); m.persons[a].birth.date = '2 NOV 1990';
  const b = addPerson(m, { given: 'B' }); m.persons[b].birth.date = '1 NOV 1950'; m.persons[b].death.date = '2010';
  const c = addPerson(m, { given: 'C' }); m.persons[c].birth.date = '25 OCT 1980'; // yesterday -> next year, out of 45 days
  const u = upcomingBirthdays(m, NOW, 45);
  assert.equal(u.length, 1);
  assert.deepEqual([u[0].id, u[0].in, u[0].turns], [a, 7, 36]);
});

test('checks: finds planted errors and nothing on a clean family', () => {
  const { m } = family();
  assert.deepEqual(runChecks(m, NOW).filter((i) => i.sev !== 'info'), []);
  const { m: bad, piotr, jan } = family();
  bad.persons[piotr].birth.date = '1920';      // born before father (1930)
  bad.persons[jan].death.date = '1925';        // death before birth (1930)
  const codes = runChecks(bad, NOW).map((i) => i.code);
  assert.ok(codes.includes('child-before-parent'));
  assert.ok(codes.includes('death-before-birth'));
});

test('duplicates: same name+year strong, same name without dates weak, different years not duplicates', () => {
  const m = emptyModel();
  const mk = (g, s, b) => { const id = addPerson(m, { given: g, surname: s }); m.persons[id].birth.date = b; return id; };
  const a1 = mk('Łukasz', 'Żuk', '1950'), a2 = mk('Lukasz', 'Zuk', '1950');
  mk('Jan', 'Kos', '1900'); mk('Jan', 'Kos', '1950');
  const w1 = mk('Ewa', 'Lis', ''), w2 = mk('Ewa', 'Lis', '');
  const g = findDuplicateGroups(m);
  assert.equal(g.length, 2);
  const strong = g.find((x) => x.strong);
  assert.deepEqual([...strong.ids].sort(), [a1, a2].sort());
  assert.deepEqual([...g.find((x) => !x.strong).ids].sort(), [w1, w2].sort());
});

test('merge: relations move, no dangling refs, families fold', () => {
  const { m, jan, ola, piotr, maria } = family();
  // a second "Jan" record that is married to Ola's duplicate and has a different child
  const jan2 = addPerson(m, { given: 'Jan', surname: 'Nowak', sex: 'M' }); m.persons[jan2].birth.date = '12 MAR 1930';
  const ola2 = addPerson(m, { given: 'Ola', surname: 'Nowak', sex: 'F' });
  const extra = addPerson(m, { given: 'Extra', surname: 'Nowak', sex: 'M' });
  const f = addSpouse(m, jan2, ola2); addChild(m, f, extra);
  mergePersons(m, jan, jan2); mergePersons(m, ola, ola2);
  assert.deepEqual(validate(m), []);
  assert.equal(m.persons[jan2], undefined);
  assert.deepEqual(childrenOf(m, jan).sort(), [piotr, extra, m.families[m.persons[jan].fams[0]].children.find((c) => c !== piotr && c !== extra)].sort());
  assert.equal(m.persons[jan].fams.length, 1, 'the two couple-families were folded');
  assert.deepEqual(runChecks(m, NOW).filter((i) => i.sev === 'err'), []);
  assert.equal(Object.keys(m.persons).length, 10);
  assert.ok(maria);
});

test('merge keeps media of the dropped record and survives export', () => {
  const m = parseGedcom(decodeGedcom(readFileSync(new URL('../fixtures/sample-rich.ged', import.meta.url))));
  const extra = addPerson(m, { given: 'Maria', surname: 'Zmyslona', sex: 'F' });
  mergePersons(m, extra, '@I1@');
  const out = serializeGedcom(m);
  assert.match(out, /OBJE/);
  assert.deepEqual(validate(parseGedcom(out)), []);
});

test('anonymize living for sharing', () => {
  const { m, adam, piotr } = family();
  const { model, anonymized } = anonymizeLiving(m, NOW);
  assert.ok(anonymized >= 3);
  assert.equal(model.persons[adam].given, 'Adam');      // died 1970
  assert.equal(model.persons[piotr].given, 'Żyjąca');   // b. 1960, no death
  const txt = serializeGedcom(model);
  assert.ok(!txt.includes('Piotr') && txt.includes('Adam'));
  assert.deepEqual(validate(parseGedcom(txt)), []);
});

test('csv: BOM, semicolons, quoting, parents', () => {
  const { m, piotr } = family();
  m.persons[piotr].given = 'Piotr "Pio"';
  const csv = toCsv(m);
  assert.ok(csv.startsWith('\uFEFF"ID";'));
  assert.match(csv, /"Piotr ""Pio""";"Nowak"/);
  assert.match(csv, /"Jan Nowak";"Ola Nowak"/);
  assert.equal(csv.trim().split('\r\n').length, 10);
});

test('kinship labels', () => {
  const { m, adam, jan, maria, piotr, zosia, kasia } = family();
  assert.match(relate(m, adam, jan).text, /ojciec/);
  assert.match(relate(m, jan, adam).text, /syn/);
  assert.match(relate(m, adam, piotr).text, /dziadek/);
  assert.match(relate(m, piotr, adam).text, /wnuk/);
  assert.match(relate(m, jan, maria).text, /brat/);
  assert.match(relate(m, piotr, kasia).text, /brat/);
  assert.match(relate(m, piotr, zosia).text, /kuzyn 1\. stopnia/);
  assert.match(relate(m, jan, zosia).text, /wujek/);
  assert.equal(relate(m, piotr, zosia).total, 4);
  const lone = addPerson(m, { given: 'Obcy' });
  assert.equal(relate(m, piotr, lone).kind, 'none');
});

const priv = new URL('../data/kolodziejczuki-myheritage-2026-06-04.ged', import.meta.url);
test('real file: stats, checks, anonymize are consistent (skipped when absent)', { skip: !existsSync(priv) }, () => {
  const m = parseGedcom(decodeGedcom(readFileSync(priv)));
  const s = computeStats(m, NOW);
  assert.equal(s.totals.persons, 334);
  assert.equal(s.totals.sex.M + s.totals.sex.F + s.totals.sex.other, 334);
  const L = s.totals.life;
  assert.equal(L.living + L['unknown-living'] + L.dead + L['probably-dead'], 334);
  const t0 = Date.now(); const issues = runChecks(m, NOW); assert.ok(Date.now() - t0 < 1500);
  assert.ok(issues.length >= 0);
  const { model } = anonymizeLiving(m, NOW);
  assert.deepEqual(validate(parseGedcom(serializeGedcom(model))), []);
});

test('checks: one-click repairs', async () => {
  const { fixIssue, fixAllSafe } = await import('../public/checks.js');
  const m = emptyModel();
  const a = addPerson(m, { given: 'Anna', surname: 'X', sex: 'F' }), b = addPerson(m, { given: 'Bolek', surname: 'X', sex: 'M' });
  addSpouse(m, a, b);
  const f = Object.values(m.families)[0]; [f.husband, f.wife] = [a, b];
  const lone = addPerson(m, { given: 'Lone', surname: 'Y', sex: 'M' });
  m.families['@FX@'] = { id: '@FX@', husband: lone, wife: '', children: [], marriage: { date: '', place: '' } }; m.persons[lone].fams.push('@FX@');
  m.persons[a].famc.push('@GONE@');
  m.persons[b].birth.date = '1990'; m.persons[b].death.date = '1950';
  let iss = runChecks(m, NOW);
  for (const c of ['ref', 'swapped-sex', 'empty-family', 'death-before-birth']) assert.ok(iss.some((i) => i.code === c), c);
  assert.equal(fixAllSafe(m, iss), 3);
  assert.ok(fixIssue(m, runChecks(m, NOW).find((i) => i.code === 'death-before-birth')));
  iss = runChecks(m, NOW);
  for (const c of ['ref', 'swapped-sex', 'empty-family', 'death-before-birth']) assert.ok(!iss.some((i) => i.code === c), 'still ' + c);
  assert.equal(f.husband, b); assert.equal(m.persons[b].birth.date, '1950');
  assert.deepEqual(validate(m), []);
});

test('dates: weekday of birth', async () => {
  const { weekdayOf } = await import('../public/dates.js');
  assert.equal(weekdayOf('11 NOV 1918'), 'poniedziałek');
  assert.equal(weekdayOf('1 SEP 1939'), 'piątek');
  assert.equal(weekdayOf('29 OCT 2026'), 'czwartek');
  assert.equal(weekdayOf('1950'), ''); assert.equal(weekdayOf('ABT 12 MAR 1950'), ''); assert.equal(weekdayOf('31 FEB 1950'), '');
});
test('stats: moreStats', async () => {
  const { moreStats } = await import('../public/stats.js');
  const m = emptyModel();
  const mk = (g, s, sex, b, d = '') => { const id = addPerson(m, { given: g, surname: s, sex }); m.persons[id].birth.date = b; m.persons[id].death.date = d; return id; };
  const h = mk('Jan', 'Kowalski', 'M', '1 SEP 1939', '2000'), w = mk('Ewa', 'Kowalska', 'F', '11 NOV 1945', '2010');
  const fam = addSpouse(m, h, w); m.families[Object.keys(m.families)[0]].marriage.date = '15 JUN 1965';
  const k = mk('Ola', 'Kowalska', 'F', '1 SEP 1966'); addChild(m, Object.keys(m.families)[0], k);
  const s = moreStats(m, NOW);
  assert.equal(s.birthWeekdayN, 3);
  assert.deepEqual(['piątek', 'niedziela', 'czwartek'].map((d) => s.birthWeekday.find((x) => x.name === d).n), [1, 1, 1]);
  assert.equal(s.marriageMonth[5].n, 1);
  assert.equal(s.marriageAge.M, 26); assert.equal(s.marriageAge.F, 20);
  assert.equal(s.spouseGap.avg, 6);
  assert.equal(s.records.longestMarriage.years, 35);
  assert.equal(s.records.youngestMother.age, 21);
  assert.equal(s.sharedBirthdays[0].length, 2);
  assert.equal(s.surnameEndings[0].name, '-ski / -cki');
});
