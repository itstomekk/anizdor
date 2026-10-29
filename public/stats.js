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

const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const WEEKDAYS = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
function weekdayIdx(d) {
  if (!d || !d.day || !d.month || d.qual || d.year < 1583) return null;
  const dt = new Date(2000, 0, 1); dt.setFullYear(d.year, d.month - 1, d.day);
  return dt.getMonth() === d.month - 1 ? (dt.getDay() + 6) % 7 : null;
}
const byIndex = (labels, counts) => labels.map((name, i) => ({ name, n: counts[i] || 0 }));

/** Extra statistics: calendar patterns, marriage ages, records. Pure; `now` injectable. */
export function moreStats(model, now = new Date()) {
  const P = model.persons, F = Object.values(model.families);
  const bWd = {}, bMon = {}, dMon = {}, mMon = {}, sameDay = {};
  const givenM = {}, givenF = {}, endings = {};
  const lifeByCentury = {};
  let nWd = 0;
  for (const p of Object.values(P)) {
    const b = parseDate(p.birth.date), d = parseDate(p.death.date);
    const wd = weekdayIdx(b); if (wd != null) { bump(bWd, wd); nWd++; }
    if (b?.month && !b.qual) bump(bMon, b.month - 1);
    if (d?.month && !d.qual) bump(dMon, d.month - 1);
    if (b?.month && b.day && !b.qual) (sameDay[`${b.day}.${b.month}`] ||= []).push(p.id);
    const g = (p.given || '').split(/\s+/)[0];
    if (g) bump(p.sex === 'M' ? givenM : p.sex === 'F' ? givenF : {}, g);
    const s = fold(p.surname || '');
    if (s.length > 3) {
      const e = ['ski', 'cki', 'dzki', 'ska', 'cka', 'dzka', 'wicz', 'owicz', 'ewicz', 'czyk', 'czak', 'ak', 'ek', 'ik', 'uk', 'yk', 'as', 'el'].sort((a, b2) => b2.length - a.length).find((x) => s.endsWith(x));
      const k = !e ? 'inne' : /sk|ck|dzk/.test(e) ? '-ski / -cki' : /wicz/.test(e) ? '-wicz' : /cz[yi]k|czak/.test(e) ? '-czyk / -czak' : /^(ak|ek|ik|uk|yk)$/.test(e) ? '-ak / -ek / -ik / -uk' : 'inne';
      bump(endings, k);
    }
    const by = b?.year, dy = d?.year;
    if (by != null && dy != null && dy >= by && dy - by <= 120) (lifeByCentury[Math.floor(by / 100) * 100] ||= []).push(dy - by);
  }
  // marriages: month, ages, spouse gap, longest marriage
  const firstAge = { M: [], F: [] }, gaps = [];
  let biggestGap = null, longest = null;
  for (const f of F) {
    const md = parseDate(f.marriage.date);
    if (md?.month && !md.qual) bump(mMon, md.month - 1);
    const h = P[f.husband], w = P[f.wife];
    const hy = h && yearOf(h.birth.date), wy = w && yearOf(w.birth.date);
    if (md) for (const [k, py] of [['M', hy], ['F', wy]]) if (py != null && md.year - py >= 14 && md.year - py <= 80) firstAge[k].push(md.year - py);
    if (hy != null && wy != null) { const gp = Math.abs(hy - wy); gaps.push(gp); if (!biggestGap || gp > biggestGap.gap) biggestGap = { gap: gp, fam: f.id }; }
    if (md && h && w) {
      const hd = yearOf(h.death.date), wd = yearOf(w.death.date);
      const alive = !isDeceased(h) && !isDeceased(w);
      const end = alive ? now.getFullYear() : (hd != null && wd != null ? Math.min(hd, wd) : null);
      if (end != null && end >= md.year && end - md.year < 90 && (!longest || end - md.year > longest.years)) longest = { years: end - md.year, fam: f.id, ongoing: alive };
    }
  }
  // records
  let oldestLiving = null, youngestMother = null, youngestFather = null, mostKids = null;
  for (const p of Object.values(P)) {
    const by = yearOf(p.birth.date);
    if (by != null && lifeStatus(p, now) === 'living' && (!oldestLiving || by < oldestLiving.year)) oldestLiving = { id: p.id, year: by, age: now.getFullYear() - by };
    const kids = childrenOf(model, p.id);
    if (!mostKids || kids.length > mostKids.n) mostKids = { id: p.id, n: kids.length };
    if (by != null) for (const c of kids) {
      const cy = yearOf(P[c]?.birth.date); if (cy == null || cy - by < 12 || cy - by > 70) continue;
      const rec = { id: p.id, age: cy - by, child: c };
      if (p.sex === 'F' && (!youngestMother || rec.age < youngestMother.age)) youngestMother = rec;
      if (p.sex === 'M' && (!youngestFather || rec.age < youngestFather.age)) youngestFather = rec;
    }
  }
  const twinsDay = Object.values(sameDay).filter((ids) => ids.length > 1).sort((a, b) => b.length - a.length);
  return {
    birthWeekday: byIndex(WEEKDAYS, bWd), birthWeekdayN: nWd,
    birthMonth: byIndex(MONTHS_SHORT, bMon), deathMonth: byIndex(MONTHS_SHORT, dMon), marriageMonth: byIndex(MONTHS_SHORT, mMon),
    marriageAge: { M: avg(firstAge.M), F: avg(firstAge.F), nM: firstAge.M.length, nF: firstAge.F.length },
    spouseGap: { avg: avg(gaps), n: gaps.length, biggest: biggestGap },
    lifeByCentury: Object.entries(lifeByCentury).sort((a, b) => a[0] - b[0]).map(([c, a]) => ({ name: `ur. ${c}–${+c + 99}`, n: Math.round(avg(a) * 10) / 10, count: a.length })),
    topGivenM: top(givenM, 8), topGivenF: top(givenF, 8), surnameEndings: top(endings, 6),
    sharedBirthdays: twinsDay.slice(0, 6),
    records: { oldestLiving, youngestMother, youngestFather, mostKids: mostKids?.n ? mostKids : null, longestMarriage: longest },
  };
}
