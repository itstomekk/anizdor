// Family-tree model helpers on top of the parsed GEDCOM model. Pure functions, no DOM.

const emptyEv = () => ({ date: '', place: '' });

export function newId(model, letter) {
  const coll = letter === 'F' ? model.families : model.persons;
  let n = Object.keys(coll).length + 1;
  while (coll[`@${letter}${n}@`]) n++;
  return `@${letter}${n}@`;
}

export function emptyModel() {
  return { header: {}, persons: {}, families: {}, other: [] };
}

export function addPerson(model, { given = '', surname = '', sex = '' } = {}) {
  const id = newId(model, 'I');
  model.persons[id] = { id, given, surname, suffix: '', sex, birth: emptyEv(), death: emptyEv(), famc: [], fams: [], notes: [] };
  return id;
}

export function parentsOf(model, pid) {
  const p = model.persons[pid];
  const f = p && p.famc.length ? model.families[p.famc[0]] : null;
  if (!f) return { father: null, mother: null, family: null };
  return { father: f.husband || null, mother: f.wife || null, family: f.id };
}

export function spousesOf(model, pid) {
  const p = model.persons[pid];
  const out = [];
  for (const fid of p?.fams || []) {
    const f = model.families[fid];
    if (!f) continue;
    const other = f.husband === pid ? f.wife : f.husband;
    out.push({ family: fid, spouse: other || null, marriage: f.marriage });
  }
  return out;
}

export function childrenOf(model, pid) {
  const out = [];
  for (const fid of model.persons[pid]?.fams || []) {
    const f = model.families[fid];
    for (const c of f?.children || []) if (model.persons[c]) out.push(c);
  }
  return out;
}

/** Find or create the family of two partners (either may be null for a single parent). */
export function ensureFamily(model, aId, bId) {
  const [h, w] = orderCouple(model, aId, bId);
  for (const f of Object.values(model.families)) {
    if ((f.husband || null) === h && (f.wife || null) === w) return f.id;
  }
  const id = newId(model, 'F');
  model.families[id] = { id, husband: h || '', wife: w || '', children: [], marriage: emptyEv() };
  for (const pid of [h, w]) if (pid && !model.persons[pid].fams.includes(id)) model.persons[pid].fams.push(id);
  return id;
}

function orderCouple(model, a, b) {
  const sa = model.persons[a]?.sex, sb = model.persons[b]?.sex;
  if (sa === 'F' || sb === 'M') return [b || null, a || null];
  return [a || null, b || null];
}

export function addSpouse(model, pid, spouseId) {
  return ensureFamily(model, pid, spouseId);
}

export function addChild(model, famId, childId) {
  const f = model.families[famId];
  if (!f.children.includes(childId)) f.children.push(childId);
  const c = model.persons[childId];
  if (!c.famc.includes(famId)) c.famc.push(famId);
}

/** Give a person a parent (creates the parents' family when needed). */
export function addParent(model, childId, parentId) {
  const { family } = parentsOf(model, childId);
  if (family) {
    const f = model.families[family];
    if (f.husband && f.wife) return family;
    const slot = model.persons[parentId].sex === 'F' ? 'wife' : 'husband';
    const other = slot === 'wife' ? 'husband' : 'wife';
    const target = f[slot] ? other : slot;
    f[target] = parentId;
    if (!model.persons[parentId].fams.includes(family)) model.persons[parentId].fams.push(family);
    return family;
  }
  const fid = ensureFamily(model, parentId, null);
  addChild(model, fid, childId);
  return fid;
}

export function removePerson(model, pid) {
  for (const f of Object.values(model.families)) {
    if (f.husband === pid) f.husband = '';
    if (f.wife === pid) f.wife = '';
    f.children = f.children.filter((c) => c !== pid);
  }
  delete model.persons[pid];
  for (const f of Object.values(model.families)) {
    if (!f.husband && !f.wife && !f.children.length) {
      delete model.families[f.id];
      for (const p of Object.values(model.persons)) {
        p.fams = p.fams.filter((x) => x !== f.id);
        p.famc = p.famc.filter((x) => x !== f.id);
      }
    }
  }
  for (const p of Object.values(model.persons)) {
    p.fams = p.fams.filter((x) => model.families[x]);
    p.famc = p.famc.filter((x) => model.families[x]);
  }
}

