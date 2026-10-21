// Invoice layout engine.
// A template is a list of positioned blocks on a page (in PDF points).
// layout() turns template + invoice data into a flat "display list" of drawing
// ops that both the on-screen canvas and the PDF writer play back, so what you
// see in the editor is exactly what ends up in the PDF.
import { money, fmtDate, totals, lineAmount, clientAddressLines, num } from './util.js';

export const PAGES = { A4: { w: 595.28, h: 841.89 }, Letter: { w: 612, h: 792 } };
export const MARGIN = 40;

export const FONTS = {
  sans: { css: 'Helvetica, Arial, sans-serif', pdf: ['Helvetica', 'Helvetica-Bold'], label: 'Sans' },
  serif: { css: '"Times New Roman", Times, serif', pdf: ['Times-Roman', 'Times-Bold'], label: 'Serif' },
  mono: { css: '"Courier New", Courier, monospace', pdf: ['Courier', 'Courier-Bold'], label: 'Mono' },
};

export const BLOCK_TYPES = {
  band: { label: 'Colour band', unique: false },
  logo: { label: 'Logo', unique: true },
  business: { label: 'Your business', unique: true },
  title: { label: 'Title', unique: true, hasText: true },
  meta: { label: 'Invoice details', unique: true },
  client: { label: 'Bill to', unique: true, hasText: true },
  items: { label: 'Items table', unique: true },
  totals: { label: 'Totals', unique: true },
  notes: { label: 'Notes & terms', unique: true },
  payment: { label: 'Payment details', unique: true, hasText: true },
  text: { label: 'Text', unique: false, hasText: true },
  divider: { label: 'Divider line', unique: false },
  footer: { label: 'Footer', unique: true, hasText: true },
};

const B = (type, x, y, w, extra = {}) => ({ id: type + '-' + Math.random().toString(36).slice(2, 7), type, x, y, w, visible: true, size: 9, align: 'left', ...extra });

export function presetTemplate(name = 'classic') {
  const W = PAGES.A4.w, R = W - MARGIN, full = W - MARGIN * 2;
  const base = { page: 'A4', font: 'sans', accent: '#2457d6', tableStyle: 'solid', zebra: true, preset: name };
  if (name === 'modern') {
    return {
      ...base, accent: '#0f766e', tableStyle: 'solid',
      blocks: [
        B('band', 0, 0, W, { h: 120 }),
        B('title', MARGIN, 52, 250, { size: 30, text: 'INVOICE', color: 'white' }),
        B('logo', R - 110, 30, 110, { align: 'right' }),
        B('business', MARGIN, 140, 240, { size: 9 }),
        B('meta', R - 210, 140, 210, { size: 9 }),
        B('client', MARGIN, 230, 260, { size: 10, text: 'BILLED TO' }),
        B('items', MARGIN, 330, full, { size: 9 }),
        B('totals', R - 220, 440, 220, { size: 10 }),
        B('notes', MARGIN, 440, 255, { size: 8.5 }),
        B('payment', MARGIN, 540, 255, { size: 8.5, text: 'PAYMENT DETAILS' }),
        B('footer', MARGIN, 800, full, { size: 8, align: 'center', text: 'Thank you for your business!' }),
      ],
    };
  }
  if (name === 'minimal') {
    return {
      ...base, accent: '#111827', tableStyle: 'lines', zebra: false, font: 'serif',
      blocks: [
        B('business', MARGIN, 48, 260, { size: 9 }),
        B('title', R - 220, 44, 220, { size: 22, align: 'right', text: 'Invoice' }),
        B('meta', R - 200, 80, 200, { size: 9 }),
        B('divider', MARGIN, 160, full),
        B('client', MARGIN, 180, 260, { size: 10, text: 'Billed to' }),
        B('items', MARGIN, 280, full, { size: 9.5 }),
        B('totals', R - 210, 395, 210, { size: 10 }),
        B('notes', MARGIN, 395, 260, { size: 9 }),
        B('payment', MARGIN, 500, 260, { size: 9, text: 'Payment' }),
        B('footer', MARGIN, 805, full, { size: 8, align: 'center', text: '' }),
      ],
    };
  }
  return {
    ...base,
    blocks: [
      B('logo', MARGIN, MARGIN, 120),
      B('title', R - 230, 42, 230, { size: 28, align: 'right', text: 'INVOICE' }),
      B('meta', R - 200, 86, 200, { size: 9 }),
      B('business', MARGIN, 110, 250, { size: 9 }),
      B('client', MARGIN, 245, 260, { size: 10, text: 'BILL TO' }),
      B('items', MARGIN, 350, full, { size: 9 }),
      B('totals', R - 220, 460, 220, { size: 10 }),
      B('notes', MARGIN, 460, 260, { size: 8.5 }),
      B('payment', MARGIN, 555, 260, { size: 8.5, text: 'PAYMENT DETAILS' }),
      B('footer', MARGIN, 800, full, { size: 8, align: 'center', text: 'Thank you for your business!' }),
    ],
  };
}

