import { db, save, replaceAll, loadDemo, formatNumber, newInvoice } from '../store.js';
import { shortcutPayload, runShortcut } from '../shortcut.js';
import { makePdf } from './share.js';
import { gmailAccount, loadGis, getToken, disconnectGmail, sendWithGmail } from '../gmail.js';
import { esc, today, downloadBlob, num } from '../util.js';
import { header, icon, field, readForm, toast, confirmSheet, sheet } from '../ui.js';

export default function more({ main }) {
  header({ title: 'More' });
  const n = (x) => `<span class="muted">${x}</span>`;
  main.innerHTML = `
    <div class="pad">
      <div class="card list">
        <a class="row" href="#/items"><span class="row-ic blue">${icon('tag')}</span><span class="row-main"><span class="row-title">Price book</span><span class="row-sub">Saved items & prices that auto-fill</span></span>${n(db.items.length)}<span class="chev">${icon('chev')}</span></a>
        <a class="row" href="#/design"><span class="row-ic violet">${icon('layout')}</span><span class="row-main"><span class="row-title">Invoice layout</span><span class="row-sub">Design how your invoices look</span></span><span class="chev">${icon('chev')}</span></a>
        <a class="row" href="#/import"><span class="row-ic teal">${icon('upload')}</span><span class="row-main"><span class="row-title">Import past invoices</span><span class="row-sub">PDF, CSV, pasted text or by hand</span></span><span class="chev">${icon('chev')}</span></a>
      </div>
      <div class="card list">
        <a class="row" href="#/settings"><span class="row-ic grey">${icon('gear')}</span><span class="row-main"><span class="row-title">Business & invoice settings</span><span class="row-sub">${esc(db.settings.business.name || 'Add your details')}</span></span><span class="chev">${icon('chev')}</span></a>
        <a class="row" href="privacy.html"><span class="row-ic grey">${icon('eye')}</span><span class="row-main"><span class="row-title">Privacy policy</span><span class="row-sub">What Tally does (and doesn’t do) with your data</span></span><span class="chev">${icon('chev')}</span></a>
        <a class="row" href="terms.html"><span class="row-ic grey">${icon('file')}</span><span class="row-main"><span class="row-title">Terms of service</span><span class="row-sub">The rules for using Tally</span></span><span class="chev">${icon('chev')}</span></a>
        <button class="row" id="install"><span class="row-ic green">${icon('download')}</span><span class="row-main"><span class="row-title">Add to Home Screen</span><span class="row-sub">Use it like a normal iPhone app, offline</span></span><span class="chev">${icon('chev')}</span></button>
      </div>
      <div class="group-label">Your data</div>
      <div class="card list">
        <button class="row" id="export"><span class="row-ic grey">${icon('download')}</span><span class="row-main"><span class="row-title">Back up everything</span><span class="row-sub">Save a backup file to Files / iCloud Drive</span></span></button>
        <label class="row"><span class="row-ic grey">${icon('upload')}</span><span class="row-main"><span class="row-title">Restore from backup</span><span class="row-sub">Replaces what’s on this device</span></span><input type="file" accept=".json,application/json" id="restore" hidden></label>
        <button class="row" id="demo"><span class="row-ic grey">${icon('wand')}</span><span class="row-main"><span class="row-title">Add demo data</span><span class="row-sub">Sample clients and invoices to play with</span></span></button>
        <button class="row danger" id="erase"><span class="row-ic red">${icon('trash')}</span><span class="row-main"><span class="row-title">Erase all data</span></span></button>
      </div>
      <p class="privacy">${icon('check')} ${db.invoices.length} invoices · ${db.clients.length} clients — stored only on this device. Back up now and then.</p>
    </div>`;
  main.querySelector('#install').onclick = installHelp;
  main.querySelector('#export').onclick = () => {
    downloadBlob(new Blob([JSON.stringify({ app: 'tally', version: 1, exportedAt: new Date().toISOString(), ...db }, null, 1)], { type: 'application/json' }), `tally-backup-${today()}.json`);
  };
  main.querySelector('#restore').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.invoices)) throw new Error('Not a Tally backup file');
      if (!(await confirmSheet(`Restore ${data.invoices.length} invoices and ${(data.clients || []).length} clients? Everything currently on this device will be replaced.`, { ok: 'Restore', danger: true }))) return;
      delete data.app; delete data.version; delete data.exportedAt;
      replaceAll(data);
      toast('Backup restored');
      location.hash = '#/';
    } catch (err) { toast(err.message, 'bad'); }
  };
  main.querySelector('#demo').onclick = () => { loadDemo(); toast('Demo data added'); location.hash = '#/'; };
  main.querySelector('#erase').onclick = async () => {
    if (!(await confirmSheet('Delete every invoice, client, item and setting on this device? Make a backup first if you might need them.', { ok: 'Erase everything', danger: true }))) return;
    replaceAll({});
    toast('All data erased');
    location.hash = '#/settings/welcome';
  };
}

