// UI helpers: header, sheets, toasts, confirm dialogs, icons.
import { esc } from './util.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  doc: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M8.5 13h7M8.5 17h5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  download: '<path d="M12 3v12m0 0-5-5m5 5 5-5M4 20h16"/>',
  share: '<path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v8h14v-8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M4 20h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 7 8.5-7"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  building: '<path d="M4 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 7h3M8 11h3M8 15h3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
  wand: '<path d="M4 20 16 8M14 4v3M18 6h3M19.5 2.5l-2 2M18 10v3M10 2v3"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  arrowUp: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14m-6-6 6 6 6-6"/>',
  arrowLeft: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.3-.5 4.6-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

// ---- navigation bar (iOS style: large title that collapses into the bar on scroll) ----
const BACK_LABELS = { '#/': 'Home', '#/invoices': 'Invoices', '#/clients': 'Clients', '#/more': 'More', '#/settings': 'Settings' };
let pendingLarge = null;

export function header({ title, back, backLabel, right = '', large = true, sub = '' }) {
  const hd = $('#topbar');
  hd.className = 'topbar' + (large ? ' large' : ' solid');
  const label = backLabel || BACK_LABELS[back] || (/^#\/invoice\//.test(back || '') ? 'Invoice' : 'Back');
  hd.innerHTML = `
    <div class="tb-row">
      <div class="tb-left">${back ? `<button class="tb-btn tb-back" data-back="${esc(back)}">${icon('back')}<span>${esc(label)}</span></button>` : ''}</div>
      <div class="tb-mid">${esc(title)}</div>
      <div class="tb-right">${right}</div>
    </div>`;
  pendingLarge = large ? { title, sub } : null;
  const b = hd.querySelector('[data-back]');
  if (b) b.onclick = () => (history.length > 1 && b.dataset.back === 'history' ? history.back() : (location.hash = b.dataset.back));
}

// Called by the router once a screen has rendered.
export function mountLargeTitle(main) {
  const hd = $('#topbar');
  main.onscroll = null;
  if (pendingLarge) {
    const lt = document.createElement('div');
    lt.className = 'large-title';
    lt.innerHTML = `<h1>${esc(pendingLarge.title)}</h1>${pendingLarge.sub ? `<p>${esc(pendingLarge.sub)}</p>` : ''}`;
    main.prepend(lt);
    const h1 = lt.querySelector('h1');
    main.onscroll = () => {
      const y = main.scrollTop;
      hd.classList.toggle('collapsed', y > h1.offsetTop + h1.offsetHeight - 6);
      hd.classList.toggle('edge', y > 2);
      // rubber-band: the big title grows a little when pulled down, like iOS
      h1.style.transform = y < 0 ? `scale(${Math.min(1.12, 1 - y / 900)})` : '';
    };
  } else {
    main.onscroll = () => hd.classList.toggle('edge', main.scrollTop > 2);
  }
  main.onscroll();
}

// ---- toast: a Dynamic-Island style pill at the top of the screen ----
let toastT;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.innerHTML = `<span class="toast-ic">${icon(kind === 'bad' ? 'x' : 'check')}</span><span class="toast-msg">${esc(msg)}</span>`;
  t.className = 'toast ' + kind;
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

// Coloured avatar per name, like Contacts.
export function avatarStyle(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `background:linear-gradient(160deg,hsl(${h} 75% 62%),hsl(${(h + 25) % 360} 70% 46%))`;
}

// Keep the app "card" scaled back while any sheet is open (iOS sheet look).
let openSheets = 0;
function sheetCount(d) {
  openSheets = Math.max(0, openSheets + d);
  document.body.classList.toggle('sheet-open', openSheets > 0);
}

// ---- bottom sheets ----
export function sheet({ title = '', body = '', onMount, onClose, tall = false, footer = '' }) {
  const host = $('#sheets');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-scrim"></div>
    <div class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grab"></div>
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="sheet-body">${body}</div>
      ${footer ? `<div class="sheet-foot">${footer}</div>` : ''}
    </div>`;
  host.appendChild(wrap);
  sheetCount(1);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (onClose) onClose();
    sheetCount(-1);
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 260);
  };
  wrap.querySelector('.sheet-scrim').onclick = close;
  wrap.querySelector('[data-close]').onclick = close;
  // swipe down on the grabber/head to dismiss
  const head = wrap.querySelector('.sheet-head');
  const sh = wrap.querySelector('.sheet');
  let y0 = null;
  const start = (e) => { y0 = e.touches[0].clientY; };
  const move = (e) => { if (y0 !== null) { const dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transform = `translateY(${dy}px)`; } };
  const end = (e) => {
    if (y0 === null) return;
    const dy = (e.changedTouches[0].clientY - y0);
    sh.style.transform = '';
    y0 = null;
    if (dy > 90) close();
  };
  for (const el of [head, wrap.querySelector('.sheet-grab')]) {
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
  }
  if (onMount) onMount(sh, close);
  return close;
}

// iOS-style centred alert.
export function confirmSheet(message, { ok = 'OK', danger = false, title = 'Are you sure?' } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'alert-wrap';
    wrap.innerHTML = `
      <div class="alert" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="alert-text"><h3>${esc(title)}</h3><p>${esc(message)}</p></div>
        <div class="alert-btns"><button data-v="0">Cancel</button><button data-v="1" class="${danger ? 'danger' : 'strong'}">${esc(ok)}</button></div>
      </div>`;
    $('#sheets').appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    wrap.onclick = (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 200);
      resolve(b.dataset.v === '1');
    };
  });
}

// iOS-style action sheet with a separate Cancel button.
export function actionSheet(title, actions) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'as-wrap';
    wrap.innerHTML = `
      <div class="sheet-scrim"></div>
      <div class="as">
        <div class="as-group">
          ${title ? `<div class="as-title">${esc(title)}</div>` : ''}
          ${actions.map((a, i) => `<button class="as-btn ${a.danger ? 'danger' : ''}" data-i="${i}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`).join('')}
        </div>
        <button class="as-btn as-cancel" data-i="-1">Cancel</button>
      </div>`;
    $('#sheets').appendChild(wrap);
    sheetCount(1);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const done = (v) => {
      sheetCount(-1);
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 260);
      resolve(v);
    };
    wrap.querySelector('.sheet-scrim').onclick = () => done(null);
    wrap.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => {
      const i = +b.dataset.i;
      done(i < 0 ? null : actions[i].value ?? i);
    }));
  });
}

// iOS swipe-to-reveal actions on list rows.
// actionsFor(row) -> [{ label, icon, cls: 'green'|'red'|'blue', run }]
export function swipeRows(container, selector, actionsFor) {
  let open = null;
  const closeOpen = () => { if (open) { open.style.transform = ''; open.classList.remove('swiped'); open = null; } };
  container.querySelectorAll(selector).forEach((row) => {
    const acts = actionsFor(row);
    if (!acts.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'swipe-wrap';
    row.replaceWith(wrap);
    const tray = document.createElement('div');
    tray.className = 'swipe-actions';
    tray.innerHTML = acts.map((a, i) => `<button class="swipe-btn ${a.cls || ''}" data-i="${i}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`).join('');
    wrap.append(tray, row);
    const W = acts.length * 78;
    row.draggable = false;
    row.addEventListener('dragstart', (e) => e.preventDefault());
    let x0 = null, y0 = 0, dx = 0, mode = null, base = 0;
    row.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; mode = null;
      base = row.classList.contains('swiped') ? -W : 0;
      if (open && open !== row) closeOpen();
    });
    row.addEventListener('pointermove', (e) => {
      if (x0 === null) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!mode && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
        mode = Math.abs(mx) > Math.abs(my) ? 'h' : 'v';
        if (mode === 'h') { row.setPointerCapture(e.pointerId); row.classList.add('dragging'); }
      }
      if (mode !== 'h') return;
      dx = Math.min(0, base + mx);
      if (dx < -W) dx = -W + (dx + W) * 0.3; // resistance past the buttons
      row.style.transform = `translateX(${dx}px)`;
    });
    const end = () => {
      row.classList.remove('dragging');
      if (mode === 'h') {
        if (dx < -W * 0.4) { row.style.transform = `translateX(${-W}px)`; row.classList.add('swiped'); open = row; }
        else { row.style.transform = ''; row.classList.remove('swiped'); if (open === row) open = null; }
      }
      x0 = null;
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
    // a swipe isn't a tap
    row.addEventListener('click', (e) => {
      if (mode === 'h' || row.classList.contains('swiped')) { e.preventDefault(); if (mode !== 'h') closeOpen(); mode = null; }
    });
    tray.onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      closeOpen();
      acts[+b.dataset.i].run();
    };
  });
}

// Read form fields named like "a.b" into an object.
export function readForm(root) {
  const out = {};
  for (const el of root.querySelectorAll('[name]')) {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    const path = el.name.split('.');
    let o = out;
    path.slice(0, -1).forEach((k) => (o = o[k] = o[k] || {}));
    o[path[path.length - 1]] = v;
  }
  return out;
}

export const statusPill = (st, label) => `<span class="pill st-${st}">${esc(label)}</span>`;

export function field(label, name, value = '', opts = {}) {
  const { type = 'text', placeholder = '', textarea = false, rows = 3, inputmode = '', extra = '', hint = '' } = opts;
  const input = textarea
    ? `<textarea name="${name}" rows="${rows}" placeholder="${esc(placeholder)}" ${extra}>${esc(value)}</textarea>`
    : `<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${inputmode ? `inputmode="${inputmode}"` : ''} ${extra}>`;
  return `<label class="field"><span class="field-label">${esc(label)}</span>${input}${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}</label>`;
}

export function emptyState(ic, title, text, action = '') {
  return `<div class="empty">${icon(ic, 'empty-ic')}<h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}
