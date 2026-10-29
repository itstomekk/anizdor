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

const yearIn = (d) => { const m = String(d || '').match(/\d{4}/); return m ? +m[0] : null; };

/**
 * Birth year per layout node (same order as lay.nodes). Unknown years are estimated from
 * parents/children in the layout (+-gap years) or the death year, and flagged with est = true.
 */
export function nodeYears(model, lay, gap = 28) {
  const out = lay.nodes.map((n) => { const y = yearIn(model.persons[n.id]?.birth?.date); return { year: y, est: y == null }; });
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const [a, b] of lay.links) {
      if (out[b].year == null && out[a].year != null) { out[b].year = out[a].year + gap; changed = true; }
      if (out[a].year == null && out[b].year != null) { out[a].year = out[b].year - gap; changed = true; }
    }
    if (!changed) break;
  }
  lay.nodes.forEach((n, i) => { if (out[i].year == null) { const d = yearIn(model.persons[n.id]?.death?.date); if (d != null) out[i].year = d - 60; } });
  const known = out.filter((o) => o.year != null).map((o) => o.year);
  const base = known.length ? Math.min(...known) : 1900;
  lay.nodes.forEach((n, i) => { if (out[i].year == null) out[i].year = base + n.gen * gap; });
  return out;
}

/**
 * Render a layout to an SVG string (labels escaped).
 * opts.spouse adds a "⚭ partner" line; opts.mark highlights ids; opts.vertical draws generations top -> bottom;
 * opts.timeAxis (vertical only) places each person at the height of their birth year, with a decade scale;
 * opts.offsets = { id: { dx, dy } } moves boxes by hand (export editor); opts.title adds a heading.
 */
