// Previewing, exporting and emailing invoices.
import { db, upsertInvoice, logEvent, clientName, getClient, upsertClient } from '../store.js';
import { shortcutEnabled, shortcutName, shortcutPayload, runShortcut } from '../shortcut.js';
import { gmailConfigured, gmailAccount, loadGis, getToken, sendWithGmail, validEmails } from '../gmail.js';
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
  const gmail = gmailConfigured();
  const auto = shortcutEnabled();
  if (gmail) loadGis().catch(() => {});
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
        ${auto ? `<button class="btn primary block" id="s-auto" disabled>${icon('send')} <span>Preparing PDF…</span></button>
        <p class="hint center">Sends via your “${esc(shortcutName())}” Shortcut and the Mail app, PDF attached.</p>` : ''}
        ${gmail ? `<button class="btn ${auto ? '' : 'primary'} block" id="s-gmail" disabled>${icon('send')} <span>Preparing PDF…</span></button>
        <p class="hint center" id="s-gmail-note">Sends from ${esc(gmailAccount() || 'your Gmail')} with the PDF attached.</p>` : ''}
        <button class="btn ${gmail || auto ? '' : 'primary'} block" id="s-share" disabled>${icon('share')} <span>Preparing PDF…</span></button>
        <button class="btn block" id="s-mail">${icon('mail')} Open in Mail (no attachment)</button>
        <button class="btn ghost block" id="s-dl">${icon('download')} Save PDF</button>
      </div>
      ${gmail || auto ? '' : `<a class="card note gmail-cta" href="#/settings/auto">${icon('mail')}<span><b>Send automatically</b><br><span class="muted small">One tap, PDF attached, from your Gmail — no copy-pasting. Set it up once →</span></span></a>`}
      <p class="hint">${canShareFiles
        ? '<b>Share PDF</b> opens the iPhone share sheet — pick <b>Mail</b> and the PDF is attached. The email address is copied, so just paste it into “To”.'
        : 'Your browser can’t attach files directly. Save the PDF, then attach it to an email.'}</p>
      <label class="check"><input type="checkbox" id="s-mark" ${inv.status === 'draft' ? 'checked' : ''}> Mark as sent</label>`,
    onMount(el, close) {
      const btn = el.querySelector('#s-share');
      const gbtn = el.querySelector('#s-gmail');
      const abtn = el.querySelector('#s-auto');
      let payloadFor = null; // the fields the prepared payload was built from
      let payload = null;
      const preparePayload = () => {
        const cur = JSON.stringify(v());
        if (!file || payloadFor === cur) return;
        payloadFor = cur;
        payload = null;
        if (abtn) abtn.disabled = true;
        const { to, subject, body } = v();
        shortcutPayload({ to, subject, body, file }).then((p) => {
          if (payloadFor !== cur) return;
          payload = p;
          if (abtn) { abtn.disabled = false; abtn.querySelector('span').textContent = 'Send automatically'; }
        });
      };
      // keep the payload ready so the tap itself does no waiting
      el.addEventListener('input', () => { if (abtn) setTimeout(preparePayload, 0); });
      makePdf(inv).then((blob) => {
        file = new File([blob], pdfFileName(inv), { type: 'application/pdf' });
        const ok = canShareFiles && navigator.canShare({ files: [file] });
        btn.disabled = false;
        btn.querySelector('span').textContent = ok ? 'Share PDF via Mail…' : 'Save PDF';
        btn.dataset.mode = ok ? 'share' : 'download';
        if (abtn) preparePayload();
        if (gbtn) {
          gbtn.querySelector('span').textContent = 'Send with Gmail';
          // Google sign-in must be loaded before the tap so its window can open.
          loadGis().then(() => { gbtn.disabled = false; })
            .catch((e) => { gbtn.querySelector('span').textContent = 'Gmail unavailable (offline?)'; el.querySelector('#s-gmail-note').textContent = e.message; });
        }
      }).catch((e) => { btn.querySelector('span').textContent = 'PDF failed'; console.error(e); });
      const v = () => ({ to: el.querySelector('#s-to').value.trim(), subject: el.querySelector('#s-subj').value, body: el.querySelector('#s-body').value });
      const markSent = (how) => {
        if (el.querySelector('#s-mark').checked && inv.status === 'draft') inv.status = 'sent';
        logEvent(inv, how);
        // remember an email address typed here on the client's record
        const to = v().to;
        const c = inv.clientId ? getClient(inv.clientId) : null;
        if (c && !c.email && to && validEmails(to) && !to.includes(',')) upsertClient({ ...c, email: to });
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
      if (abtn) abtn.onclick = () => {
        const { to } = v();
        if (!to || !validEmails(to)) { toast('Enter a valid email address', 'bad'); el.querySelector('#s-to').focus(); return; }
        if (!payload) { preparePayload(); toast('One moment — preparing…'); return; }
        runShortcut(payload).then(() => {
          el.querySelector('#s-mark').checked = true;
          markSent(`Emailed to ${to} via Shortcut`);
          close();
        });
      };
      const cta = el.querySelector('.gmail-cta');
      if (cta) cta.addEventListener('click', close);
      if (gbtn) gbtn.onclick = () => {
        if (!file) return;
        const { to, subject, body } = v();
        if (!to || !validEmails(to)) { toast('Enter a valid email address', 'bad'); el.querySelector('#s-to').focus(); return; }
        const label = gbtn.querySelector('span');
        // getToken() opens Google's sign-in straight from this tap when needed.
        getToken()
          .then((token) => {
            gbtn.disabled = true;
            label.textContent = 'Sending…';
            return sendWithGmail(token, { to, subject, body, file });
          })
          .then(() => {
            el.querySelector('#s-mark').checked = true;
            markSent(`Emailed to ${to} via Gmail`);
            toast(`Sent to ${to}`);
            close();
          })
          .catch((e) => {
            gbtn.disabled = false;
            label.textContent = 'Send with Gmail';
            toast(e.message, 'bad');
          });
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
