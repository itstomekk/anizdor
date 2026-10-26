// Interactive views of the family: galaxy (network of people) and ancestor fan. DOM + pointer handling only;
// all geometry comes from visualizations.js. Everything is built with createElementNS/textContent (names are never parsed as HTML).
import { el, svg, personLabel } from './ui.js';
import { displayName, years } from './tree.js';
import { relate } from './kin.js';
import { photoUrl } from './media.js';
import { fanLayout, arcPath, ringRadii, galaxyGraph, layoutGalaxy, bbox, clampView, dataLevel } from './visualizations.js';

const strip = (id) => id.replace(/@/g, '');
const TABS = [['galaktyka', 'Galaktyka'], ['wachlarz', 'Wachlarz przodków'], ['klasyczne', 'Drzewo klasyczne']];
export const VIZ_DEFAULTS = { depth: 5, shape: 'full', color: 'gen', hops: 4, dir: 'all' };

/** Pan / zoom for an SVG inside `host`. The viewBox always matches the host's aspect ratio, so maths stays linear. */
function viewport(host, node, box, { onZoom } = {}) {
  let cx = 0, cy = 0, s = 1, fitS = 1;
  const dims = () => ({ w: host.clientWidth || 800, h: host.clientHeight || 560 });
  const apply = () => {
    const { w, h } = dims();
    node.setAttribute('viewBox', `${(cx - w / (2 * s)).toFixed(2)} ${(cy - h / (2 * s)).toFixed(2)} ${(w / s).toFixed(2)} ${(h / s).toFixed(2)}`);
    host.dataset.zoom = (s / fitS).toFixed(2);
    if (onZoom) onZoom(s / fitS);
  };
  const set = (v) => { ({ cx, cy, s } = clampView(v, box, fitS)); apply(); };
  const fit = () => {
    const { w, h } = dims();
    fitS = Math.min(w / (box.maxX - box.minX), h / (box.maxY - box.minY));
    cx = (box.minX + box.maxX) / 2; cy = (box.minY + box.maxY) / 2; s = fitS; apply();
  };
  const toSvg = (clientX, clientY) => {
    const r = host.getBoundingClientRect(), { w, h } = dims();
    return { x: cx + (clientX - r.left - w / 2) / s, y: cy + (clientY - r.top - h / 2) / s };
  };
  const zoomAt = (factor, clientX, clientY) => {
    const r = host.getBoundingClientRect(), { w, h } = dims();
    const px = clientX ?? r.left + w / 2, py = clientY ?? r.top + h / 2;
    const p = toSvg(px, py), ns = Math.min(fitS * 30, Math.max(fitS * 0.4, s * factor));
    set({ s: ns, cx: p.x - ((px - r.left - w / 2) / ns), cy: p.y - ((py - r.top - h / 2) / ns) });
  };
  const centreOn = (x, y, scale) => set({ cx: x, cy: y, s: scale ? fitS * scale : s });

  const pts = new Map();
  let last = null, pinch = null, moved = 0;
  host.addEventListener('wheel', (e) => { e.preventDefault(); const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; zoomAt(Math.exp(-dy * 0.0016), e.clientX, e.clientY); }, { passive: false });
  host.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-id]') || e.button > 0) return;
    host.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY }; moved = 0;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    host.classList.add('grab');
  });
  host.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = d; return;
    }
    const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; moved += Math.abs(dx) + Math.abs(dy);
    set({ cx: cx - dx / s, cy: cy - dy / s, s });
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) host.classList.remove('grab'); };
  host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
  host.addEventListener('keydown', (e) => {
    if (e.target !== host) return;
    const step = 60 / s;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (k) { e.preventDefault(); set({ cx: cx + k[0], cy: cy + k[1], s }); }
    else if (e.key === '+' || e.key === '=') zoomAt(1.25); else if (e.key === '-') zoomAt(0.8); else if (e.key === '0') fit();
  });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (host.clientWidth) apply(); }) : null;
  ro?.observe(host);
  return { fit, zoomAt, centreOn, toSvg, get scale() { return s; }, get fitScale() { return fitS; }, apply };
}

