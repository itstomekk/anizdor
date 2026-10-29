// "Uzupełnij braki": the most important missing facts as a short form, so a family member can fill them in one go.
import { el } from './ui.js';
import { displayName, years, parentsOf, spousesOf, childrenOf } from './tree.js';
import { yearOf, toGedcomDate } from './dates.js';
import { lifeStatus } from './ops.js';

/** Question kinds, most valuable first. weight decides the order; ask(p) is the question shown to the user. */
export const KINDS = [
  { field: 'given', name: 'imię', weight: 10, ask: () => 'Jak miał(a) na imię?' },
  { field: 'birth.date', name: 'data urodzenia', weight: 9, ask: (p) => `Kiedy ${p.sex === 'F' ? 'urodziła' : p.sex === 'M' ? 'urodził' : 'urodził(a)'} się? (wystarczy rok)` },
  { field: 'surname', name: 'nazwisko', weight: 8, ask: (p) => (p.sex === 'F' ? 'Jakie nazwisko (panieńskie)?' : 'Jakie nazwisko?') },
  { field: 'death.date', name: 'data śmierci', weight: 6, ask: (p) => `Kiedy ${p.sex === 'F' ? 'zmarła' : p.sex === 'M' ? 'zmarł' : 'zmarł(a)'}? (wystarczy rok)` },
  { field: 'sex', name: 'płeć', weight: 5, ask: () => 'Mężczyzna czy kobieta?' },
  { field: 'birth.place', name: 'miejsce urodzenia', weight: 4, ask: () => 'Gdzie się urodził(a)?' },
  { field: 'death.place', name: 'miejsce śmierci', weight: 2, ask: () => 'Gdzie zmarł(a)?' },
];
const get = (p, f) => f.split('.').reduce((o, k) => (o ? o[k] : ''), p) || '';
const set = (p, f, v) => { const [a, b] = f.split('.'); if (b) p[a][b] = v; else p[a] = v; };
const isDate = (f) => f.endsWith('.date');

/** Is this fact missing for this person? Death facts are asked only for people who are (probably) dead. */
export function isMissing(p, field, now = new Date()) {
  const v = get(p, field).trim();
  if (field === 'sex') return !['M', 'F'].includes(p.sex);
  if (field.startsWith('death.')) { const s = lifeStatus(p, now); if (s !== 'dead' && s !== 'probably-dead') return false; }
  if (isDate(field)) return yearOf(v) == null;
  return !v;
}

/**
 * All open questions, best first. Better = more important kind, then people with more relatives (easier to place
 * and more useful to know), then older people. skipped = Set of `${id}:${field}` the user marked "nie wiem".
 */
export function missingQuestions(model, { skipped = new Set(), now = new Date(), kinds = null } = {}) {
  const out = [];
  for (const p of Object.values(model.persons)) {
    const rel = Object.values(parentsOf(model, p.id)).filter((x) => typeof x === 'string' && model.persons[x]).length + spousesOf(model, p.id).filter((s) => s.spouse).length + childrenOf(model, p.id).length;
    for (const k of KINDS) {
      if (kinds && !kinds.has(k.field)) continue;
      if (skipped.has(`${p.id}:${k.field}`) || !isMissing(p, k.field, now)) continue;
      out.push({ id: p.id, field: k.field, kind: k, score: k.weight * 100 + Math.min(rel, 20) * 3 });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'pl', { numeric: true }));
}

/** Short description that helps to recognise the person: years, parents, partner, children. */
export function whoIs(model, id) {
  const p = model.persons[id];
  const { father, mother } = parentsOf(model, id);
  const name = (x) => displayName(model.persons[x]);
  const bits = [];
  if (years(p)) bits.push(years(p));
  const par = [father, mother].filter((x) => x && model.persons[x]).map(name);
  if (par.length) bits.push(`${p.sex === 'F' ? 'córka' : p.sex === 'M' ? 'syn' : 'dziecko'}: ${par.join(' i ')}`);
  const sp = spousesOf(model, id).map((s) => s.spouse).filter(Boolean).map(name);
  if (sp.length) bits.push(`${p.sex === 'F' ? 'żona' : p.sex === 'M' ? 'mąż' : 'partner'}: ${sp.join(', ')}`);
  const kids = childrenOf(model, id);
  if (kids.length) bits.push(`dzieci: ${kids.slice(0, 3).map(name).join(', ')}${kids.length > 3 ? ` i ${kids.length - 3} więcej` : ''}`);
  return bits.join(' · ');
}

const SKIP_KEY = 'anizdor.missingSkip';
const loadSkip = () => { try { return new Set(JSON.parse(localStorage.getItem(SKIP_KEY) || '[]')); } catch { return new Set(); } };
const saveSkip = (s) => { try { localStorage.setItem(SKIP_KEY, JSON.stringify([...s])); } catch {} };
const PAGE = 12;

