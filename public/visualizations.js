// Pure layout code for the interactive views (ancestor fan, family "galaxy"). No DOM, no network.
import { parentsOf, childrenOf, spousesOf } from './tree.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- ancestor fan
/**
 * Ahnentafel-style fan. Cell (gen g, index k) has father (g+1, 2k) and mother (g+1, 2k+1).
 * Angles are radians, clockwise from the top. `start`/`sweep` pick a full circle or a half fan.
 * Unknown parents become `empty` cells (never invented people). An ancestor met a second time
 * (cousin marriages) is flagged `repeat`; a person who is their own ancestor is flagged `loop` and not expanded.
 */
export function fanLayout(model, rootId, depth = 5, { start = 0, sweep = TAU } = {}) {
  const cells = [];
  const seen = new Map();
  const maxDepth = Math.max(1, Math.min(10, depth | 0));
  const walk = (pid, gen, k, path) => {
    const n = 2 ** gen;
    const cell = { key: `${gen}:${k}`, id: pid, gen, k, a0: start + (k / n) * sweep, a1: start + ((k + 1) / n) * sweep, empty: false, repeat: false, loop: false };
    cells.push(cell);
    if (seen.has(pid)) cell.repeat = true; else seen.set(pid, cell.key);
    if (gen >= maxDepth) return;
    const { father, mother } = parentsOf(model, pid);
    [father, mother].forEach((par, i) => {
      const kk = k * 2 + i;
      if (par && model.persons[par]) {
        if (path.includes(par) || par === pid) {
          const m = 2 ** (gen + 1);
          cells.push({ key: `${gen + 1}:${kk}`, id: par, gen: gen + 1, k: kk, a0: start + (kk / m) * sweep, a1: start + ((kk + 1) / m) * sweep, empty: false, repeat: false, loop: true });
        } else walk(par, gen + 1, kk, [...path, pid]);
      } else {
        const m = 2 ** (gen + 1);
        cells.push({ key: `${gen + 1}:${kk}`, id: null, gen: gen + 1, k: kk, a0: start + (kk / m) * sweep, a1: start + ((kk + 1) / m) * sweep, empty: true, repeat: false, loop: false });
      }
    });
  };
  if (rootId && model.persons[rootId]) walk(rootId, 0, 0, []);
  const known = cells.filter((c) => c.id && !c.loop);
  const perGen = [];
  for (const c of cells) { const g = (perGen[c.gen] ||= { gen: c.gen, known: 0, empty: 0 }); if (c.empty) g.empty++; else if (!c.loop) g.known++; }
  return { cells, depth: maxDepth, distinct: new Set(known.map((c) => c.id)).size, known: known.length, repeats: cells.filter((c) => c.repeat).length, perGen: perGen.filter(Boolean) };
}