function header(ctx, tab, focus) {
  const go = (t, f = focus) => ctx.go(`tablica/${t}${f ? '/' + strip(f) : ''}`);
  return el('nav', { class: 'tabs' }, TABS.map(([t, n]) => el('button', { class: tab === t ? 'on' : '', onclick: () => go(t) }, n)));
}

function focusPicker(ctx, focus, tab) {
  const m = ctx.model();
  const sel = at(el('select', { class: 'big', onchange: (e) => ctx.go(`tablica/${tab}/${strip(e.target.value)}`) },
    ctx.sortedIds().map((id) => el('option', { value: id, selected: id === focus }, personLabel(m.persons[id])))), { 'aria-label': 'Osoba w centrum' });
  return el('label', { class: 'inl' }, 'W centrum', sel);
}

function opt(label, value, current, onchange, options) {
  return el('label', { class: 'inl' }, label, el('select', { onchange: (e) => onchange(e.target.value) }, options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(current) }, t))));
}

const fmtYears = (p) => years(p) || 'brak dat';
/** Longest readable form of a name that fits in `room` characters: full, "Given S.", given, truncated. */
function fitName(p, room) {
  const full = displayName(p);
  if (full.length <= room) return full;
  const short = p.given && p.surname ? `${p.given.split(' ')[0]} ${p.surname[0]}.` : '';
  if (short && short.length <= room) return short;
  const first = (p.given || p.surname || full).split(' ')[0];
  return first.length <= room ? first : first.slice(0, Math.max(2, room - 1)) + '…';
}

