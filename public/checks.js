// Data-quality checks. Each issue: {sev:'err'|'warn'|'info', code, ids:[personIds], text}.
import { yearOf, parseDate } from './dates.js';
import { parentsOf, displayName } from './tree.js';
import { generationDepth } from './stats.js';
import { validate } from './gedcom.js';
import { fold } from './ops.js';

function context(model, id) {
  const pa = parentsOf(model, id);
  const bits = [];
  const nm = (x) => displayName(model.persons[x]);
  const par = [pa.father, pa.mother].filter(Boolean);
  if (par.length) bits.push('dziecko: ' + par.map(nm).join(' i '));
  const sp = (model.persons[id].fams || []).map((f) => model.families[f]).filter(Boolean);
  const partner = sp.map((f) => (f.husband === id ? f.wife : f.husband)).filter(Boolean);
  if (partner.length) bits.push('partner: ' + partner.map(nm).join(', '));
  const kids = sp.flatMap((f) => f.children);
  if (kids.length) bits.push('dzieci: ' + kids.slice(0, 3).map(nm).join(', ') + (kids.length > 3 ? '…' : ''));
  return bits.join('; ') || 'bez powiązań';
}

const nameKey = (p) => fold(`${p.given} ${p.surname}`).replace(/\s+/g, ' ').trim();

export function findDuplicateGroups(model) {
  const groups = {};
  for (const p of Object.values(model.persons)) {
    const k = nameKey(p);
    if (!k || k === '...' || /^\.+$/.test(k.replace(/\s/g, ''))) continue;
    (groups[k] ||= []).push(p.id);
  }
  const out = [];
  for (const ids of Object.values(groups)) {
    if (ids.length < 2) continue;
    // split a same-name group by birth year: different known years are different people
    const byYear = {};
    for (const id of ids) { const y = yearOf(model.persons[id].birth.date); (byYear[y ?? '?'] ||= []).push(id); }
    const unknown = byYear['?'] || [];
    for (const [y, list] of Object.entries(byYear)) {
      if (y === '?') continue;
      const members = [...list, ...unknown];
      if (members.length > 1) out.push({ ids: members, strong: list.length > 1 || (unknown.length > 0 && list.length === 1 ? false : true), name: displayName(model.persons[ids[0]]) });
    }
    if (!Object.keys(byYear).some((y) => y !== '?') && unknown.length > 1) out.push({ ids: unknown, strong: false, name: displayName(model.persons[unknown[0]]) });
  }
  // dedupe identical id sets
  const seen = new Set();
  return out.filter((g) => { const k = [...g.ids].sort().join(); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function runChecks(model, now = new Date()) {
  const issues = [];
  const add = (sev, code, ids, text) => issues.push({ sev, code, ids, text });
  const P = model.persons;
  const nm = (id) => displayName(P[id]);

  for (const msg of validate(model)) add('err', 'ref', [], `Uszkodzone powiązanie w pliku: ${msg.replace('missing person', 'brak osoby').replace('missing family', 'brak rodziny').replace(/@/g, '')}`);

  const depth = generationDepth(model);
  for (const p of Object.values(P)) {
    const by = yearOf(p.birth.date), dy = yearOf(p.death.date);
    if (!p.given && !p.surname) add('warn', 'noname', [p.id], `Osoba bez imienia i nazwiska (ID ${p.id.replace(/@/g, '')}; ${context(model, p.id)})`);
    if (by != null && dy != null && dy < by) add('err', 'death-before-birth', [p.id], `${nm(p.id)}: śmierć (${dy}) przed urodzeniem (${by})`);
    if (by != null && dy != null && dy - by > 110) add('warn', 'too-old', [p.id], `${nm(p.id)}: wiek ${dy - by} lat, sprawdź daty`);
    if (!p.famc.length && !p.fams.length) add('info', 'isolated', [p.id], `${nm(p.id)}: osoba bez żadnych powiązań rodzinnych`);
    const pa = parentsOf(model, p.id);
    for (const [role, id] of [['ojciec', pa.father], ['matka', pa.mother]]) {
      if (!id || !P[id]) continue;
      const py = yearOf(P[id].birth.date), pd = yearOf(P[id].death.date);
      if (by != null && py != null) {
        if (by < py) add('err', 'child-before-parent', [p.id, id], `${nm(p.id)} (ur. ${by}) urodzony przed swoim rodzicem: ${role} ${nm(id)} (ur. ${py})`);
        else if (by - py < 14) add('warn', 'parent-young', [p.id, id], `${nm(id)} miał(a) ${by - py} lat przy narodzinach dziecka ${nm(p.id)}`);
        else if (role === 'matka' && by - py > 50) add('warn', 'mother-old', [p.id, id], `${nm(id)} miała ${by - py} lat przy narodzinach dziecka ${nm(p.id)}`);
        else if (role === 'ojciec' && by - py > 80) add('warn', 'father-old', [p.id, id], `${nm(id)} miał ${by - py} lat przy narodzinach dziecka ${nm(p.id)}`);
      }
      if (by != null && pd != null && (role === 'matka' ? pd < by : pd < by - 1)) add('err', 'parent-dead', [p.id, id], `${nm(id)} zmarł(a) (${pd}) przed narodzinami dziecka ${nm(p.id)} (${by})`);
    }
    if (depth[p.id] > 40) add('err', 'cycle', [p.id], `${nm(p.id)}: pętla w rodowodzie`);
  }
  for (const f of Object.values(model.families)) {
    const h = P[f.husband], w = P[f.wife];
    if (h && h.sex === 'F' && w && w.sex === 'M') add('info', 'swapped-sex', [h.id, w.id], `Rodzina ${nm(h.id)} + ${nm(w.id)}: płcie wyglądają na zamienione`);
    const my = yearOf(f.marriage.date);
    if (my != null) for (const x of [h, w]) { const y = x && yearOf(x.birth.date); if (y != null && my - y < 14) add('warn', 'marriage-young', [x.id], `${nm(x.id)}: ślub w ${my}, urodzony(a) w ${y}`); }
    if (!f.children.length && (!f.husband || !f.wife)) add('info', 'empty-family', [f.husband || f.wife].filter(Boolean), 'Rodzina z jedną osobą i bez dzieci');
    // siblings born less than 8 months apart and different years are fine; twins fine. Flag same mother with births < 8 months apart not twins:
    const kids = f.children.map((c) => ({ id: c, d: parseDate(P[c]?.birth.date) })).filter((k) => k.d?.month);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].d, b = kids[j].d, gap = Math.abs((a.year * 12 + a.month) - (b.year * 12 + b.month));
      if (gap > 0 && gap < 8 && a.day && b.day) add('info', 'close-births', [kids[i].id, kids[j].id], `${nm(kids[i].id)} i ${nm(kids[j].id)}: urodzeni w odstępie ${gap} mies.`);
    }
  }
  for (const g of findDuplicateGroups(model)) add(g.strong ? 'warn' : 'info', 'dup', g.ids, `${g.strong ? 'Prawdopodobny duplikat' : 'Możliwy duplikat'}: ${g.name} (${g.ids.length} osoby)`);
  const order = { err: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.sev] - order[b.sev] || a.code.localeCompare(b.code));
}

