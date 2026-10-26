// Data operations: living/deceased, search folding, merge duplicates, privacy export, CSV.
import { parseDate, yearOf, formatDate } from './dates.js';
import { displayName, parentsOf } from './tree.js';

export function fold(s) {
  return String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const hasEvent = (p, tag) => !!p._raw?.children.some((c) => c.tag === tag);

export function isDeceased(p) {
  return !!(p.death.date || p.death.place || hasEvent(p, 'DEAT') || hasEvent(p, 'BURI'));
}

/** 'dead' | 'living' | 'probably-dead' (born >110 years ago, no death record) | 'unknown-living' (no dates at all) */
export function lifeStatus(p, now = new Date()) {
  if (isDeceased(p)) return 'dead';
  const by = yearOf(p.birth.date);
  if (by == null) return 'unknown-living';
  return now.getFullYear() - by > 110 ? 'probably-dead' : 'living';
}
export const isLiving = (p, now) => ['living', 'unknown-living'].includes(lifeStatus(p, now));

// ---------- merge ----------

/** Merge `dropId` into `keepId`: relations move over, empty fields are filled, the dropped person is removed. */
export function mergePersons(model, keepId, dropId) {
  if (keepId === dropId) return;
  const K = model.persons[keepId], D = model.persons[dropId];
  for (const f of ['given', 'surname', 'suffix', 'sex']) if (!K[f] && D[f]) K[f] = D[f];
  for (const ev of ['birth', 'death']) for (const f of ['date', 'place']) if (!K[ev][f] && D[ev][f]) K[ev][f] = D[ev][f];
  K.notes = [...K.notes, ...D.notes.filter((n) => !K.notes.includes(n))];
  // keep dropped person's unmodelled data (media, burial...) when the keeper has none of that tag
  if (D._raw) {
    K._raw = K._raw || { level: 0, xref: K.id, tag: 'INDI', value: '', children: [] };
    const have = new Set(K._raw.children.map((c) => c.tag));
    for (const c of D._raw.children) if (!['NAME', 'SEX', 'BIRT', 'DEAT', 'FAMC', 'FAMS', 'NOTE', '_UID', 'RIN', '_UPD'].includes(c.tag) && !have.has(c.tag)) K._raw.children.push(c);
  }
  for (const f of Object.values(model.families)) {
    if (f.husband === dropId) f.husband = keepId;
    if (f.wife === dropId) f.wife = keepId;
    f.children = [...new Set(f.children.map((c) => (c === dropId ? keepId : c)))];
  }
  K.famc = [...new Set([...K.famc, ...D.famc])];
  K.fams = [...new Set([...K.fams, ...D.fams])];
  delete model.persons[dropId];
  // families that became identical (same couple) are folded together; self-marriages are dropped
  const seen = new Map();
  for (const f of Object.values(model.families)) {
    if (f.husband && f.husband === f.wife) f.wife = '';
    const key = `${f.husband}|${f.wife}`;
    if (f.husband && f.wife && seen.has(key)) {
      const into = model.families[seen.get(key)];
      into.children = [...new Set([...into.children, ...f.children])];
      for (const f2 of ['date', 'place']) if (!into.marriage[f2] && f.marriage[f2]) into.marriage[f2] = f.marriage[f2];
      for (const p of Object.values(model.persons)) {
        p.fams = [...new Set(p.fams.map((x) => (x === f.id ? into.id : x)))];
        p.famc = [...new Set(p.famc.map((x) => (x === f.id ? into.id : x)))];
      }
      delete model.families[f.id];
    } else seen.set(key, f.id);
  }
  // remove empty families, refresh person links from the families (single source of truth)
  for (const f of Object.values(model.families)) if (!f.husband && !f.wife && !f.children.length) delete model.families[f.id];
  for (const p of Object.values(model.persons)) { p.fams = p.fams.filter((x) => model.families[x]); p.famc = p.famc.filter((x) => model.families[x]); }
  for (const f of Object.values(model.families)) {
    for (const id of [f.husband, f.wife]) if (id && !model.persons[id].fams.includes(f.id)) model.persons[id].fams.push(f.id);
    for (const id of f.children) if (!model.persons[id].famc.includes(f.id)) model.persons[id].famc.push(f.id);
  }
}

// ---------- privacy export ----------

/** Deep-ish copy where living people are anonymised: name -> "Żyjąca osoba", no dates, places, notes, media. */
export function anonymizeLiving(model, now = new Date()) {
  const out = { header: model.header, other: (model.other || []).filter((n) => n.tag === 'HEAD'), persons: {}, families: {} };
  let n = 0;
  for (const p of Object.values(model.persons)) {
    if (isLiving(p, now)) {
      n++;
      out.persons[p.id] = { id: p.id, given: 'Żyjąca', surname: 'osoba', suffix: '', sex: p.sex, birth: { date: '', place: '' }, death: { date: '', place: '' }, famc: [...p.famc], fams: [...p.fams], notes: [] };
    } else out.persons[p.id] = { ...p, birth: { ...p.birth }, death: { ...p.death }, famc: [...p.famc], fams: [...p.fams], notes: [...p.notes] };
  }
  for (const f of Object.values(model.families)) {
    const anyLiving = [f.husband, f.wife].some((id) => id && isLiving(model.persons[id], now));
    out.families[f.id] = { id: f.id, husband: f.husband, wife: f.wife, children: [...f.children], marriage: anyLiving ? { date: '', place: '' } : { ...f.marriage }, _raw: undefined };
  }
  return { model: out, anonymized: n };
}

// ---------- csv ----------

export function toCsv(model) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['ID', 'Imię', 'Nazwisko', 'Płeć', 'Data urodzenia', 'Miejsce urodzenia', 'Data śmierci', 'Miejsce śmierci', 'Ojciec', 'Matka', 'Liczba dzieci']];
  for (const p of Object.values(model.persons)) {
    const { father, mother } = parentsOf(model, p.id);
    const kids = p.fams.reduce((s, f) => s + (model.families[f]?.children.length || 0), 0);
    rows.push([p.id.replace(/@/g, ''), p.given, p.surname, p.sex, formatDate(p.birth.date), p.birth.place, formatDate(p.death.date), p.death.place,
      father ? displayName(model.persons[father]) : '', mother ? displayName(model.persons[mother]) : '', kids]);
  }
  // BOM + semicolons: opens correctly in Polish Excel
  return '\uFEFF' + rows.map((r) => r.map(q).join(';')).join('\r\n') + '\r\n';
}