export function installHelp() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  sheet({
    title: 'Add to Home Screen',
    body: standalone
      ? '<p>You’re already using Tally as an app. 🎉 It works offline and keeps your data on this phone.</p>'
      : `<ol class="steps">
          <li>Open this page in <b>Safari</b>.</li>
          <li>Tap the <b>Share</b> button ${icon('share')} at the bottom of the screen.</li>
          <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
          <li>Tap <b>Add</b>. Tally now opens full-screen from your Home Screen and works offline.</li>
        </ol>
        <p class="hint">Your invoices are stored only on this iPhone. Use <b>Back up everything</b> regularly to keep a copy in Files or iCloud Drive.</p>`,
  });
}

const CURRENCIES = ['GBP', 'EUR', 'USD', 'AUD', 'CAD', 'NZD', 'IEP', 'CHF', 'PLN', 'SEK', 'NOK', 'DKK', 'CZK', 'ZAR', 'INR', 'JPY', 'AED', 'SGD', 'HKD'].filter((c) => c !== 'IEP');
const LOCALES = [['en-GB', 'English (UK) — 31/12/2026'], ['en-US', 'English (US) — 12/31/2026'], ['en-IE', 'English (Ireland)'], ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)'], ['de-DE', 'Deutsch'], ['fr-FR', 'Français'], ['es-ES', 'Español'], ['it-IT', 'Italiano'], ['nl-NL', 'Nederlands'], ['pl-PL', 'Polski']];

