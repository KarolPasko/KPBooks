// All data lives on the device in localStorage. Nothing is ever sent to a server.
import { uid, today, addDays, normName, num, setFormat, round2 } from './util.js';
import { presetTemplate } from './layout.js';

const KEY = 'tally.invoices.v1';

const defaultSettings = () => ({
  business: {
    name: '', email: '', phone: '', website: '', address: '',
    taxLabel: 'VAT No.', taxId: '', logo: null, logoW: 0, logoH: 0,
  },
  currency: 'GBP',
  locale: 'en-GB',
  prefix: 'INV',
  numberDigits: 4,
  nextNumber: 1,
  gmailClientId: '',
  dueDays: 14,
  taxRate: 0,
  notes: 'Thank you for your business!',
  terms: 'Payment is due within 14 days of the invoice date.',
  paymentDetails: '',
  emailSubject: 'Invoice {number} from {business}',
  emailBody:
    'Hi {client},\n\nPlease find attached invoice {number} for {total}, due on {due}.\n\nThanks,\n{business}',
  onboarded: false,
});

const blank = () => ({
  settings: defaultSettings(),
  template: presetTemplate('classic'),
  clients: [],
  invoices: [],
  items: [],
});

export const db = load();

function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { data = null; }
  const base = blank();
  if (!data) return base;
  return {
    ...base,
    ...data,
    settings: { ...base.settings, ...data.settings, business: { ...base.settings.business, ...(data.settings || {}).business } },
    template: data.template && data.template.blocks ? data.template : base.template,
  };
}

let saveError = null;
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    saveError = null;
  } catch (e) {
    saveError = e;
    window.dispatchEvent(new CustomEvent('store-error', { detail: e }));
  }
  applyFormat();
}
export const lastSaveError = () => saveError;

export function applyFormat() {
  setFormat(db.settings.currency, db.settings.locale);
}
applyFormat();

// Ask Safari to keep our storage around (helps on iOS).
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* ignore */ }

export function replaceAll(data) {
  const fresh = blank();
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, fresh, data, {
    settings: { ...fresh.settings, ...(data.settings || {}), business: { ...fresh.settings.business, ...((data.settings || {}).business || {}) } },
  });
  save();
}

// ---- Clients ----
export const getClient = (id) => db.clients.find((c) => c.id === id) || null;
export const clientName = (c) => (c ? c.name || c.contact || 'Unnamed client' : 'No client');

export function newClient(partial = {}) {
  return {
    id: uid(), type: 'business', name: '', contact: '', email: '', phone: '',
    address: '', city: '', postcode: '', country: '', taxId: '', notes: '',
    createdAt: Date.now(), ...partial,
  };
}
export function upsertClient(c) {
  const i = db.clients.findIndex((x) => x.id === c.id);
  if (i >= 0) db.clients[i] = c; else db.clients.push(c);
  // keep snapshots on unpaid invoices in sync
  for (const inv of db.invoices) if (inv.clientId === c.id && inv.status !== 'paid') inv.client = { ...c };
  save();
  return c;
}
export function deleteClient(id) {
  db.clients = db.clients.filter((c) => c.id !== id);
  save();
}
export function findClientByName(name, email) {
  const n = normName(name);
  return db.clients.find((c) => (email && c.email && c.email.toLowerCase() === email.toLowerCase()) || (n && normName(c.name) === n)) || null;
}

// ---- Invoices ----
export const getInvoice = (id) => db.invoices.find((i) => i.id === id) || null;

// "ABC" + 1 -> "ABC 0001". A prefix ending in "-", "/", "_" or a space is used as-is ("INV-0001").
export function formatNumber(n, prefix = db.settings.prefix, digits = db.settings.numberDigits) {
  const p = String(prefix || '');
  const sep = p && /[A-Za-z0-9]$/.test(p) ? ' ' : '';
  return p + sep + String(Math.max(0, Math.floor(num(n)))).padStart(Math.max(1, num(digits) || 1), '0');
}

export function nextNumber() {
  let n = num(db.settings.nextNumber) || 1;
  const taken = new Set(db.invoices.map((i) => i.number));
  while (taken.has(formatNumber(n))) n++;
  return formatNumber(n);
}