/** The sticky info strip under a chart: last hovered/selected person with actions. */
function infoStrip(ctx, focus) {
  const m = ctx.model();
  const box = at(el('div', { class: 'vizinfo' }, el('span', { class: 'mut' }, 'Najedź na osobę, aby zobaczyć szczegóły.')), { role: 'status', 'aria-live': 'polite' });
  let current = null;
  const show = (id) => {
    if (id === current || !m.persons[id]) return; current = id;
    const p = m.persons[id];
    let rel = '';
    try { rel = id === focus ? 'osoba w centrum' : relate(m, focus, id).text; } catch { rel = ''; }
    box.replaceChildren(el('b', {}, displayName(p)), el('span', { class: 'mut' }, ` ${fmtYears(p)}${rel ? ' · ' + rel : ''}`), ' ',
      el('button', { class: 'sm', onclick: () => ctx.goPerson(id) }, 'Otwórz kartę'),
      id !== focus && el('button', { class: 'sm', onclick: () => ctx.go(`tablica/${route().tab}/${strip(id)}`) }, 'Wyśrodkuj tutaj'));
  };
  const route = () => ({ tab: location.hash.replace(/^#\/?/, '').split('/')[1] || 'galaktyka' });
  return { box, show };
}

const coarse = () => matchMedia('(pointer: coarse)').matches;
/** el() assigns properties, so ARIA and tabindex need real attributes. */
const at = (node, attrs) => { for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); return node; };
/** Single click acts after a short wait so that a double click can mean something else. */
function clickOrDouble(onSingle, onDouble) {
  let timer = null;
  return () => {
    if (timer) { clearTimeout(timer); timer = null; onDouble(); return; }
    timer = setTimeout(() => { timer = null; onSingle(); }, 240);
  };
}

async function exportSvg(node, box, name, ctx, download) {
  let css = '';
  try { css = (await (await fetch('viz.css')).text()).split('/* @export-cut */')[0]; } catch { /* the picture still exports, just unstyled */ }
  const clone = node.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${box.minX} ${box.minY} ${box.maxX - box.minX} ${box.maxY - box.minY}`);
  clone.setAttribute('width', Math.round(box.maxX - box.minX)); clone.setAttribute('height', Math.round(box.maxY - box.minY));
  clone.classList.remove('hovering');
  clone.querySelectorAll('.hl,.same').forEach((n) => n.classList.remove('hl', 'same'));
  const st = document.createElementNS('http://www.w3.org/2000/svg', 'style'); st.textContent = css; clone.insertBefore(st, clone.firstChild);
  download(name, new XMLSerializer().serializeToString(clone), 'image/svg+xml');
  ctx.say('Zapisano obraz SVG (bez zdjęć, dane tylko w pliku).');
}

// ------------------------------------------------------------------ fan
function fanView(main, ctx, focus, { head, download }) {
  const m = ctx.model(), st = ctx.ui.viz;
  const half = st.shape === 'half';
  const fan = fanLayout(m, focus, st.depth, half ? { start: -Math.PI / 2, sweep: Math.PI } : {});
  const R = ringRadii(fan.depth)[1] + 16;
  const box = half ? { minX: -R, maxX: R, minY: -R, maxY: 40 + 62 } : { minX: -R, maxX: R, minY: -R, maxY: R };
  const root = svg('svg', { class: `viz-svg fan by-${st.color}`, role: 'img', 'aria-label': `Wachlarz przodków: ${displayName(m.persons[focus])}` });
  root.append(svg('rect', { class: 'vbg', x: box.minX - 2000, y: box.minY - 2000, width: box.maxX - box.minX + 4000, height: box.maxY - box.minY + 4000 }));
  const byKey = new Map();
  const g = svg('g', {});
  for (const c of fan.cells) {
    const [r0, r1] = ringRadii(c.gen);
    const p = c.id ? m.persons[c.id] : null;
    const cls = ['cell', `g${c.gen}`, p?.sex || '', c.empty ? 'empty' : '', c.repeat ? 'repeat' : '', c.loop ? 'loop' : '', p ? 'lv-' + dataLevel(p) : ''].filter(Boolean).join(' ');
    const attrs = { class: cls, d: arcPath(0, 0, r0, r1, c.a0, c.a1), 'fill-rule': 'evenodd' };
    const node = svg('g', c.id && !c.loop ? { 'data-id': c.id, 'data-key': c.key, tabindex: 0, role: 'button', 'aria-label': `${displayName(p)} ${fmtYears(p)}` } : { 'data-key': c.key });
    node.append(svg('path', attrs));
    if (p) node.append(svg('title', {}, `${displayName(p)} ${fmtYears(p)}${c.repeat ? ' (ten sam przodek występuje wyżej w wachlarzu)' : ''}${c.loop ? ' (pętla w danych: ta osoba jest własnym przodkiem)' : ''}`));
    else node.append(svg('title', {}, 'brak znanego rodzica'));
    // label
    if (p && !c.loop) {
      const am = (c.a0 + c.a1) / 2, rm = (r0 + r1) / 2, arc = (c.a1 - c.a0) * rm, thick = r1 - r0;
      const x = Math.sin(am) * rm, y = -Math.cos(am) * rm;
      if (c.gen === 0) {
        node.append(svg('text', { class: 'lb b', x: 0, y: -4, 'text-anchor': 'middle' }, (p.given || displayName(p)).slice(0, 14)), svg('text', { class: 'lb', x: 0, y: 11, 'text-anchor': 'middle' }, (p.given ? p.surname || '' : '').slice(0, 14)));
      } else if (c.gen <= 2 && arc > 60) {
        node.append(svg('text', { class: 'lb b', x, y: y - 3, 'text-anchor': 'middle' }, (p.given || displayName(p)).slice(0, 14)), svg('text', { class: 'lb', x, y: y + 10, 'text-anchor': 'middle' }, `${p.given ? p.surname || '' : ''}`.slice(0, 14)), svg('text', { class: 'lb s', x, y: y + 22, 'text-anchor': 'middle' }, years(p)));
      } else if (arc >= 10) {
        const rot = Math.sin(am) >= 0 ? (am * 180) / Math.PI - 90 : (am * 180) / Math.PI + 90;
        const fs = Math.max(8, Math.min(13, arc - 3));
        const room = Math.floor((thick - 6) / (fs * 0.54));
        const txt = fitName(p, room);
        node.append(svg('text', { class: 'lb', x, y, 'font-size': fs.toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'central', transform: `rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})` }, txt));
      }
    }
    g.append(node); byKey.set(c.key, node);
  }
  root.append(g);
  // photo of the person in the middle
  const centre = m.persons[focus], ph = centre.photos?.find((x) => x.primary) || centre.photos?.[0];
  if (ph) photoUrl(ph.id).then((u) => {
    if (!u) return;
    const [, r1] = ringRadii(0);
    const id = 'clip-centre';
    const clip = svg('clipPath', { id }, svg('circle', { cx: 0, cy: 0, r: r1 - 3 }));
    const img = svg('image', { href: u, x: -r1, y: -r1, width: r1 * 2, height: r1 * 2, 'clip-path': `url(#${id})`, preserveAspectRatio: 'xMidYMid slice', class: 'cphoto', 'pointer-events': 'none' });
    byKey.get('0:0')?.querySelectorAll('text').forEach((t) => t.remove());
    root.append(clip, img);
  }).catch(() => {});

  const host = at(el('div', { class: 'vizbox' }, root), { tabindex: 0, 'aria-label': 'Wykres: strzałki przesuwają, plus i minus powiększają, zero dopasowuje' });
  const info = infoStrip(ctx, focus);
  const zl = el('span', { class: 'mut zl' }, '100%');
  const vp = viewport(host, root, box, { onZoom: (z) => { zl.textContent = Math.round(z * 100) + '%'; } });
  const lineage = (key) => { const [gen, k] = key.split(':').map(Number); const out = []; for (let j = 0; j <= gen; j++) out.push(`${gen - j}:${k >> j}`); return out; };
  const clear = () => { root.classList.remove('hovering'); root.querySelectorAll('.hl,.same').forEach((n) => n.classList.remove('hl', 'same')); };
  const hover = (node) => {
    clear(); const id = node.dataset.id; if (!id) return;
    root.classList.add('hovering');
    for (const key of lineage(node.dataset.key)) byKey.get(key)?.classList.add('hl');
    for (const c of fan.cells) if (c.id === id && !c.loop) byKey.get(c.key)?.classList.add('same');
    info.show(id);
  };
  root.querySelectorAll('g[data-id]').forEach((n) => {
    n.addEventListener('pointerenter', () => hover(n)); n.addEventListener('focus', () => hover(n)); n.addEventListener('pointerleave', clear); n.addEventListener('blur', clear);
    const act = clickOrDouble(() => ctx.goPerson(n.dataset.id), () => n.dataset.id !== focus && ctx.go(`tablica/wachlarz/${strip(n.dataset.id)}`));
    n.addEventListener('click', () => { if (coarse() && info.box.dataset.sel !== n.dataset.id) { info.box.dataset.sel = n.dataset.id; hover(n); return; } act(); });
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.goPerson(n.dataset.id); } });
  });

  const note = `${fan.known - 1} znanych przodków (${fan.distinct - 1} różnych osób) w ${Math.max(0, fan.perGen.length - 1)} pokoleniach.` + (fan.repeats ? ` Ten sam przodek występuje wielokrotnie: ${fan.repeats} razy (pokrewieństwo małżonków, pomarańczowa przerywana obwódka).` : '') + (fan.cells.some((c) => c.loop) ? ' Uwaga: w danych jest pętla (osoba jako własny przodek).' : '');
  const bar = el('div', { class: 'treebar' },
    focusPicker(ctx, focus, 'wachlarz'),
    opt('Pokolenia', 0, st.depth, (v) => { st.depth = +v; ctx.render(); }, [2, 3, 4, 5, 6, 7, 8, 9].map((n) => [n, n])),
    opt('Kształt', 0, st.shape, (v) => { st.shape = v; ctx.render(); }, [['full', 'pełne koło'], ['half', 'półkole']]),
    opt('Kolory', 0, st.color, (v) => { st.color = v; ctx.render(); }, [['gen', 'pokolenia'], ['sex', 'płeć'], ['data', 'kompletność danych']]),
    el('button', { onclick: () => vp.zoomAt(0.8), title: 'Pomniejsz' }, '−'), zl, el('button', { onclick: () => vp.zoomAt(1.25), title: 'Powiększ' }, '+'), el('button', { onclick: () => vp.fit() }, 'Dopasuj'),
    el('button', { onclick: () => exportSvg(root, box, `wachlarz-${strip(focus)}.svg`, ctx, download) }, 'Pobierz SVG'), el('button', { onclick: () => print() }, 'Drukuj / PDF'));
  const legend = st.color === 'data'
    ? el('div', { class: 'vizlegend' }, el('span', { class: 'sw lv-full' }), ' data i miejsce urodzenia ', el('span', { class: 'sw lv-part' }), ' jedno z dwóch ', el('span', { class: 'sw lv-none' }), ' brak obu ', el('span', { class: 'sw empty' }), ' brak rodzica w danych')
    : st.color === 'sex' ? el('div', { class: 'vizlegend' }, el('span', { class: 'sw M' }), ' mężczyzna ', el('span', { class: 'sw F' }), ' kobieta ', el('span', { class: 'sw empty' }), ' brak rodzica w danych')
      : el('div', { class: 'vizlegend' }, el('span', { class: 'mut' }, 'Kolor = pokolenie od osoby w centrum. '), el('span', { class: 'sw empty' }), ' brak rodzica w danych');
  main.replaceChildren(el('div', { class: 'card', style: 'margin-top:.5rem' }, el('h2', {}, 'Wachlarz przodków'), head,
    el('p', { class: 'mut' }, note, ' Kółko myszy lub szczypanie: zoom. Przeciągnij tło: przesuwanie. Kliknięcie: karta osoby. Dwuklik: ta osoba w centrum.'),
    bar, host, legend, info.box));
  vp.fit();
  return { root, vp };
}

