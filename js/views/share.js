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
        <button class="btn block" id="s-mail">${icon('mail')} Open in Mail & attach it myself</button>
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
        if (!file) { toast('One moment — preparing the PDF…'); return; }
        const { to, subject, body } = v();
        const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        attachSheet(inv, file, mailto, () => markSent(`Emailed ${to}`));
      };
      el.querySelector('#s-dl').onclick = () => {
        if (file) { downloadBlob(file, file.name); markSent('PDF saved'); } else downloadPdf(inv);
      };
    },
  });
}

// "Attach it yourself": a draggable PDF, a copyable page image, and the steps
// to add the PDF inside the Mail app.
function attachSheet(inv, file, mailto, onOpened) {
  const pdfUrl = URL.createObjectURL(file);
  let imgBlob = null;
  sheet({
    title: 'Add the PDF to your email',
    tall: true,
    onClose: () => setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000),
    body: `
      <p class="hint">Drag the invoice into your email, or save it and attach it from Mail. Mail opens with the address, subject and message already filled in.</p>
      <div class="attach-drop">
        <div class="pdf-chip" id="a-pdf">
          <span class="pdf-ic" id="a-badge">PDF</span>
          <img class="pdf-drag" id="a-pdfimg" alt="${esc(file.name)}" hidden>
          <span class="pdf-meta"><b>${esc(file.name)}</b><span class="muted small" id="a-hint">${Math.max(1, Math.round(file.size / 1024))} KB · drag me into the email</span></span>
        </div>
        <div class="page-thumb"><img id="a-img" alt="Invoice ${esc(inv.number)}" draggable="true"><span class="muted small">Page image — drag, or copy &amp; paste</span></div>
      </div>
      <div class="btn-col">
        <button class="btn primary block" id="a-open">${icon('mail')} Open Mail</button>
        <div class="btn-row tight two">
          <button class="btn sm" id="a-save">${icon('download')} Save PDF to Files</button>
          <button class="btn sm" id="a-copy" disabled>${icon('copy')} Copy page image</button>
        </div>
      </div>
      <div class="group-label">On iPhone</div>
      <ol class="steps">
        <li>Tap <b>Save PDF to Files</b> (choose <i>Save to Files</i> if asked).</li>
        <li>Tap <b>Open Mail</b>. In the new email, tap where you want the attachment, then tap the <b>‹</b> / <b>Aa</b> bar above the keyboard → <b>paperclip / document</b> icon → <b>Recents</b> → pick <b>${esc(file.name)}</b>.</li>
        <li><i>Or drag & drop:</i> press and hold the PDF card above until it lifts, and with another finger swipe up to switch to Mail — drop it into the email.</li>
        <li><i>Quickest (as an image):</i> tap <b>Copy page image</b>, then in the email tap and hold → <b>Paste</b>.</li>
      </ol>
      <p class="hint">On a computer you can drag the PDF card straight into an email or onto your desktop.</p>`,
    onMount(el) {
      const chip = el.querySelector('#a-pdf');
      const pdfImg = el.querySelector('#a-pdfimg');
      // Safari (iPhone, iPad, Mac) can show a PDF in an <img>. Dragging that
      // image hands over the actual PDF file, not a link — so when it loads,
      // the PDF thumbnail itself becomes the thing you drag.
      pdfImg.onload = () => {
        pdfImg.hidden = false;
        pdfImg.draggable = true;
        el.querySelector('#a-badge').hidden = true;
        el.querySelector('#a-hint').textContent = 'Press and hold the page, then drag it into the email';
        chip.classList.add('native');
      };
      // Other browsers (Chrome, Edge…): attach the real file to the drag ourselves.
      pdfImg.onerror = () => {
        chip.draggable = true;
        const reader = new FileReader();
        let dataUrl = null;
        reader.onload = () => { dataUrl = reader.result; };
        reader.readAsDataURL(file);
        chip.addEventListener('dragstart', (e) => {
          try { e.dataTransfer.items.add(file); } catch { /* not supported */ }
          try { if (dataUrl) e.dataTransfer.setData('DownloadURL', `application/pdf:${file.name}:${dataUrl}`); } catch { /* not supported */ }
          e.dataTransfer.effectAllowed = 'copy';
        });
      };
      pdfImg.src = pdfUrl;
      chip.addEventListener('click', () => downloadBlob(file, file.name));

      // render page 1 as an image for drag / copy-paste
      const img = el.querySelector('#a-img');
      const lay = layout(db.template, { inv, settings: db.settings });
      preloadImages(lay).then((imgs) => {
        const c = document.createElement('canvas');
        drawPage(c, lay, 0, 600, imgs);
        c.toBlob((b) => {
          imgBlob = b;
          img.src = URL.createObjectURL(b);
          el.querySelector('#a-copy').disabled = !(navigator.clipboard && window.ClipboardItem);
        }, 'image/png');
      });

      el.querySelector('#a-save').onclick = () => downloadBlob(file, file.name);
      el.querySelector('#a-copy').onclick = () => {
        if (!imgBlob) return;
        navigator.clipboard.write([new ClipboardItem({ 'image/png': imgBlob })])
          .then(() => toast('Copied — paste it into the email'))
          .catch(() => toast('Copy failed — press and hold the image instead', 'bad'));
      };
      el.querySelector('#a-open').onclick = () => {
        location.href = mailto;
        onOpened();
      };
    },
  });
}