export function newInvoice(partial = {}) {
  const s = db.settings;
  const issue = today();
  return {
    id: uid(),
    number: nextNumber(),
    status: 'draft',
    clientId: null,
    client: null,
    issueDate: issue,
    dueDate: addDays(issue, s.dueDays),
    reference: '',
    items: [],
    discountType: 'amount',
    discountValue: 0,
    taxRate: s.taxRate,
    amountPaid: 0,
    notes: s.notes,
    terms: s.terms,
    imported: false,
    history: [{ at: Date.now(), what: 'Created' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...partial,
  };
}

export function upsertInvoice(inv) {
  inv.updatedAt = Date.now();
  if (inv.clientId) {
    const c = getClient(inv.clientId);
    if (c && inv.status !== 'paid') inv.client = { ...c };
  }
  const i = db.invoices.findIndex((x) => x.id === inv.id);
  if (i >= 0) db.invoices[i] = inv;
  else {
    db.invoices.push(inv);
    // bump the counter past the number we just used
    const m = String(inv.number).match(/(\d+)\s*$/);
    if (m && String(inv.number).startsWith(String(db.settings.prefix).trim()) && +m[1] >= num(db.settings.nextNumber)) {
      db.settings.nextNumber = +m[1] + 1;
    }
  }
  learnPrices(inv);
  save();
  return inv;
}

export function deleteInvoice(id) {
  db.invoices = db.invoices.filter((i) => i.id !== id);
  save();
}

export function logEvent(inv, what) {
  inv.history = inv.history || [];
  inv.history.push({ at: Date.now(), what });
}

// ---- Price book: learns from every invoice you save or import ----
export const getItem = (id) => db.items.find((i) => i.id === id) || null;

export function newItem(partial = {}) {
  return { id: uid(), name: '', description: '', unit: '', price: 0, uses: 0, lastUsed: null, history: [], source: 'manual', ...partial };
}
export function upsertItem(it) {
  const i = db.items.findIndex((x) => x.id === it.id);
  if (i >= 0) db.items[i] = it; else db.items.push(it);
  save();
  return it;
}
export function deleteItem(id) {
  db.items = db.items.filter((i) => i.id !== id);
  save();
}

function learnPrices(inv) {
  if (inv.skipPriceBook) return;
  for (const line of inv.items || []) {
    const key = normName(line.name);
    if (!key || !(num(line.price) > 0)) continue;
    let it = db.items.find((x) => normName(x.name) === key);
    if (!it) {
      it = newItem({ name: line.name.trim(), description: line.description || '', unit: line.unit || '', source: inv.imported ? 'import' : 'invoice' });
      db.items.push(it);
    }
    it.history = (it.history || []).filter((h) => h.invoiceId !== inv.id);
    it.history.push({ invoiceId: inv.id, number: inv.number, date: inv.issueDate, price: round2(line.price), qty: num(line.qty) });
    it.history.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const latest = it.history[it.history.length - 1];
    it.price = latest.price;
    it.lastUsed = latest.date;
    it.uses = it.history.length;
    if (!it.description && line.description) it.description = line.description;
  }
}

export function priceStats(it) {
  const h = it.history || [];
  if (!h.length) return null;
  const prices = h.map((x) => x.price);
  return {
    count: h.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: round2(prices.reduce((a, b) => a + b, 0) / prices.length),
    last: h[h.length - 1],
  };
}

// Best matches for what the user is typing in an item name field.
export function suggestItems(query, limit = 6) {
  const q = normName(query);
  if (!q) return [...db.items].sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, limit);
  const words = q.split(' ');
  return db.items
    .map((it) => {
      const n = normName(it.name + ' ' + (it.description || ''));
      const name = normName(it.name);
      let score = 0;
      if (name === q) score += 100;
      else if (name.startsWith(q)) score += 60;
      else if (n.includes(q)) score += 35;
      for (const w of words) if (w && n.includes(w)) score += 10;
      if (!score) return null;
      return { it, score: score + Math.min(10, it.uses || 0) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.it);
}

export function exactItem(name) {
  const k = normName(name);
  return k ? db.items.find((x) => normName(x.name) === k) || null : null;
}

// ---- Demo data ----
export function loadDemo() {
  const s = db.settings;
  if (!s.business.name) {
    Object.assign(s.business, {
      name: 'Harbour Studio Ltd', email: 'hello@harbourstudio.co.uk', phone: '020 7946 0321',
      website: 'harbourstudio.co.uk', address: '12 Quay Street\nBristol BS1 4DJ\nUnited Kingdom', taxId: 'GB 123 4567 89',
    });
    s.paymentDetails = 'Bank: Northbank\nAccount name: Harbour Studio Ltd\nSort code: 12-34-56\nAccount no: 12345678';
  }
  const c1 = upsertClient(newClient({ type: 'business', name: 'Brightside Bakery', contact: 'Amelia Hart', email: 'amelia@brightside.example', phone: '0117 496 0000', address: '4 Mill Lane', city: 'Bath', postcode: 'BA1 1AA', country: 'United Kingdom', taxId: 'GB 987 6543 21' }));
  const c2 = upsertClient(newClient({ type: 'personal', name: 'Oliver Grant', email: 'oliver.grant@example.com', address: '27 Elm Road', city: 'Cardiff', postcode: 'CF10 2AB', country: 'United Kingdom' }));
  const mk = (client, daysAgo, status, items, extra = {}) => {
    const issue = addDays(today(), -daysAgo);
    upsertInvoice(newInvoice({ clientId: client.id, client: { ...client }, issueDate: issue, dueDate: addDays(issue, 14), status, items: items.map((x) => ({ id: uid(), unit: '', description: '', ...x })), ...extra }));
  };
  mk(c1, 60, 'paid', [{ name: 'Brand identity design', qty: 1, price: 1200 }, { name: 'Business cards (500)', qty: 2, price: 85 }], { taxRate: 20 });
  mk(c2, 30, 'sent', [{ name: 'Website maintenance', description: 'Monthly retainer', qty: 1, price: 250 }, { name: 'Consulting hour', qty: 3, price: 65 }]);
  mk(c1, 3, 'sent', [{ name: 'Social media templates', qty: 1, price: 420 }, { name: 'Consulting hour', qty: 2, price: 70 }], { taxRate: 20 });
  save();
}
