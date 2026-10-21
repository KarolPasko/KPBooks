import { db } from '../store.js';
import { esc, money, totals, statusOf, today, addDays } from '../util.js';
import { header, icon } from '../ui.js';
import { invoiceRow } from './invoices.js';

export default function home({ main }) {
  const biz = db.settings.business;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  header({ title: hello, sub: biz.name || 'Tally Invoices', right: `<a class="tb-btn" href="#/settings" aria-label="Settings">${icon('gear')}</a>` });

  let outstanding = 0, overdue = 0, overdueN = 0, paid30 = 0, drafts = 0, unpaidN = 0;
  const since = addDays(today(), -30);
  for (const inv of db.invoices) {
    const st = statusOf(inv), t = totals(inv);
    if (st === 'draft') drafts++;
    if (st === 'sent' || st === 'overdue') { outstanding += t.due; unpaidN++; }
    if (st === 'overdue') { overdue += t.due; overdueN++; }
    if (st === 'paid' && (inv.paidDate || inv.issueDate) >= since) paid30 += t.total;
  }
  const recent = [...db.invoices].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);

  main.innerHTML = `
  <div class="pad">
    <section class="hero card">
      <div class="hero-label">Outstanding</div>
      <div class="hero-num">${esc(money(outstanding))}</div>
      <div class="hero-sub">${unpaidN} unpaid invoice${unpaidN === 1 ? '' : 's'}</div>
      <a class="btn primary block hero-btn" href="#/new">${icon('plus')} New invoice</a>
    </section>
    <section class="tiles">
      <a class="tile card" href="#/invoices?f=overdue">
        <div class="tile-label">${overdueN ? '<span class="dot bad"></span>' : ''}Overdue</div>
        <div class="tile-num">${esc(money(overdue))}</div>
        <div class="tile-sub">${overdueN} invoice${overdueN === 1 ? '' : 's'}</div>
      </a>
      <a class="tile card" href="#/invoices?f=paid">
        <div class="tile-label">Paid · 30 days</div>
        <div class="tile-num">${esc(money(paid30))}</div>
        <div class="tile-sub">received</div>
      </a>
      <a class="tile card" href="#/invoices?f=draft">
        <div class="tile-label">Drafts</div>
        <div class="tile-num">${drafts}</div>
        <div class="tile-sub">not sent yet</div>
      </a>
    </section>
    <section class="quick">
      <a class="quick-btn card" href="#/import">${icon('upload')}<span>Import past invoices</span></a>
      <a class="quick-btn card" href="#/design">${icon('layout')}<span>Design invoice layout</span></a>
      <a class="quick-btn card" href="#/items">${icon('tag')}<span>Price book</span></a>
      <a class="quick-btn card" href="#/client/new">${icon('users')}<span>Add a client</span></a>
    </section>
    <div class="section-head"><h2>Recent</h2>${recent.length ? '<a href="#/invoices">See all</a>' : ''}</div>
    ${recent.length ? `<div class="card list">${recent.map(invoiceRow).join('')}</div>`
      : `<div class="card note">No invoices yet. Tap <b>New invoice</b> to create one, or <a href="#/import">import past invoices</a> so prices fill in automatically.</div>`}
    <p class="privacy">${icon('check')} Your data never leaves this device.</p>
  </div>`;
}