// ------------------------------------------------------------------ galaxy
function galaxyView(main, ctx, focus, { head, download }) {
  const m = ctx.model(), st = ctx.ui.viz;
  const graph = galaxyGraph(m, focus, { hops: st.hops, dir: st.dir, max: 220 });
  const box = layoutGalaxy(graph);
  const home = graph.nodes.map((n) => [n.x, n.y]);
  const root = svg('svg', { class: 'viz-svg galaxy', role: 'img', 'aria-label': `Galaktyka rodziny wokół: ${displayName(m.persons[focus])}` });
  root.append(svg('rect', { class: 'vbg', x: box.minX - 3000, y: box.minY - 3000, width: box.maxX - box.minX + 6000, height: box.maxY - box.minY + 6000 }));
  // a fixed, deterministic star field for depth
  const stars = svg('g', { class: 'stars' });
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 140; i++) stars.append(svg('circle', { cx: (box.minX - 200 + rnd() * (box.maxX - box.minX + 400)).toFixed(0), cy: (box.minY - 200 + rnd() * (box.maxY - box.minY + 400)).toFixed(0), r: (0.5 + rnd() * 1.1).toFixed(1), class: 'star' }));
  root.append(stars);
  const lines = svg('g', { class: 'edges' }), nodesG = svg('g', { class: 'nodes' });
  const edgeEls = graph.edges.map((e) => { const A = graph.nodes[e.a], B = graph.nodes[e.b]; const l = svg('line', { class: `edge ${e.kind}`, x1: A.x, y1: A.y, x2: B.x, y2: B.y }); lines.append(l); return l; });
  const incident = graph.nodes.map(() => []);
  graph.edges.forEach((e, i) => { incident[e.a].push([i, 1]); incident[e.b].push([i, 2]); });
  const nodeEls = graph.nodes.map((n, i) => {
    const p = m.persons[n.id];
    const r = n.d === 0 && i === 0 ? 11 : Math.min(10, 4.4 + Math.sqrt(n.deg) * 1.5);
    const g = svg('g', { class: `node ${p.sex || ''}${i === 0 ? ' focus' : ''}${n.d <= 1 ? ' near' : ''}`, 'data-id': n.id, 'data-i': i, transform: `translate(${n.x} ${n.y})`, tabindex: 0, role: 'button', 'aria-label': `${displayName(p)} ${fmtYears(p)}` });
    g.append(svg('circle', { class: 'halo', r: r * 2.6 }), svg('circle', { class: 'core', r }), svg('text', { class: 'nl', y: r + 11, 'text-anchor': 'middle' }, displayName(p).slice(0, 24)), svg('title', {}, `${displayName(p)} ${fmtYears(p)}`));
    nodesG.append(g); return g;
  });
  root.append(lines, nodesG);
  root.classList.toggle('labels-all', graph.nodes.length <= 30);

  const host = at(el('div', { class: 'vizbox space' }, root), { tabindex: 0, 'aria-label': 'Wykres: strzałki przesuwają, plus i minus powiększają, zero dopasowuje' });
  const info = infoStrip(ctx, focus);
  const zl = el('span', { class: 'mut zl' }, '100%');
  const vp = viewport(host, root, box, { onZoom: (z) => { root.classList.toggle('zoomed', z > 1.7); zl.textContent = Math.round(z * 100) + '%'; } });
  const clear = () => { root.classList.remove('hovering'); root.querySelectorAll('.hl').forEach((n) => n.classList.remove('hl')); };
  const hover = (i) => {
    clear(); root.classList.add('hovering'); nodeEls[i].classList.add('hl');
    for (const [ei, side] of incident[i]) { edgeEls[ei].classList.add('hl'); const e = graph.edges[ei]; nodeEls[side === 1 ? e.b : e.a].classList.add('hl'); }
    info.show(graph.nodes[i].id);
  };
  let dragging = false;
  nodeEls.forEach((g, i) => {
    g.addEventListener('pointerenter', () => !dragging && hover(i)); g.addEventListener('focus', () => hover(i)); g.addEventListener('pointerleave', () => !dragging && clear()); g.addEventListener('blur', clear);
    const act = clickOrDouble(() => ctx.goPerson(g.dataset.id), () => i !== 0 && ctx.go(`tablica/galaktyka/${strip(g.dataset.id)}`));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.goPerson(g.dataset.id); } });
    let start = null;
    g.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return; e.stopPropagation(); g.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY, nx: graph.nodes[i].x, ny: graph.nodes[i].y, moved: false }; dragging = true; g.classList.add('drag'); hover(i);
    });
    g.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.abs(dx) + Math.abs(dy) < 4) return; start.moved = true;
      const n = graph.nodes[i]; n.x = start.nx + dx / vp.scale; n.y = start.ny + dy / vp.scale;
      g.setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`);
      for (const [ei, side] of incident[i]) edgeEls[ei].setAttribute(side === 1 ? 'x1' : 'x2', n.x.toFixed(1)), edgeEls[ei].setAttribute(side === 1 ? 'y1' : 'y2', n.y.toFixed(1));
    });
    const end = (e) => {
      if (!start) return; const wasMoved = start.moved; start = null; dragging = false; g.classList.remove('drag');
      try { g.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (wasMoved) return;
      if (coarse() && info.box.dataset.sel !== g.dataset.id) { info.box.dataset.sel = g.dataset.id; return; }
      act();
    };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', (e) => { start = null; dragging = false; g.classList.remove('drag'); });
  });

  const reset = () => { graph.nodes.forEach((n, i) => { [n.x, n.y] = home[i]; nodeEls[i].setAttribute('transform', `translate(${n.x} ${n.y})`); }); edgeEls.forEach((l, k) => { const e = graph.edges[k], A = graph.nodes[e.a], B = graph.nodes[e.b]; l.setAttribute('x1', A.x); l.setAttribute('y1', A.y); l.setAttribute('x2', B.x); l.setAttribute('y2', B.y); }); vp.fit(); };
  const note = `${graph.nodes.length} osób w zasięgu ${st.hops} ${st.hops === 1 ? 'kroku' : 'kroków'} od wybranej osoby (rodzic, dziecko = 1 krok; partner = 0, bo para trzyma się razem).` + (graph.truncated ? ` Pokazano ${graph.nodes.length} najbliższych z ${graph.total}; zmniejsz liczbę kroków, aby zobaczyć wszystkich.` : '');
  const bar = el('div', { class: 'treebar' },
    focusPicker(ctx, focus, 'galaktyka'),
    opt('Kroki', 0, st.hops, (v) => { st.hops = +v; ctx.render(); }, [1, 2, 3, 4, 5, 6].map((n) => [n, n])),
    opt('Kto', 0, st.dir, (v) => { st.dir = v; ctx.render(); }, [['all', 'wszyscy krewni'], ['anc', 'tylko przodkowie'], ['desc', 'tylko potomkowie']]),
    el('button', { onclick: () => vp.zoomAt(0.8), title: 'Pomniejsz' }, '−'), zl, el('button', { onclick: () => vp.zoomAt(1.25), title: 'Powiększ' }, '+'), el('button', { onclick: reset }, 'Dopasuj i ułóż od nowa'),
    el('button', { onclick: () => exportSvg(root, box, `galaktyka-${strip(focus)}.svg`, ctx, download) }, 'Pobierz SVG'), el('button', { onclick: () => print() }, 'Drukuj / PDF'));
  const legend = el('div', { class: 'vizlegend' }, el('span', { class: 'sw M' }), ' mężczyzna ', el('span', { class: 'sw F' }), ' kobieta ', el('span', { class: 'sw U' }), ' brak płci ', el('span', { class: 'ln parent' }), ' rodzic–dziecko ', el('span', { class: 'ln spouse' }), ' partnerzy');
  main.replaceChildren(el('div', { class: 'card', style: 'margin-top:.5rem' }, el('h2', {}, 'Galaktyka rodziny'), head,
    el('p', { class: 'mut' }, note, ' Przeciągnij gwiazdę, aby ją przesunąć (tylko w widoku). Przeciągnij tło lub użyj kółka myszy. Kliknięcie: karta osoby. Dwuklik: ta osoba w centrum.'),
    bar, host, legend, info.box));
  vp.fit();
  return { root, vp, graph };
}

/** Tablica: tabs + focus person. `classic(main, head)` renders the old whole-family board. */
export function viewBoard(main, r, ctx, { classic, download }) {
  const m = ctx.model();
  const tab = TABS.some(([t]) => t === r.a) ? r.a : 'galaktyka';
  const wanted = r.b && m.persons[`@${r.b}@`] ? `@${r.b}@` : null;
  const focus = wanted || (m.persons[ctx.ui.focus] ? ctx.ui.focus : ctx.defaultFocus());
  ctx.ui.focus = focus;
  const canon = `#/tablica/${tab}/${strip(focus)}`;
  if (location.hash !== canon) history.replaceState(null, '', canon);
  ctx.ui.viz = { ...VIZ_DEFAULTS, ...(ctx.ui.viz || {}) };
  const head = header(ctx, tab, focus);
  if (tab === 'klasyczne') return classic(main, head);
  return (tab === 'wachlarz' ? fanView : galaxyView)(main, ctx, focus, { head, download });
}