export function layoutToSvg(model, lay, { w = 150, gx = 22, gy = 6, spouse = false, mark = null, vertical = false, timeAxis = false, ppy = 4, offsets = null, title = '' } = {}) {
  const h = spouse ? 46 : 34;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const vgx = 10, vgy = 34;
  const time = vertical && timeAxis && lay.nodes.length > 0;
  // raw positions: horizontal = generations are columns (left -> right); vertical = generations are rows (top -> bottom)
  let P = lay.nodes.map((n) => (vertical ? { x: n.y * (w + vgx), y: n.gen * (h + vgy) } : { x: n.gen * (w + gx), y: n.y * (h + gy) }));
  let yrs = null, y0 = 0, y1 = 0;
  if (time) {
    yrs = nodeYears(model, lay);
    y0 = Math.floor(Math.min(...yrs.map((o) => o.year)) / 10) * 10;
    P = P.map((p, i) => ({ x: p.x, y: (yrs[i].year - y0) * ppy }));
    // same column: push a box down when it would overlap the one above it
    const cols = new Map();
    P.forEach((p, i) => { if (!cols.has(p.x)) cols.set(p.x, []); cols.get(p.x).push(i); });
    for (const idx of cols.values()) {
      idx.sort((a, b) => P[a].y - P[b].y);
      for (let k = 1; k < idx.length; k++) { const min = P[idx[k - 1]].y + h + 8; if (P[idx[k]].y < min) P[idx[k]] = { x: P[idx[k]].x, y: min }; }
    }
    y1 = Math.ceil(Math.max(...yrs.map((o) => o.year)) / 10) * 10 + 10;
  }
  if (offsets) P = P.map((p, i) => { const o = offsets[lay.nodes[i].id]; return o ? { x: p.x + o.dx, y: p.y + o.dy } : p; });
  const left = time ? 46 : 4, top = 4 + (title ? 34 : 0);
  const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
  // with hand offsets keep the automatic origin, so dragging one box never shifts the others
  const minX = xs.length ? Math.min(offsets ? 0 : Infinity, ...xs) : 0, maxX = xs.length ? Math.max(...xs) : 0;
  const minY = time || offsets ? Math.min(0, ...ys) : ys.length ? Math.min(...ys) : 0, maxY = ys.length ? Math.max(...ys) : 0;
  const pos = P.map((p) => ({ x: p.x - minX + left, y: p.y - minY + top }));
  let width = maxX - minX + w + left + 4, height = maxY - minY + h + top + 4;
  if (time) height = Math.max(height, (y1 - y0) * ppy - minY + top + 4);
  if (title) width = Math.max(width, Math.min(900, 14 * title.length) + 8);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui,Arial,sans-serif"><rect width="100%" height="100%" fill="#fff"/>`];
  if (title) parts.push(`<text x="${left}" y="26" font-size="22" font-weight="700" fill="#111">${esc(title)}</text>`);
  const axisLabels = [];
  if (time) {
    for (let yr = y0; yr <= y1; yr += 10) {
      const y = (yr - y0) * ppy - minY + top;
      if (y > height) break;
      parts.push(`<line class="axis" x1="${left - 6}" y1="${y}" x2="${width}" y2="${y}" stroke="#e7ded6" stroke-width="${yr % 50 ? 0.6 : 1.2}"/>`);
      axisLabels.push(`<rect x="1" y="${y - 7}" width="30" height="13" rx="3" fill="#fff" fill-opacity=".85"/><text x="4" y="${y + 4}" font-size="10" fill="#8a7b70">${yr}</text>`);
    }
  }
  for (const [a, b] of lay.links) {
    const A = pos[a], B = pos[b];
    if (vertical) {
      const x1 = A.x + w / 2, y1 = A.y + h, x2 = B.x + w / 2, y2 = B.y;
      const my = time ? Math.min(y1 + 12, y2 - 4) : (y1 + y2) / 2;
      parts.push(`<path d="M${x1} ${y1} V${my} H${x2} V${y2}" fill="none" stroke="#b8a597" stroke-width="1.3"/>`);
    } else {
      const x1 = A.x + w, y1 = A.y + h / 2, x2 = B.x, y2 = B.y + h / 2, mx = (x1 + x2) / 2;
      parts.push(`<path d="M${x1} ${y1} H${mx} V${y2} H${x2}" fill="none" stroke="#b8a597" stroke-width="1.3"/>`);
    }
  }
  lay.nodes.forEach((n, i) => {
    const p = model.persons[n.id];
    const { x, y } = pos[i];
    const fill = p.sex === 'F' ? '#f8e0cf' : p.sex === 'M' ? '#e2eadf' : '#e8ecf0';
    const stroke = mark && mark.has(n.id) ? '#c94a24' : p.sex === 'F' ? '#b5603a' : p.sex === 'M' ? '#3f5a46' : '#7d8d9e';
    const sw = mark && mark.has(n.id) ? 3 : 1;
    const est = yrs && yrs[i].est;
    let sp = '';
    if (spouse) {
      const names = spousesOf(model, n.id).filter((s) => s.spouse).map((s) => displayName(model.persons[s.spouse])).join(', ');
      if (names) sp = `<text x="${x + 8}" y="${y + 41}" font-size="9.5" fill="#c94a24">⚭ ${esc(names.slice(0, 28))}</text>`;
    }
    parts.push(`<g data-id="${esc(n.id)}">${est ? '<title>Rok urodzenia nieznany: miejsce na osi jest szacowane</title>' : ''}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${est ? ' stroke-dasharray="4 3"' : ''}/>` +
      `<text x="${x + 6}" y="${y + 14}" font-size="11" font-weight="600" fill="#111">${esc(displayName(p).slice(0, PICTO[p.sex] ? 22 : 25))}</text>` +
      `<text x="${x + 6}" y="${y + 27}" font-size="9.5" fill="#444">${esc(years(p))}</text>${sp}` +
      (PICTO[p.sex] ? `<path class="pic ${p.sex}" transform="translate(${x + w - 17} ${y + 4}) scale(.55)" fill="${p.sex === 'F' ? '#b5603a' : '#3f5a46'}" d="${PICTO[p.sex]}"/>` : '') + '</g>');
  });
  // year labels on top of everything; the app keeps this group pinned to the left edge while scrolling
  if (axisLabels.length) parts.push(`<g class="yearlabels">${axisLabels.join('')}</g>`);
  parts.push('</svg>');
  return parts.join('');
}
