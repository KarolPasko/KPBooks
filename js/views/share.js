// Previewing, exporting and emailing invoices.
import { db, upsertInvoice, logEvent, clientName } from '../store.js';
import { esc, money, fmtDate, totals, fill, downloadBlob } from '../util.js';
import { layout, drawPage, preloadImages } from '../layout.js';
import { buildPdf, pdfFileName } from '../pdf.js';
import { sheet, icon, toast } from '../ui.js';

export async function renderPreview(container, inv) {
  const data = { inv, settings: db.settings };
  const lay = layout(db.template, data);
  const imgs = await preloadImages(lay);
  container.innerHTML = '';
  const w = Math.min(container.clientWidth || 340, 820);
  for (let p = 0; p < lay.pages; p++) {
    const c = document.createElement('canvas');
    c.className = 'page';
    drawPage(c, lay, p, w, imgs);
    container.appendChild(c);
  }
  return lay;
}

export const makePdf = (inv) => buildPdf(db.template, { inv, settings: db.settings });

export function emailVars(inv) {
  const t = totals(inv);
  const c = inv.client || {};
  return {
    number: inv.number,
    total: money(t.due),
    due: inv.dueDate ? fmtDate(inv.dueDate) : 'receipt',
    client: c.type === 'business' && !c.contact ? c.name || 'there' : (c.contact || c.name || 'there').split(' ')[0],
    business: db.settings.business.name || '',
  };
}

export async function downloadPdf(inv) {
  const blob = await makePdf(inv);
  downloadBlob(blob, pdfFileName(inv));
}

export function sendSheet(inv, onDone) {
  const vars = emailVars(inv);
  const to = (inv.client && inv.client.email) || '';
  let file = null;
  const canShareFiles = !!(navigator.canShare && window.File);
  sheet({
    title: 'Send invoice',
    tall: true,
    body: `
      <div class="send-summary card flat">
        <div><div class="muted small">To</div><div class="strong">${esc(clientName(inv.client))}</div></div>
        <div class="right"><div class="muted small">${esc(inv.number)}</div><div class="strong">${esc(money(totals(inv).due))}</div></div>
      </div>
      <label class="field"><span class="field-label">Email</span><input id="s-to" type="email" inputmode="email" value="${esc(to)}" placeholder="client@example.com"></label>
      <label class="field"><span class="field-label">Subject</span><input id="s-subj" value="${esc(fill(db.settings.emailSubject, vars))}"></label>
      <label class="field"><span class="field-label">Message</span><textarea id="s-body" rows="6">${esc(fill(db.settings.emailBody, vars))}</textarea></label>
      <div class="btn-col">
        <button class="btn primary block" id="s-share" disabled>${icon('share')} <span>Preparing PDF…</span></button>
        <button class="btn block" id="s-mail">${icon('mail')} Open in Mail (no attachment)</button>
        <button class="btn ghost block" id="s-dl">${icon('download')} Save PDF</button>
      </div>
      <p class="hint">${canShareFiles
        ? '<b>Share PDF</b> opens the iPhone share sheet — pick <b>Mail</b> and the PDF is attached. The email address is copied, so just paste it into “To”.'
        : 'Your browser can’t attach files directly. Save the PDF, then attach it to an email.'}</p>
      <label class="check"><input type="checkbox" id="s-mark" ${inv.status === 'draft' ? 'checked' : ''}> Mark as sent</label>`,
    onMount(el, close) {
      const btn = el.querySelector('#s-share');
      makePdf(inv).then((blob) => {
        file = new File([blob], pdfFileName(inv), { type: 'application/pdf' });
        const ok = canShareFiles && navigator.canShare({ files: [file] });
        btn.disabled = false;
        btn.querySelector('span').textContent = ok ? 'Share PDF via Mail…' : 'Save PDF';
        btn.dataset.mode = ok ? 'share' : 'download';
      }).catch((e) => { btn.querySelector('span').textContent = 'PDF failed'; console.error(e); });
      const v = () => ({ to: el.querySelector('#s-to').value.trim(), subject: el.querySelector('#s-subj').value, body: el.querySelector('#s-body').value });
      const markSent = (how) => {
        if (el.querySelector('#s-mark').checked && inv.status === 'draft') inv.status = 'sent';
        logEvent(inv, how);
        if (!inv.client || !inv.client.email) { /* keep */ }
        upsertInvoice(inv);
        if (onDone) onDone();
      };
      // Must stay synchronous so iOS treats share() as a direct tap.
      btn.onclick = () => {
        if (!file) return;
        const { to, subject, body } = v();
        if (btn.dataset.mode === 'share') {
          if (to && navigator.clipboard) navigator.clipboard.writeText(to).catch(() => {});
          navigator.share({ files: [file], title: subject, text: body })
            .then(() => { markSent('Shared PDF'); toast('Shared'); close(); })
            .catch((e) => { if (e && e.name !== 'AbortError') toast('Sharing failed — try Save PDF', 'bad'); });
        } else {
          downloadBlob(file, file.name);
          markSent('PDF saved');
        }
      };
      el.querySelector('#s-mail').onclick = () => {
        const { to, subject, body } = v();
        location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        markSent(`Emailed ${to}`);
      };
      el.querySelector('#s-dl').onclick = () => {
        if (file) { downloadBlob(file, file.name); markSent('PDF saved'); } else downloadPdf(inv);
      };
    },
  });
}
