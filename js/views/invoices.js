import { db, clientName } from '../store.js';
import { esc, money, fmtDate, totals, statusOf, STATUS_LABEL } from '../util.js';
import { header, icon, statusPill, emptyState } from '../ui.js';

export function invoiceRow(inv) {
  const st = statusOf(inv);
  const t = totals(inv);
  return `<a class="row inv-row" href="#/invoice/${inv.id}">
    <div class="row-main">
      <div class="row-title">${esc(clientName(inv.client))}</div>
      <div class="row-sub">${esc(inv.number)} · ${esc(fmtDate(inv.issueDate))}${inv.imported ? ' · imported' : ''}</div>
    </div>
    <div class="row-end">
      <div class="row-amt">${esc(money(st === 'paid' ? t.total : t.due))}</div>
      ${statusPill(st, STATUS_LABEL[st])}
    </div>
  </a>`;
}

const FILTERS = [['all', 'All'], ['draft', 'Drafts'], ['sent', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid']];

export default function invoices({ main, query }) {
  let filter = query.f || 'all';
  let q = '';
  header({
    title: 'Invoices',
    right: `<a class="tb-btn" href="#/import" aria-label="Import past invoices">${icon('upload')}</a><a class="tb-btn" href="#/new" aria-label="New invoice">${icon('plus')}</a>`,
  });
  main.innerHTML = `
    <div class="pad">
      <label class="search">${icon('search')}<input type="search" placeholder="Search client, number or item" id="q"></label>
      <div class="chips" id="chips">${FILTERS.map(([k, l]) => `<button class="chip" data-f="${k}">${l}</button>`).join('')}</div>
      <div id="list"></div>
    </div>`;
  const draw = () => {
    main.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.f === filter));
    const ql = q.toLowerCase();
    const list = [...db.invoices]
      .filter((i) => filter === 'all' || statusOf(i) === filter || (filter === 'sent' && statusOf(i) === 'overdue'))
      .filter((i) => !ql || [i.number, clientName(i.client), ...(i.items || []).map((x) => x.name)].join(' ').toLowerCase().includes(ql))
      .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || b.createdAt - a.createdAt);
    const sum = list.reduce((s, i) => s + (statusOf(i) === 'paid' ? totals(i).total : totals(i).due), 0);
    main.querySelector('#list').innerHTML = list.length
      ? `<div class="list-meta">${list.length} invoice${list.length === 1 ? '' : 's'} · ${esc(money(sum))}</div><div class="card list">${list.map(invoiceRow).join('')}</div>`
      : db.invoices.length
        ? emptyState('search', 'Nothing here', 'No invoices match this filter.')
        : emptyState('doc', 'No invoices yet', 'Create your first invoice, or import invoices you sent in the past.',
          `<div class="btn-row center"><a class="btn primary" href="#/new">${icon('plus')} New invoice</a><a class="btn" href="#/import">${icon('upload')} Import</a></div>`);
  };
  main.querySelector('#chips').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; draw(); } };
  main.querySelector('#q').oninput = (e) => { q = e.target.value; draw(); };
  draw();
}
