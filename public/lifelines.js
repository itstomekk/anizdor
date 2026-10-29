// "Linie życia" tab of the tree view: one row per person, x = year. Hover shows who was alive in a year;
// clicking a bar selects the person, highlights their lifetime and dims everyone who never lived at the same time.
import { el, svg } from './ui.js';
import { displayName, years, layoutForest } from './tree.js';
import { lifeBars } from './extras.js';
import { showPersonPop } from './person_pop.js';

/** Years two bars overlap (0 when they never lived at the same time). */
export function overlapYears(a, b) { return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from)); }

/** Order bars: 'birth' (oldest first), 'family' (tree order, then the rest by birth), 'surname'. */
export function orderBars(model, bars, mode) {
  if (mode === 'family') {
    const pos = new Map(layoutForest(model).nodes.map((n, i) => [n.id, i]));
    return [...bars].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9) || a.from - b.from);
  }
  if (mode === 'surname') {
    const sn = (x) => model.persons[x.id].surname || '\uffff';
    return [...bars].sort((a, b) => sn(a).localeCompare(sn(b), 'pl') || a.from - b.from);
  }
  return [...bars].sort((a, b) => a.from - b.from || a.to - b.to);
}

export function viewLifelines(main, head, ctx) {
  const m = ctx.model();
  const st = ctx.ui.lines || (ctx.ui.lines = { order: 'birth', surname: '', sel: null });
  const surnames = [...new Set(Object.values(m.persons).map((p) => p.surname).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
  const wrap = el('div', { class: 'canvas lifewrap linesview' });
  const info = el('p', { class: 'mut treeinfo' });
  const now = new Date().getFullYear();

  const draw = () => {
    const bars = orderBars(m, lifeBars(m, { surname: st.surname }), st.order);
    if (!bars.length) { wrap.replaceChildren(el('p', { class: 'mut' }, 'Brak osób z datami urodzenia lub śmierci.')); info.textContent = ''; return; }
    const sel = bars.find((b) => b.id === st.sel) || null;
    const lo = Math.floor(Math.min(...bars.map((b) => b.from)) / 10) * 10, hi = Math.ceil(Math.max(...bars.map((b) => b.to)) / 10) * 10;
    const left = 210, rowH = 18, top = 22;
    const W = Math.max(760, Math.min(1800, (wrap.clientWidth || 1000) - 4));
    const X = (y) => left + ((y - lo) / (hi - lo || 1)) * (W - left - 14);
    const H = top + bars.length * rowH + 8;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'lives', role: 'img', 'aria-label': 'Linie życia' });
    const step = (hi - lo) / 10 > 14 ? 20 : 10;
    for (let y = lo; y <= hi; y += 10) {
      s.append(svg('line', { x1: X(y), x2: X(y), y1: top - 4, y2: H, class: 'grid' }));
      if ((y - lo) % step === 0) s.append(svg('text', { x: X(y), y: 13, 'text-anchor': 'middle', class: 'ax' }, String(y)));
    }
    if (now >= lo && now <= hi) s.append(svg('line', { x1: X(now), x2: X(now), y1: top - 4, y2: H, class: 'today' }));
    if (sel) s.append(svg('rect', { x: X(sel.from), y: top - 4, width: Math.max(2, X(sel.to) - X(sel.from)), height: H - top + 4, class: 'selband' }));
    let together = 0;
    bars.forEach((b, i) => {
      const p = m.persons[b.id], y = top + i * rowH;
      const ov = sel && b !== sel ? overlapYears(sel, b) : null;
      if (ov) together++;
      const cls = ['lifebar', p.sex || '', sel && b === sel ? 'on' : '', sel && b !== sel && !ov ? 'dim' : ''].join(' ');
      const g = svg('g', { 'data-id': b.id, class: cls });
      const r = svg('rect', { x: X(b.from), y, width: Math.max(3, X(b.to) - X(b.from)), height: rowH - 5, rx: 3, class: b.guess ? 'guess' : '' });
      r.append(svg('title', {}, `${displayName(p)}  ${years(p)}${b.guess ? ' (zakres częściowo szacowany)' : ''}${ov ? `\nżyli razem ok. ${ov} lat` : ''}`));
      g.append(svg('rect', { x: 0, y: y - 2, width: W, height: rowH, class: 'hit' }), r,
        svg('text', { x: left - 8, y: y + 10, 'text-anchor': 'end', class: 'nm' }, `${displayName(p).slice(0, 24)} ${years(p)}`.trim()));
      if (ov) g.append(svg('text', { x: Math.min(X(b.to) + 4, W - 40), y: y + 10, class: 'ov' }, `${ov} l.`));
      g.addEventListener('click', () => {
        st.sel = st.sel === b.id ? null : b.id; draw();
        if (st.sel) { const gg = wrap.querySelector(`g[data-id="${CSS.escape(b.id)}"] rect:not(.hit)`); if (gg) showPersonPop(ctx, b.id, gg); }
      });
      s.append(g);
    });
    // hover cursor: year + how many people were alive
    const cur = svg('line', { class: 'cursor', y1: top - 4, y2: H, x1: -10, x2: -10 });
    const lab = svg('text', { class: 'curlab', y: top + 10, x: -100 });
    s.append(cur, lab);
    s.addEventListener('pointermove', (e) => {
      const pt = s.getScreenCTM(); if (!pt) return;
      const x = (e.clientX - pt.e) / pt.a;
      if (x < left) { cur.setAttribute('x1', -10); cur.setAttribute('x2', -10); lab.setAttribute('x', -100); return; }
      const yr = Math.round(lo + ((x - left) / (W - left - 14)) * (hi - lo));
      const alive = bars.filter((b) => b.from <= yr && b.to >= yr).length;
      cur.setAttribute('x1', X(yr)); cur.setAttribute('x2', X(yr));
      lab.textContent = `${yr}: żyło ${alive}`;
      const right = X(yr) + 6 + 90 > W;
      lab.setAttribute('x', right ? X(yr) - 6 : X(yr) + 6); lab.setAttribute('text-anchor', right ? 'end' : 'start');
    });
    s.addEventListener('pointerleave', () => { cur.setAttribute('x1', -10); cur.setAttribute('x2', -10); lab.setAttribute('x', -100); });
    wrap.replaceChildren(s);
    info.textContent = sel
      ? `${displayName(m.persons[sel.id])} żył${m.persons[sel.id].sex === 'F' ? 'a' : ''} w tym samym czasie co ${together} z ${bars.length - 1} osób. Liczba przy pasku = ile lat żyli razem. Kliknij jeszcze raz, aby odznaczyć.`
      : `${bars.length} osób. Kliknij pasek, aby zobaczyć, kto żył w tym samym czasie. Najedź na wykres, aby zobaczyć rok i ile osób wtedy żyło. Przerywany pasek = brak jednej z dat.`;
  };
  const sel = (val, opts, on) => el('select', { onchange: (e) => on(e.target.value) }, opts.map(([v, t]) => el('option', { value: v, selected: val === v }, t)));
  main.replaceChildren(el('div', { class: 'card', style: 'margin-top:.3rem' }, head, info,
    el('div', { class: 'treebar' },
      el('label', { class: 'inl' }, 'Kolejność ', sel(st.order, [['birth', 'wg roku urodzenia'], ['family', 'wg rodzin (jak w drzewie)'], ['surname', 'wg nazwiska']], (v) => { st.order = v; draw(); })),
      sel(st.surname, [['', 'wszystkie nazwiska'], ...surnames.map((x) => [x, x])], (v) => { st.surname = v; draw(); }),
      el('button', { onclick: () => { st.sel = null; draw(); } }, 'Wyczyść zaznaczenie')),
    wrap));
  draw();
}
