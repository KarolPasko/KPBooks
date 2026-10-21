import { db, save, replaceAll, loadDemo } from '../store.js';
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
        <div class="grid2">
          ${field('Number prefix', 'prefix', s.prefix)}
          ${field('Next number', 'nextNumber', s.nextNumber, { inputmode: 'numeric' })}
          ${field('Payment due (days)', 'dueDays', s.dueDays, { inputmode: 'numeric' })}
          ${field('Default tax / VAT %', 'taxRate', s.taxRate, { inputmode: 'decimal' })}
          <label class="field"><span class="field-label">Currency</span><select name="currency">${CURRENCIES.map((c) => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Date & number format</span><select name="locale">${LOCALES.map(([k, l]) => `<option value="${k}" ${k === s.locale ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        </div>
        ${field('Default notes', 'notes', s.notes, { textarea: true, rows: 2 })}
        ${field('Default terms', 'terms', s.terms, { textarea: true, rows: 2 })}
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
    for (const k of ['paymentDetails', 'prefix', 'currency', 'locale', 'notes', 'terms', 'emailSubject', 'emailBody']) s[k] = f[k];
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
  if (welcome) {
    main.querySelector('#skip').onclick = () => { s.onboarded = true; save(); location.hash = '#/'; };
    main.querySelector('#demo').onclick = () => { s.onboarded = true; loadDemo(); location.hash = '#/'; };
  }
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