export const newBlock = (type, page = 'A4') => {
  const W = PAGES[page].w;
  const d = {
    band: { x: 0, y: 0, w: W, h: 60 },
    divider: { x: MARGIN, y: 200, w: W - MARGIN * 2 },
    text: { x: MARGIN, y: 200, w: 250, text: 'Your text here', size: 10 },
  }[type] || { x: MARGIN, y: 200, w: 220 };
  return B(type, d.x, d.y, d.w, d);
};

// ---- text measuring (shared by canvas + PDF so both wrap identically) ----
const mctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const mcache = new Map();
export function fontCss(font, size, bold) {
  return `${bold ? 'bold ' : ''}${size}px ${(FONTS[font] || FONTS.sans).css}`;
}
export function measure(text, size, bold, font) {
  const key = font + (bold ? 'b' : 'n') + text;
  let w = mcache.get(key);
  if (w === undefined) {
    if (mctx) { mctx.font = fontCss(font, 100, bold); w = mctx.measureText(text).width / 100; }
    else w = text.length * 0.5;
    if (mcache.size > 5000) mcache.clear();
    mcache.set(key, w);
  }
  return w * size;
}
function wrap(text, maxW, size, bold, font) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (line && measure(test.trimEnd(), size, bold, font) > maxW) {
        out.push(line.trimEnd());
        line = w.trimStart();
        // hard-break very long words
        while (measure(line, size, bold, font) > maxW && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && measure(line.slice(0, cut), size, bold, font) > maxW) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else line = test;
    }
    out.push(line.trimEnd());
  }
  return out;
}

// ---- colour helpers ----
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x2457d6;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function tint(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const t = (c) => Math.round(c + (255 - c) * amt).toString(16).padStart(2, '0');
  return `#${t(r)}${t(g)}${t(b)}`;
}
const INK = '#1f2533', MUTED = '#6b7280', RULE = '#e3e6ec';

// A tiny "canvas" that records ops relative to a block origin.
class Pen {
  constructor(tpl) { this.ops = []; this.font = tpl.font; this.tpl = tpl; }
  text(s, x, y, size, opts = {}) {
    s = String(s ?? '');
    if (!s) return;
    const bold = !!opts.bold;
    let tx = x;
    if (opts.align === 'right') tx = x - measure(s, size, bold, this.font);
    else if (opts.align === 'center') tx = x - measure(s, size, bold, this.font) / 2;
    this.ops.push({ t: 'text', s, x: tx, y, size, bold, color: opts.color || INK });
  }
  rect(x, y, w, h, fill, r = 0) { this.ops.push({ t: 'rect', x, y, w, h, fill, r }); }
  line(x1, y1, x2, y2, color = RULE, width = 0.75) { this.ops.push({ t: 'line', x1, y1, x2, y2, color, width }); }
  image(src, x, y, w, h) { this.ops.push({ t: 'img', src, x, y, w, h }); }
  // writes wrapped lines; returns the new y (top of next line)
  para(s, x, y, w, size, opts = {}) {
    const lh = size * (opts.lh || 1.4);
    const lines = wrap(s, w, size, opts.bold, this.font);
    for (const ln of lines) {
      const ax = opts.align === 'right' ? x + w : opts.align === 'center' ? x + w / 2 : x;
      this.text(ln, ax, y + size, size, opts);
      y += lh;
    }
    return y;
  }
}

const colorOf = (b, tpl, fallback) =>
  b.color === 'white' ? '#ffffff' : b.color === 'accent' ? tpl.accent : b.color || fallback;

