// Import past invoices, entirely on-device.
//  - PDFs made by this app: read back exactly (embedded data).
//  - Other PDFs: extract the text layer and guess number, dates, client, items, totals.
//  - CSV: price lists or invoice line exports.
import { DATA_MARK } from './pdf.js';
import { uid, isoOf, num, round2, getFormat } from './util.js';

const bin = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return s;
};

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') return null;
  for (const fmt of ['deflate', 'deflate-raw']) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { /* try next */ }
  }
  return null;
}

// ---------- PDF object parsing ----------
function balanced(s, i) {
  // s[i..] starts with '<<' ; return index after the matching '>>'
  let depth = 0;
  while (i < s.length) {
    if (s[i] === '<' && s[i + 1] === '<') { depth++; i += 2; continue; }
    if (s[i] === '>' && s[i + 1] === '>') { depth--; i += 2; if (!depth) return i; continue; }
    if (s[i] === '(') { // skip literal strings
      let d = 1; i++;
      while (i < s.length && d) { if (s[i] === '\\') i++; else if (s[i] === '(') d++; else if (s[i] === ')') d--; i++; }
      continue;
    }
    i++;
  }
  return s.length;
}
function dictValue(dict, key) {
  const m = new RegExp('/' + key + '(?![A-Za-z0-9])\\s*').exec(dict);
  if (!m) return null;
  const i = m.index + m[0].length;
  if (dict.startsWith('<<', i)) return dict.slice(i, balanced(dict, i));
  const r = /^(\d+)\s+(\d+)\s+R/.exec(dict.slice(i));
  if (r) return { ref: +r[1] };
  if (dict[i] === '[') return dict.slice(i, dict.indexOf(']', i) + 1);
  const t = /^[^\s/<>\[\]()]+|^\/[^\s/<>\[\]()]+/.exec(dict.slice(i));
  return t ? t[0] : null;
}

async function parsePdf(u8) {
  const s = bin(u8);
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const sm = /(>>\s*)stream(\r\n|\n|\r)/g;
    sm.lastIndex = start;
    const endObj = s.indexOf('endobj', start);
    const st = sm.exec(s);
    let o;
    if (st && (endObj < 0 || st.index < endObj)) {
      const dataStart = st.index + st[0].length;
      const es = s.indexOf('endstream', dataStart);
      let dataEnd = es < 0 ? s.length : es;
      while (dataEnd > dataStart && (s[dataEnd - 1] === '\n' || s[dataEnd - 1] === '\r')) dataEnd--;
      const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(s.slice(start, st.index + 2));
      if (len && +len[1] <= dataEnd - dataStart + 2) dataEnd = dataStart + +len[1];
      o = { dict: s.slice(start, st.index + st[1].length), data: u8.subarray(dataStart, dataEnd) };
      re.lastIndex = es < 0 ? s.length : es;
    } else {
      o = { dict: s.slice(start, endObj < 0 ? s.length : endObj) };
      if (endObj > 0) re.lastIndex = endObj;
    }
    objs.set(+m[1], o);
  }
  const decode = async (o) => {
    if (!o || !o.data) return null;
    if (o.decoded !== undefined) return o.decoded;
    const filt = /\/Filter\s*\[?\s*\/(\w+)/.exec(o.dict);
    let out = null;
    if (!filt) out = o.data;
    else if (filt[1] === 'FlateDecode' && !/\/Filter\s*\[\s*\/\w+\s+\//.test(o.dict)) out = await inflate(o.data);
    o.decoded = out ? bin(out) : null;
    return o.decoded;
  };
  // unpack compressed object streams
  for (const [, o] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const d = await decode(o);
    if (!d) continue;
    const n = +(/\/N\s+(\d+)/.exec(o.dict) || [])[1], first = +(/\/First\s+(\d+)/.exec(o.dict) || [])[1];
    const head = d.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const id = head[i * 2], off = head[i * 2 + 1], next = i + 1 < n ? head[i * 2 + 3] : d.length - first;
      if (!objs.has(id)) objs.set(id, { dict: d.slice(first + off, first + next) });
    }
  }
  return { objs, decode, raw: s };
}

function parseCMap(text) {
  const map = new Map();
  let codeLen = 1;
  const hex = (h) => parseInt(h, 16);
  const uni = (h) => {
    let str = '';
    for (let i = 0; i + 4 <= h.length; i += 4) str += String.fromCharCode(hex(h.slice(i, i + 4)));
    if (h.length === 2) str = String.fromCharCode(hex(h));
    return str;
  };
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      codeLen = Math.max(codeLen, p[1].length / 2);
      map.set(hex(p[1]), uni(p[2]));
    }
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      codeLen = Math.max(codeLen, p[1].length / 2);
      const lo = hex(p[1]), hi = hex(p[2]);
      if (p[3][0] === '[') {
        const arr = [...p[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1]);
        for (let c = lo; c <= hi && c - lo < arr.length; c++) map.set(c, uni(arr[c - lo]));
      } else {
        const dst = p[3].slice(1, -1);
        const base = hex(dst.slice(-4)), prefix = dst.length > 4 ? uni(dst.slice(0, -4)) : '';
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, prefix + String.fromCharCode(base + c - lo));
      }
    }
  }
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text);
  if (cs) codeLen = cs[1].length / 2;
  return { map, codeLen };
}