/** SVG path of an annular sector. Angle 0 = up, clockwise. A full ring is drawn as two arcs. */
export function arcPath(cx, cy, r0, r1, a0, a1) {
  const pt = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const f = (n) => Math.round(n * 100) / 100;
  const span = a1 - a0;
  if (span >= TAU - 1e-6) {
    const d = (r) => `M${f(cx)} ${f(cy - r)}A${f(r)} ${f(r)} 0 1 1 ${f(cx)} ${f(cy + r)}A${f(r)} ${f(r)} 0 1 1 ${f(cx)} ${f(cy - r)}`;
    return r0 <= 0 ? `${d(r1)}Z` : `${d(r1)}${d(r0)}`; // ring: evenodd fill rule hollows it
  }
  const large = span > Math.PI ? 1 : 0;
  const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
  if (r0 <= 0) return `M${f(cx)} ${f(cy)}L${f(x0)} ${f(y0)}A${f(r1)} ${f(r1)} 0 ${large} 1 ${f(x1)} ${f(y1)}Z`;
  return `M${f(x0)} ${f(y0)}A${f(r1)} ${f(r1)} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${f(r0)} ${f(r0)} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
}

/** Radii for ring `gen`: centre disc, then equal-ish rings that get slightly thinner outwards. */
export function ringRadii(gen, { centre = 62, ring = 78, shrink = 0.94 } = {}) {
  if (gen === 0) return [0, centre];
  let r = centre;
  for (let g = 1; g < gen; g++) r += ring * shrink ** (g - 1);
  return [r, r + ring * shrink ** (gen - 1)];
}

// ---------------------------------------------------------------- family galaxy
/**
 * Neighbourhood graph around `focusId`. A parent or child costs one hop; a partner costs none
 * (couples stay together). dir: 'all' | 'anc' (only upwards) | 'desc' (only downwards, plus partners).
 * Capped at `max` people (nearest first); `truncated` tells the caller.
 */
export function galaxyGraph(model, focusId, { hops = 3, dir = 'all', max = 220 } = {}) {
  if (!focusId || !model.persons[focusId]) return { nodes: [], edges: [], truncated: false, total: 0 };
  const dist = new Map([[focusId, 0]]);
  const order = [focusId];
  const queue = [focusId];
  // 0-1 BFS: partners at cost 0 are pushed to the front.
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(cur);
    const step = [];
    for (const s of spousesOf(model, cur)) if (s.spouse && model.persons[s.spouse]) step.push([s.spouse, 0]);
    if (d < hops) {
      if (dir !== 'desc') { const { father, mother } = parentsOf(model, cur); for (const x of [father, mother]) if (x && model.persons[x]) step.push([x, 1]); }
      if (dir !== 'anc') for (const c of childrenOf(model, cur)) step.push([c, 1]);
    }
    for (const [x, c] of step) {
      const nd = d + c;
      if (!dist.has(x)) { dist.set(x, nd); order.push(x); if (c === 0) queue.unshift(x); else queue.push(x); }
      else if (nd < dist.get(x)) { dist.set(x, nd); if (c === 0) queue.unshift(x); else queue.push(x); }
    }
  }
  const total = order.length;
  const keep = order.slice().sort((a, b) => dist.get(a) - dist.get(b) || order.indexOf(a) - order.indexOf(b)).slice(0, max);
  const inSet = new Set(keep);
  const nodes = keep.map((id) => ({ id, d: dist.get(id), x: 0, y: 0, deg: 0 }));
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = [], seen = new Set();
  const add = (a, b, kind) => {
    if (!inSet.has(a) || !inSet.has(b) || a === b) return;
    const key = kind + (a < b ? `${a}|${b}` : `${b}|${a}`) + (kind === 'child' ? `>${a}` : '');
    if (seen.has(key)) return;
    seen.add(key); edges.push({ a: idx.get(a), b: idx.get(b), kind }); nodes[idx.get(a)].deg++; nodes[idx.get(b)].deg++;
  };
  for (const f of Object.values(model.families)) {
    if (f.husband && f.wife) add(f.husband, f.wife, 'spouse');
    for (const c of f.children) for (const p of [f.husband, f.wife]) if (p) add(p, c, 'child');
  }
  return { nodes, edges, truncated: total > keep.length, total };
}

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/**
 * Deterministic force layout (same input, same picture). Starts from rings by distance so the result
 * looks like a galaxy: focus in the centre, relatives in orbits, couples side by side.
 * Mutates nodes[].x/y and returns the bounding box.
 */
export function layoutGalaxy(graph, { iterations = 260, ring = 150, seed = 7 } = {}) {
  const { nodes, edges } = graph;
  const n = nodes.length;
  if (!n) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  const rand = rng(seed);
  const byD = new Map();
  nodes.forEach((nd, i) => { (byD.get(nd.d) || byD.set(nd.d, []).get(nd.d)).push(i); });
  for (const [d, list] of byD) {
    list.forEach((i, j) => {
      if (d === 0 && list.length === 1) { nodes[i].x = 0; nodes[i].y = 0; return; }
      const a = (j / list.length) * TAU + d * 0.6 + rand() * 0.3, r = (d === 0 ? 0.35 : d) * ring * (0.9 + rand() * 0.2);
      nodes[i].x = Math.sin(a) * r; nodes[i].y = -Math.cos(a) * r;
    });
  }
  const k = 58;
  const vx = new Float64Array(n), vy = new Float64Array(n);
  let temp = ring * 0.5;
  for (let it = 0; it < iterations; it++) {
    vx.fill(0); vy.fill(0);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
      let d2 = dx * dx + dy * dy;
      if (d2 > 90000) continue; // beyond 300px nothing happens: keeps big graphs fast
      if (d2 < 0.01) { dx = rand() - 0.5; dy = rand() - 0.5; d2 = dx * dx + dy * dy + 0.01; }
      const d = Math.sqrt(d2), f = (k * k) / d / d;
      vx[i] += dx * f; vy[i] += dy * f; vx[j] -= dx * f; vy[j] -= dy * f;
    }
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const ideal = e.kind === 'spouse' ? 34 : 80;
      const f = ((d - ideal) / d) * (e.kind === 'spouse' ? 0.45 : 0.12);
      vx[e.a] += dx * f; vy[e.a] += dy * f; vx[e.b] -= dx * f; vy[e.b] -= dy * f;
    }
    for (let i = 0; i < n; i++) { // orbit gravity
      const nd = nodes[i], r = Math.sqrt(nd.x * nd.x + nd.y * nd.y) || 0.01, target = nd.d === 0 ? 0 : nd.d * ring * 0.8;
      const g = ((target - r) / r) * 0.06;
      vx[i] += nd.x * g; vy[i] += nd.y * g;
    }
    for (let i = 0; i < n; i++) {
      const m = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]) || 1, s = Math.min(m, temp) / m;
      nodes[i].x += vx[i] * s; nodes[i].y += vy[i] * s;
    }
    temp = Math.max(1.2, temp * 0.97);
  }
  const ox = nodes[0].x, oy = nodes[0].y; // nodes[0] is the focus: back to the origin
  for (const nd of nodes) { nd.x = Math.round((nd.x - ox) * 10) / 10; nd.y = Math.round((nd.y - oy) * 10) / 10; }
  return bbox(nodes);
}

export function bbox(nodes, pad = 60) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); }
  if (!isFinite(minX)) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}

/** Keep a pan/zoom state {cx, cy, s} sane: scale within [fitS*0.4, fitS*30], centre inside the picture's box. */
export function clampView(v, box, fitS) {
  const s = Math.min(fitS * 30, Math.max(fitS * 0.4, v.s));
  return { s, cx: Math.min(box.maxX, Math.max(box.minX, v.cx)), cy: Math.min(box.maxY, Math.max(box.minY, v.cy)) };
}

/** "completeness" bucket for colouring: full = birth date and place known, part = one of them, none = neither. */
export function dataLevel(p) {
  const d = !!(p.birth && p.birth.date), pl = !!(p.birth && p.birth.place);
  return d && pl ? 'full' : d || pl ? 'part' : 'none';
}
