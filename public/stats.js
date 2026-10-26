// Statistics over the family model. Pure; `now` is injectable for tests.
import { parseDate, yearOf } from './dates.js';
import { lifeStatus, isDeceased, fold } from './ops.js';
import { parentsOf, childrenOf, displayName } from './tree.js';

const top = (counts, n = 10) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl')).slice(0, n).map(([name, n]) => ({ name, n }));
const bump = (o, k, by = 1) => { o[k] = (o[k] || 0) + by; };
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const decade = (y) => Math.floor(y / 10) * 10;

export function histogram(years, step = 10) {
  if (!years.length) return [];
  const lo = Math.floor(Math.min(...years) / step) * step, hi = Math.floor(Math.max(...years) / step) * step;
  const out = [];
  for (let d = lo; d <= hi; d += step) out.push({ label: String(d), from: d, n: 0 });
  for (const y of years) out[(Math.floor(y / step) * step - lo) / step].n++;
  return out;
}

/** Longest chain of known ancestors above each person (1 = no known parents). Cycles are cut. */
export function generationDepth(model) {
  const memo = {}, busy = new Set();
  const depth = (id) => {
    if (memo[id] != null) return memo[id];
    if (busy.has(id)) return 1;
    busy.add(id);
    const { father, mother } = parentsOf(model, id);
    const d = 1 + Math.max(0, ...[father, mother].filter((x) => x && model.persons[x]).map(depth));
    busy.delete(id); memo[id] = d; return d;
  };
  for (const id of Object.keys(model.persons)) depth(id);
  return memo;
}

export function computeStats(model, now = new Date()) {
  const P = Object.values(model.persons), F = Object.values(model.families);
  const sex = { M: 0, F: 0, other: 0 };
  const life = { living: 0, 'unknown-living': 0, dead: 0, 'probably-dead': 0 };
  const surnames = {}, given = {}, places = {};
  const births = [], deaths = [], ages = [], marriages = [];
  let bDate = 0, bPlace = 0, dDate = 0, withParents = 0, withPartner = 0, withKids = 0, noName = 0, withMedia = 0;
  for (const p of P) {
    sex[p.sex === 'M' ? 'M' : p.sex === 'F' ? 'F' : 'other']++;
    life[lifeStatus(p, now)]++;
    if (p.surname) bump(surnames, p.surname);
    const g = (p.given || '').split(/\s+/)[0]; if (g) bump(given, g);
    if (!p.given && !p.surname) noName++;
    const by = yearOf(p.birth.date), dy = yearOf(p.death.date);
    if (by != null) { births.push(by); bDate++; }
    if (dy != null) { deaths.push(dy); dDate++; }
    if (p.birth.place) { bPlace++; bump(places, p.birth.place); }
    if (p.death.place) bump(places, p.death.place);
    if (by != null && dy != null && dy >= by && dy - by <= 120) ages.push({ id: p.id, age: dy - by, sex: p.sex });
    if (parentsOf(model, p.id).family) withParents++;
    if (p.fams.some((f) => model.families[f] && (model.families[f].husband && model.families[f].wife))) withPartner++;
    if (childrenOf(model, p.id).length) withKids++;
    if (p._raw?.children.some((c) => c.tag === 'OBJE')) withMedia++;
  }
  for (const f of F) { const y = yearOf(f.marriage.date); if (y != null) marriages.push(y); }

  const sizes = {};
  for (const f of F) bump(sizes, Math.min(f.children.length, 8));
  const withChildFams = F.filter((f) => f.children.length);

  // parent age at birth of a child (known years only)
  const ageAt = { M: [], F: [] };
  for (const f of F) {
    for (const c of f.children) {
      const cy = yearOf(model.persons[c]?.birth.date);
      if (cy == null) continue;
      for (const [role, id] of [['M', f.husband], ['F', f.wife]]) {
        const py = id && yearOf(model.persons[id]?.birth.date);
        if (py && cy - py >= 12 && cy - py <= 70) ageAt[role].push(cy - py);
      }
    }
  }

  const depth = generationDepth(model);
  const maxDepth = Math.max(0, ...Object.values(depth));
  const deepest = Object.keys(depth).find((id) => depth[id] === maxDepth) || null;
  const oldest = ages.length ? ages.reduce((a, b) => (b.age > a.age ? b : a)) : null;
  const ageList = ages.map((a) => a.age);

  return {
    totals: { persons: P.length, families: F.length, sex, life, noName },
    completeness: [
      { key: 'Data urodzenia', n: bDate, pct: pct(bDate, P.length) },
      { key: 'Miejsce urodzenia', n: bPlace, pct: pct(bPlace, P.length) },
      { key: 'Data śmierci (zmarli)', n: dDate, pct: pct(dDate, life.dead + life['probably-dead']) },
      { key: 'Znani rodzice', n: withParents, pct: pct(withParents, P.length) },
      { key: 'Ma partnera', n: withPartner, pct: pct(withPartner, P.length) },
      { key: 'Ma dzieci', n: withKids, pct: pct(withKids, P.length) },
      { key: 'Zdjęcia / media', n: withMedia, pct: pct(withMedia, P.length) },
    ],
    birthsByDecade: histogram(births), deathsByDecade: histogram(deaths), marriagesByDecade: histogram(marriages),
    span: births.length ? { from: Math.min(...births), to: Math.max(...births) } : null,
    lifespan: { n: ageList.length, avg: avg(ageList), median: median(ageList), max: oldest, hist: histogram(ageList, 10),
      avgM: avg(ages.filter((a) => a.sex === 'M').map((a) => a.age)), avgF: avg(ages.filter((a) => a.sex === 'F').map((a) => a.age)) },
    topSurnames: top(surnames), topGiven: top(given), topPlaces: top(places, 8),
    surnameCount: Object.keys(surnames).length,
    family: { avgChildren: avg(withChildFams.map((f) => f.children.length)), childless: F.length - withChildFams.length, sizes: Object.entries(sizes).map(([k, n]) => ({ label: +k === 8 ? '8+' : k, n })).sort((a, b) => parseInt(a.label) - parseInt(b.label)),
      largest: withChildFams.length ? withChildFams.reduce((a, b) => (b.children.length > a.children.length ? b : a)).id : null },
    parentAge: { M: avg(ageAt.M), F: avg(ageAt.F), nM: ageAt.M.length, nF: ageAt.F.length },
    generations: { max: maxDepth, deepest, roots: Object.keys(depth).filter((id) => depth[id] === 1 && childrenOf(model, id).length).length },
  };
}

/** Next birthdays of living people within `days`. */
export function upcomingBirthdays(model, now = new Date(), days = 45) {
  const out = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const p of Object.values(model.persons)) {
    if (isDeceased(p)) continue;
    const d = parseDate(p.birth.date);
    if (!d || !d.month || !d.day) continue;
    for (const yr of [today.getFullYear(), today.getFullYear() + 1]) {
      const next = new Date(yr, d.month - 1, d.day);
      const diff = Math.round((next - today) / 86400000);
      if (diff >= 0) { if (diff <= days && yr - d.year < 111) out.push({ id: p.id, in: diff, turns: yr - d.year, day: d.day, month: d.month }); break; }
    }
  }
  return out.sort((a, b) => a.in - b.in);
}

export { displayName, fold };