const WIN_HI = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
function decodeSimple(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes.charCodeAt(i);
    s += c >= 0x80 && c < 0xa0 ? WIN_HI[c - 0x80] : String.fromCharCode(c);
  }
  return s;
}

// Tokenise a content stream and collect positioned text fragments.
function contentText(src, fonts, frags, pageIdx) {
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = tm, font = null, size = 10, lead = 0;
  let ops = [];
  const show = (str) => {
    const fi = fonts[font] || null;
    let text = '';
    if (fi && fi.cmap) {
      const L = fi.cmap.codeLen;
      for (let i = 0; i + L <= str.length; i += L) {
        let code = 0;
        for (let k = 0; k < L; k++) code = code * 256 + str.charCodeAt(i + k);
        text += fi.cmap.map.get(code) ?? (L === 1 ? String.fromCharCode(code) : '');
      }
    } else text = decodeSimple(str);
    const m = mul(tm, ctm);
    const tx = text.length * size * 0.5; // glyph widths unknown: assume half an em
    if (text) frags.push({ page: pageIdx, x: m[4], y: m[5], s: text, size: Math.abs(size * Math.hypot(m[2], m[3])) || size, w: tx * Math.hypot(m[0], m[1]) });
    tm = mul([1, 0, 0, 1, tx, 0], tm);
  };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0') { i++; continue; }
    if (c === '%') { while (i < n && src[i] !== '\n' && src[i] !== '\r') i++; continue; }
    if (c === '(') {
      let d = 1, out = '';
      i++;
      while (i < n && d) {
        const ch = src[i];
        if (ch === '\\') {
          const nx = src[i + 1];
          const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[nx];
          if (esc) { out += esc; i += 2; }
          else if (/[0-7]/.test(nx)) { const o = /^[0-7]{1,3}/.exec(src.slice(i + 1, i + 4))[0]; out += String.fromCharCode(parseInt(o, 8)); i += 1 + o.length; }
          else if (nx === '\r' || nx === '\n') { i += nx === '\r' && src[i + 2] === '\n' ? 3 : 2; }
          else { out += nx; i += 2; }
          continue;
        }
        if (ch === '(') d++;
        else if (ch === ')') { d--; if (!d) { i++; break; } }
        out += ch; i++;
      }
      ops.push({ str: out });
      continue;
    }
    if (c === '<' && src[i + 1] !== '<') {
      const e = src.indexOf('>', i);
      let h = src.slice(i + 1, e).replace(/\s+/g, '');
      if (h.length % 2) h += '0';
      let out = '';
      for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.slice(k, k + 2), 16));
      ops.push({ str: out });
      i = e + 1;
      continue;
    }
    if (c === '[') { ops.push({ arr: 'start' }); i++; continue; }
    if (c === ']') {
      const k = ops.map((o) => o.arr).lastIndexOf('start');
      const items = ops.slice(k + 1);
      ops = ops.slice(0, k);
      ops.push({ list: items });
      i++;
      continue;
    }
    if (c === '<' || c === '>') { i += 2; continue; }
    if (c === '/') {
      const mm = /^\/[^\s/<>\[\]()%{}]*/.exec(src.slice(i, i + 128));
      ops.push({ name: mm[0].slice(1) });
      i += mm[0].length;
      continue;
    }
    const mm = /^[^\s/<>\[\]()%{}]+/.exec(src.slice(i, i + 64));
    if (!mm) { i++; continue; }
    const tok = mm[0];
    i += tok.length;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) { ops.push({ n: parseFloat(tok) }); continue; }
    const nums = () => ops.filter((o) => 'n' in o).map((o) => o.n);
    switch (tok) {
      case 'q': stack.push(ctm); break;
      case 'Q': ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; break;
      case 'cm': { const a = nums().slice(-6); if (a.length === 6) ctm = mul(a, ctm); break; }
      case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': { const nm = ops.find((o) => o.name); font = nm ? nm.name : font; size = nums().slice(-1)[0] || size; break; }
      case 'TL': lead = nums().slice(-1)[0] || 0; break;
      case 'Td': case 'TD': { const [x, y] = nums().slice(-2); if (tok === 'TD') lead = -y; tlm = mul([1, 0, 0, 1, x, y], tlm); tm = tlm; break; }
      case 'Tm': { const a = nums().slice(-6); if (a.length === 6) { tlm = tm = a; } break; }
      case 'T*': tlm = mul([1, 0, 0, 1, 0, -lead], tlm); tm = tlm; break;
      case "'": case '"': tlm = mul([1, 0, 0, 1, 0, -lead], tlm); tm = tlm; // fallthrough
      case 'Tj': { const st = ops.filter((o) => 'str' in o).pop(); if (st) show(st.str); break; }
      case 'TJ': {
        const l = ops.find((o) => o.list);
        if (l) for (const it of l.list) {
          if ('str' in it) show(it.str);
          else if ('n' in it) {
            const adv = (-it.n / 1000) * size;
            tm = mul([1, 0, 0, 1, adv, 0], tm);
            if (it.n < -180 && frags.length) frags[frags.length - 1].s += ' ';
          }
        }
        break;
      }
      case 'ID': { const e = src.indexOf('EI', i); i = e < 0 ? n : e + 2; break; }
      default: break;
    }
    ops = [];
  }
}

