// Date helpers for GEDCOM dates (also accepts what people type in Polish).

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const PL_MON = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const PL_MON_FULL = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

export const isUnknownDate = (s) => !s || /^[.\s?-]*$/.test(s);

/** -> {year, month, day, qual} or null. qual: '', 'abt', 'bef', 'aft', 'bet' */
export function parseDate(s) {
  if (isUnknownDate(s)) return null;
  let t = s.trim().toUpperCase().replace(/\s+/g, ' ');
  let qual = '';
  const q = t.match(/^(ABT|ABOUT|EST|CAL|CA\.?|OK\.?|OKOŁO|BEF|BEFORE|PRZED|AFT|AFTER|PO|BET|BETWEEN|FROM|OD)\b\.?\s*(.*)$/);
  if (q) {
    const w = q[1];
    qual = /^(BEF|BEFORE|PRZED)/.test(w) ? 'bef' : /^(AFT|AFTER|PO)$/.test(w) ? 'aft' : /^(BET|BETWEEN|FROM|OD)/.test(w) ? 'bet' : 'abt';
    t = q[2];
  }
  t = t.replace(/\s+(AND|TO|DO|I)\s+.*$/, ''); // ranges: first part only
  let m;
  if ((m = t.match(/^(\d{1,2}) ([A-Z]{3})[A-Z]* (\d{4})\??$/)) && MON.includes(m[2])) return { year: +m[3], month: MON.indexOf(m[2]) + 1, day: +m[1], qual };
  if ((m = t.match(/^([A-Z]{3})[A-Z]* (\d{4})\??$/)) && MON.includes(m[1])) return { year: +m[2], month: MON.indexOf(m[1]) + 1, day: 0, qual };
  if ((m = t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/))) return { year: +m[3], month: +m[2], day: +m[1], qual };
  if ((m = t.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/))) return { year: +m[1], month: +m[2], day: +m[3], qual };
  if ((m = t.match(/^(\d{1,2})[.\-/](\d{4})$/))) return { year: +m[2], month: +m[1], day: 0, qual };
  if ((m = t.match(/^(\d{4})\??$/))) return { year: +m[1], month: 0, day: 0, qual };
  m = t.match(/\b(\d{4})\b/); // last resort: any 4-digit year
  return m ? { year: +m[1], month: 0, day: 0, qual } : null;
}

export const yearOf = (s) => parseDate(s)?.year ?? null;

/** Polish display form: "12 mar 1950", "ok. 1900", "przed 1900". Unknown -> ''. */
export function formatDate(s) {
  const d = parseDate(s);
  if (!d) return isUnknownDate(s) ? '' : String(s);
  const core = d.month ? `${d.day ? d.day + ' ' : ''}${PL_MON[d.month - 1]} ${d.year}` : String(d.year);
  const pre = { abt: 'ok. ', bef: 'przed ', aft: 'po ', bet: 'ok. ', '': '' }[d.qual];
  return pre + core + (/\?\s*$/.test(s || '') ? '?' : '');
}

export function formatLong(s) {
  const d = parseDate(s);
  if (!d || !d.month || !d.day) return formatDate(s);
  return `${d.day} ${PL_MON_FULL[d.month - 1]} ${d.year}`;
}

/** Normalize what the user typed to a GEDCOM date: 12.03.1950 -> 12 MAR 1950. Leaves anything else untouched. */
export function toGedcomDate(input) {
  const t = (input || '').trim();
  if (!t) return '';
  const d = parseDate(t);
  const plain = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$|^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$|^(\d{1,2})[.\-/](\d{4})$/.test(t);
  if (!d || !plain) return t;
  return `${d.day ? d.day + ' ' : ''}${d.month ? MON[d.month - 1] + ' ' : ''}${d.year}`;
}

export function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

export const PL_WEEKDAYS = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
/** Weekday index 0=Monday..6=Sunday for an exact (day-precise, unqualified) Gregorian date, else null. */
export function weekdayIndex(s) {
  const d = parseDate(s);
  if (!d || !d.day || !d.month || d.qual || d.year < 1583 || d.day > daysInMonth(d.year, d.month)) return null;
  const dt = new Date(2000, 0, 1); dt.setFullYear(d.year, d.month - 1, d.day);
  return (dt.getDay() + 6) % 7;
}
/** Polish weekday name ("niedziela") or ''. */
export const weekdayOf = (s) => { const i = weekdayIndex(s); return i == null ? '' : PL_WEEKDAYS[i]; };
