import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { decodeGedcom, parseGedcom } from '../public/gedcom.js';
import { emptyModel, addPerson, addSpouse, addChild, addParent, parentsOf } from '../public/tree.js';
import { fanLayout, arcPath, ringRadii, galaxyGraph, layoutGalaxy, clampView, bbox, dataLevel } from '../public/visualizations.js';

// Three generations: kid <- (dad, mom); dad <- (gf, gm); mom has no known parents.
function family() {
  const m = emptyModel();
  const P = (given, sex) => addPerson(m, { given, surname: 'T', sex });
  const gf = P('Gf', 'M'), gm = P('Gm', 'F'), dad = P('Dad', 'M'), mom = P('Mom', 'F'), kid = P('Kid', 'F'), sis = P('Sis', 'F');
  const f1 = addSpouse(m, gf, gm); addChild(m, f1, dad);
  const f2 = addSpouse(m, dad, mom); addChild(m, f2, kid); addChild(m, f2, sis);
  return { m, gf, gm, dad, mom, kid, sis };
}

test('fan: ahnentafel positions, empty cells for unknown parents', () => {
  const { m, kid, dad, mom, gf, gm } = family();
  const fan = fanLayout(m, kid, 3);
  const at = (g, k) => fan.cells.find((c) => c.gen === g && c.k === k);
  assert.equal(at(0, 0).id, kid);
  assert.equal(at(1, 0).id, dad); assert.equal(at(1, 1).id, mom);
  assert.equal(at(2, 0).id, gf); assert.equal(at(2, 1).id, gm);
  assert.ok(at(2, 2).empty && at(2, 3).empty); // mom's parents unknown
  assert.ok(!fan.cells.some((c) => c.gen === 3 && c.k >= 4)); // nothing invented below an empty cell
  assert.equal(fan.distinct, 5);
  assert.ok(Math.abs(at(1, 0).a1 - at(1, 1).a0) < 1e-9); // father and mother halves touch
});

test('fan: depth is respected and half fan angles stay in range', () => {
  const { m, kid } = family();
  assert.ok(fanLayout(m, kid, 1).cells.every((c) => c.gen <= 1));
  const half = fanLayout(m, kid, 3, { start: -Math.PI / 2, sweep: Math.PI });
  for (const c of half.cells) assert.ok(c.a0 >= -Math.PI / 2 - 1e-9 && c.a1 <= Math.PI / 2 + 1e-9);
});

test('fan: pedigree collapse is flagged, not hidden', () => {
  const { m, kid, gf } = family();
  const mom = parentsOf(m, kid).mother;
  addParent(m, mom, gf); // the grandfather now appears on both sides
  const fan = fanLayout(m, kid, 3);
  const gfCells = fan.cells.filter((c) => c.id === gf);
  assert.equal(gfCells.length, 2);
  assert.equal(gfCells.filter((c) => c.repeat).length, 1);
  assert.equal(fan.repeats, 1);
});

test('fan: a person who is their own ancestor does not hang or recurse', () => {
  const m = emptyModel();
  const a = addPerson(m, { given: 'A', sex: 'M' }), b = addPerson(m, { given: 'B', sex: 'M' });
  const f1 = addSpouse(m, a, null); addChild(m, f1, b);
  const f2 = addSpouse(m, b, null); addChild(m, f2, a);
  const fan = fanLayout(m, a, 8);
  assert.ok(fan.cells.length < 20);
  assert.ok(fan.cells.some((c) => c.loop));
});

test('fan: unknown or missing root gives an empty fan', () => {
  assert.equal(fanLayout(emptyModel(), '@I9@').cells.length, 0);
});

test('arcPath: valid, finite numbers, full ring and disc', () => {
  for (const d of [arcPath(0, 0, 60, 120, 0, Math.PI), arcPath(0, 0, 0, 60, 0, Math.PI * 2), arcPath(0, 0, 60, 120, 0, Math.PI * 2), arcPath(0, 0, 60, 120, 1, 1.01)]) {
    assert.match(d, /^M/); assert.ok(!/NaN|Infinity/.test(d));
  }
  const [r0, r1] = ringRadii(1); assert.ok(r0 > 0 && r1 > r0);
  assert.equal(ringRadii(2)[0], ringRadii(1)[1]);
});

