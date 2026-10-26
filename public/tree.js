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

/** Descendants, to the right. */
export function layoutDescendants(model, rootId, maxGen = 6) {
  const nodes = [], links = [];
  let row = 0;
  const walk = (pid, gen, path) => {
    if (path.includes(pid)) return -1;
    const kids = [];
    if (gen < maxGen) for (const c of childrenOf(model, pid)) { const i = walk(c, gen + 1, [...path, pid]); if (i >= 0) kids.push(i); }
    const y = kids.length ? kids.reduce((s, i) => s + nodes[i].y, 0) / kids.length : row++;
    const idx = nodes.push({ id: pid, gen, y }) - 1;
    for (const k of kids) links.push([idx, k]);
    return idx;
  };
  walk(rootId, 0, []);
  return { nodes, links, rows: Math.max(row, 1) };
}

/** Render a layout to an SVG string (labels escaped). */
export function layoutToSvg(model, lay, { w = 180, h = 44, gx = 40, gy = 14, dir = 'right' } = {}) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const maxGen = Math.max(...lay.nodes.map((n) => n.gen));
  const X = (g) => 10 + g * (w + gx);
  const Y = (r) => 10 + r * (h + gy);
  const width = X(maxGen) + w + 10, height = Y(lay.rows - 1) + h + 10;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui,Arial,sans-serif">`];
  // ancestors: parents are drawn to the right (gen grows right); descendants: also right. Same geometry.
  for (const [a, b] of lay.links) {
    const A = lay.nodes[a], B = lay.nodes[b];
    const x1 = X(A.gen) + w, y1 = Y(A.y) + h / 2, x2 = X(B.gen), y2 = Y(B.y) + h / 2, mx = (x1 + x2) / 2;
    parts.push(`<path d="M${x1} ${y1} H${mx} V${y2} H${x2}" fill="none" stroke="#9aa" stroke-width="1.2"/>`);
  }
  for (const n of lay.nodes) {
    const p = model.persons[n.id];
    const fill = p.sex === 'F' ? '#fde4ec' : p.sex === 'M' ? '#dfeafc' : '#eee';
    const stroke = p.sex === 'F' ? '#d37a9a' : p.sex === 'M' ? '#6f95d6' : '#999';
    parts.push(`<g data-id="${esc(n.id)}"><rect x="${X(n.gen)}" y="${Y(n.y)}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}"/>` +
      `<text x="${X(n.gen) + 8}" y="${Y(n.y) + 19}" font-size="13" font-weight="600">${esc(displayName(p).slice(0, 26))}</text>` +
      `<text x="${X(n.gen) + 8}" y="${Y(n.y) + 35}" font-size="11" fill="#555">${esc(years(p))}</text></g>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