// ---- Block renderers: each returns { h, ops } in block-local coordinates ----
const RENDER = {
  band(b, d, tpl) {
    const p = new Pen(tpl);
    p.rect(0, 0, b.w, b.h || 60, tpl.accent);
    return { h: b.h || 60, ops: p.ops };
  },
  divider(b, d, tpl) {
    const p = new Pen(tpl);
    p.line(0, 4, b.w, 4, b.color === 'accent' ? tpl.accent : '#cfd4dc', 1);
    return { h: 8, ops: p.ops };
  },
  logo(b, d, tpl, opt) {
    const biz = d.settings.business;
    const p = new Pen(tpl);
    if (biz.logo && biz.logoW) {
      let w = b.w, h = (b.w * biz.logoH) / biz.logoW;
      const maxH = b.maxH || 70;
      if (h > maxH) { w = (w * maxH) / h; h = maxH; }
      const x = b.align === 'right' ? b.w - w : b.align === 'center' ? (b.w - w) / 2 : 0;
      p.image(biz.logo, x, 0, w, h);
      return { h, ops: p.ops };
    }
    if (opt.editing) {
      p.rect(0, 0, b.w, 44, '#eef1f6', 6);
      p.text('Your logo', b.w / 2, 26, 9, { align: 'center', color: MUTED });
      return { h: 44, ops: p.ops };
    }
    return { h: 0, ops: [] };
  },
  title(b, d, tpl) {
    const p = new Pen(tpl);
    const size = b.size || 28;
    const ax = b.align === 'right' ? b.w : b.align === 'center' ? b.w / 2 : 0;
    p.text(b.text ?? 'INVOICE', ax, size * 0.95, size, { bold: true, align: b.align, color: colorOf(b, tpl, tpl.accent) });
    return { h: size * 1.15, ops: p.ops };
  },
  business(b, d, tpl) {
    const biz = d.settings.business, s = b.size || 9, p = new Pen(tpl);
    const col = colorOf(b, tpl, INK);
    let y = p.para(biz.name || 'Your Business Name', 0, 0, b.w, s + 3, { bold: true, align: b.align, color: col });
    const lines = [biz.address, biz.phone, biz.email, biz.website, biz.taxId ? `${biz.taxLabel || 'Tax ID'}: ${biz.taxId}` : '']
      .filter(Boolean).join('\n');
    y = p.para(lines, 0, y + 1, b.w, s, { align: b.align, color: b.color ? col : MUTED });
    return { h: y, ops: p.ops };
  },
  meta(b, d, tpl) {
    const { inv } = d, s = b.size || 9, p = new Pen(tpl);
    const rows = [
      ['Invoice No.', inv.number],
      ['Issue date', fmtDate(inv.issueDate)],
      ['Due date', inv.dueDate ? fmtDate(inv.dueDate) : 'On receipt'],
    ];
    if (inv.reference) rows.push(['Reference', inv.reference]);
    let y = 0;
    for (const [k, v] of rows) {
      p.text(k, 0, y + s, s, { color: MUTED });
      p.text(v, b.w, y + s, s, { align: 'right', bold: k === 'Invoice No.' });
      y += s * 1.75;
    }
    return { h: y - s * 0.6, ops: p.ops };
  },
  client(b, d, tpl) {
    const c = d.inv.client, s = b.size || 10, p = new Pen(tpl);
    const ax = b.align === 'right' ? b.w : b.align === 'center' ? b.w / 2 : 0;
    p.text(b.text ?? 'BILL TO', ax, s * 0.8, s * 0.75, { bold: true, color: tpl.accent, align: b.align });
    let y = s * 1.3;
    if (!c) return { h: p.para('No client selected', 0, y, b.w, s, { color: MUTED, align: b.align }), ops: p.ops };
    y = p.para(c.name || c.contact || '', 0, y, b.w, s + 1.5, { bold: true, align: b.align });
    const lines = [
      c.type === 'business' && c.contact && c.contact !== c.name ? `Attn: ${c.contact}` : '',
      ...clientAddressLines(c), c.email, c.phone,
      c.taxId ? `Tax ID: ${c.taxId}` : '',
    ].filter(Boolean).join('\n');
    y = p.para(lines, 0, y + 1, b.w, s - 0.5, { color: MUTED, align: b.align });
    return { h: y, ops: p.ops };
  },
  totals(b, d, tpl) {
    const t = d.totals, inv = d.inv, s = b.size || 10, p = new Pen(tpl);
    const rows = [['Subtotal', money(t.subtotal)]];
    if (t.discount) rows.push([inv.discountType === 'percent' ? `Discount (${num(inv.discountValue)}%)` : 'Discount', '-' + money(t.discount)]);
    if (num(inv.taxRate)) rows.push([`Tax (${num(inv.taxRate)}%)`, money(t.tax)]);
    rows.push(['Total', money(t.total)]);
    if (t.paid) rows.push(['Paid', '-' + money(t.paid)]);
    let y = 0;
    const pad = 8;
    for (const [k, v] of rows) {
      const strong = k === 'Total';
      p.text(k, pad, y + s, s, { color: strong ? INK : MUTED, bold: strong });
      p.text(v, b.w - pad, y + s, s, { align: 'right', bold: strong });
      y += s * 1.8;
    }
    const bh = s * 2.6;
    y += 2;
    p.rect(0, y, b.w, bh, tpl.accent, 4);
    p.text('Amount due', pad, y + bh / 2 + s * 0.36, s, { bold: true, color: '#ffffff' });
    p.text(money(t.due), b.w - pad, y + bh / 2 + s * 0.4, s + 2, { bold: true, color: '#ffffff', align: 'right' });
    return { h: y + bh, ops: p.ops };
  },
  notes(b, d, tpl) {
    const inv = d.inv, s = b.size || 8.5, p = new Pen(tpl);
    let y = 0;
    for (const [label, body] of [['Notes', inv.notes], ['Terms', inv.terms]]) {
      if (!body) continue;
      p.text(label.toUpperCase(), 0, y + s * 0.85, s * 0.85, { bold: true, color: tpl.accent });
      y = p.para(body, 0, y + s * 1.3, b.w, s, { color: MUTED }) + s * 0.8;
    }
    return { h: Math.max(0, y - s * 0.8), ops: p.ops };
  },
  payment(b, d, tpl) {
    const body = d.settings.paymentDetails, s = b.size || 8.5, p = new Pen(tpl);
    if (!body) return { h: 0, ops: [] };
    p.text(b.text ?? 'PAYMENT DETAILS', 0, s * 0.85, s * 0.85, { bold: true, color: tpl.accent });
    return { h: p.para(body, 0, s * 1.3, b.w, s, { color: INK }), ops: p.ops };
  },
  text(b, d, tpl) {
    const s = b.size || 10, p = new Pen(tpl);
    return { h: p.para(b.text || '', 0, 0, b.w, s, { align: b.align, bold: b.bold, color: colorOf(b, tpl, INK) }), ops: p.ops };
  },
  footer(b, d, tpl) {
    const s = b.size || 8, p = new Pen(tpl);
    const txt = b.text ?? '';
    if (!txt) return { h: 0, ops: [] };
    return { h: p.para(txt, 0, 0, b.w, s, { align: b.align || 'center', color: colorOf(b, tpl, MUTED) }), ops: p.ops };
  },
};

