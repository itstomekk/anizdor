// Small DOM helpers. Everything is built with createElement/textContent: stored names are never parsed as HTML.
import { displayName, years } from './tree.js';
import { photoUrl } from './media.js';

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'data') Object.assign(e.dataset, v);
    else e[k] = v;
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

const SVG = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}

export function initials(p) {
  const a = (p.given || '').trim()[0] || '', b = (p.surname || '').trim()[0] || '';
  return (a + b).toUpperCase() || '?';
}

export function avatar(p, big = false) {
  const span = el('span', { class: `av ${p.sex || ''}${big ? ' lg' : ''}` }, initials(p));
  const ph = p.photos?.find((x) => x.primary) || p.photos?.[0];
  if (ph) photoUrl(ph.id).then((u) => {
    if (!u) return;
    const img = el('img', { alt: '' });
    img.onload = () => { span.textContent = ''; span.append(img); span.classList.add('has'); };
    img.src = u;
  }).catch(() => {});
  return span;
}

/** Horizontal bars. items: [{name, n, id?}]. onclick(item) makes the label a link. */
export function bars(items, { onclick, fmt = (n) => String(n), max } = {}) {
  const m = max ?? Math.max(1, ...items.map((i) => i.n));
  const box = el('div', { class: 'bars' });
  for (const it of items) {
    const fill = el('div', { class: 'fill' });
    fill.style.width = `${Math.max(2, (it.n / m) * 100)}%`;
    const lbl = onclick ? el('a', { class: 'lbl', title: it.name, onclick: () => onclick(it) }, it.name) : el('span', { class: 'lbl', title: it.name }, it.name);
    box.append(el('div', { class: 'bar' }, lbl, el('div', { class: 'track' }, fill), el('span', { class: 'num' }, fmt(it.n))));
  }
  if (!items.length) box.append(el('span', { class: 'mut' }, 'Brak danych.'));
  return box;
}

/** Column histogram as SVG. items: [{label, n}] */
export function hist(items, { height = 170 } = {}) {
  if (!items.length) return el('span', { class: 'mut' }, 'Brak danych.');
  const W = 480, H = height, padB = 24, padT = 16, bw = Math.max(8, Math.min(40, (W - 10) / items.length - 3));
  const step = (W - 10) / items.length, max = Math.max(1, ...items.map((i) => i.n));
  const s = svg('svg', { class: 'hist', viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const every = Math.ceil(items.length / 9);
  s.append(svg('line', { x1: 0, x2: W, y1: H - padB, y2: H - padB }));
  items.forEach((it, i) => {
    const h = Math.round(((H - padB - padT) * it.n) / max), x = 5 + i * step + (step - bw) / 2, y = H - padB - h;
    const r = svg('rect', { x, y, width: bw, height: Math.max(h, it.n ? 1 : 0), rx: 2 }); r.append(svg('title', {}, `${it.label}: ${it.n}`));
    s.append(r);
    if (it.n) s.append(svg('text', { x: x + bw / 2, y: y - 3, 'text-anchor': 'middle' }, String(it.n)));
    if (i % every === 0) s.append(svg('text', { x: x + bw / 2, y: H - 7, 'text-anchor': 'middle' }, it.label));
  });
  return s;
}

export function stack(parts) {
  const total = parts.reduce((s, p) => s + p.n, 0) || 1;
  const bar = el('div', { class: 'stack' });
  const legend = el('div', { class: 'legend' });
  for (const p of parts) {
    const seg = el('div', { title: `${p.name}: ${p.n}` }); seg.style.width = `${(p.n / total) * 100}%`; seg.style.background = p.color; bar.append(seg);
    const dot = el('span', { class: 'dot' }); dot.style.background = p.color;
    legend.append(el('span', {}, dot, `${p.name}: ${p.n} (${Math.round((p.n / total) * 100)}%)`));
  }
  return el('div', {}, bar, legend);
}

export const personLabel = (p) => `${displayName(p)}${years(p) ? ' ' + years(p) : ''}`;

export function download(name, data, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([data], { type })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
