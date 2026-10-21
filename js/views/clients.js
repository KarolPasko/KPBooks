import { db, getClient, newClient, upsertClient, deleteClient, clientName } from '../store.js';
import { esc, money, totals, statusOf, initials } from '../util.js';
import { header, icon, field, readForm, toast, confirmSheet, emptyState } from '../ui.js';
import { invoiceRow } from './invoices.js';

export default function clients({ main }) {
  header({ title: 'Clients', right: `<a class="tb-btn" href="#/client/new" aria-label="Add client">${icon('plus')}</a>` });
  main.innerHTML = `<div class="pad">
    <label class="search">${icon('search')}<input type="search" id="q" placeholder="Search clients"></label>
    <div id="list"></div></div>`;
  const draw = () => {
    const q = main.querySelector('#q').value.toLowerCase();
    const list = db.clients
      .filter((c) => !q || [c.name, c.contact, c.email, c.city].join(' ').toLowerCase().includes(q))
      .sort((a, b) => clientName(a).localeCompare(clientName(b)));
    main.querySelector('#list').innerHTML = list.length
      ? `<div class="card list">${list.map((c) => {
        const invs = db.invoices.filter((i) => i.clientId === c.id);
        const owed = invs.filter((i) => ['sent', 'overdue'].includes(statusOf(i))).reduce((s, i) => s + totals(i).due, 0);
        return `<a class="row" href="#/client/${c.id}">
          <span class="avatar ${c.type === 'personal' ? 'alt' : ''}">${esc(initials(c.name))}</span>
          <span class="row-main"><span class="row-title">${esc(clientName(c))}</span>
          <span class="row-sub">${esc(c.email || (c.type === 'personal' ? 'Personal' : 'Business'))} · ${invs.length} invoice${invs.length === 1 ? '' : 's'}</span></span>
          ${owed ? `<span class="row-end"><span class="row-amt">${esc(money(owed))}</span><span class="muted small">owed</span></span>` : `<span class="chev">${icon('chev')}</span>`}
        </a>`;
      }).join('')}</div>`
      : db.clients.length ? emptyState('search', 'No matches', 'Try a different search.')
        : emptyState('users', 'No clients yet', 'Add the people and businesses you invoice. Their details are filled in on every invoice.', `<a class="btn primary" href="#/client/new">${icon('plus')} Add client</a>`);
  };
  main.querySelector('#q').oninput = draw;
  draw();
}

export function clientEdit({ params, main }) {
  const isNew = params[0] === 'new';
  const c = isNew ? newClient() : getClient(params[0]);
  if (!c) { location.hash = '#/clients'; return; }
  let type = c.type || 'business';
  header({ title: isNew ? 'New client' : clientName(c), large: false, back: '#/clients', right: `<button class="tb-btn strong" id="save">Save</button>` });
  const invs = db.invoices.filter((i) => i.clientId === c.id).sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''));
  main.innerHTML = `
    <div class="pad" id="f">
      <div class="seg wide" id="type">
        <button data-t="business">${icon('building')} Business</button>
        <button data-t="personal">${icon('user')} Personal</button>
      </div>
      <div class="group-label" id="who-label"></div>
      <div class="card form">
        <div id="name-field"></div>
        <div class="biz-only">${field('Contact person', 'contact', c.contact, { placeholder: 'Who should the invoice go to?' })}</div>
        <div class="grid2">
          ${field('Email', 'email', c.email, { type: 'email', inputmode: 'email', placeholder: 'name@example.com' })}
          ${field('Phone', 'phone', c.phone, { type: 'tel', inputmode: 'tel' })}
        </div>
      </div>
      <div class="group-label">Address</div>
      <div class="card form">
        ${field('Street address', 'address', c.address, { textarea: true, rows: 2 })}
        <div class="grid2">${field('City / town', 'city', c.city)}${field('Postcode / ZIP', 'postcode', c.postcode)}</div>
        ${field('Country', 'country', c.country)}
      </div>
      <div class="group-label">Other</div>
      <div class="card form">
        <div class="biz-only">${field('Company / VAT number', 'taxId', c.taxId, { placeholder: 'Optional' })}</div>
        ${field('Private notes', 'notes', c.notes, { textarea: true, rows: 2, hint: 'Only you can see these.' })}
      </div>
      ${isNew ? '' : `
        <div class="btn-row"><a class="btn primary" href="#/new?client=${c.id}">${icon('plus')} New invoice for ${esc(clientName(c))}</a></div>
        ${invs.length ? `<div class="section-head"><h2>Invoices</h2></div><div class="card list">${invs.map(invoiceRow).join('')}</div>` : ''}
        <button class="btn danger ghost block" id="del">${icon('trash')} Delete client</button>`}
    </div>`;
  const setType = (t) => {
    type = t;
    main.querySelectorAll('#type button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    main.querySelectorAll('.biz-only').forEach((el) => (el.hidden = t !== 'business'));
    main.querySelector('#who-label').textContent = t === 'business' ? 'Business' : 'Person';
    const cur = main.querySelector('[name=name]');
    main.querySelector('#name-field').innerHTML = field(t === 'business' ? 'Business name' : 'Full name', 'name', cur ? cur.value : c.name, { placeholder: t === 'business' ? 'Acme Ltd' : 'Jane Smith' });
  };
  main.querySelector('#type').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) setType(b.dataset.t); };
  setType(type);
  const saveIt = () => {
    const f = readForm(main.querySelector('#f'));
    if (!f.name.trim()) { toast('Please add a name'); return; }
    Object.assign(c, f, { type, name: f.name.trim() });
    upsertClient(c);
    toast('Client saved');
    location.hash = '#/clients';
  };
  document.getElementById('save').onclick = saveIt;
  const del = main.querySelector('#del');
  if (del) del.onclick = async () => {
    if (!(await confirmSheet(`Delete ${clientName(c)}? Their invoices are kept.`, { ok: 'Delete', danger: true }))) return;
    deleteClient(c.id);
    location.hash = '#/clients';
  };
}