// ---------- repairs ----------
/** Issue codes that can be fixed without human judgement (safe for "fix all"). */
export const SAFE_FIXES = new Set(['ref', 'swapped-sex', 'empty-family']);
/** Codes with a one-click fix that needs confirmation per issue. */
export const FIX_LABEL = { ref: 'Usuń zerwane powiązania', 'swapped-sex': 'Zamień role w rodzinie', 'empty-family': 'Usuń pustą rodzinę', 'death-before-birth': 'Zamień daty urodzenia i śmierci' };
export const canFix = (i) => i.code in FIX_LABEL;

/** Drop references to persons/families that do not exist. Returns number of removed references. */
export function repairRefs(model) {
  let n = 0;
  for (const f of Object.values(model.families)) {
    for (const r of ['husband', 'wife']) if (f[r] && !model.persons[f[r]]) { f[r] = ''; n++; }
    const before = f.children.length; f.children = f.children.filter((c) => model.persons[c]); n += before - f.children.length;
  }
  for (const p of Object.values(model.persons)) {
    for (const k of ['famc', 'fams']) { const before = p[k].length; p[k] = p[k].filter((x) => model.families[x]); n += before - p[k].length; }
  }
  return n;
}

const familiesOf = (model, ids) => Object.values(model.families).filter((f) => ids.every((id) => f.husband === id || f.wife === id));

/** Apply the fix for one issue. Returns true if something changed. */
export function fixIssue(model, issue) {
  const P = model.persons;
  switch (issue.code) {
    case 'ref': return repairRefs(model) > 0;
    case 'swapped-sex': {
      let ch = false;
      for (const f of familiesOf(model, issue.ids)) if (P[f.husband]?.sex === 'F' && P[f.wife]?.sex === 'M') { [f.husband, f.wife] = [f.wife, f.husband]; ch = true; }
      return ch;
    }
    case 'empty-family': {
      let ch = false;
      for (const f of Object.values(model.families)) {
        const members = [f.husband, f.wife].filter(Boolean);
        if (f.children.length || members.length !== 1 || members[0] !== issue.ids[0]) continue;
        delete model.families[f.id]; ch = true;
        for (const p of Object.values(P)) { p.fams = p.fams.filter((x) => x !== f.id); p.famc = p.famc.filter((x) => x !== f.id); }
      }
      return ch;
    }
    case 'death-before-birth': {
      const p = P[issue.ids[0]]; if (!p) return false;
      [p.birth.date, p.death.date] = [p.death.date, p.birth.date]; return true;
    }
    default: return false;
  }
}

/** Fix every issue whose code is in SAFE_FIXES. Returns number of fixed issues. */
export function fixAllSafe(model, issues) {
  let n = 0;
  for (const i of issues) if (SAFE_FIXES.has(i.code) && fixIssue(model, i)) n++;
  return n;
}