function groupLines(frags) {
  frags.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines = [];
  for (const f of frags) {
    const last = lines[lines.length - 1];
    if (last && last.page === f.page && Math.abs(last.y - f.y) < Math.max(2, f.size * 0.45)) last.frags.push(f);
    else lines.push({ page: f.page, y: f.y, frags: [f] });
  }
  return lines.map((l) => {
    l.frags.sort((a, b) => a.x - b.x);
    let out = '';
    let end = null;
    for (const f of l.frags) {
      if (end !== null) {
        const gap = f.x - end;
        if (gap > f.size * 1.5) out = out.trimEnd() + '   ';
        else if (gap > f.size * 0.18 && !out.endsWith(' ') && !f.s.startsWith(' ')) out += ' ';
      }
      out += f.s;
      end = f.x + f.w;
    }
    return out.replace(/[ \t]+$/, '');
  }).filter((s) => s.trim());
}

export async function pdfToLines(u8) {
  const { objs, decode } = await parsePdf(u8);
  // fonts with ToUnicode maps
  const fontInfo = new Map();
  for (const [id, o] of objs) {
    if (!/\/Type\s*\/Font\b/.test(o.dict) && !/\/BaseFont/.test(o.dict)) continue;
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(o.dict);
    let cmap = null;
    if (tu) {
      const t = await decode(objs.get(+tu[1]));
      if (t) cmap = parseCMap(t);
    }
    fontInfo.set(id, { cmap });
  }
  const fontsFromRes = (res) => {
    const out = {};
    if (!res) return out;
    let dict = typeof res === 'object' ? (objs.get(res.ref) || {}).dict || '' : res;
    let fd = dictValue(dict, 'Font');
    if (fd && typeof fd === 'object') fd = (objs.get(fd.ref) || {}).dict || '';
    if (typeof fd !== 'string') return out;
    for (const p of fd.matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) out[p[1]] = fontInfo.get(+p[2]) || null;
    return out;
  };
  const globalFonts = {};
  for (const [, o] of objs) {
    const r = dictValue(o.dict, 'Resources');
    if (r) Object.assign(globalFonts, { ...fontsFromRes(r), ...globalFonts });
  }

  const frags = [];
  const pages = [...objs.entries()].filter(([, o]) => /\/Type\s*\/Page(?!s)\b/.test(o.dict));
  let pi = 0;
  for (const [, pg] of pages) {
    const fonts = { ...globalFonts, ...fontsFromRes(dictValue(pg.dict, 'Resources')) };
    const cv = dictValue(pg.dict, 'Contents');
    const refs = typeof cv === 'object' && cv ? [cv.ref] : typeof cv === 'string' ? [...cv.matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => +x[1]) : [];
    let src = '';
    for (const r of refs) src += ((await decode(objs.get(r))) || '') + '\n';
    // text inside form XObjects used by this page
    let resDict = dictValue(pg.dict, 'Resources');
    if (resDict && typeof resDict === 'object') resDict = (objs.get(resDict.ref) || {}).dict || '';
    let xo = resDict ? dictValue(resDict, 'XObject') : null;
    if (xo && typeof xo === 'object') xo = (objs.get(xo.ref) || {}).dict || '';
    contentText(src, fonts, frags, pi);
    if (typeof xo === 'string') {
      for (const p of xo.matchAll(/\/[^\s/]+\s+(\d+)\s+\d+\s+R/g)) {
        const o = objs.get(+p[1]);
        if (o && /\/Subtype\s*\/Form/.test(o.dict)) {
          const t = await decode(o);
          if (t) contentText(t, { ...fonts, ...fontsFromRes(dictValue(o.dict, 'Resources')) }, frags, pi);
        }
      }
    }
    pi++;
  }
  if (!frags.length) {
    // no page tree found: scan every stream that looks like text content
    for (const [, o] of objs) {
      const t = o.data && !/\/Subtype\s*\/Image|\/ObjStm|\/XRef|\/Length1|\/FontFile/.test(o.dict) ? await decode(o) : null;
      if (t && /\bBT\b/.test(t)) contentText(t, globalFonts, frags, 0);
    }
  }
  return groupLines(frags);
}

