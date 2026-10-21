import { db, getInvoice, upsertInvoice, deleteInvoice, newInvoice, logEvent, clientName } from '../store.js';
import { esc, money, fmtDate, totals, statusOf, STATUS_LABEL, uid, today } from '../util.js';
import { header, icon, statusPill, actionSheet, confirmSheet, toast } from '../ui.js';
import { renderPreview, sendSheet, downloadPdf } from './share.js';

export default function invoiceView({ params, main }) {
  const inv = getInvoice(params[0]);
  if (!inv) { location.hash = '#/invoices'; return; }
  header({ title: inv.number, back: '#/invoices', large: false, right: `<button class="tb-btn" id="more" aria-label="More">${icon('more')}</button>` });
  const draw = () => {
    const st = statusOf(inv), t = totals(inv);
    main.innerHTML = `
      <div class="pad">
        <section class="inv-head card">
          <div class="inv-head-top">
            <div>
              <div class="muted small">${esc(inv.number)}${inv.imported ? ' · imported' : ''}</div>
              <div class="inv-client">${esc(clientName(inv.client))}</div>
            </div>
            ${statusPill(st, STATUS_LABEL[st])}
          </div>
          <div class="inv-amt">${esc(money(st === 'paid' ? t.total : t.due))}</div>
          <div class="muted small">${st === 'paid' ? `Paid${inv.paidDate ? ' ' + esc(fmtDate(inv.paidDate)) : ''}` : `Due ${inv.dueDate ? esc(fmtDate(inv.dueDate)) : 'on receipt'}`} · Issued ${esc(fmtDate(inv.issueDate))}</div>
          <div class="action-bar">
            <a class="act" href="#/invoice/${inv.id}/edit">${icon('edit')}<span>Edit</span></a>
            <button class="act" id="send">${icon('send')}<span>Send</span></button>
            <button class="act" id="pdf">${icon('download')}<span>PDF</span></button>
            <button class="act" id="paid">${icon('check')}<span>${st === 'paid' ? 'Unpaid' : 'Paid'}</span></button>
          </div>
        </section>
        <div class="section-head"><h2>Preview</h2><a href="#/design">${icon('layout')} Layout</a></div>
        <div class="preview" id="preview"><div class="page skeleton"></div></div>
        ${(inv.history || []).length ? `<div class="section-head"><h2>Activity</h2></div>
        <div class="card list timeline">${[...inv.history].reverse().map((h) => `<div class="row"><div class="row-main"><div class="row-title">${esc(h.what)}</div><div class="row-sub">${esc(new Date(h.at).toLocaleString())}</div></div></div>`).join('')}</div>` : ''}
      </div>`;
    renderPreview(main.querySelector('#preview'), inv);
    main.querySelector('#send').onclick = () => sendSheet(inv, draw);
    main.querySelector('#pdf').onclick = () => downloadPdf(inv).catch((e) => toast('PDF failed: ' + e.message, 'bad'));
    main.querySelector('#paid').onclick = () => {
      if (inv.status === 'paid') { inv.status = 'sent'; inv.paidDate = null; logEvent(inv, 'Marked unpaid'); }
      else { inv.status = 'paid'; inv.paidDate = today(); logEvent(inv, 'Marked paid'); toast('Marked as paid'); }
      upsertInvoice(inv);
      draw();
    };
  };
  draw();
  document.getElementById('more').onclick = async () => {
    const a = await actionSheet(inv.number, [
      { label: 'Duplicate', icon: 'copy', value: 'dup' },
      { label: 'Edit layout', icon: 'layout', value: 'layout' },
      ...(inv.status !== 'draft' ? [{ label: 'Move back to drafts', icon: 'undo', value: 'draft' }] : []),
      { label: 'Delete invoice', icon: 'trash', value: 'del', danger: true },
    ]);
    if (a === 'dup') {
      const copy = newInvoice({ clientId: inv.clientId, client: inv.client, items: inv.items.map((x) => ({ ...x, id: uid() })), discountType: inv.discountType, discountValue: inv.discountValue, taxRate: inv.taxRate, notes: inv.notes, terms: inv.terms });
      upsertInvoice(copy);
      location.hash = `#/invoice/${copy.id}/edit`;
    } else if (a === 'layout') location.hash = '#/design';
    else if (a === 'draft') { inv.status = 'draft'; upsertInvoice(inv); draw(); }
    else if (a === 'del' && (await confirmSheet(`Delete ${inv.number}? This can’t be undone.`, { ok: 'Delete', danger: true }))) {
      deleteInvoice(inv.id);
      toast('Invoice deleted');
      location.hash = '#/invoices';
    }
  };
  void db;
}