export function displayName(p) {
  if (!p) return '';
  const n = `${p.given || ''} ${p.surname || ''}`.trim();
  return n || '(bez nazwy)';
}

export function years(p) {
  const y = (d) => (d.match(/\d{4}/) || [''])[0];
  const b = y(p.birth.date), d = y(p.death.date);
  if (!b && !d) return '';
  return `${b || '?'}${d || p.death.date ? ' – ' + (d || '?') : ''}`;
}

// ---------- tree layout ----------

/** Ancestors, pedigree to the right. Returns {nodes:[{id,x,y,gen}], links:[[idx,idx]]}. */
export function layoutAncestors(model, rootId, maxGen = 5) {
  const nodes = [], links = [];
  let row = 0;
  const walk = (pid, gen, path) => {
    if (path.includes(pid)) return -1; // cycle guard
    const { father, mother } = gen < maxGen ? parentsOf(model, pid) : {};
    const kids = [];
    for (const par of [father, mother]) {
      if (par && model.persons[par]) { const i = walk(par, gen + 1, [...path, pid]); if (i >= 0) kids.push(i); }
    }
    let y;
    if (kids.length) y = kids.reduce((s, i) => s + nodes[i].y, 0) / kids.length; else y = row++;
    const idx = nodes.push({ id: pid, gen, y }) - 1;
    for (const k of kids) links.push([idx, k]);
    return idx;
  };
  walk(rootId, 0, []);
  return { nodes, links, rows: Math.max(row, 1) };
}

/** Descendants, to the right. `seen` (optional Set) keeps a person from being drawn twice across several trees. */
export function layoutDescendants(model, rootId, maxGen = 6, seen = null, rowStart = 0) {
  const nodes = [], links = [];
  let row = rowStart;
  const walk = (pid, gen, path) => {
    if (path.includes(pid) || (seen && seen.has(pid))) return -1;
    if (seen) seen.add(pid);
    const kids = [];
    if (gen < maxGen) for (const c of childrenOf(model, pid)) { const i = walk(c, gen + 1, [...path, pid]); if (i >= 0) kids.push(i); }
    const y = kids.length ? kids.reduce((s, i) => s + nodes[i].y, 0) / kids.length : row++;
    const idx = nodes.push({ id: pid, gen, y }) - 1;
    for (const k of kids) links.push([idx, k]);
    return idx;
  };
  walk(rootId, 0, []);
  return { nodes, links, rows: Math.max(row - rowStart, 1), endRow: row };
}

/** The whole family: descendant trees of everyone without known parents, stacked top to bottom. */
export function layoutForest(model, maxGen = 30) {
  const seen = new Set();
  const born = (id) => { const m = (model.persons[id].birth.date || '').match(/\d{4}/); return m ? +m[0] : 9999; };
  const roots = Object.keys(model.persons)
    .filter((id) => !parentsOf(model, id).family && childrenOf(model, id).length)
    .sort((a, b) => born(a) - born(b) || a.localeCompare(b, 'pl', { numeric: true }));
  const nodes = [], links = [];
  let row = 0, trees = 0;
  for (const r of roots) {
    if (seen.has(r)) continue;
    const trial = new Set(seen);
    const lay = layoutDescendants(model, r, maxGen, trial, row);
    if (lay.nodes.length === 1) continue; // partner of someone already drawn: shown as "⚭ name" on that person
    for (const id of trial) seen.add(id);
    const off = nodes.length;
    for (const n of lay.nodes) nodes.push(n);
    for (const [a, b] of lay.links) links.push([a + off, b + off]);
    row = lay.endRow + 0.6; trees++;
  }
  const alone = Object.keys(model.persons).filter((id) => !seen.has(id) && !parentsOf(model, id).family && !childrenOf(model, id).length && !model.persons[id].fams.length).length;
  return { nodes, links, rows: Math.max(row, 1), trees, alone };
}

