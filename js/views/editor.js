import { db, getInvoice, newInvoice, upsertInvoice, getClient, newClient, upsertClient, clientName, suggestItems, exactItem, priceStats, logEvent } from '../store.js';
import { esc, money, fmtDate, totals, lineAmount, uid, addDays, num, initials, clientAddressLines } from '../util.js';
import { header, icon, sheet, toast, confirmSheet, field, readForm, avatarStyle } from '../ui.js';
import { renderPreview } from './share.js';

export default function editor({ params, query, main }) {
  const existing = params[0] ? getInvoice(params[0]) : null;
  if (params[0] && !existing) { location.hash = '#/invoices'; return; }
  const inv = existing ? structuredClone(existing) : newInvoice();
  if (!existing && query.client) {
    const c = getClient(query.client);
    if (c) { inv.clientId = c.id; inv.client = { ...c }; }
  }
  if (!inv.items.length) inv.items.push(blankLine());
  let dirty = false;
  const touch = () => { dirty = true; };

  header({
    title: existing ? `Edit ${inv.number}` : 'New invoice',
    large: false,
    back: existing ? `#/invoice/${inv.id}` : '#/invoices',
    right: `<button class="tb-btn strong" id="save">Save</button>`,
  });

  main.className = 'with-footer';
  main.innerHTML = `
  <div class="pad editor">
    <div class="group-label">Client</div>
    <div id="client"></div>

    <div class="group-label">Details</div>
    <div class="card form">
      <div class="grid2">
        ${field('Invoice number', 'number', inv.number)}
        ${field('Reference / PO', 'reference', inv.reference, { placeholder: 'Optional' })}
        ${field('Issue date', 'issueDate', inv.issueDate, { type: 'date' })}
        ${field('Due date', 'dueDate', inv.dueDate, { type: 'date' })}
      </div>
      <div class="chips tight" id="due-chips">
        <span class="muted small">Due in</span>
        ${[[0, 'On receipt'], [7, '7 days'], [14, '14 days'], [30, '30 days']].map(([d, l]) => `<button class="chip" data-due="${d}">${l}</button>`).join('')}
      </div>
    </div>

    <div class="group-label">Items <span class="muted">· prices fill in from your price book</span></div>
    <div id="items"></div>
    <div class="btn-row">
      <button class="btn" id="add-item">${icon('plus')} Add item</button>
      <button class="btn ghost" id="from-book">${icon('tag')} From price book</button>
    </div>

    <div class="group-label">Discount, tax & payments</div>
    <div class="card form">
      <div class="grid2">
        <label class="field"><span class="field-label">Discount</span>
          <div class="input-seg">
            <input name="discountValue" inputmode="decimal" value="${esc(inv.discountValue || '')}" placeholder="0">
            <div class="seg mini" id="disc-type">
              <button data-t="amount" class="${inv.discountType !== 'percent' ? 'on' : ''}">${esc(currencyGlyph())}</button>
              <button data-t="percent" class="${inv.discountType === 'percent' ? 'on' : ''}">%</button>
            </div>
          </div>
        </label>
        ${field('Tax / VAT %', 'taxRate', inv.taxRate || '', { inputmode: 'decimal', placeholder: '0' })}
        ${field('Amount already paid', 'amountPaid', inv.amountPaid || '', { inputmode: 'decimal', placeholder: '0.00', hint: 'Deposits or part payments' })}
      </div>
      <div class="sum" id="sum"></div>
    </div>

    <div class="group-label">Notes</div>
    <div class="card form">
      ${field('Notes to client', 'notes', inv.notes, { textarea: true, rows: 2 })}
      ${field('Terms', 'terms', inv.terms, { textarea: true, rows: 2 })}
    </div>
  </div>
  <div class="footer-bar">
    <div><div class="muted small">Amount due</div><div class="footer-total" id="ft"></div></div>
    <button class="btn" id="preview">${icon('eye')} Preview</button>
    <button class="btn primary" id="save2">Save</button>
  </div>`;

  // ---------- client ----------
  const drawClient = () => {
    const c = inv.client;
    main.querySelector('#client').innerHTML = c
      ? `<button class="card client-card" id="pick-client">
          <span class="avatar" style="${avatarStyle(c.name)}">${esc(initials(c.name))}</span>
          <span class="row-main"><span class="row-title">${esc(clientName(c))}</span>
          <span class="row-sub">${esc([c.email, clientAddressLines(c)[0]].filter(Boolean).join(' · ') || 'No email yet')}</span></span>
          <span class="chev">${icon('chev')}</span></button>`
      : `<button class="card client-card empty-client" id="pick-client">${icon('users')}<span>Choose or add a client</span><span class="chev">${icon('chev')}</span></button>`;
    main.querySelector('#pick-client').onclick = pickClient;
  };
  const pickClient = () => {
    sheet({
      title: 'Client',
      tall: true,
      body: `
        <label class="search">${icon('search')}<input type="search" id="cq" placeholder="Search clients"></label>
        <div class="card list" id="clist"></div>
        <div class="group-label">Or add a new client</div>
        <div class="card form" id="cnew">
          <div class="seg" id="ctype"><button data-t="business" class="on">${icon('building')} Business</button><button data-t="personal">${icon('user')} Personal</button></div>
          ${field('Name', 'name', '', { placeholder: 'Company or person' })}
          ${field('Email', 'email', '', { type: 'email', inputmode: 'email' })}
          ${field('Address', 'address', '', { textarea: true, rows: 2 })}
          <div class="grid2">${field('City', 'city', '')}${field('Postcode', 'postcode', '')}</div>
          <button class="btn primary block" id="cadd">Add client</button>
        </div>`,
      onMount(el, close) {
        let type = 'business';
        const list = () => {
          const q = el.querySelector('#cq').value.toLowerCase();
          const cs = db.clients.filter((c) => !q || [c.name, c.contact, c.email].join(' ').toLowerCase().includes(q));
          el.querySelector('#clist').innerHTML = cs.length
            ? cs.map((c) => `<button class="row" data-id="${c.id}"><span class="avatar sm" style="${avatarStyle(c.name)}">${esc(initials(c.name))}</span><span class="row-main"><span class="row-title">${esc(clientName(c))}</span><span class="row-sub">${esc(c.email || (c.type === 'personal' ? 'Personal' : 'Business'))}</span></span>${inv.clientId === c.id ? icon('check', 'ok') : ''}</button>`).join('')
            : '<div class="row muted">No clients yet</div>';
        };
        list();
        el.querySelector('#cq').oninput = list;
        el.querySelector('#clist').onclick = (e) => {
          const b = e.target.closest('[data-id]');
          if (!b) return;
          const c = getClient(b.dataset.id);
          inv.clientId = c.id; inv.client = { ...c };
          touch(); drawClient(); close();
        };
        el.querySelector('#ctype').onclick = (e) => {
          const b = e.target.closest('[data-t]');
          if (!b) return;
          type = b.dataset.t;
          el.querySelectorAll('#ctype button').forEach((x) => x.classList.toggle('on', x === b));
        };
        el.querySelector('#cadd').onclick = () => {
          const f = readForm(el.querySelector('#cnew'));
          if (!f.name.trim()) { toast('Add a name first'); return; }
          const c = upsertClient(newClient({ ...f, type, name: f.name.trim() }));
          inv.clientId = c.id; inv.client = { ...c };
          touch(); drawClient(); close();
        };
      },
    });
  };

  // ---------- items ----------
  const itemsEl = main.querySelector('#items');
  const itemHtml = (it, i) => `
    <div class="card item" data-i="${i}">
      <div class="item-top">
        <div class="ac-wrap">
          <input class="it-name" value="${esc(it.name)}" placeholder="Item or service" autocomplete="off" autocapitalize="sentences">
          <div class="ac" hidden></div>
        </div>
        <button class="icon-btn it-del" aria-label="Remove item">${icon('trash')}</button>
      </div>
      <textarea class="it-desc" rows="1" placeholder="Description (optional)">${esc(it.description || '')}</textarea>
      <div class="item-nums">
        <label><span>Qty</span><input class="it-qty" inputmode="decimal" value="${esc(it.qty)}"></label>
        <label><span>Unit</span><input class="it-unit" value="${esc(it.unit || '')}" placeholder="hrs"></label>
        <label><span>Price</span><input class="it-price" inputmode="decimal" value="${num(it.price) ? esc(it.price) : ''}" placeholder="0.00"></label>
        <div class="it-amt"><span>Amount</span><b>${esc(money(lineAmount(it)))}</b></div>
      </div>
      <div class="it-hint">${it._hint ? esc(it._hint) : ''}</div>
    </div>`;
  const drawItems = () => {
    itemsEl.innerHTML = inv.items.map(itemHtml).join('');
    itemsEl.querySelectorAll('.it-desc').forEach(autoGrow);
  };
  const rowOf = (el) => el.closest('[data-i]');
  const itemOf = (el) => inv.items[+rowOf(el).dataset.i];
  const updateAmt = (row) => { row.querySelector('.it-amt b').textContent = money(lineAmount(inv.items[+row.dataset.i])); };

  const applySuggestion = (row, src, how) => {
    const it = inv.items[+row.dataset.i];
    it.name = src.name;
    if (!it.description && src.description) it.description = src.description;
    if (src.unit && !it.unit) it.unit = src.unit;
    it.price = src.price;
    const st = priceStats(src);
    it._hint = `${how} ${money(src.price)}` + (st && st.count > 1 ? ` · ${st.count} past invoices, avg ${money(st.avg)}` : st ? ` · last used ${fmtDate(st.last.date)}` : '');
    row.querySelector('.it-name').value = it.name;
    row.querySelector('.it-desc').value = it.description || '';
    row.querySelector('.it-unit').value = it.unit || '';
    const p = row.querySelector('.it-price');
    p.value = it.price;
    p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash');
    row.querySelector('.it-hint').textContent = it._hint;
    autoGrow(row.querySelector('.it-desc'));
    updateAmt(row); drawSum(); touch();
  };

  const showAc = (row) => {
    const it = inv.items[+row.dataset.i];
    const ac = row.querySelector('.ac');
    const list = suggestItems(it.name, 5).filter((s) => s.name !== it.name || num(s.price) !== num(it.price));
    if (!list.length) { ac.hidden = true; return; }
    ac.innerHTML = list.map((s) => `<button type="button" data-id="${s.id}"><span>${esc(s.name)}${s.unit ? ` <i>/ ${esc(s.unit)}</i>` : ''}</span><b>${esc(money(s.price))}</b></button>`).join('');
    ac.hidden = false;
    // keep the suggestions clear of the floating footer bar
    requestAnimationFrame(() => {
      const limit = main.querySelector('.footer-bar').getBoundingClientRect().top - 12;
      const over = ac.getBoundingClientRect().bottom - limit;
      if (over > 0) main.scrollBy({ top: over, behavior: 'smooth' });
    });
  };

  itemsEl.addEventListener('input', (e) => {
    const t = e.target, row = rowOf(t);
    if (!row) return;
    const it = itemOf(t);
    if (t.classList.contains('it-name')) { it.name = t.value; showAc(row); }
    else if (t.classList.contains('it-desc')) { it.description = t.value; autoGrow(t); }
    else if (t.classList.contains('it-qty')) it.qty = t.value;
    else if (t.classList.contains('it-unit')) it.unit = t.value;
    else if (t.classList.contains('it-price')) { it.price = t.value; it._hint = ''; row.querySelector('.it-hint').textContent = ''; }
    updateAmt(row); drawSum(); touch();
  });
  itemsEl.addEventListener('focusin', (e) => { if (e.target.classList.contains('it-name')) showAc(rowOf(e.target)); });
  itemsEl.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('it-name')) return;
    const row = rowOf(e.target);
    setTimeout(() => {
      if (!row.isConnected) return;
      row.querySelector('.ac').hidden = true;
      // exact name match with no price yet -> fill it in automatically
      const it = inv.items[+row.dataset.i];
      const hit = exactItem(it.name);
      if (hit && !num(it.price)) applySuggestion(row, hit, 'Auto-filled');
    }, 180);
  });
  itemsEl.addEventListener('pointerdown', (e) => { if (e.target.closest('.ac button')) e.preventDefault(); });
  itemsEl.addEventListener('click', async (e) => {
    const sug = e.target.closest('.ac button');
    if (sug) {
      const row = rowOf(sug);
      const src = db.items.find((x) => x.id === sug.dataset.id);
      if (src) applySuggestion(row, src, 'From price book:');
      row.querySelector('.ac').hidden = true;
      return;
    }
    const del = e.target.closest('.it-del');
    if (del) {
      const i = +rowOf(del).dataset.i;
      inv.items.splice(i, 1);
      if (!inv.items.length) inv.items.push(blankLine());
      drawItems(); drawSum(); touch();
    }
  });
  main.querySelector('#add-item').onclick = () => {
    inv.items.push(blankLine());
    drawItems(); touch();
    const rows = itemsEl.querySelectorAll('.it-name');
    rows[rows.length - 1].focus();
  };
  main.querySelector('#from-book').onclick = () => {
    if (!db.items.length) { toast('Your price book is empty — import past invoices or add items in More → Price book'); return; }
    sheet({
      title: 'Price book',
      tall: true,
      body: `<label class="search">${icon('search')}<input type="search" id="pq" placeholder="Search items"></label><div class="card list" id="plist"></div>`,
      onMount(el, close) {
        const draw = () => {
          const q = el.querySelector('#pq').value;
          el.querySelector('#plist').innerHTML = suggestItems(q, 50).map((s) => `<button class="row" data-id="${s.id}"><span class="row-main"><span class="row-title">${esc(s.name)}</span><span class="row-sub">${esc(s.description || (s.uses ? `Used ${s.uses}×` : ''))}</span></span><span class="row-amt">${esc(money(s.price))}</span></button>`).join('') || '<div class="row muted">No matches</div>';
        };
        draw();
        el.querySelector('#pq').oninput = draw;
        el.querySelector('#plist').onclick = (e) => {
          const b = e.target.closest('[data-id]');
          if (!b) return;
          const src = db.items.find((x) => x.id === b.dataset.id);
          let idx = inv.items.findIndex((x) => !x.name && !num(x.price));
          if (idx < 0) { inv.items.push(blankLine()); idx = inv.items.length - 1; }
          inv.items[idx] = { ...inv.items[idx], name: src.name, description: src.description || '', unit: src.unit || '', price: src.price, _hint: `From price book: ${money(src.price)}` };
          drawItems(); drawSum(); touch(); close();
        };
      },
    });
  };

  // ---------- other fields ----------
  const form = main.querySelector('.editor');
  form.addEventListener('input', (e) => {
    const n = e.target.name;
    if (!n) return;
    inv[n] = e.target.value;
    if (n === 'issueDate' || n === 'dueDate') markDue();
    drawSum(); touch();
  });
  const markDue = () => {
    const d = inv.dueDate ? Math.round((new Date(inv.dueDate) - new Date(inv.issueDate)) / 864e5) : 0;
    main.querySelectorAll('[data-due]').forEach((c) => c.classList.toggle('on', +c.dataset.due === d));
  };
  main.querySelector('#due-chips').onclick = (e) => {
    const b = e.target.closest('[data-due]');
    if (!b) return;
    inv.dueDate = addDays(inv.issueDate, +b.dataset.due);
    main.querySelector('[name=dueDate]').value = inv.dueDate;
    markDue(); touch();
  };
  main.querySelector('#disc-type').onclick = (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    inv.discountType = b.dataset.t;
    main.querySelectorAll('#disc-type button').forEach((x) => x.classList.toggle('on', x === b));
    drawSum(); touch();
  };

  const drawSum = () => {
    const t = totals(inv);
    main.querySelector('#sum').innerHTML = `
      <div><span>Subtotal</span><span>${esc(money(t.subtotal))}</span></div>
      ${t.discount ? `<div><span>Discount</span><span>−${esc(money(t.discount))}</span></div>` : ''}
      ${t.tax ? `<div><span>Tax (${num(inv.taxRate)}%)</span><span>${esc(money(t.tax))}</span></div>` : ''}
      <div class="strong"><span>Total</span><span>${esc(money(t.total))}</span></div>
      ${t.paid ? `<div><span>Paid</span><span>−${esc(money(t.paid))}</span></div>` : ''}`;
    main.querySelector('#ft').textContent = money(t.due);
  };

  const clean = () => {
    const out = structuredClone(inv);
    out.items = out.items
      .filter((x) => (x.name || '').trim() || num(x.price))
      .map(({ _hint, ...x }) => ({ ...x, name: (x.name || '').trim(), qty: num(x.qty) || (x.qty === '0' ? 0 : 1), price: num(x.price) }));
    out.discountValue = num(out.discountValue);
    out.taxRate = num(out.taxRate);
    out.amountPaid = num(out.amountPaid);
    return out;
  };
  const save = () => {
    const out = clean();
    if (!out.number.trim()) { toast('Invoice number is required'); return; }
    if (db.invoices.some((x) => x.number === out.number && x.id !== out.id)) { toast(`${out.number} is already used`); return; }
    if (existing) logEvent(out, 'Edited');
    upsertInvoice(out);
    dirty = false;
    toast('Saved');
    location.hash = `#/invoice/${out.id}`;
  };
  document.getElementById('save').onclick = save;
  main.querySelector('#save2').onclick = save;
  main.querySelector('#preview').onclick = () => {
    sheet({
      title: 'Preview', tall: true, body: '<div class="preview" id="pv"></div>',
      onMount(el) { requestAnimationFrame(() => renderPreview(el.querySelector('#pv'), clean())); },
    });
  };

  drawClient(); drawItems(); drawSum(); markDue();
  return {
    canLeave: async () => !dirty || confirmSheet('You have unsaved changes on this invoice.', { ok: 'Discard changes', danger: true, title: 'Discard changes?' }),
  };
}

function blankLine() { return { id: uid(), name: '', description: '', qty: 1, unit: '', price: '' }; }
function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.max(34, t.scrollHeight) + 'px'; }
function currencyGlyph() {
  try { return (0).toLocaleString(db.settings.locale, { style: 'currency', currency: db.settings.currency, maximumFractionDigits: 0 }).replace(/[\d\s.,]/g, '') || '¤'; } catch { return '¤'; }
}
