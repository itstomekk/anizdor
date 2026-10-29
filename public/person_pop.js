// Small person popover: shown when a person is clicked in the tree views. The full card opens only on request.
import { el, avatar } from './ui.js';
import { displayName, years, parentsOf, spousesOf, childrenOf } from './tree.js';
import { formatDate, yearOf } from './dates.js';

let current = null;

export function closePersonPop() {
  if (!current) return;
  current.cleanup();
  current = null;
}

/**
 * ctx: { model(), goPerson(id) }. anchor: element or DOMRect to place the popover next to.
 * opts.onRelative(id): called when a relative's name is clicked (default: show that person's popover in place).
 * opts.extra: optional array of extra buttons.
 */
export function showPersonPop(ctx, id, anchor, opts = {}) {
  closePersonPop();
  const m = ctx.model(), p = m.persons[id];
  if (!p) return;
  const rect = anchor && typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : anchor;
  const rel = (rid, note) => rid && m.persons[rid] ? el('a', { class: 'pp-rel', title: note || '', onclick: (e) => { e.preventDefault(); (opts.onRelative || ((x) => showPersonPop(ctx, x, rect, opts)))(rid); } }, displayName(m.persons[rid])) : null;
  const list = (ids, max = 8) => { const out = []; ids.slice(0, max).forEach((x, i) => { if (i) out.push(', '); out.push(rel(x)); }); if (ids.length > max) out.push(` i ${ids.length - max} więcej`); return out; };
  const ev = (label, e) => (e && (e.date || e.place) ? el('div', { class: 'pp-ev' }, el('span', { class: 'mut' }, label), ' ', [formatDate(e.date), e.place].filter(Boolean).join(', ')) : null);
  const b = yearOf(p.birth.date), d = yearOf(p.death.date);
  const age = b != null && d != null && d >= b ? el('div', { class: 'pp-ev' }, el('span', { class: 'mut' }, 'przeżył' + (p.sex === 'F' ? 'a' : '')), ` ok. ${d - b} lat`) : null;
  const { father, mother } = parentsOf(m, id);
  const partners = spousesOf(m, id).map((s) => s.spouse).filter(Boolean);
  const kids = [...new Set(childrenOf(m, id))];
  const row = (label, kids2) => (kids2.length ? el('div', { class: 'pp-row' }, el('span', { class: 'mut' }, label), ' ', kids2) : null);
  const parents = [father, mother].filter(Boolean);
  const box = el('div', { class: 'pp', role: 'dialog', 'aria-label': displayName(p) },
    el('div', { class: 'pp-head' }, avatar(p, false), el('div', {}, el('b', {}, displayName(p) || 'bez imienia'), el('div', { class: 'mut' }, years(p))),
      el('button', { class: 'pp-x', 'aria-label': 'Zamknij', title: 'Zamknij (Esc)', onclick: closePersonPop }, '✕')),
    ev('ur.', p.birth), ev('zm.', p.death), age,
    row(parents.length > 1 ? 'Rodzice:' : 'Rodzic:', list(parents)),
    row(partners.length > 1 ? 'Partnerzy:' : 'Partner:', list(partners)),
    row(`Dzieci (${kids.length}):`, list(kids)),
    el('div', { class: 'pp-btns' }, el('button', { class: 'primary', onclick: () => { closePersonPop(); ctx.goPerson(id); } }, 'Otwórz kartę'), opts.extra || null));
  document.body.append(box);
  // place: right of the anchor if it fits, else left, else below; always inside the viewport
  const vw = innerWidth, vh = innerHeight, bw = box.offsetWidth, bh = box.offsetHeight;
  let x = 8, y = 8;
  if (rect) {
    x = rect.right + 8 + bw <= vw ? rect.right + 8 : rect.left - 8 - bw >= 0 ? rect.left - 8 - bw : rect.left;
    y = rect.right + 8 + bw <= vw || rect.left - 8 - bw >= 0 ? rect.top : rect.bottom + 8;
  }
  x = Math.max(8, Math.min(x, vw - bw - 8)); y = Math.max(8, Math.min(y, vh - bh - 8));
  box.style.left = x + 'px'; box.style.top = y + 'px';
  const onKey = (e) => { if (e.key === 'Escape') closePersonPop(); };
  const onDown = (e) => { if (!box.contains(e.target) && !e.target.closest?.('g[data-id]')) closePersonPop(); };
  const onHash = () => closePersonPop();
  addEventListener('keydown', onKey); addEventListener('pointerdown', onDown, true); addEventListener('hashchange', onHash);
  current = { id, cleanup: () => { box.remove(); removeEventListener('keydown', onKey); removeEventListener('pointerdown', onDown, true); removeEventListener('hashchange', onHash); } };
  box.querySelector('.primary')?.focus({ preventScroll: true });
}
