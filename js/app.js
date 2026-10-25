import { $, toast } from './ui.js';
import { db } from './store.js';
import home from './views/home.js';
import invoices from './views/invoices.js';
import invoiceView from './views/invoice-view.js';
import editor from './views/editor.js';
import designer from './views/designer.js';
import clients, { clientEdit } from './views/clients.js';
import items from './views/items.js';
import importView from './views/import.js';
import more, { settings } from './views/settings.js';

const routes = [
  [/^\/?$/, home, 'home'],
  [/^\/invoices$/, invoices, 'invoices'],
  [/^\/invoice\/([\w-]+)$/, invoiceView, 'invoices'],
  [/^\/invoice\/([\w-]+)\/edit$/, editor, null],
  [/^\/new$/, editor, null],
  [/^\/clients$/, clients, 'clients'],
  [/^\/client\/([\w-]+)$/, clientEdit, 'clients'],
  [/^\/items$/, items, 'more'],
  [/^\/design$/, designer, null],
  [/^\/import$/, importView, 'more'],
  [/^\/more$/, more, 'more'],
  [/^\/settings(?:\/(\w+))?$/, settings, 'more'],
];

let current = null; // { cleanup, canLeave }
let lastHash = location.hash;
let ignoreNext = false;

async function route() {
  if (ignoreNext) { ignoreNext = false; return; }
  if (current && current.canLeave) {
    const ok = await current.canLeave();
    if (!ok) { ignoreNext = true; location.hash = lastHash; return; }
  }
  if (current && current.cleanup) current.cleanup();
  current = null;
  // sheets belong to the screen that opened them
  document.querySelectorAll('#sheets .sheet-wrap').forEach((w) => w.remove());
  lastHash = location.hash;
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  for (const [re, view, tab] of routes) {
    const m = re.exec(path || '/');
    if (!m) continue;
    document.body.classList.toggle('no-tabs', !tab);
    for (const a of document.querySelectorAll('#tabbar [data-tab]')) a.classList.toggle('active', a.dataset.tab === tab);
    const main = $('#view');
    main.innerHTML = '';
    main.scrollTop = 0;
    main.className = '';
    try {
      current = (await view({ params: m.slice(1), query, main })) || null;
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="pad"><p class="muted">Something went wrong: ${String(e.message || e)}</p></div>`;
    }
    return;
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', route);
window.addEventListener('store-error', () => toast('Could not save — your device storage may be full.', 'bad'));

// First run: send people to set up their business details.
if (!db.settings.onboarded && !location.hash.startsWith('#/settings')) {
  location.hash = '#/settings/welcome';
} else route();

// Offline support (works once the app has been opened over https).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