/** Man / woman pictograms (24x24, Aicher-style): head + body. Used by avatars and the tree board. */
export const PICTO = {
  M: 'M12 1.6a2.7 2.7 0 1 1 0 5.4a2.7 2.7 0 1 1 0-5.4ZM8.8 8h6.4a1.4 1.4 0 0 1 1.4 1.4v6.1h-2v7h-2.1v-6.5h-1v6.5H9.4v-7h-2V9.4A1.4 1.4 0 0 1 8.8 8Z',
  F: 'M12 1.6a2.7 2.7 0 1 1 0 5.4a2.7 2.7 0 1 1 0-5.4ZM9.9 8h4.2a1 1 0 0 1 .95.68L18.6 18h-4.2v4.5h-1.6V18h-1.6v4.5H9.6V18H5.4l3.55-9.32A1 1 0 0 1 9.9 8Z',
};

/** Render a layout to an SVG string (labels escaped). opts.spouse adds a "⚭ partner" line; opts.mark highlights ids. */
export function layoutToSvg(model, lay, { w = 150, gx = 22, gy = 6, spouse = false, mark = null, vertical = false } = {}) {
  const h = spouse ? 46 : 34;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const maxGen = Math.max(0, ...lay.nodes.map((n) => n.gen));
  const maxRow = Math.max(0, ...lay.nodes.map((n) => n.y));
  // horizontal: generations are columns (left -> right); vertical: generations are rows (top -> bottom)
  const vgx = 10, vgy = 34;
  const pos = (n) => (vertical ? { x: 4 + n.y * (w + vgx), y: 4 + n.gen * (h + vgy) } : { x: 4 + n.gen * (w + gx), y: 4 + n.y * (h + gy) });
  const width = vertical ? 4 + maxRow * (w + vgx) + w + 4 : 4 + maxGen * (w + gx) + w + 4;
  const height = vertical ? 4 + maxGen * (h + vgy) + h + 4 : 4 + maxRow * (h + gy) + h + 4;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui,Arial,sans-serif"><rect width="100%" height="100%" fill="#fff"/>`];
  for (const [a, b] of lay.links) {
    const A = pos(lay.nodes[a]), B = pos(lay.nodes[b]);
    if (vertical) {
      const x1 = A.x + w / 2, y1 = A.y + h, x2 = B.x + w / 2, y2 = B.y, my = (y1 + y2) / 2;
      parts.push(`<path d="M${x1} ${y1} V${my} H${x2} V${y2}" fill="none" stroke="#b8a597" stroke-width="1.3"/>`);
    } else {
      const x1 = A.x + w, y1 = A.y + h / 2, x2 = B.x, y2 = B.y + h / 2, mx = (x1 + x2) / 2;
      parts.push(`<path d="M${x1} ${y1} H${mx} V${y2} H${x2}" fill="none" stroke="#b8a597" stroke-width="1.3"/>`);
    }
  }
  for (const n of lay.nodes) {
    const p = model.persons[n.id];
    const { x, y } = pos(n);
    const fill = p.sex === 'F' ? '#f8e0cf' : p.sex === 'M' ? '#e2eadf' : '#e8ecf0';
    const stroke = mark && mark.has(n.id) ? '#c94a24' : p.sex === 'F' ? '#b5603a' : p.sex === 'M' ? '#3f5a46' : '#7d8d9e';
    const sw = mark && mark.has(n.id) ? 3 : 1;
    let sp = '';
    if (spouse) {
      const names = spousesOf(model, n.id).filter((s) => s.spouse).map((s) => displayName(model.persons[s.spouse])).join(', ');
      if (names) sp = `<text x="${x + 8}" y="${y + 41}" font-size="9.5" fill="#c94a24">⚭ ${esc(names.slice(0, 28))}</text>`;
    }
    parts.push(`<g data-id="${esc(n.id)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>` +
      `<text x="${x + 6}" y="${y + 14}" font-size="11" font-weight="600" fill="#111">${esc(displayName(p).slice(0, PICTO[p.sex] ? 22 : 25))}</text>` +
      `<text x="${x + 6}" y="${y + 27}" font-size="9.5" fill="#444">${esc(years(p))}</text>${sp}` +
      (PICTO[p.sex] ? `<path class="pic ${p.sex}" transform="translate(${x + w - 17} ${y + 4}) scale(.55)" fill="${p.sex === 'F' ? '#b5603a' : '#3f5a46'}" d="${PICTO[p.sex]}"/>` : '') + '</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}