// Items table is special: rows can flow across pages.
function itemsTable(b, d, tpl) {
  const s = b.size || 9, font = tpl.font;
  const W = b.w;
  const cQty = 44, cPrice = 78, cAmt = 84;
  const xDesc = 8, xQty = W - cAmt - cPrice - cQty + cQty - 6, xPrice = W - cAmt - 6, xAmt = W - 8;
  const descW = W - cAmt - cPrice - cQty - 16;
  const headerH = s * 2.5;
  const solid = tpl.tableStyle === 'solid';
  const header = new Pen(tpl);
  if (solid) header.rect(0, 0, W, headerH, tpl.accent, 3);
  else header.line(0, headerH, W, headerH, tpl.tableStyle === 'lines' ? INK : tpl.accent, 1);
  const hc = solid ? '#ffffff' : tpl.tableStyle === 'lines' ? INK : tpl.accent;
  const hy = headerH / 2 + s * 0.35;
  header.text('DESCRIPTION', xDesc, hy, s * 0.85, { bold: true, color: hc });
  header.text('QTY', xQty, hy, s * 0.85, { bold: true, color: hc, align: 'right' });
  header.text('PRICE', xPrice, hy, s * 0.85, { bold: true, color: hc, align: 'right' });
  header.text('AMOUNT', xAmt, hy, s * 0.85, { bold: true, color: hc, align: 'right' });

  const pad = s * 0.75;
  const items = (d.inv.items || []).filter((it) => it.name || it.description || num(it.price));
  const rows = [];
  const rowSrc = items.length ? items : [null];
  rowSrc.forEach((it, i) => {
    const p = new Pen(tpl);
    let y = pad;
    if (!it) {
      p.text('No items yet', xDesc, y + s, s, { color: MUTED });
      y += s * 1.4;
    } else {
      const nameLines = wrap(it.name || '', descW, s, true, font);
      const descLines = it.description ? wrap(it.description, descW, s * 0.9, false, font) : [];
      const top = y;
      nameLines.forEach((ln) => { p.text(ln, xDesc, y + s, s, { bold: true }); y += s * 1.35; });
      descLines.forEach((ln) => { p.text(ln, xDesc, y + s * 0.9, s * 0.9, { color: MUTED }); y += s * 1.3; });
      if (!nameLines.length && !descLines.length) y += s * 1.35;
      const qty = num(it.qty);
      p.text(String(+qty.toFixed(3)) + (it.unit ? ' ' + it.unit : ''), xQty, top + s, s, { align: 'right' });
      p.text(money(it.price), xPrice, top + s, s, { align: 'right' });
      p.text(money(lineAmount(it)), xAmt, top + s, s, { align: 'right', bold: true });
    }
    const h = y + pad - s * 0.35;
    const ops = [];
    if (tpl.zebra && i % 2 === 1) ops.push({ t: 'rect', x: 0, y: 0, w: W, h, fill: tint(tpl.accent, 0.94), r: 0 });
    ops.push(...p.ops);
    if (!tpl.zebra || tpl.tableStyle !== 'solid') ops.push({ t: 'line', x1: 0, y1: h, x2: W, y2: h, color: RULE, width: 0.6 });
    rows.push({ h, ops });
  });
  const oneRow = s * 1.35 + pad * 2 - s * 0.35;
  return { headerH, header: header.ops, rows, baseH: headerH + oneRow * 3 };
}

