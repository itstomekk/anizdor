// Reports: printable HTML documents (opened in a new tab/print dialog) and Markdown-ish plain text. All strings are escaped.
import { displayName, parentsOf, childrenOf, spousesOf, years } from './tree.js';
import { formatLong, formatDate } from './dates.js';
import { timelineFor, EVENT_TYPES } from './extras.js';
import { relate } from './kin.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `body{font:14px/1.5 Georgia,serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#111}h1{font-size:1.6rem;margin:.2rem 0}h2{font-size:1.15rem;border-bottom:1px solid #999;margin:1.4rem 0 .4rem}h3{font-size:1rem;margin:1rem 0 .2rem}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.2rem .4rem;text-align:left;vertical-align:top}.mut{color:#666}.pb{page-break-before:always}img{max-width:160px;max-height:200px;float:right;margin:0 0 .6rem 1rem;border:1px solid #bbb}@media print{.noprint{display:none}}`;

export function htmlDoc(title, body) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><p class="noprint mut">Aby zapisać jako PDF, użyj Drukuj (Ctrl+P) i wybierz „Zapisz jako PDF”.</p>${body}</body></html>`;
}

function personBlock(model, id, { photoUrl = null } = {}) {
  const p = model.persons[id];
  const { father, mother } = parentsOf(model, id);
  const row = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : '');
  const nm = (x) => (x ? esc(displayName(model.persons[x])) + (years(model.persons[x]) ? ` <span class="mut">${esc(years(model.persons[x]))}</span>` : '') : '');
  const spouses = spousesOf(model, id).filter((s) => s.spouse).map((s) => nm(s.spouse) + (s.marriage.date ? ` (ślub ${esc(formatLong(s.marriage.date))}${s.marriage.place ? ', ' + esc(s.marriage.place) : ''})` : '')).join('<br>');
  const kids = childrenOf(model, id).map(nm).join('<br>');
  const evs = timelineFor(model, id).filter((e) => e.kind !== 'child').map((e) => `${esc(formatDate(e.date))}: ${esc(e.label)}${e.place ? ', ' + esc(e.place) : ''}`).join('<br>');
  const srcs = (p.sources || []).map((s) => esc(model.ext?.sources?.[s]?.title || s)).join('; ');
  return `<h3>${esc(displayName(p))}</h3>${photoUrl ? `<img src="${esc(photoUrl)}" alt="">` : ''}<table>${row('Urodzony(a)', p.birth.date || p.birth.place ? esc(formatLong(p.birth.date)) + (p.birth.place ? ', ' + esc(p.birth.place) : '') : '')}${row('Zmarł(a)', p.death.date || p.death.place ? esc(formatLong(p.death.date)) + (p.death.place ? ', ' + esc(p.death.place) : '') : '')}${row('Ojciec', nm(father))}${row('Matka', nm(mother))}${row('Małżonkowie', spouses)}${row('Dzieci', kids)}${row('Wydarzenia', evs)}${row('Notatki', p.notes.map((n) => esc(n).replace(/\n/g, '<br>')).join('<br>'))}${row('Źródła', srcs)}</table>`;
}

/** Single person sheet. */
export const personSheet = (model, id, opts) => htmlDoc(displayName(model.persons[id]), `<h1>${esc(displayName(model.persons[id]))}</h1>${personBlock(model, id, opts)}`);

/** Family book: descendants of `rootId`, numbered (Henry/d'Aboville style), each with a short block. */
export function descendantBook(model, rootId, maxGen = 8) {
  const out = []; const seen = new Set();
  const walk = (id, gen, num) => {
    if (seen.has(id) || gen > maxGen) return; seen.add(id);
    out.push(`<h2>${esc(num)}. ${esc(displayName(model.persons[id]))} <span class="mut">${esc(years(model.persons[id]))}</span></h2>` + personBlock(model, id));
    childrenOf(model, id).forEach((c, i) => walk(c, gen + 1, `${num}.${i + 1}`));
  };
  walk(rootId, 1, '1');
  return htmlDoc('Potomkowie ' + displayName(model.persons[rootId]), `<h1>Potomkowie: ${esc(displayName(model.persons[rootId]))}</h1><p class="mut">${out.length} osób, numeracja d'Aboville'a (1.2.3 = trzecie dziecko drugiego dziecka).</p>${out.join('')}`);
}

/** Ahnentafel (ancestor list, Sosa-Stradonitz numbering). */
export function ahnentafel(model, rootId, maxGen = 10) {
  const rows = []; const walk = (id, n, gen) => {
    if (!id || !model.persons[id] || gen > maxGen) return;
    const p = model.persons[id];
    rows.push(`<tr><td>${n}</td><td>${esc(displayName(p))}</td><td>${esc(formatLong(p.birth.date))}${p.birth.place ? ', ' + esc(p.birth.place) : ''}</td><td>${esc(formatLong(p.death.date))}${p.death.place ? ', ' + esc(p.death.place) : ''}</td></tr>`);
    const { father, mother } = parentsOf(model, id); walk(father, n * 2, gen + 1); walk(mother, n * 2 + 1, gen + 1);
  };
  walk(rootId, 1, 1);
  rows.sort((a, b) => parseInt(a.match(/<td>(\d+)/)[1]) - parseInt(b.match(/<td>(\d+)/)[1]));
  return htmlDoc('Tablica przodków', `<h1>Lista przodków: ${esc(displayName(model.persons[rootId]))}</h1><p class="mut">Numeracja Sosa-Stradonitza: ojciec = 2n, matka = 2n+1. Osób: ${rows.length}.</p><table><tr><th>Nr</th><th>Imię i nazwisko</th><th>Urodzenie</th><th>Śmierć</th></tr>${rows.join('')}</table>`);
}

/** Whole-tree index (surname, given, years, id) as a printable list. */
export function indexReport(model) {
  const ids = Object.keys(model.persons).sort((a, b) => { const A = model.persons[a], B = model.persons[b]; return (A.surname || '\uffff').localeCompare(B.surname || '\uffff', 'pl') || (A.given || '').localeCompare(B.given || '', 'pl'); });
  return htmlDoc('Indeks osób', `<h1>Indeks osób (${ids.length})</h1><table><tr><th>Nazwisko</th><th>Imię</th><th>Ur.</th><th>Zm.</th><th>Miejsce ur.</th></tr>${ids.map((id) => { const p = model.persons[id]; return `<tr><td>${esc(p.surname)}</td><td>${esc(p.given)}</td><td>${esc(formatDate(p.birth.date))}</td><td>${esc(formatDate(p.death.date))}</td><td>${esc(p.birth.place)}</td></tr>`; }).join('')}</table>`);
}

/** Open a report in a new tab as a blob URL (works under the page CSP; the document itself is inert HTML+CSS). */
export function openReport(html) { const u = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }

export { relate, EVENT_TYPES };
