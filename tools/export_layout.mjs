// Dumps layouts of a GEDCOM as JSON for the PDF builder (tools/make_pdf.py). Usage: node tools/export_layout.mjs file.ged out.json [focusId]
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeGedcom, parseGedcom } from '../public/gedcom.js';
import { layoutForest, spousesOf, displayName, years } from '../public/tree.js';
import { fanLayout } from '../public/visualizations.js';
import { computeStats } from '../public/stats.js';

const [, , ged, out, focusArg] = process.argv;
const m = parseGedcom(decodeGedcom(readFileSync(ged)));
const lay = layoutForest(m);
const person = (id) => {
  const p = m.persons[id];
  return { id, given: p.given || '', surname: p.surname || '', sex: p.sex || '', years: years(p), birth: p.birth.date || '', death: p.death.date || '',
    spouses: spousesOf(m, id).filter((s) => s.spouse).map((s) => displayName(m.persons[s.spouse])) };
};
const nodes = lay.nodes.map((n) => ({ ...person(n.id), gen: n.gen, row: n.y }));
const focus = focusArg && m.persons[focusArg] ? focusArg : computeStats(m).generations.deepest;
const fan = fanLayout(m, focus, 7);
writeFileSync(out, JSON.stringify({
  total: Object.keys(m.persons).length, families: Object.keys(m.families).length,
  nodes, links: lay.links, trees: lay.trees, alone: lay.alone, rows: lay.rows,
  focus: person(focus),
  fan: { depth: fan.depth, known: fan.known, distinct: fan.distinct, repeats: fan.repeats, cells: fan.cells.map((c) => ({ gen: c.gen, k: c.k, a0: c.a0, a1: c.a1, empty: c.empty, repeat: c.repeat, loop: c.loop, p: c.id && !c.loop ? person(c.id) : null })) },
}));
console.log('persons', Object.keys(m.persons).length, 'drawn', nodes.length, 'trees', lay.trees, 'rows', lay.rows, 'maxgen', Math.max(...nodes.map((n) => n.gen)), 'focus', focus);
