import { db, newItem, upsertItem, deleteItem, getItem, priceStats } from '../store.js';
import { esc, money, fmtDate, num, round2 } from '../util.js';
import { header, icon, sheet, field, readForm, toast, confirmSheet, emptyState } from '../ui.js';
import { csvToData } from '../importer.js';

export default function items({ main }) {
  header({ title: 'Price book', back: '#/more', sub: 'Prices fill in automatically when you add items to an invoice.', right: `<button class="tb-btn" id="add" aria-label="Add item">${icon('plus')}</button>` });
  main.innerHTML = `<div class="pad">
    <label class="search">${icon('search')}<input type="search" id="q" placeholder="Search items"></label>
    <div id="list"></div>
    <div class="btn-row">
      <label class="btn">${icon('upload')} Import price list (CSV)<input type="file" accept=".csv,text/csv" id="csv" hidden></label>
      <a class="btn ghost" href="#/import">${icon('file')} Learn from past invoices</a>
    </div>
  </div>`;
  const draw = () => {
    const q = main.querySelector('#q').value.toLowerCase();
    const list = db.items.filter((i) => !q || (i.name + ' ' + i.description).toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    main.querySelector('#list').innerHTML = list.length
      ? `<div class="card list">${list.map((it) => {
        const st = priceStats(it);
        return `<button class="row" data-id="${it.id}">
          <span class="row-main"><span class="row-title">${esc(it.name)}${it.unit ? ` <span class="muted">/ ${esc(it.unit)}</span>` : ''}</span>
          <span class="row-sub">${st ? `Used ${st.count}× · last ${esc(fmtDate(st.last.date))}${st.min !== st.max ? ` · ${esc(money(st.min))}–${esc(money(st.max))}` : ''}` : esc(it.description || 'Added manually')}</span></span>
          <span class="row-amt">${esc(money(it.price))}</span></button>`;
      }).join('')}</div>`
      : db.items.length ? emptyState('search', 'No matches', 'Try another search.')
        : emptyState('tag', 'Your price book is empty', 'Items you invoice are remembered here with their prices. Import past invoices to fill it instantly, or add items by hand.');
  };
  main.querySelector('#q').oninput = draw;
  main.querySelector('#list').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) editItem(getItem(b.dataset.id), draw); };
  document.getElementById('add').onclick = () => editItem(null, draw);
  main.querySelector('#csv').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = csvToData(await f.text());
      if (d.kind !== 'items') { toast('That CSV has invoice numbers — use Import past invoices instead'); return; }
      let n = 0;
      for (const it of d.items) {
        const ex = db.items.find((x) => x.name.toLowerCase() === it.name.toLowerCase());
        upsertItem(ex ? { ...ex, price: it.price || ex.price, description: it.description || ex.description, unit: it.unit || ex.unit } : newItem({ name: it.name, description: it.description, unit: it.unit, price: it.price, source: 'csv' }));
        n++;
      }
      toast(`Imported ${n} item${n === 1 ? '' : 's'}`);
      draw();
    } catch (err) { toast(err.message, 'bad'); }
    e.target.value = '';
  };
  draw();
}

function editItem(it, done) {
  const isNew = !it;
  it = it || newItem();
  const st = priceStats(it);
  sheet({
    title: isNew ? 'New item' : 'Edit item',
    tall: true,
    body: `<div class="card form" id="f">
      ${field('Name', 'name', it.name, { placeholder: 'e.g. Consulting hour' })}
      ${field('Description', 'description', it.description, { textarea: true, rows: 2, placeholder: 'Optional — shown under the item' })}
      <div class="grid2">${field('Price', 'price', it.price || '', { inputmode: 'decimal', placeholder: '0.00' })}${field('Unit', 'unit', it.unit, { placeholder: 'hrs, pcs, days' })}</div>
    </div>
    ${st ? `<div class="group-label">Price history</div><div class="card list">${[...it.history].reverse().map((h) => `<a class="row" href="#/invoice/${h.invoiceId}"><span class="row-main"><span class="row-title">${esc(h.number || 'Invoice')}</span><span class="row-sub">${esc(fmtDate(h.date))} · qty ${esc(h.qty)}</span></span><span class="row-amt">${esc(money(h.price))}</span></a>`).join('')}</div>
      <p class="hint">Average ${esc(money(st.avg))} across ${st.count} invoice${st.count === 1 ? '' : 's'}.</p>` : ''}
    <div class="btn-col"><button class="btn primary block" id="ok">Save item</button>${isNew ? '' : `<button class="btn danger ghost block" id="del">${icon('trash')} Delete</button>`}</div>`,
    onMount(el, close) {
      el.querySelector('#ok').onclick = () => {
        const f = readForm(el.querySelector('#f'));
        if (!f.name.trim()) { toast('Add a name'); return; }
        upsertItem({ ...it, ...f, name: f.name.trim(), price: round2(num(f.price)) });
        close(); done();
      };
      const del = el.querySelector('#del');
      if (del) del.onclick = async () => { if (await confirmSheet(`Remove ${it.name} from your price book?`, { ok: 'Delete', danger: true })) { deleteItem(it.id); close(); done(); } };
      el.querySelectorAll('a.row').forEach((a) => a.addEventListener('click', close));
    },
  });
}