// ---------- Heuristics: text lines -> invoice fields ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function findDate(line) {
  let m;
  const mk = (y, mo, d) => {
    y = +y; if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return isoOf(new Date(y, mo - 1, d));
  };
  if ((m = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(line))) return mk(m[1], +m[2], +m[3]);
  if ((m = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/.exec(line))) {
    let a = +m[1], b = +m[2];
    const us = /US|CA|PH/.test(getFormat().locale.split('-')[1] || '');
    let d = us ? b : a, mo = us ? a : b;
    if (a > 12) { d = a; mo = b; } else if (b > 12) { d = b; mo = a; }
    return mk(m[3], mo, d);
  }
  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  if ((m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${mon},?\\s+(\\d{4})`, 'i').exec(line))) return mk(m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
  if ((m = new RegExp(`\\b${mon}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, 'i').exec(line))) return mk(m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  return null;
}

const MONEY_RE = /(?:[£$€¥]|USD|GBP|EUR|AUD|CAD)?\s?-?(?:\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})(?![\d%])/g;
const moneyIn = (line) => [...line.replace(findDateText(line), ' ').matchAll(MONEY_RE)].map((m) => round2(num(m[0].replace(/,/g, ''))));
function findDateText(line) {
  const m = /\b\d{1,4}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/.exec(line);
  return m ? m[0] : '\u0000';
}
const isNumTok = (t) => /^[£$€¥]?\s?-?[\d,]*\.?\d+%?$/.test(t.trim()) && /\d/.test(t);

