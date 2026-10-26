// "How are A and B related?" (blood relationship via the closest common ancestor).
import { displayName, parentsOf, spousesOf } from './tree.js';

function ancestors(model, id) {
  const dist = { [id]: 0 };
  let frontier = [id];
  for (let d = 1; frontier.length && d < 40; d++) {
    const next = [];
    for (const x of frontier) {
      const { father, mother } = parentsOf(model, x);
      for (const p of [father, mother]) if (p && model.persons[p] && dist[p] == null) { dist[p] = d; next.push(p); }
    }
    frontier = next;
  }
  return dist;
}

const gen = (n, m, f, sex, prefix = 'pra') => {
  const base = sex === 'F' ? f : m;
  return n <= 1 ? base : prefix.repeat(n - 1) + base;
};

/** What `a` is to `b`, in Polish, plus the path numbers. */
function label(da, db, sexA) {
  const F = sexA === 'F', M = sexA === 'M';
  const pick = (m, f, both) => (F ? f : M ? m : both);
  if (da === 0 && db > 0) { // a is an ancestor of b
    if (db === 1) return pick('ojciec', 'matka', 'rodzic');
    if (db === 2) return pick('dziadek', 'babcia', 'dziadek lub babcia');
    return db <= 5 ? pick(gen(db - 1, 'dziadek', 'babcia'), gen(db - 1, 'babcia', 'babcia'), 'przodek') : `przodek (${db}. pokolenie wstecz)`;
  }
  if (db === 0 && da > 0) {
    if (da === 1) return pick('syn', 'córka', 'dziecko');
    if (da === 2) return pick('wnuk', 'wnuczka', 'wnuk lub wnuczka');
    return da <= 5 ? pick(gen(da - 1, 'wnuk', 'wnuczka'), gen(da - 1, 'wnuczka', 'wnuczka'), 'potomek') : `potomek (${da}. pokolenie)`;
  }
  if (da === 1 && db === 1) return pick('brat', 'siostra', 'rodzeństwo');
  if (da === 1 && db === 2) return pick('wujek (brat rodzica)', 'ciocia (siostra rodzica)', 'wujek lub ciocia');
  if (da === 2 && db === 1) return pick('bratanek lub siostrzeniec', 'bratanica lub siostrzenica', 'bratanek/siostrzeniec');
  if (da === 1 && db === 3) return pick('stryjeczny/wujeczny dziadek', 'stryjeczna/wujeczna babcia', 'brat lub siostra dziadka/babci');
  if (da === db) return `${pick('kuzyn', 'kuzynka', 'kuzyn')} ${da - 1}. stopnia`;
  return 'dalszy krewny';
}

export function relate(model, a, b) {
  if (a === b) return { kind: 'self', text: 'To ta sama osoba.' };
  const A = ancestors(model, a), B = ancestors(model, b);
  let best = null;
  for (const id of Object.keys(A)) {
    if (B[id] == null) continue;
    const total = A[id] + B[id];
    if (!best || total < best.total) best = { ca: id, da: A[id], db: B[id], total };
  }
  const pa = model.persons[a], pb = model.persons[b];
  if (!best) {
    const married = spousesOf(model, a).some((s) => s.spouse === b);
    return { kind: married ? 'spouse' : 'none', text: married ? `${displayName(pa)} i ${displayName(pb)} są małżonkami (partnerami).` : 'Nie znalazłem wspólnego przodka w tym drzewie (brak pokrewieństwa krwi).' };
  }
  const rel = label(best.da, best.db, pa.sex);
  const line = best.da === 0 || best.db === 0 ? 'w linii prostej' : 'w linii bocznej';
  const ca = best.da && best.db ? `Wspólny przodek: ${displayName(model.persons[best.ca])} (${best.da} pokol. nad ${displayName(pa)}, ${best.db} nad ${displayName(pb)}). ` : '';
  return { kind: best.da === 0 || best.db === 0 ? 'direct' : 'collateral', ...best, rel,
    text: `${displayName(pa)} jest dla ${displayName(pb)}: ${rel}. ${ca}Pokrewieństwo ${line}, ${best.total}. stopnia.` };
}