export function settings({ params, main }) {
  const welcome = params[0] === 'welcome';
  const s = db.settings, b = s.business;
  let logo = { src: b.logo, w: b.logoW, h: b.logoH };
  header({
    title: welcome ? 'Welcome to Tally' : 'Settings',
    back: welcome ? '' : '#/more',
    sub: welcome ? 'Add your business details once — they appear on every invoice.' : '',
    right: `<button class="tb-btn strong" id="save">Save</button>`,
  });
  main.innerHTML = `
    <div class="pad" id="f">
      ${welcome ? `<div class="card note">Everything you enter stays on this iPhone — there’s no account and no server. <button class="link" id="skip">Skip for now</button> · <button class="link" id="demo">Try with demo data</button></div>` : ''}
      <div class="group-label">Your business</div>
      <div class="card form">
        <div class="logo-row">
          <div class="logo-box" id="logo-box"></div>
          <div class="btn-col">
            <label class="btn sm">${icon('upload')} ${b.logo ? 'Change logo' : 'Add logo'}<input type="file" accept="image/*" id="logo" hidden></label>
            <button class="btn sm ghost" id="logo-rm" ${b.logo ? '' : 'hidden'}>Remove</button>
          </div>
        </div>
        ${field('Business or your name', 'business.name', b.name, { placeholder: 'e.g. Smith Plumbing Ltd' })}
        <div class="grid2">
          ${field('Email', 'business.email', b.email, { type: 'email', inputmode: 'email' })}
          ${field('Phone', 'business.phone', b.phone, { type: 'tel' })}
        </div>
        ${field('Address', 'business.address', b.address, { textarea: true, rows: 3 })}
        ${field('Website', 'business.website', b.website, { inputmode: 'url', placeholder: 'Optional' })}
        <div class="grid2">
          ${field('Tax ID label', 'business.taxLabel', b.taxLabel, { placeholder: 'VAT No.' })}
          ${field('Tax ID', 'business.taxId', b.taxId, { placeholder: 'Optional' })}
        </div>
      </div>

      <div class="group-label">Getting paid</div>
      <div class="card form">
        ${field('Payment details', 'paymentDetails', s.paymentDetails, { textarea: true, rows: 4, placeholder: 'Bank name, account name, sort code, account number, PayPal…', hint: 'Printed on every invoice.' })}
      </div>

      <div class="group-label">Invoice defaults</div>
      <div class="card form">
        <div class="grid3">
          ${field('Prefix', 'prefix', s.prefix, { placeholder: 'ABC', extra: 'autocapitalize="characters"' })}
          <label class="field"><span class="field-label">Digits</span><select name="numberDigits">${[3, 4, 5, 6].map((d) => `<option ${d === (+s.numberDigits || 4) ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          ${field('Next number', 'nextNumber', s.nextNumber, { inputmode: 'numeric' })}
        </div>
        <div class="num-preview">Next invoice: <b id="num-preview"></b></div>
        <div class="grid2">
          ${field('Payment due (days)', 'dueDays', s.dueDays, { inputmode: 'numeric' })}
          ${field('Default tax / VAT %', 'taxRate', s.taxRate, { inputmode: 'decimal' })}
          <label class="field"><span class="field-label">Currency</span><select name="currency">${CURRENCIES.map((c) => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Date & number format</span><select name="locale">${LOCALES.map(([k, l]) => `<option value="${k}" ${k === s.locale ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        </div>
        ${field('Default notes', 'notes', s.notes, { textarea: true, rows: 2 })}
        ${field('Default terms', 'terms', s.terms, { textarea: true, rows: 2 })}
      </div>

      <div class="group-label" id="auto">Send automatically · iPhone Shortcut</div>
      <div class="card form">
        <p class="form-intro"><b>Recommended.</b> Invoices are emailed in one tap, PDF attached, from the account in your iPhone's Mail app (add your Gmail there). No Google Cloud setup. You make a small Shortcut once — about 3 minutes.</p>
        <label class="toggle big"><input type="checkbox" name="shortcutEnabled" ${s.shortcutEnabled ? 'checked' : ''}><span></span> Use the Shortcut to send invoices</label>
        ${field('Shortcut name', 'shortcutName', s.shortcutName || 'Tally Send', { hint: 'Must match the name in the Shortcuts app exactly.' })}
        <div class="btn-row">
          <button class="btn sm primary" id="sc-help">${icon('wand')} How to make the Shortcut</button>
          <button class="btn sm" id="sc-test">Send test email</button>
        </div>
      </div>

      <div class="group-label" id="gmail">Or: send from Gmail with Google sign-in</div>
      <div class="card form">
        <p class="form-intro">Send invoices from your own Gmail address in one tap, with the PDF attached. You sign in with Google on this phone — Tally only gets permission to <i>send</i> email, and nothing goes through any other server. <a href="privacy.html">Privacy policy</a> · <a href="terms.html">Terms</a></p>
        ${field('Google OAuth Client ID', 'gmailClientId', s.gmailClientId, { placeholder: '1234…apps.googleusercontent.com', extra: 'autocapitalize="off" autocorrect="off" spellcheck="false"' })}
        <div class="gmail-status" id="gmail-status"></div>
        <div class="btn-row">
          <button class="btn sm primary" id="g-connect">${icon('mail')} Connect Gmail</button>
          <button class="btn sm" id="g-test" hidden>Send test email</button>
          <button class="btn sm ghost danger" id="g-off" hidden>Disconnect</button>
          <button class="btn sm ghost" id="g-help">How to get a Client ID</button>
        </div>
      </div>

      <div class="group-label">Email message</div>
      <div class="card form">
        ${field('Subject', 'emailSubject', s.emailSubject)}
        ${field('Message', 'emailBody', s.emailBody, { textarea: true, rows: 6, hint: 'Placeholders: {client} {number} {total} {due} {business}' })}
      </div>
      <button class="btn primary block" id="save2">${welcome ? 'Save & start invoicing' : 'Save settings'}</button>
      ${welcome ? '' : `<a class="btn ghost block" href="#/design">${icon('layout')} Customise invoice layout</a>`}
    </div>`;

  const drawLogo = () => {
    main.querySelector('#logo-box').innerHTML = logo.src ? `<img src="${logo.src}" alt="Logo">` : `<span class="muted small">No logo</span>`;
    main.querySelector('#logo-rm').hidden = !logo.src;
  };
  drawLogo();
  main.querySelector('#logo').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { logo = await shrinkImage(f, 600); drawLogo(); } catch { toast('Could not read that image', 'bad'); }
  };
  main.querySelector('#logo-rm').onclick = () => { logo = { src: null, w: 0, h: 0 }; drawLogo(); };

  const doSave = () => {
    const f = readForm(main.querySelector('#f'));
    Object.assign(s.business, f.business, { logo: logo.src, logoW: logo.w, logoH: logo.h });
    for (const k of ['paymentDetails', 'currency', 'locale', 'notes', 'terms', 'emailSubject', 'emailBody']) s[k] = f[k];
    s.prefix = f.prefix.trim();
    s.numberDigits = +f.numberDigits || 4;
    s.gmailClientId = f.gmailClientId.trim();
    s.shortcutEnabled = !!f.shortcutEnabled;
    s.shortcutName = f.shortcutName.trim() || 'Tally Send';
    s.nextNumber = Math.max(1, Math.floor(num(f.nextNumber)) || 1);
    s.dueDays = Math.max(0, Math.floor(num(f.dueDays)));
    s.taxRate = num(f.taxRate);
    s.onboarded = true;
    save();
    toast('Settings saved');
    location.hash = welcome ? '#/' : '#/more';
  };
  document.getElementById('save').onclick = doSave;
  main.querySelector('#save2').onclick = doSave;

  // ---- invoice number preview ----
  const preview = () => {
    const f = readForm(main.querySelector('#f'));
    main.querySelector('#num-preview').textContent = formatNumber(f.nextNumber || 1, f.prefix.trim(), f.numberDigits);
  };
  for (const n of ['prefix', 'numberDigits', 'nextNumber']) main.querySelector(`[name=${n}]`).addEventListener('input', preview);
  main.querySelector('[name=numberDigits]').addEventListener('change', preview);
  preview();

  // ---- Gmail ----
  const idInput = main.querySelector('[name=gmailClientId]');
  const gStatus = () => {
    const acct = gmailAccount();
    main.querySelector('#gmail-status').innerHTML = acct
      ? `<span class="pill st-paid">Connected</span> ${esc(acct)}`
      : `<span class="pill st-draft">Not connected</span>`;
    main.querySelector('#g-connect').hidden = !!acct;
    main.querySelector('#g-test').hidden = !acct;
    main.querySelector('#g-off').hidden = !acct;
  };
  gStatus();
  const preload = () => { if (idInput.value.trim()) loadGis().catch(() => {}); };
  idInput.addEventListener('change', preload);
  preload();
  const ensureId = () => {
    const id = idInput.value.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) { toast('Paste your Client ID first (it ends in .apps.googleusercontent.com)', 'bad'); idInput.focus(); return false; }
    if (s.gmailClientId !== id) { s.gmailClientId = id; s.gmailEmail = ''; save(); }
    if (!(window.google && google.accounts && google.accounts.oauth2)) {
      loadGis().then(() => toast('Ready — tap the button again')).catch((e) => toast(e.message, 'bad'));
      return false;
    }
    return true;
  };
  main.querySelector('#g-connect').onclick = () => {
    if (!ensureId()) return;
    getToken().then(() => { gStatus(); toast('Gmail connected'); }).catch((e) => toast(e.message, 'bad'));
  };
  main.querySelector('#g-test').onclick = () => {
    if (!ensureId()) return;
    getToken()
      .then((t) => sendWithGmail(t, { to: gmailAccount(), subject: 'Tally test email', body: 'It works! Invoices sent from Tally will come from this Gmail account.' }))
      .then(() => toast(`Test email sent to ${gmailAccount()}`))
      .catch((e) => toast(e.message, 'bad'));
  };
  main.querySelector('#g-off').onclick = () => { disconnectGmail(); gStatus(); toast('Gmail disconnected'); };
  main.querySelector('#g-help').onclick = gmailHelp;
  // ---- Shortcut ----
  main.querySelector('#sc-help').onclick = () => shortcutHelp(main.querySelector('[name=shortcutName]').value.trim() || 'Tally Send');
  const scTest = main.querySelector('#sc-test');
  let testPayload = null;
  scTest.onclick = () => {
    s.shortcutName = main.querySelector('[name=shortcutName]').value.trim() || 'Tally Send';
    const to = main.querySelector('[name="business.email"]').value.trim();
    if (!to) { toast('Add your email under “Your business” first — the test is sent there', 'bad'); return; }
    if (testPayload) { runShortcut(testPayload); testPayload = null; scTest.textContent = 'Send test email'; return; }
    scTest.disabled = true;
    scTest.textContent = 'Preparing…';
    const inv = newInvoice({ number: 'TEST', items: [{ id: 't', name: 'Test item', qty: 1, price: 1, unit: '', description: '' }] });
    makePdf(inv)
      .then((blob) => shortcutPayload({ to, subject: 'Tally test email', body: 'It works! Invoices sent from Tally will arrive like this, with the PDF attached.', file: new File([blob], 'Invoice TEST.pdf', { type: 'application/pdf' }) }))
      .then((p) => { testPayload = p; scTest.disabled = false; scTest.textContent = 'Tap to run the test'; })
      .catch((e) => { scTest.disabled = false; scTest.textContent = 'Send test email'; toast(e.message, 'bad'); });
  };
  if (params[0] === 'auto') requestAnimationFrame(() => main.querySelector('#auto').scrollIntoView({ block: 'start' }));
  if (params[0] === 'gmail') requestAnimationFrame(() => main.querySelector('#gmail').scrollIntoView({ block: 'start' }));
  if (welcome) {
    main.querySelector('#skip').onclick = () => { s.onboarded = true; save(); location.hash = '#/'; };
    main.querySelector('#demo').onclick = () => { s.onboarded = true; loadDemo(); location.hash = '#/'; };
  }
}

function shortcutHelp(name) {
  const v = (k) => `<code class="copy-code">${k}</code>`;
  sheet({
    title: 'Make the “' + name + '” Shortcut',
    tall: true,
    body: `
      <p><b>Before you start:</b> make sure your Gmail is in the iPhone Mail app (Settings → Apps → Mail → Mail Accounts → Add Account → Google).</p>
      <ol class="steps">
        <li>Open the <b>Shortcuts</b> app, tap <b>+</b>, and name the shortcut exactly <b>${esc(name)}</b> (tap the name at the top).</li>
        <li>Add <b>Get Clipboard</b>.</li>
        <li>Add <b>Get Dictionary from Input</b> (it uses the Clipboard automatically).</li>
        <li>Add <b>Get Dictionary Value</b> → set it to <i>Get Value for</i> ${v('pdf')} <i>in</i> <b>Dictionary</b>.</li>
        <li>Add <b>Base64 Encode</b>, tap <i>Encode</i> and change it to <b>Decode</b>.</li>
        <li>Add <b>Get Dictionary Value</b> → key ${v('filename')}. Tap its input and choose <b>Select Variable → Dictionary</b>.</li>
        <li>Add <b>Set Name</b> → set the name of <b>Base64 Decoded</b> to <b>Dictionary Value</b> (the filename). Tap each blue field and pick the variable.</li>
        <li>Add three more <b>Get Dictionary Value</b> actions for ${v('to')}, ${v('subject')} and ${v('body')}, each reading from <b>Dictionary</b> like step 6.</li>
        <li>Add <b>Send Email</b>:
          <ul>
            <li><b>Recipients</b>: the ${v('to')} value</li>
            <li><b>Subject</b>: the ${v('subject')} value</li>
            <li><b>Message</b>: the ${v('body')} value, then the <b>Renamed Item</b> (the PDF) — it becomes the attachment</li>
            <li>Tap the arrow to show more: turn <b>Show Compose Sheet</b> <b>off</b>, and set <b>From</b> to your Gmail address</li>
          </ul></li>
        <li>Tap <b>Done</b>. Back in Tally, turn the switch on, tap <b>Save</b>, then <b>Send test email</b>. The first time, iPhone asks whether the shortcut may send email — choose <b>Always Allow</b>.</li>
      </ol>
      <p class="hint">After sending, iPhone shows the Shortcuts app — swipe back or tap Tally to return. Sent emails appear in your Gmail “Sent” folder.</p>`,
  });
}

function gmailHelp() {
  const origin = location.origin;
  sheet({
    title: 'Set up Gmail sending',
    tall: true,
    body: `
      <p>Google requires every app that sends Gmail to have its own <b>Client ID</b>. It's free and takes about 5 minutes, once. Do it on a computer if you can — it's easier.</p>
      <ol class="steps">
        <li>Open <b>console.cloud.google.com</b> and sign in with the Gmail account you'll send from. Create a project (any name, e.g. “Tally”).</li>
        <li>Search for <b>Gmail API</b> in the top search bar and tap <b>Enable</b>.</li>
        <li>Go to <b>Google Auth Platform</b> (also called “OAuth consent screen”) → <b>Get started</b>. App name: <i>Tally</i>, support email: yours, audience: <b>External</b>. Finish.</li>
        <li>In <b>Audience</b>, under <b>Test users</b>, add your own Gmail address.</li>
        <li>In <b>Clients</b> → <b>Create client</b> → type <b>Web application</b>. Under <b>Authorised JavaScript origins</b> add:<br><code class="copy-code">${esc(origin)}</code></li>
        <li>Create, then copy the <b>Client ID</b> (ends in <i>.apps.googleusercontent.com</i>) and paste it into Tally → <b>Connect Gmail</b>.</li>
      </ol>
      <p class="hint">When you connect, Google may say <b>“Google hasn't verified this app”</b> — that's normal for your own private app. Tap <b>Continue</b>, then allow <b>“Send email on your behalf”</b>. Google signs you out of Tally after about an hour; the next time you send, just pick your account again.</p>
      <button class="btn block" id="copy-origin">${icon('copy')} Copy ${esc(origin)}</button>`,
    onMount(el) {
      el.querySelector('#copy-origin').onclick = () => navigator.clipboard.writeText(origin).then(() => toast('Copied')).catch(() => toast(origin));
    },
  });
}

function shrinkImage(file, max) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const r = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * r);
      c.height = Math.round(im.naturalHeight * r);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ src: c.toDataURL('image/png'), w: c.width, h: c.height });
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    im.src = url;
  });
}
