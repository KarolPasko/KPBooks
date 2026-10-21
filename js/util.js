// Small shared helpers: ids, escaping, money, dates, invoice maths.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const num = (v) => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
};

// ---- Formatting (configured from settings) ----
let fmt = { currency: 'GBP', locale: 'en-GB' };
let moneyFmt = null;
export function setFormat(currency, locale) {
  fmt = { currency: currency || 'GBP', locale: locale || 'en-GB' };
  try {
    moneyFmt = new Intl.NumberFormat(fmt.locale, { style: 'currency', currency: fmt.currency });
  } catch {
    moneyFmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  }
}
setFormat();
export const getFormat = () => fmt;
export const money = (n) => moneyFmt.format(round2(n)).replace(/ /g, ' ');
export const currencySymbol = () =>
  (moneyFmt.formatToParts(0).find((p) => p.type === 'currency') || { value: '' }).value;

// ---- Dates (stored as YYYY-MM-DD strings) ----
const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoOf(new Date());
export const parseIso = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
export const addDays = (iso, days) => {
  const d = parseIso(iso) || new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return isoOf(d);
};
export const daysBetween = (a, b) => {
  const da = parseIso(a), db = parseIso(b);
  return da && db ? Math.round((db - da) / 86400000) : 0;
};
export function fmtDate(iso, style = 'medium') {
  const d = parseIso(iso);
  if (!d) return '';
  const opts = style === 'short'
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleDateString(fmt.locale, opts);
}

// ---- Invoice maths ----
export const lineAmount = (it) => round2(num(it.qty) * num(it.price));

export function totals(inv) {
  const subtotal = round2((inv.items || []).reduce((s, it) => s + lineAmount(it), 0));
  const dv = num(inv.discountValue);
  const discount = round2(Math.min(subtotal, inv.discountType === 'percent' ? (subtotal * dv) / 100 : dv));
  const taxable = subtotal - discount;
  const tax = round2((taxable * num(inv.taxRate)) / 100);
  const total = round2(taxable + tax);
  const paid = inv.status === 'paid' ? total : round2(num(inv.amountPaid));
  return { subtotal, discount, tax, total, paid, due: round2(total - paid) };
}

export function statusOf(inv) {
  if (inv.status === 'paid') return 'paid';
  if (inv.status === 'draft') return 'draft';
  if (inv.dueDate && inv.dueDate < today()) return 'overdue';
  return 'sent';
}
export const STATUS_LABEL = { draft: 'Draft', sent: 'Unpaid', overdue: 'Overdue', paid: 'Paid' };

export const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function clientAddressLines(c) {
  if (!c) return [];
  return [
    ...(String(c.address || '').split('\n')),
    [c.city, c.postcode].filter(Boolean).join(' '),
    c.country,
  ].map((s) => (s || '').trim()).filter(Boolean);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
