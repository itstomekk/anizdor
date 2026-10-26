// GEDCOM 5.5.1 reader/writer (.ged). Pure JS, works in browser, Worker and Node.

/** Decode raw .ged bytes. Honors BOM and the HEAD.CHAR tag (UTF-8, ANSI/Windows-125x, ASCII, UNICODE). */
export function decodeGedcom(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder('utf-8').decode(u8.subarray(3));
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  // Sniff CHAR from the first 2 KB as latin1 (header is ASCII).
  const head = new TextDecoder('latin1').decode(u8.subarray(0, 2048));
  const m = head.match(/^\s*1\s+CHAR\s+(.+?)\s*$/im);
  const char = m ? m[1].toUpperCase() : 'UTF-8';
  let label = 'utf-8';
  if (char === 'ANSI' || char === 'WINDOWS-1250' || char === 'CP1250') label = 'windows-1250';
  else if (char === 'WINDOWS-1252' || char === 'CP1252' || char === 'IBMPC') label = 'windows-1252';
  else if (char === 'ASCII') label = 'latin1';
  else if (char === 'UNICODE') label = 'utf-16le';
  return new TextDecoder(label).decode(u8);
}

/** Parse GEDCOM text into a tree: [{level, xref, tag, value, children}]. CONC/CONT are folded into the value. */
export function parseTree(text) {
  const roots = [];
  const stack = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const m = raw.match(/^\s*(\d+)\s+(?:(@[^@\s]+@)\s+)?(\S+)(?: (.*))?$/);
    if (!m) continue; // tolerate junk lines
    const node = { level: +m[1], xref: m[2] || null, tag: m[3].toUpperCase(), value: m[4] ?? '', children: [] };
    if (node.tag === 'CONC' || node.tag === 'CONT') {
      const parent = stack[node.level - 1];
      if (parent) parent.value += (node.tag === 'CONT' ? '\n' : '') + node.value;
      continue;
    }
    stack.length = node.level;
    if (node.level === 0) roots.push(node);
    else if (stack[node.level - 1]) stack[node.level - 1].children.push(node);
    stack[node.level] = node;
  }
  return roots;
}

const child = (n, tag) => n.children.find((c) => c.tag === tag);
const childs = (n, tag) => n.children.filter((c) => c.tag === tag);
const val = (n, tag) => child(n, tag)?.value ?? '';

function eventOf(n, tag) {
  const e = child(n, tag);
  return e ? { date: val(e, 'DATE'), place: val(e, 'PLAC') } : { date: '', place: '' };
}

function splitName(raw) {
  const m = raw.match(/^([^/]*)\/([^/]*)\/?(.*)$/);
  return m ? { given: m[1].trim(), surname: m[2].trim(), suffix: m[3].trim() } : { given: raw.trim(), surname: '', suffix: '' };
}

/** Parse .ged text into a plain data model: { persons: {id: ...}, families: {id: ...}, header }. */
export function parseGedcom(text) {
  const tree = parseTree(text);
  const persons = {};
  const families = {};
  const header = {};
  for (const n of tree) {
    if (n.tag === 'HEAD') {
      header.source = val(child(n, 'SOUR') || { children: [] }, 'NAME') || val(n, 'SOUR');
      header.charset = val(n, 'CHAR');
      header.version = val(child(n, 'GEDC') || { children: [] }, 'VERS');
    } else if (n.tag === 'INDI' && n.xref) {
      const name = splitName(val(n, 'NAME'));
      persons[n.xref] = {
        id: n.xref, ...name,
        sex: val(n, 'SEX'),
        birth: eventOf(n, 'BIRT'), death: eventOf(n, 'DEAT'),
        famc: childs(n, 'FAMC').map((c) => c.value),
        fams: childs(n, 'FAMS').map((c) => c.value),
        notes: childs(n, 'NOTE').map((c) => c.value),
      };
    } else if (n.tag === 'FAM' && n.xref) {
      families[n.xref] = {
        id: n.xref,
        husband: val(n, 'HUSB'), wife: val(n, 'WIFE'),
        children: childs(n, 'CHIL').map((c) => c.value),
        marriage: eventOf(n, 'MARR'),
      };
    }
  }
  return { header, persons, families };
}

function emit(level, tag, value, out) {
  const v = String(value ?? '');
  const parts = v.split('\n');
  const first = parts.shift();
  const chunks = [];
  let rest = first;
  // GEDCOM line limit is 255 chars; split with CONC
  const MAX = 200;
  chunks.push(rest.slice(0, MAX)); rest = rest.slice(MAX);
  out.push(`${level} ${tag}${chunks[0] ? ' ' + chunks[0] : ''}`);
  while (rest.length) { out.push(`${level + 1} CONC ${rest.slice(0, MAX)}`); rest = rest.slice(MAX); }
  for (const p of parts) out.push(`${level + 1} CONT ${p}`);
}

/** Serialize the data model back to GEDCOM 5.5.1, UTF-8. */
export function serializeGedcom(model, { source = 'rodzina-tablica' } = {}) {
  const out = ['0 HEAD', `1 SOUR ${source}`, '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8'];
  const ev = (level, tag, e) => {
    if (!e || (!e.date && !e.place)) return;
    out.push(`${level} ${tag}`);
    if (e.date) emit(level + 1, 'DATE', e.date, out);
    if (e.place) emit(level + 1, 'PLAC', e.place, out);
  };
  for (const p of Object.values(model.persons)) {
    out.push(`0 ${p.id} INDI`);
    out.push(`1 NAME ${p.given || ''} /${p.surname || ''}/${p.suffix ? ' ' + p.suffix : ''}`);
    if (p.sex) out.push(`1 SEX ${p.sex}`);
    ev(1, 'BIRT', p.birth); ev(1, 'DEAT', p.death);
    for (const f of p.famc || []) out.push(`1 FAMC ${f}`);
    for (const f of p.fams || []) out.push(`1 FAMS ${f}`);
    for (const n of p.notes || []) emit(1, 'NOTE', n, out);
  }
  for (const f of Object.values(model.families)) {
    out.push(`0 ${f.id} FAM`);
    if (f.husband) out.push(`1 HUSB ${f.husband}`);
    if (f.wife) out.push(`1 WIFE ${f.wife}`);
    for (const c of f.children || []) out.push(`1 CHIL ${c}`);
    ev(1, 'MARR', f.marriage);
  }
  out.push('0 TRLR');
  return out.join('\r\n') + '\r\n';
}

/** Referential integrity check: returns a list of problems (empty = ok). */
export function validate(model) {
  const bad = [];
  for (const f of Object.values(model.families)) {
    for (const r of [f.husband, f.wife, ...f.children]) if (r && !model.persons[r]) bad.push(`${f.id}: missing person ${r}`);
  }
  for (const p of Object.values(model.persons)) {
    for (const r of [...p.famc, ...p.fams]) if (!model.families[r]) bad.push(`${p.id}: missing family ${r}`);
  }
  return bad;
}