test('galaxy: hops, direction and partner handling', () => {
  const { m, kid, dad, mom, gf, gm, sis } = family();
  const ids = (g) => g.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids(galaxyGraph(m, kid, { hops: 1 })), [dad, kid, mom].sort()); // a sibling is two hops away
  assert.deepEqual(ids(galaxyGraph(m, kid, { hops: 2, dir: 'anc' })), [dad, gf, gm, kid, mom].sort());
  const desc = galaxyGraph(m, gf, { hops: 2, dir: 'desc' });
  assert.ok(desc.nodes.some((n) => n.id === kid));
  assert.equal(desc.nodes.find((n) => n.id === gm).d, 0); // partner stays with the focus
  const g = galaxyGraph(m, kid, { hops: 2 });
  assert.equal(g.edges.filter((e) => e.kind === 'spouse').length, 2);
  assert.equal(g.edges.filter((e) => e.kind === 'child').length, 6);
  assert.equal(new Set(g.edges.map((e) => `${e.kind}${e.a}-${e.b}`)).size, g.edges.length);
});

test('galaxy: cap keeps the nearest people and says it truncated', () => {
  const { m, kid } = family();
  const g = galaxyGraph(m, kid, { hops: 3, max: 3 });
  assert.equal(g.nodes.length, 3); assert.ok(g.truncated); assert.equal(g.nodes[0].id, kid);
  assert.ok(g.edges.every((e) => e.a < 3 && e.b < 3));
});

test('galaxy: layout is deterministic, finite, centred on the focus, couples are close', () => {
  const { m, kid, dad, mom } = family();
  const run = () => { const g = galaxyGraph(m, kid, { hops: 3 }); const box = layoutGalaxy(g); return { g, box }; };
  const A = run(), B = run();
  assert.deepEqual(A.g.nodes.map((n) => [n.x, n.y]), B.g.nodes.map((n) => [n.x, n.y]));
  for (const n of A.g.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  assert.deepEqual([A.g.nodes[0].x, A.g.nodes[0].y], [0, 0]);
  const pos = (id) => A.g.nodes.find((n) => n.id === id);
  const dist = Math.hypot(pos(dad).x - pos(mom).x, pos(dad).y - pos(mom).y);
  assert.ok(dist < 140, `couple distance ${dist}`);
  assert.ok(A.box.maxX > A.box.minX);
});

test('galaxy: empty and single-person graphs do not break', () => {
  assert.deepEqual(galaxyGraph(emptyModel(), '@I1@').nodes, []);
  const m = emptyModel(); const p = addPerson(m, { given: 'Solo' });
  const g = galaxyGraph(m, p); const box = layoutGalaxy(g);
  assert.equal(g.nodes.length, 1); assert.ok(Number.isFinite(box.minX));
  layoutGalaxy({ nodes: [], edges: [] });
});

test('clampView keeps the picture reachable; dataLevel buckets', () => {
  const box = bbox([{ x: 0, y: 0 }, { x: 100, y: 100 }], 0);
  const v = clampView({ cx: 99999, cy: -99999, s: 1000 }, box, 2);
  assert.deepEqual(v, { s: 60, cx: 100, cy: 0 });
  assert.equal(clampView({ cx: 50, cy: 50, s: 0.001 }, box, 2).s, 0.8);
  assert.equal(dataLevel({ birth: { date: '1900', place: 'X' } }), 'full');
  assert.equal(dataLevel({ birth: { date: '1900', place: '' } }), 'part');
  assert.equal(dataLevel({ birth: { date: '', place: '' } }), 'none');
});

const REAL = new URL('../data/kolodziejczuki-myheritage-2026-06-04.ged', import.meta.url);
test('real private file: every 7th person lays out quickly and finitely (skipped when absent)', { skip: !existsSync(REAL) }, () => {
  const m = parseGedcom(decodeGedcom(readFileSync(REAL)));
  const t0 = Date.now(); let worst = 0, biggest = 0;
  for (const id of Object.keys(m.persons).filter((_, i) => i % 7 === 0)) {
    const g = galaxyGraph(m, id, { hops: 6 }); const t = Date.now(); layoutGalaxy(g); worst = Math.max(worst, Date.now() - t); biggest = Math.max(biggest, g.nodes.length);
    for (const n of g.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
    assert.ok(fanLayout(m, id, 9).cells.length <= 2 ** 10);
  }
  console.log(`# galaxy worst layout ${worst} ms, biggest graph ${biggest} nodes, total ${Date.now() - t0} ms`);
  assert.ok(worst < 1500);
});
