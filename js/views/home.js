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
    <section class="hero">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="hero-label">Outstanding</div>
      <div class="hero-num" id="hero-num" data-to="${outstanding}">${esc(money(outstanding))}</div>
      <div class="hero-sub">${unpaidN} unpaid invoice${unpaidN === 1 ? '' : 's'}${overdueN ? ` · <b>${overdueN} overdue</b>` : ''}</div>
      <a class="btn hero-btn block" href="#/new">${icon('plus')} New invoice</a>
    </section>
    <section class="tiles">
      <a class="tile card" href="#/invoices?f=overdue">
        <span class="tile-ic red">${icon('arrowDown')}</span>
        <div class="tile-label">Overdue</div>
        <div class="tile-num">${esc(money(overdue))}</div>
        <div class="tile-sub">${overdueN} invoice${overdueN === 1 ? '' : 's'}</div>
      </a>
      <a class="tile card" href="#/invoices?f=paid">
        <span class="tile-ic green">${icon('check')}</span>
        <div class="tile-label">Paid · 30 days</div>
        <div class="tile-num">${esc(money(paid30))}</div>
        <div class="tile-sub">received</div>
      </a>
      <a class="tile card" href="#/invoices?f=draft">
        <span class="tile-ic grey">${icon('edit')}</span>
        <div class="tile-label">Drafts</div>
        <div class="tile-num">${drafts}</div>
        <div class="tile-sub">not sent yet</div>
      </a>
    </section>
    <section class="quick">
      <a class="quick-btn card" href="#/import"><span class="qi teal">${icon('upload')}</span><span>Import past invoices</span></a>
      <a class="quick-btn card" href="#/design"><span class="qi violet">${icon('layout')}</span><span>Design invoice layout</span></a>
      <a class="quick-btn card" href="#/items"><span class="qi orange">${icon('tag')}</span><span>Price book</span></a>
      <a class="quick-btn card" href="#/client/new"><span class="qi blue">${icon('users')}</span><span>Add a client</span></a>
    </section>
    <div class="section-head"><h2>Recent</h2>${recent.length ? '<a href="#/invoices">See all</a>' : ''}</div>
    ${recent.length ? `<div class="card list">${recent.map(invoiceRow).join('')}</div>`
      : `<div class="card note">No invoices yet. Tap <b>New invoice</b> to create one, or <a href="#/import">import past invoices</a> so prices fill in automatically.</div>`}
    <p class="privacy">${icon('check')} Your data never leaves this device. <a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a></p>
  </div>`;

  // count the big number up, like Wallet/Stocks
  const el = main.querySelector('#hero-num');
  const to = Number(el.dataset.to) || 0;
  if (to > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const t0 = performance.now(), dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = money(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
