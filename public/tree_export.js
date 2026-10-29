// Tree export editor: drag boxes (optionally with their descendants), add a title, then save PNG / PDF / SVG or print.
// Hand-made offsets are remembered per layout mode in localStorage. All rendering happens in the browser.
import { el } from './ui.js';
import { layoutToSvg } from './tree.js';

const PAPER = { a4: [595.28, 841.89], a3: [841.89, 1190.55], a2: [1190.55, 1683.78] }; // PDF points (1/72 in)

/** Minimal one-page PDF with a single JPEG image, fitted into the page with a margin. Pure: returns Uint8Array. */
export function jpegToPdf(jpeg, imgW, imgH, { paper = 'fit', margin = 24 } = {}) {
  let pw, ph;
  if (PAPER[paper]) {
    [pw, ph] = PAPER[paper];
    if (imgW > imgH) [pw, ph] = [ph, pw]; // landscape for wide drawings
  } else {
    const s = Math.min(1, 14400 / Math.max(imgW, imgH)); // PDF page limit 200 in
    pw = imgW * s + margin * 2; ph = imgH * s + margin * 2;
  }
  const k = Math.min((pw - margin * 2) / imgW, (ph - margin * 2) / imgH);
  const dw = imgW * k, dh = imgH * k, dx = (pw - dw) / 2, dy = (ph - dh) / 2;
  const f = (n) => (Math.round(n * 100) / 100).toString();
  const enc = new TextEncoder();
  const chunks = [], offs = [];
  let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
  const content = `q ${f(dw)} 0 0 ${f(dh)} ${f(dx)} ${f(dy)} cm /Im0 Do Q`;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  obj(4, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
  obj(5, [`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => String(offs[n]).padStart(10, '0') + ' 00000 n \n').join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len); let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/** Ids of a node and everything below it in the layout. */
export function subtreeIds(lay, id) {
  const kids = new Map();
  for (const [a, b] of lay.links) { const k = lay.nodes[a].id; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(lay.nodes[b].id); }
  const out = new Set(), stack = [id];
  while (stack.length) { const x = stack.pop(); if (out.has(x)) continue; out.add(x); for (const c of kids.get(x) || []) stack.push(c); }
  return out;
}

function svgToCanvas(svgText, scale) {
  return new Promise((resolve, reject) => {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const vb = doc.documentElement.getAttribute('viewBox').split(/\s+/).map(Number);
    const maxSide = 16000, maxArea = 60e6;
    let s = Math.min(scale, maxSide / vb[2], maxSide / vb[3], Math.sqrt(maxArea / (vb[2] * vb[3])));
    s = Math.max(s, 0.1);
    const W = Math.round(vb[2] * s), H = Math.round(vb[3] * s);
    doc.documentElement.setAttribute('width', W); doc.documentElement.setAttribute('height', H);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url); resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Nie udało się narysować obrazka.')); };
    img.src = url;
  });
}
const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

/**
 * Open the export editor as a full-screen overlay.
 * opts: { model, lay, vertical, timeAxis, title, download(name, data, type), say(msg) }
 */
export function openTreeExport({ model, lay, vertical, timeAxis, title = '', download, say = () => {} }) {
  const key = `anizdor.exportOffsets.${vertical ? (timeAxis ? 't' : 'v') : 'h'}`;
  let offsets = {};
  try { offsets = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
  const known = new Set(lay.nodes.map((n) => n.id));
  for (const id of Object.keys(offsets)) if (!known.has(id)) delete offsets[id];
  const st = { title, withKids: true, paper: 'a3', scale: 2 };
  const save = () => { try { localStorage.setItem(key, JSON.stringify(offsets)); } catch {} };
  const svgText = () => layoutToSvg(model, lay, { spouse: true, vertical, timeAxis, offsets, title: st.title.trim() });
  const board = el('div', { class: 'xp-board' });
  let zoom = 1;
  const draw = () => {
    const doc = new DOMParser().parseFromString(svgText(), 'image/svg+xml');
    const node = document.importNode(doc.documentElement, true);
    const vb = node.viewBox.baseVal;
    node.setAttribute('width', Math.round(vb.width * zoom)); node.setAttribute('height', Math.round(vb.height * zoom));
    board.replaceChildren(node);
  };

  // dragging: work in SVG units so zoom does not matter
  let drag = null, raf = 0;
  board.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('g[data-id]'); if (!g || e.button !== 0) return;
    e.preventDefault();
    const svg = board.querySelector('svg'); const k = svg.getScreenCTM()?.a || 1;
    const ids = st.withKids ? subtreeIds(lay, g.dataset.id) : new Set([g.dataset.id]);
    drag = { x: e.clientX, y: e.clientY, k, ids, base: Object.fromEntries([...ids].map((id) => [id, { ...(offsets[id] || { dx: 0, dy: 0 }) }])) };
    board.setPointerCapture(e.pointerId); board.classList.add('dragging');
  });
  board.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / drag.k, dy = (e.clientY - drag.y) / drag.k;
    for (const id of drag.ids) offsets[id] = { dx: Math.round(drag.base[id].dx + dx), dy: Math.round(drag.base[id].dy + dy) };
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  });
  const end = () => { if (!drag) return; drag = null; board.classList.remove('dragging'); save(); draw(); };
  board.addEventListener('pointerup', end); board.addEventListener('pointercancel', end);

  const busy = async (btn, fn) => { const t = btn.textContent; btn.disabled = true; btn.textContent = 'Chwileczkę…'; try { await fn(); } catch (err) { say(err.message || String(err)); } finally { btn.disabled = false; btn.textContent = t; } };
  const base = () => (st.title.trim() || 'drzewo-rodziny').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'drzewo-rodziny';
  const png = (e) => busy(e.currentTarget, async () => { const c = await svgToCanvas(svgText(), st.scale); download(base() + '.png', await toBlob(c, 'image/png'), 'image/png'); });
  const pdf = (e) => busy(e.currentTarget, async () => {
    const c = await svgToCanvas(svgText(), st.scale);
    const jpg = new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
    download(base() + '.pdf', jpegToPdf(jpg, c.width, c.height, { paper: st.paper }), 'application/pdf');
  });
  const svgBtn = () => download(base() + '.svg', svgText(), 'image/svg+xml');
  const doPrint = () => {
    const holder = el('div', { class: 'xp-print' }); holder.innerHTML = svgText();
    document.body.append(holder); document.body.classList.add('printing-export');
    const done = () => { holder.remove(); document.body.classList.remove('printing-export'); removeEventListener('afterprint', done); };
    addEventListener('afterprint', done); print(); setTimeout(done, 1500);
  };
  const reset = () => { offsets = {}; save(); draw(); };
  const zoomTo = (z) => { zoom = Math.min(3, Math.max(0.15, z)); zl.textContent = Math.round(zoom * 100) + '%'; draw(); };
  const zl = el('span', { class: 'mut zl' }, '100%');
  const fit = () => { const vb = board.querySelector('svg')?.viewBox.baseVal; if (vb) zoomTo((board.clientWidth - 16) / vb.width); };

  const close = () => { removeEventListener('keydown', onKey); overlay.remove(); document.body.classList.remove('xp-open'); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const sel = (val, opts, on) => el('select', { onchange: (e) => on(e.target.value) }, opts.map(([v, t]) => el('option', { value: v, selected: String(val) === String(v) }, t)));
  const overlay = el('div', { class: 'xp', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Eksport drzewa' },
    el('div', { class: 'xp-bar' },
      el('b', {}, 'Eksport drzewa'),
      el('input', { type: 'text', placeholder: 'Tytuł (opcjonalnie)', value: st.title, oninput: (e) => { st.title = e.target.value; draw(); }, 'aria-label': 'Tytuł' }),
      el('label', { class: 'inl', title: 'Przeciągnięcie osoby przesuwa też jej potomków' }, el('input', { type: 'checkbox', checked: st.withKids, onchange: (e) => { st.withKids = e.target.checked; } }), 'z potomkami'),
      el('button', { onclick: reset, title: 'Wróć do automatycznego układu' }, 'Resetuj układ'),
      el('button', { onclick: () => zoomTo(zoom - 0.15), title: 'Pomniejsz' }, '−'), zl, el('button', { onclick: () => zoomTo(zoom + 0.15), title: 'Powiększ' }, '+'), el('button', { onclick: fit }, 'Dopasuj'),
      el('span', { class: 'xp-sp' }),
      el('label', { class: 'inl', title: 'Rozdzielczość PNG i PDF' }, 'Jakość ', sel(st.scale, [[1, 'zwykła'], [2, 'wysoka'], [3, 'do druku']], (v) => { st.scale = +v; })),
      el('label', { class: 'inl' }, 'PDF ', sel(st.paper, [['a4', 'A4'], ['a3', 'A3'], ['a2', 'A2'], ['fit', 'rozmiar rysunku']], (v) => { st.paper = v; })),
      el('button', { class: 'primary', onclick: png }, 'PNG'), el('button', { class: 'primary', onclick: pdf }, 'PDF'), el('button', { onclick: svgBtn }, 'SVG'), el('button', { onclick: doPrint }, 'Drukuj'),
      el('button', { onclick: close, title: 'Zamknij (Esc)', 'aria-label': 'Zamknij' }, '✕')),
    el('p', { class: 'mut xp-hint' }, 'Przeciągnij osobę, aby ją przesunąć. Układ zostaje zapamiętany do następnego eksportu. Drzewo w aplikacji się nie zmienia.'),
    board);
  document.body.append(overlay); document.body.classList.add('xp-open');
  addEventListener('keydown', onKey);
  draw();
  requestAnimationFrame(() => { const vb = board.querySelector('svg')?.viewBox.baseVal; if (vb && vb.width > board.clientWidth) fit(); });
  return { close };
}
