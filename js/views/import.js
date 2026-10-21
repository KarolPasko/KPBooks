// Import invoices sent in the past. Their line items and prices feed the price
// book, so new invoices auto-fill prices.
import { db, newInvoice, upsertInvoice, newClient, upsertClient, findClientByName, newItem, upsertItem } from '../store.js';
import { esc, money, uid, num, round2, totals, addDays, today } from '../util.js';
import { header, icon, field, toast, sheet } from '../ui.js';
import { importPdfFile, csvToData, guessInvoice } from '../importer.js';

export default function importView({ main }) {
  const queue = [];
  header({ title: 'Import past invoices', back: '#/more', large: true, sub: 'Bring in invoices you’ve sent before. Their items and prices go into your price book, so new invoices fill in prices for you.' });
  main.innerHTML = `
    <div class="pad">
      <div class="import-opts">
        <label class="import-opt card">
          <span class="io-ic">${icon('file')}</span>
          <span><b>PDF invoices</b><span class="muted small">Pick one or more PDFs from Files. Text is read on your phone — nothing is uploaded.</span></span>
          <input type="file" accept="application/pdf,.pdf" multiple id="pdf" hidden>
        </label>
        <label class="import-opt card">
          <span class="io-ic">${icon('layout')}</span>
          <span><b>Spreadsheet (CSV)</b><span class="muted small">Columns like Invoice, Date, Client, Item, Qty, Price.</span></span>
          <input type="file" accept=".csv,text/csv" id="csv" hidden>
        </label>
        <label class="import-opt card">
          <span class="io-ic">${icon('copy')}</span>
          <span><b>Paste text</b><span class="muted small">Copy the text of an old invoice (e.g. from an email) and paste it.</span></span>
          <button hidden id="paste"></button>
        </label>
        <button class="import-opt card" id="manual">
          <span class="io-ic">${icon('edit')}</span>
          <span><b>Type it in</b><span class="muted small">Quickly add a past invoice by hand — client, items and prices.</span></span>
        </button>
      </div>
      <div id="status"></div>
      <div id="review"></div>
      <p class="hint">Tip: PDFs exported from this app re-import perfectly. Scanned/photographed invoices have no text to read — use “Type it in” for those.</p>
    </div>`;

  const status = main.querySelector('#status');
  const reviewEl = main.querySelector('#review');

  const next = () => {
    reviewEl.innerHTML = '';
    if (!queue.length) { status.innerHTML = ''; return; }
    const job = queue.shift();
    status.innerHTML = queue.length ? `<div class="card note">${queue.length} more to review after this one</div>` : '';
    review(job);
  };

  main.querySelector('#pdf').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    status.innerHTML = `<div class="card note">Reading ${files.length} file${files.length === 1 ? '' : 's'}…</div>`;
    let exactN = 0;
    for (const f of files) {
      try {
        const r = await importPdfFile(f);
        if (r.exact) {
          if (db.invoices.some((x) => x.id === r.inv.id || x.number === r.inv.number)) { toast(`${r.inv.number} is already in the app`); continue; }
          saveExact(r.inv); exactN++;
        } else queue.push({ guess: r.guess, lines: r.lines, fileName: f.name });
      } catch (err) {
        queue.push({ guess: guessInvoice([]), lines: [], fileName: f.name, error: err.message });
      }
    }
    if (exactN) toast(`Imported ${exactN} invoice${exactN === 1 ? '' : 's'} made with Tally`);
    next();
  };

  main.querySelector('#csv').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const d = csvToData(await f.text());
      if (d.kind === 'items') {
        for (const it of d.items) upsertItem(newItem({ name: it.name, description: it.description, unit: it.unit, price: it.price, source: 'csv' }));
        toast(`Added ${d.items.length} items to your price book`);
        return;
      }
      for (const g of d.invoices) {
        const t = round2(g.items.reduce((s, it) => s + num(it.qty) * num(it.price), 0));
        queue.push({ guess: { number: g.number, issueDate: g.issueDate, dueDate: '', client: { name: g.client.name, email: g.client.email, address: '' }, items: g.items, total: t, subtotal: t, tax: null, taxRate: null, warnings: [], status: g.status }, lines: [], fileName: f.name });
      }
      toast(`Found ${d.invoices.length} invoice${d.invoices.length === 1 ? '' : 's'} — review each one`);
      next();
    } catch (err) { toast(err.message, 'bad'); }
  };

  main.querySelector('#paste').closest('label').onclick = (e) => {
    e.preventDefault();
    sheet({
      title: 'Paste invoice text', tall: true,
      body: `<textarea id="pt" rows="12" placeholder="Paste the invoice text here…"></textarea><button class="btn primary block" id="go">Read invoice</button>`,
      onMount(el, close) {
        el.querySelector('#go').onclick = () => {
          const lines = el.querySelector('#pt').value.split(/\r?\n/).map((s) => s.replace(/\t+/g, '   ')).filter((s) => s.trim());
          if (!lines.length) { toast('Paste some text first'); return; }
          close();
          queue.unshift({ guess: guessInvoice(lines), lines, fileName: 'Pasted text' });
          next();
        };
      },
    });
  };
  main.querySelector('#manual').onclick = () => {
    queue.unshift({ guess: { ...guessInvoice([]), warnings: [], items: [{ id: uid(), name: '', description: '', qty: 1, price: 0 }] }, lines: [], fileName: null, manual: true });
    next();
  };

  function saveExact(inv) {
    let client = inv.clientId ? db.clients.find((c) => c.id === inv.clientId) : null;
    if (!client && inv.client) {
      const { id, ...rest } = inv.client;
      client = findClientByName(rest.name, rest.email) || upsertClient(newClient(rest));
    }
    upsertInvoice({ ...newInvoice(), ...inv, clientId: client ? client.id : null, client: client ? { ...client } : inv.client, imported: true, history: [{ at: Date.now(), what: 'Imported from PDF' }] });
  }

  function review(job) {
    const g = job.guess;
    const inv = newInvoice({
      number: g.number || '',
      issueDate: g.issueDate || today(),
      dueDate: g.dueDate || '',
      status: g.status || 'paid',
      items: (g.items || []).map((x) => ({ id: uid(), unit: '', description: '', ...x })),
      taxRate: g.taxRate || 0,
      notes: '', terms: '',
      imported: true,
      history: [{ at: Date.now(), what: job.fileName ? `Imported from ${job.fileName}` : 'Added manually' }],
    });
    const c = g.client || {};
    const match = c.name || c.email ? findClientByName(c.name, c.email) : null;

    reviewEl.innerHTML = `
      <div class="section-head"><h2>${job.manual ? 'Add a past invoice' : 'Check what we found'}</h2>${job.fileName ? `<span class="muted small">${esc(job.fileName)}</span>` : ''}</div>
      ${job.error ? `<div class="card note bad">${esc(job.error)}</div>` : ''}
      ${(g.warnings || []).map((w) => `<div class="card note warn">${esc(w)}</div>`).join('')}
      <div class="card form" id="rf">
        <div class="grid2">
          ${field('Invoice number', 'number', inv.number, { placeholder: 'e.g. INV-0042' })}
          <label class="field"><span class="field-label">Status</span><select name="status">
            <option value="paid" ${inv.status === 'paid' ? 'selected' : ''}>Paid</option>
            <option value="sent" ${inv.status === 'sent' ? 'selected' : ''}>Unpaid (sent)</option></select></label>
          ${field('Issue date', 'issueDate', inv.issueDate, { type: 'date' })}
          ${field('Due date', 'dueDate', inv.dueDate, { type: 'date' })}
        </div>
        <div class="group-label">Client ${match ? `<span class="pill st-paid">Matches ${esc(match.name)}</span>` : ''}</div>
        ${field('Client name', 'cname', c.name || '')}
        <div class="grid2">${field('Email', 'cemail', c.email || '', { type: 'email' })}${field('Phone', 'cphone', c.phone || '')}</div>
        ${field('Address', 'caddress', c.address || '', { textarea: true, rows: 2 })}
      </div>
      <div class="group-label">Items & prices</div>
      <div class="card list" id="ritems"></div>
      <div class="btn-row"><button class="btn sm" id="radd">${icon('plus')} Add line</button>${g.total ? `<button class="btn sm ghost" id="rtotal">Use total ${esc(money(g.total))} as one line</button>` : ''}</div>
      <div class="card form">
        ${field('Tax / VAT %', 'taxRate', inv.taxRate || '', { inputmode: 'decimal' })}
        <div class="sum" id="rsum"></div>
        <label class="check"><input type="checkbox" id="learn" checked> Remember these items & prices in my price book</label>
      </div>
      ${job.lines && job.lines.length ? `<details class="raw"><summary>Show text read from the PDF</summary><pre>${esc(job.lines.join('\n'))}</pre></details>` : ''}
      <div class="btn-row sticky-actions">
        <button class="btn ghost" id="skip">Skip</button>
        <button class="btn primary grow" id="rsave">${icon('check')} Save invoice</button>
      </div>`;

    const drawItems = () => {
      reviewEl.querySelector('#ritems').innerHTML = inv.items.map((it, i) => `
        <div class="ritem" data-i="${i}">
          <input class="ri-name" value="${esc(it.name)}" placeholder="Item">
          <input class="ri-qty" inputmode="decimal" value="${esc(it.qty)}" aria-label="Quantity">
          <input class="ri-price" inputmode="decimal" value="${esc(it.price)}" aria-label="Price">
          <button class="icon-btn ri-del" aria-label="Remove">${icon('x')}</button>
        </div>`).join('') || '<div class="row muted">No lines yet</div>';
    };
    const drawSum = () => {
      inv.taxRate = num(reviewEl.querySelector('[name=taxRate]').value);
      const t = totals({ ...inv, status: 'sent' });
      const diff = g.total != null && !job.manual && Math.abs(t.total - g.total) > 0.02;
      reviewEl.querySelector('#rsum').innerHTML = `
        <div><span>Subtotal</span><span>${esc(money(t.subtotal))}</span></div>
        ${t.tax ? `<div><span>Tax</span><span>${esc(money(t.tax))}</span></div>` : ''}
        <div class="strong"><span>Total</span><span>${esc(money(t.total))}</span></div>
        ${g.total != null && !job.manual ? `<div class="${diff ? 'bad' : 'ok'}"><span>Total on the PDF</span><span>${esc(money(g.total))} ${diff ? '≠' : '✓'}</span></div>` : ''}`;
    };
    drawItems(); drawSum();
    const ri = reviewEl.querySelector('#ritems');
    ri.oninput = (e) => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      const it = inv.items[+row.dataset.i];
      if (e.target.classList.contains('ri-name')) it.name = e.target.value;
      if (e.target.classList.contains('ri-qty')) it.qty = num(e.target.value);
      if (e.target.classList.contains('ri-price')) it.price = num(e.target.value);
      drawSum();
    };
    ri.onclick = (e) => {
      const d = e.target.closest('.ri-del');
      if (!d) return;
      inv.items.splice(+d.closest('[data-i]').dataset.i, 1);
      drawItems(); drawSum();
    };
    reviewEl.querySelector('[name=taxRate]').oninput = drawSum;
    reviewEl.querySelector('#radd').onclick = () => { inv.items.push({ id: uid(), name: '', description: '', qty: 1, price: 0, unit: '' }); drawItems(); };
    const rt = reviewEl.querySelector('#rtotal');
    if (rt) rt.onclick = () => {
      const net = g.tax != null ? round2(g.total - g.tax) : g.total;
      inv.items = [{ id: uid(), name: inv.items[0] && inv.items[0].name ? inv.items[0].name : 'Services', description: '', qty: 1, price: net, unit: '' }];
      drawItems(); drawSum();
    };
    reviewEl.querySelector('#skip').onclick = next;
    reviewEl.querySelector('#rsave').onclick = () => {
      const f = Object.fromEntries([...reviewEl.querySelectorAll('#rf [name]')].map((el) => [el.name, el.value]));
      inv.number = f.number.trim() || `PAST-${(db.invoices.length + 1).toString().padStart(3, '0')}`;
      if (db.invoices.some((x) => x.number === inv.number)) { toast(`${inv.number} already exists — change the number`); return; }
      inv.status = f.status;
      inv.issueDate = f.issueDate || today();
      inv.dueDate = f.dueDate || addDays(inv.issueDate, db.settings.dueDays);
      if (inv.status === 'paid') inv.paidDate = inv.dueDate < today() ? inv.dueDate : inv.issueDate;
      inv.items = inv.items.filter((x) => x.name.trim() || x.price);
      if (f.cname.trim()) {
        let client = findClientByName(f.cname, f.cemail);
        if (!client) client = upsertClient(newClient({ name: f.cname.trim(), email: f.cemail.trim(), phone: f.cphone.trim(), address: f.caddress.trim() }));
        inv.clientId = client.id; inv.client = { ...client };
      }
      const learn = reviewEl.querySelector('#learn').checked;
      const before = db.items.length;
      if (!learn) inv.skipPriceBook = true;
      upsertInvoice(inv);
      const added = db.items.length - before;
      toast(`Saved ${inv.number}${learn && added > 0 ? ` · ${added} new price${added === 1 ? '' : 's'} learned` : ''}`);
      next();
      window.scrollTo(0, 0);
      main.scrollTop = 0;
    };
    reviewEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