/** ctx: { model(), mutate(fn), goPerson(id), say(t), ui } */
export function viewMissing(main, ctx) {
  const m = ctx.model(), ui = ctx.ui;
  const skipped = loadSkip();
  ui.missKinds ||= new Set(KINDS.map((k) => k.field));
  const all = missingQuestions(m, { skipped });
  const counts = Object.fromEntries(KINDS.map((k) => [k.field, 0]));
  for (const q of all) counts[q.field]++;
  const list = all.filter((q) => ui.missKinds.has(q.field)).slice(0, PAGE);

  const chips = el('div', { class: 'row miss-kinds' }, KINDS.map((k) => el('label', { class: 'inl' + (counts[k.field] ? '' : ' mut') },
    el('input', { type: 'checkbox', checked: ui.missKinds.has(k.field), onchange: (e) => { if (e.target.checked) ui.missKinds.add(k.field); else ui.missKinds.delete(k.field); viewMissing(main, ctx); } }),
    `${k.name} (${counts[k.field]})`)));

  const rows = list.map((q) => {
    const p = m.persons[q.id];
    let input;
    if (q.field === 'sex') input = el('select', {}, [['', 'wybierz…'], ['M', 'mężczyzna'], ['F', 'kobieta']].map(([v, t]) => el('option', { value: v }, t)));
    else input = el('input', { type: 'text', placeholder: isDate(q.field) ? 'np. 1932, 12.03.1932, ok. 1930' : q.field.endsWith('place') ? 'miejscowość' : '', autocomplete: 'off' });
    const dunno = el('input', { type: 'checkbox', title: 'Nikt nie pamięta: nie pytaj więcej o to' });
    return { q, input, dunno, node: el('div', { class: 'miss-row' },
      el('div', { class: 'miss-who' }, el('a', { onclick: () => ctx.goPerson(q.id) }, displayName(p)), el('div', { class: 'mut' }, whoIs(m, q.id))),
      el('label', { class: 'miss-q' }, el('span', {}, q.kind.ask(p)), input),
      el('label', { class: 'inl mut miss-dunno' }, dunno, 'nie wiem')) };
  });

  const save = () => {
    let n = 0, s = 0;
    const filled = rows.filter((r) => r.input.value.trim());
    // skips first: mutate() below re-renders this view and must already see them
    for (const r of rows) if (!r.input.value.trim() && r.dunno.checked) { skipped.add(`${r.q.id}:${r.q.field}`); s++; }
    if (s) saveSkip(skipped);
    if (filled.length) ctx.mutate(() => { for (const r of filled) { const v = r.input.value.trim(); set(m.persons[r.q.id], r.q.field, isDate(r.q.field) ? toGedcomDate(v) : v); n++; } });
    ctx.say(n || s ? `Zapisano odpowiedzi: ${n}${s ? `, pominięte na stałe: ${s}` : ''}.${n ? ' Cofnij: Ctrl+Z.' : ''}` : 'Nic nie wpisano.');
    // mutate() re-renders the view by itself; without edits redraw here
    if (!filled.length) viewMissing(main, ctx);
    document.getElementById('main')?.scrollIntoView({ block: 'start' });
  };

  main.replaceChildren(el('div', { class: 'card', style: 'margin-top:.3rem' },
    el('h2', {}, 'Uzupełnij braki'),
    el('p', { class: 'mut' }, `Najważniejsze brakujące informacje, po ${PAGE} naraz. Dobre do rozmowy z rodzicami lub dziadkami: wpisz, co pamiętają, resztę zostaw pustą. „Nie wiem” chowa pytanie na stałe.`),
    chips,
    list.length ? el('form', { class: 'miss', onsubmit: (e) => { e.preventDefault(); save(); } },
      rows.map((r) => r.node),
      el('div', { class: 'row', style: 'margin-top:.8rem' }, el('button', { class: 'primary', type: 'submit' }, 'Zapisz i pokaż następne'),
        el('span', { class: 'mut' }, `Otwartych pytań: ${all.filter((q) => ui.missKinds.has(q.field)).length}`),
        skipped.size ? el('button', { type: 'button', onclick: () => { if (confirm(`Przywrócić ${skipped.size} pytań oznaczonych „nie wiem”?`)) { saveSkip(new Set()); viewMissing(main, ctx); } } }, `Przywróć pominięte (${skipped.size})`) : null))
      : el('p', {}, all.length ? 'Zaznacz rodzaj informacji powyżej.' : 'Brak otwartych pytań. Wszystko, o co umiem zapytać, jest uzupełnione.')));
  rows[0]?.input.focus({ preventScroll: true });
}
