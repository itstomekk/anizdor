// Elastic dragging for the vertical tree: grab a person and pull them sideways. Relatives follow on springs,
// boxes that live at the same time push each other away, and the height (birth year) never changes.
import { linkPath } from './tree.js';

const K_LINK = 0.06, K_HOME = 0.004, DAMP = 0.8, GAP = 8;

/** Pure step of the simulation (exported for tests). Moves x in place, returns the largest speed. */
export function springStep(st) {
  const { x, v, home, links, pairs, pinned, w } = st;
  const F = new Float64Array(x.length), prev = Float64Array.from(x);
  for (const [a, b, rest] of links) { const f = K_LINK * ((x[b] - x[a]) - rest); F[a] += f; F[b] -= f; }
  let max = 0;
  for (let i = 0; i < x.length; i++) {
    if (pinned.has(i)) { v[i] = 0; continue; }
    v[i] = (v[i] + F[i] + K_HOME * (home[i] - x[i])) * DAMP;
    x[i] += v[i];
  }
  // boxes that overlap in time may not overlap sideways
  for (let it = 0; it < 4; it++) {
    for (const [i, j] of pairs) {
      const d = x[j] - x[i], need = w + GAP - Math.abs(d);
      if (need <= 0) continue;
      const s = d > 0 || (d === 0 && i < j) ? 1 : -1;
      const pi = pinned.has(i), pj = pinned.has(j);
      if (pi && pj) continue;
      if (pi) x[j] += s * need; else if (pj) x[i] -= s * need; else { x[i] -= s * need / 2; x[j] += s * need / 2; }
    }
  }
  // speed = real movement this step (a box held by a collision is at rest even if a spring still pulls it)
  for (let i = 0; i < x.length; i++) { if (!pinned.has(i)) v[i] = x[i] - prev[i]; max = Math.max(max, Math.abs(v[i])); }
  return max;
}

/** Build the simulation state from boxes [{x, y, H}] and links [[a, b]]. */
export function springState(boxes, links, w) {
  const x = Float64Array.from(boxes.map((b) => b.x));
  const pairs = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const A = boxes[i], B = boxes[j];
    if (A.y < B.y + B.H + 6 && B.y < A.y + A.H + 6) pairs.push([i, j]);
  }
  return { x, v: new Float64Array(boxes.length), home: Float64Array.from(x), links: links.map(([a, b]) => [a, b, x[b] - x[a]]), pairs, pinned: new Set(), w };
}

/**
 * Make the boxes of a mounted tree SVG draggable. onCommit(moves) gets { id: dx } (SVG units) for every box that
 * moved once everything has settled. Mouse and pen only; on touch screens a drag stays a scroll.
 */
export function attachSprings(svg, { onCommit, onDragStart } = {}) {
  const mode = svg.dataset.mode;
  if (mode !== 't' && mode !== 'v') return () => {};
  const w = +svg.dataset.w, h = +svg.dataset.h, time = mode === 't';
  const gs = [...svg.querySelectorAll('g[data-id]')];
  const idx = new Map(gs.map((g, i) => [g.dataset.id, i]));
  const boxes = gs.map((g) => { const r = g.querySelector('rect'); return { x: +r.getAttribute('x'), y: +r.getAttribute('y'), H: +g.dataset.h || h }; });
  const paths = [...svg.querySelectorAll('path[data-a]')].map((p) => ({ el: p, a: idx.get(p.dataset.a), b: idx.get(p.dataset.b) })).filter((p) => p.a != null && p.b != null);
  const x0 = boxes.map((b) => b.x);
  let st = null, raf = 0, drag = null, moved = false, frames = 0;

  const paint = () => {
    const dirty = new Set();
    gs.forEach((g, i) => { const dx = st.x[i] - x0[i]; if (Math.abs(dx - (g._dx || 0)) > 0.05) { g._dx = dx; g.setAttribute('transform', `translate(${dx} 0)`); dirty.add(i); } });
    for (const p of paths) if (dirty.has(p.a) || dirty.has(p.b)) {
      p.el.setAttribute('d', linkPath({ x: st.x[p.a], y: boxes[p.a].y }, { x: st.x[p.b], y: boxes[p.b].y }, boxes[p.a].H, { w, h, vertical: true, time }));
    }
  };
  const loop = () => {
    let speed = 0;
    for (let k = 0; k < 2; k++) speed = Math.max(speed, springStep(st));
    paint();
    if (drag) frames = 0;
    if (drag || (speed > 0.05 && ++frames < 900)) { raf = requestAnimationFrame(loop); return; }
    raf = 0;
    const moves = {};
    gs.forEach((g, i) => { const dx = st.x[i] - x0[i]; if (Math.abs(dx) > 1.5) moves[g.dataset.id] = dx; });
    st.pinned.clear();
    if (Object.keys(moves).length) onCommit?.(moves);
  };
  const svgX = (e) => { const m = svg.getScreenCTM(); return m ? (e.clientX - m.e) / m.a : e.clientX; };

  const down = (e) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const g = e.target.closest('g[data-id]'); if (!g) return;
    const i = idx.get(g.dataset.id);
    if (!st) st = springState(boxes.map((b, k) => ({ ...b, x: x0[k] + (gs[k]._dx || 0) })), paths.map((p) => [p.a, p.b]), w);
    else { st.home.set(st.x); for (const l of st.links) l[2] = st.x[l[1]] - st.x[l[0]]; }
    drag = { i, start: svgX(e), x: st.x[i], pid: e.pointerId }; moved = false;
  };
  const move = (e) => {
    if (!drag) return;
    const dx = svgX(e) - drag.start;
    if (!moved && Math.abs(dx) < 4) return;
    // capture only once it is a real drag: capturing on press would retarget the click and break the popover
    if (!moved) { moved = true; st.pinned.add(drag.i); svg.classList.add('dragging'); svg.setPointerCapture?.(drag.pid); onDragStart?.(); }
    st.x[drag.i] = drag.x + dx;
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const up = () => {
    if (!drag) return;
    const was = moved; drag = null; svg.classList.remove('dragging');
    if (was) {
      // a drag is not a click: swallow the click that follows, so the popover does not open
      const stop = (ev) => ev.stopPropagation();
      svg.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => svg.removeEventListener('click', stop, { capture: true }), 60);
      if (!raf) raf = requestAnimationFrame(loop);
    }
  };
  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  return () => { cancelAnimationFrame(raf); svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); };
}