const shiftOps = (ops, dx, dy) => ops.map((o) =>
  o.t === 'line' ? { ...o, x1: o.x1 + dx, x2: o.x2 + dx, y1: o.y1 + dy, y2: o.y2 + dy } : { ...o, x: o.x + dx, y: o.y + dy });

/**
 * Lay out an invoice.
 * Blocks keep their designed positions, but anything that grows (a long
 * address, many line items) pushes the blocks beneath it down, and the items
 * table flows onto extra pages with its header repeated.
 * @returns {{W,H,pages,ops,boxes}} ops use absolute y across a vertical stack of pages.
 */
export function layout(tpl, data, opt = {}) {
  const { w: W, h: H } = PAGES[tpl.page] || PAGES.A4;
  const d = { ...data, totals: totals(data.inv) };
  const GAP = 10;
  const blocks = tpl.blocks.filter((b) => b.visible !== false);
  const ops = [];
  const boxes = [];
  const bottomLimit = (y) => Math.floor(y / H) * H + H - MARGIN;
  const nextTop = (y) => (Math.floor(y / H) + 1) * H + MARGIN;
  const overlapX = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1;

  const placed = []; // { b, y, bottom }
  const pinned = [];
  let contentBottom = 0;
  const order = blocks.map((b, i) => ({ b, i })).sort((p, q) => p.b.y - q.b.y || p.i - q.i).map((x) => x.b);
  for (const b of order) {
    if (b.type === 'footer') { pinned.push(b); continue; }
    const flows = b.type !== 'band';
    let y = b.y;
    if (flows) {
      for (const p of placed) {
        if (p.b.type === 'band' || p.b.y >= b.y || !overlapX(p.b, b)) continue;
        y = Math.max(y, p.bottom + GAP);
      }
    }
    if (b.type === 'items') {
      const t = itemsTable(b, d, tpl);
      if (y + t.headerH + (t.rows[0] ? t.rows[0].h : 0) > bottomLimit(y)) y = nextTop(y);
      const top = y;
      ops.push(...shiftOps(t.header, b.x, y));
      y += t.headerH;
      for (const row of t.rows) {
        if (y + row.h > bottomLimit(y) && row.h < H - 3 * MARGIN) {
          y = nextTop(y);
          ops.push(...shiftOps(t.header, b.x, y));
          y += t.headerH;
        }
        ops.push(...shiftOps(row.ops, b.x, y));
        y += row.h;
      }
      placed.push({ b, y: top, bottom: y });
      boxes.push({ id: b.id, x: b.x, y: top, w: b.w, h: Math.min(y, Math.floor(top / H) * H + H) - top });
      contentBottom = Math.max(contentBottom, y);
      continue;
    }
    const r = RENDER[b.type] ? RENDER[b.type](b, d, tpl, opt) : { h: 0, ops: [] };
    if (flows && r.h > 0 && r.h < H - 2 * MARGIN && y + r.h > bottomLimit(y) && y > b.y) y = nextTop(y);
    ops.push(...shiftOps(r.ops, b.x, y));
    placed.push({ b, y, bottom: y + r.h });
    boxes.push({ id: b.id, x: b.x, y, w: b.w, h: Math.max(r.h, 12) });
    if (r.h > 0) contentBottom = Math.max(contentBottom, y + r.h);
  }

  let pages = Math.max(1, Math.ceil((contentBottom - 0.5) / H));
  const pinnedR = pinned.map((b) => ({ b, r: RENDER.footer(b, d, tpl, opt) }));
  for (const { b, r } of pinnedR) {
    // footers sit at the same spot on the last page, below everything else
    if (r.h && contentBottom - (pages - 1) * H > b.y - 6) pages += 1;
  }
  for (const { b, r } of pinnedR) {
    const y = (pages - 1) * H + b.y;
    ops.push(...shiftOps(r.ops, b.x, y));
    boxes.push({ id: b.id, x: b.x, y: b.y, w: b.w, h: Math.max(r.h, 12) });
  }
  return { W, H, pages, ops, boxes: boxes.filter((x) => x.y < H), font: tpl.font };
}