export function guessInvoice(lines) {
  const res = { number: '', issueDate: '', dueDate: '', client: { name: '', email: '', address: '', phone: '' }, items: [], subtotal: null, tax: null, taxRate: null, total: null, warnings: [] };
  const L = lines.map((s) => s.replace(/\s+$/, ''));
  const low = L.map((s) => s.toLowerCase());

  // invoice number
  for (const s of L) {
    const m = /invoice\s*(?:no\.?|number|num\.?|#|ref(?:erence)?\.?|id)?\s*[:#.]?\s*([A-Za-z]{0,6}[-/]?\d[\w\-/]*)/i.exec(s);
    if (m && !/^(date|due)/i.test(m[1])) { res.number = m[1]; break; }
  }
  if (!res.number) for (const s of L) { const m = /\b(INV[-\s]?\d[\w-]*)/i.exec(s) || /(?:^|\s)#\s?([A-Z0-9-]*\d[A-Z0-9-]*)/i.exec(s); if (m) { res.number = m[1].replace(/\s/g, ''); break; } }

  // dates
  const dateNear = (i) => findDate(L[i]) || (L[i + 1] ? findDate(L[i + 1]) : null);
  for (let i = 0; i < L.length; i++) {
    if (!res.dueDate && /\b(due date|payment due|due by|due on|due)\b/i.test(L[i])) {
      // if the line has two dates (e.g. "Date ... Due ...") take the one after "due"
      const after = L[i].slice(low[i].search(/due/));
      res.dueDate = findDate(after) || (L[i + 1] ? findDate(L[i + 1]) : null) || '';
    }
    if (!res.issueDate && /(invoice date|issue date|date of issue|issued|dated|^\s*date\b|\bdate\s*:)/i.test(L[i]) && !/^\s*due/i.test(L[i])) {
      res.issueDate = dateNear(i) || '';
    }
  }
  if (!res.issueDate) { for (const s of L) { const d = findDate(s); if (d) { res.issueDate = d; break; } } }

  // totals
  const lastMoney = (i) => { const a = moneyIn(L[i]); if (a.length) return a[a.length - 1]; const b = L[i + 1] ? moneyIn(L[i + 1]) : []; return b.length ? b[0] : null; };
  const labels = [/amount due|balance due|total due|amount payable|balance\b/, /grand total|invoice total|total amount|total \(?inc/, /(^|[^b-])total\b(?!\s*(vat|tax|excl|ex\b|before))/];
  for (const re of labels) {
    for (let i = L.length - 1; i >= 0; i--) {
      if (re.test(low[i]) && !/sub\s*-?total/.test(low[i])) { const v = lastMoney(i); if (v !== null) { res.total = v; break; } }
    }
    if (res.total !== null) break;
  }
  for (let i = 0; i < L.length; i++) {
    if (res.subtotal === null && /sub\s*-?total|total\s*(excl|ex\.?\s|before)|net\s*(total|amount)/.test(low[i])) res.subtotal = lastMoney(i);
    if (res.tax === null && /\b(vat|tax|gst|hst)\b/.test(low[i]) && !/(no\.|number|reg|id\b)/.test(low[i])) {
      const v = moneyIn(L[i]);
      if (v.length) { res.tax = v[v.length - 1]; const r = /(\d{1,2}(?:\.\d+)?)\s*%/.exec(L[i]); if (r) res.taxRate = +r[1]; }
    }
  }
  if (res.total === null) {
    const all = L.flatMap(moneyIn);
    if (all.length) res.total = Math.max(...all);
  }

  // client
  const labelRe = /^(.*?)(bill(?:ed)?\s*to|invoice\s*to|sold\s*to|customer|client|ship\s*to|^to)\s*:?\s*(.*)$/i;
  for (let i = 0; i < L.length; i++) {
    const m = labelRe.exec(L[i]);
    if (!m || /customer (id|no|number)|client (id|no|number)/i.test(L[i])) continue;
    const rest = m[3].split(/\s{3,}/)[0].trim();
    const block = [];
    if (rest) block.push(rest);
    for (let k = i + 1; k < L.length && block.length < 6; k++) {
      const t = L[k].split(/\s{3,}/)[0].trim();
      if (!t || /invoice|date|description|qty|amount|total|^item/i.test(t)) break;
      block.push(t);
    }
    if (block.length) {
      const email = block.join(' ').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      const phone = block.find((b) => /^[+()\d\s-]{7,}$/.test(b));
      const rows = block.filter((b) => !(email && b.includes(email[0])) && b !== phone);
      res.client = { name: rows[0] || '', address: rows.slice(1).join('\n'), email: email ? email[0] : '', phone: phone || '' };
      break;
    }
  }
  if (!res.client.email) {
    const all = L.join(' ').match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
    if (all.length > 1) res.client.email = all[all.length - 1];
  }

  // line items
  let start = low.findIndex((s) => /(description|item|service|product|details)/.test(s) && /(qty|quantity|hrs|hours|units?|price|rate|amount|total|cost)/.test(s));
  let end = low.findIndex((s, i) => i > start && /sub\s*-?total|^\s*total|\btotal\b|amount due|balance due|\bvat\b|\btax\b/.test(s));
  if (end < 0) end = L.length;
  const from = start >= 0 ? start + 1 : 0;
  for (let i = from; i < end; i++) {
    const line = L[i].trim();
    if (!line) continue;
    const parts = line.split(/\s{2,}/).length > 1 ? line.split(/\s{2,}/) : line.split(/\s+/);
    const numsTail = [];
    while (parts.length && isNumTok(parts[parts.length - 1])) numsTail.unshift(parts.pop());
    // also allow "2 x £30.00" style
    const desc = parts.join(' ').replace(/\s+[x×]\s*$/i, '').trim();
    const vals = numsTail.filter((t) => !t.includes('%')).map((t) => num(t.replace(/,/g, '')));
    const hasMoney = moneyIn(line).length > 0;
    if (!vals.length || !hasMoney || !desc || /^(page|invoice|date|due)\b/i.test(desc) || findDate(line)) {
      if (res.items.length && desc && !vals.length && desc.length < 90 && start >= 0) {
        const it = res.items[res.items.length - 1];
        it.description = (it.description ? it.description + ' ' : '') + desc;
      }
      continue;
    }
    let qty = 1, price = vals[vals.length - 1];
    if (vals.length >= 3) {
      const [a, b, c] = vals.slice(-3);
      if (Math.abs(a * b - c) < 0.05 * Math.max(1, c)) { qty = a; price = b; }
      else if (Math.abs(vals[0] * vals[1] - c) < 0.05 * Math.max(1, c)) { qty = vals[0]; price = vals[1]; }
      else { qty = 1; price = c; }
    } else if (vals.length === 2) {
      const [a, b] = vals;
      if (a > 0 && Math.abs(Math.round(b / a) - b / a) < 0.001 && b / a <= 1000 && b !== a) { qty = round2(b / a); price = a; }
      else if (a > 0 && a < 1000 && Number.isInteger(a) && b >= a && !String(numsTail[0]).includes('.')) { qty = a; price = round2(b / a); }
      else if (a === b) { qty = 1; price = a; }
      else { qty = 1; price = b; }
    }
    res.items.push({ id: uid(), name: desc.slice(0, 120), description: '', qty, price: round2(price), unit: '' });
  }

  const sum = round2(res.items.reduce((s, it) => s + it.qty * it.price, 0));
  const target = res.subtotal ?? (res.total !== null && res.tax !== null ? round2(res.total - res.tax) : res.total);
  if (res.items.length && target !== null && Math.abs(sum - target) > 0.02) res.warnings.push(`Detected items add up to ${sum.toFixed(2)} but the invoice says ${target.toFixed(2)} — please check the lines.`);
  if (!res.items.length) res.warnings.push('No line items could be detected — add them below, or save the total as a single line.');
  if (res.tax && !res.taxRate && target) res.taxRate = round2((res.tax / target) * 100);
  return res;
}

// ---------- entry points ----------
export async function importPdfFile(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  const head = bin(u8.subarray(0, Math.min(u8.length, 200000)));
  const k = head.indexOf(DATA_MARK);
  if (k >= 0) {
    const b64 = head.slice(k + DATA_MARK.length, head.indexOf('\n', k));
    try {
      const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      const data = JSON.parse(json);
      return { exact: true, inv: data.inv, fileName: file.name };
    } catch { /* fall back to text */ }
  }
  if (!/^%PDF/.test(head.slice(0, 1024).trimStart())) throw new Error('That file is not a PDF.');
  const lines = await pdfToLines(u8);
  if (!lines.length) throw new Error('No text found in this PDF (it may be a scanned image). You can still enter it manually.');
  return { exact: false, guess: guessInvoice(lines), lines, fileName: file.name };
}

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

// Returns { kind: 'items', items } or { kind: 'invoices', invoices }
export function csvToData(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one data row.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => (n instanceof RegExp ? n.test(h) : h === n)));
  const c = {
    inv: col(/^invoice\s*(no|number|#|num|id)?$/, 'number', 'invoice'),
    date: col(/date/),
    client: col(/client|customer|bill to|company/),
    email: col(/e-?mail/),
    name: col(/^(item|name|product|service|description|item name)$/, /item|product|service|name/),
    desc: col(/^(description|details|notes)$/),
    qty: col(/qty|quantity|hours|units/),
    price: col(/unit\s*price|^price$|^rate$|unit cost|^cost$/, /price|rate|cost/),
    amount: col(/^(amount|total|line total)$/, /amount|total/),
    unit: col(/^unit$/),
    status: col(/status|paid/),
  };
  if (c.name === c.desc) c.desc = -1;
  const get = (r, i) => (i >= 0 ? (r[i] || '').trim() : '');
  const data = rows.slice(1);
  const line = (r) => {
    const qty = c.qty >= 0 ? num(get(r, c.qty)) || 1 : 1;
    let price = c.price >= 0 ? num(get(r, c.price).replace(/,/g, '')) : 0;
    if (!price && c.amount >= 0) price = round2(num(get(r, c.amount).replace(/,/g, '')) / qty);
    return { id: uid(), name: get(r, c.name) || get(r, c.desc), description: c.desc >= 0 && c.desc !== c.name ? get(r, c.desc) : '', qty, price: round2(price), unit: get(r, c.unit) };
  };
  if (c.inv < 0) {
    const items = data.map(line).filter((x) => x.name);
    if (!items.length) throw new Error('Could not find an item/name column in the CSV.');
    return { kind: 'items', items };
  }
  const groups = new Map();
  for (const r of data) {
    const no = get(r, c.inv);
    if (!no) continue;
    if (!groups.has(no)) groups.set(no, { number: no, issueDate: findDate(get(r, c.date)) || '', client: { name: get(r, c.client), email: get(r, c.email) }, status: /paid|yes|true/i.test(get(r, c.status)) ? 'paid' : 'sent', items: [] });
    const l = line(r);
    if (l.name || l.price) groups.get(no).items.push(l);
  }
  return { kind: 'invoices', invoices: [...groups.values()] };
}