// Ops that touch a given page, translated to that page's coordinates.
export function pageOps(lay, page) {
  const top = page * lay.H, bot = top + lay.H;
  const out = [];
  for (const o of lay.ops) {
    const y1 = o.t === 'line' ? Math.min(o.y1, o.y2) : o.t === 'text' ? o.y - o.size : o.y;
    const y2 = o.t === 'line' ? Math.max(o.y1, o.y2) : o.t === 'text' ? o.y + o.size * 0.3 : o.y + o.h;
    if (y2 < top || y1 > bot) continue;
    out.push(o.t === 'line' ? { ...o, y1: o.y1 - top, y2: o.y2 - top } : { ...o, y: o.y - top });
  }
  return out;
}

// ---- Canvas playback ----
const imgCache = new Map();
export function loadImage(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const p = new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
  imgCache.set(src, p);
  return p;
}
export async function preloadImages(lay) {
  const srcs = [...new Set(lay.ops.filter((o) => o.t === 'img').map((o) => o.src))];
  const out = {};
  await Promise.all(srcs.map(async (s) => { out[s] = await loadImage(s); }));
  return out;
}

export function drawPage(canvas, lay, page, cssWidth, images = {}) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const scale = cssWidth / lay.W;
  canvas.width = Math.round(lay.W * scale * dpr);
  canvas.height = Math.round(lay.H * scale * dpr);
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = lay.H * scale + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, lay.W, lay.H);
  ctx.textBaseline = 'alphabetic';
  for (const o of pageOps(lay, page)) {
    if (o.t === 'rect') {
      ctx.fillStyle = o.fill;
      ctx.beginPath();
      if (o.r && ctx.roundRect) ctx.roundRect(o.x, o.y, o.w, o.h, o.r); else ctx.rect(o.x, o.y, o.w, o.h);
      ctx.fill();
    } else if (o.t === 'line') {
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.width;
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y1);
      ctx.lineTo(o.x2, o.y2);
      ctx.stroke();
    } else if (o.t === 'text') {
      ctx.font = fontCss(lay.font, o.size, o.bold);
      ctx.fillStyle = o.color;
      ctx.fillText(o.s, o.x, o.y);
    } else if (o.t === 'img') {
      const im = images[o.src];
      if (im) ctx.drawImage(im, o.x, o.y, o.w, o.h);
    }
  }
  return scale;
}
