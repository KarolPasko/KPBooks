// The invoice layout editor: drag blocks around a real page, restyle them,
// and see exactly what the PDF will look like.
import { db, save, nextNumber } from '../store.js';
import { esc, uid, today, addDays } from '../util.js';
import { layout, drawPage, preloadImages, presetTemplate, newBlock, BLOCK_TYPES, PAGES, MARGIN, FONTS } from '../layout.js';
import { header, icon, actionSheet, confirmSheet, toast } from '../ui.js';

const SWATCHES = ['#2457d6', '#0f766e', '#7c3aed', '#be123c', '#c2410c', '#15803d', '#0e7490', '#111827'];

function sampleInvoice() {
  const latest = [...db.invoices].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const client = latest && latest.client ? latest.client : {
    type: 'business', name: 'Sample Client Ltd', contact: 'Jamie Smith', email: 'jamie@example.com',
    address: '1 High Street', city: 'London', postcode: 'EC1A 1BB', country: 'United Kingdom',
  };
  return {
    number: nextNumber(), issueDate: today(), dueDate: addDays(today(), db.settings.dueDays),
    client, reference: '', status: 'draft',
    items: [
      { id: uid(), name: 'Design work', description: 'Concepts and two rounds of revisions', qty: 8, unit: 'hrs', price: 45 },
      { id: uid(), name: 'Printing', description: '', qty: 250, unit: '', price: 0.4 },
      { id: uid(), name: 'Delivery', description: '', qty: 1, unit: '', price: 15 },
    ],
    discountType: 'amount', discountValue: 0, taxRate: db.settings.taxRate || 20, amountPaid: 0,
    notes: db.settings.notes, terms: db.settings.terms,
  };
}

export default function designer({ main }) {
  const tpl = db.template;
  const undo = [];
  let selected = null;
  let zoom = 1;
  let images = {};
  let lay = null;
  let scale = 1;
  const sample = { inv: sampleInvoice(), settings: db.settings };

  // where a block actually ended up (it may have been pushed down by the block above it)
  const placedY = (blk) => { const b = lay && lay.boxes.find((x) => x.id === blk.id); return b && blk.type !== 'footer' ? b.y : blk.y; };
  const snapshot = () => { undo.push(JSON.stringify(tpl)); if (undo.length > 60) undo.shift(); };
  const commit = (() => { let t; return () => { clearTimeout(t); t = setTimeout(save, 300); }; })();

  header({
    title: 'Invoice layout', large: false, back: 'history',
    right: `<button class="tb-btn" id="undo" aria-label="Undo">${icon('undo')}</button><button class="tb-btn" id="presets">${icon('wand')}<span>Styles</span></button>`,
  });

  main.className = 'designer';
  main.innerHTML = `
    <div class="stage" id="stage">
      <div class="page-wrap" id="pw">
        <canvas id="cv"></canvas>
        <div class="overlay" id="ov"></div>
      </div>
    </div>
    <button class="zoom-btn" id="zoom" aria-label="Zoom">${icon('search')}<span>Fit</span></button>
    <div class="panel" id="panel"></div>`;

  const stage = main.querySelector('#stage');
  const cv = main.querySelector('#cv');
  const ov = main.querySelector('#ov');
  const panel = main.querySelector('#panel');

  const render = () => {
    lay = layout(tpl, sample, { editing: true });
    const avail = Math.min(stage.clientWidth - 24, 700);
    const w = avail * zoom;
    scale = drawPage(cv, lay, 0, w, images);
    main.querySelector('#pw').style.width = w + 'px';
    drawBoxes();
  };
  const drawBoxes = () => {
    ov.innerHTML = lay.boxes.map((b) => {
      const blk = tpl.blocks.find((x) => x.id === b.id);
      if (!blk) return '';
      return `<div class="box ${b.id === selected ? 'sel' : ''}" data-id="${b.id}" style="left:${b.x * scale}px;top:${b.y * scale}px;width:${b.w * scale}px;height:${Math.max(b.h, 10) * scale}px">
        <span class="box-tag">${esc(BLOCK_TYPES[blk.type].label)}</span>
        ${b.id === selected && blk.type !== 'band' ? '<span class="handle" data-h="w"></span>' : ''}
        ${b.id === selected && blk.type === 'band' ? '<span class="handle hb" data-h="h"></span><span class="handle" data-h="w"></span>' : ''}
      </div>`;
    }).join('') + '<div class="guide gx" hidden></div><div class="guide gy" hidden></div>';
  };

  // ---------- dragging ----------
  let drag = null;
  ov.addEventListener('pointerdown', (e) => {
    const box = e.target.closest('.box');
    if (!box) { if (selected) { selected = null; drawBoxes(); drawPanel(); } return; }
    const blk = tpl.blocks.find((x) => x.id === box.dataset.id);
    if (selected !== blk.id) { selected = blk.id; drawBoxes(); drawPanel(); }
    const handle = e.target.closest('[data-h]');
    drag = { blk, mode: handle ? handle.dataset.h : 'move', sx: e.clientX, sy: e.clientY, x: blk.x, y: placedY(blk), w: blk.w, h: blk.h || 60, moved: false, pid: e.pointerId };
    ov.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  ov.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = (e.clientX - drag.sx) / scale, dy = (e.clientY - drag.sy) / scale;
    if (!drag.moved && Math.hypot(dx, dy) * scale < 4) return;
    if (!drag.moved) { snapshot(); drag.moved = true; }
    const P = PAGES[tpl.page];
    const b = drag.blk;
    let gx = null, gy = null;
    if (drag.mode === 'move') {
      let nx = drag.x + dx, ny = drag.y + dy;
      const xs = [MARGIN, P.w - MARGIN - b.w, (P.w - b.w) / 2, 0, P.w - b.w];
      const ys = [MARGIN, 0];
      for (const o of lay.boxes) if (o.id !== b.id) { xs.push(o.x, o.x + o.w - b.w); ys.push(o.y); }
      const sx = xs.find((v) => Math.abs(v - nx) < 5), sy = ys.find((v) => Math.abs(v - ny) < 5);
      if (sx !== undefined) { nx = sx; gx = sx === (P.w - b.w) / 2 ? P.w / 2 : sx === P.w - MARGIN - b.w || sx === P.w - b.w ? sx + b.w : sx; }
      if (sy !== undefined) { ny = sy; gy = sy; }
      b.x = Math.round(Math.max(-b.w / 2, Math.min(P.w - b.w / 2, nx)));
      b.y = Math.round(Math.max(0, Math.min(P.h - 10, ny)));
    } else if (drag.mode === 'w') {
      let nw = Math.max(40, drag.w + dx);
      const edge = drag.x + nw;
      if (Math.abs(edge - (P.w - MARGIN)) < 5) { nw = P.w - MARGIN - drag.x; gx = P.w - MARGIN; }
      b.w = Math.round(Math.min(P.w - b.x, nw));
    } else if (drag.mode === 'h') {
      b.h = Math.round(Math.max(6, drag.h + dy));
    }
    render();
    const g1 = ov.querySelector('.gx'), g2 = ov.querySelector('.gy');
    if (gx !== null) { g1.hidden = false; g1.style.left = gx * scale + 'px'; }
    if (gy !== null) { g2.hidden = false; g2.style.top = gy * scale + 'px'; }
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) { commit(); drawPanel(); }
    drag = null;
    ov.querySelectorAll('.guide').forEach((g) => (g.hidden = true));
  };
  ov.addEventListener('pointerup', endDrag);
  ov.addEventListener('pointercancel', endDrag);

  // ---------- panel ----------
  const change = (fn) => { snapshot(); fn(); render(); drawPanel(); commit(); };

  const drawPanel = () => {
    const blk = tpl.blocks.find((x) => x.id === selected);
    if (blk) return drawBlockPanel(blk);
    panel.innerHTML = `
      <div class="panel-tabs">
        <div class="p-row"><span class="p-label">Colour</span>
          <div class="swatches">${SWATCHES.map((c) => `<button class="sw ${tpl.accent === c ? 'on' : ''}" data-c="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}
            <label class="sw custom" style="--c:${tpl.accent}" aria-label="Custom colour"><input type="color" id="cc" value="${tpl.accent}"></label></div></div>
        <div class="p-row"><span class="p-label">Font</span>
          <div class="seg" id="font">${Object.entries(FONTS).map(([k, f]) => `<button data-v="${k}" class="${tpl.font === k ? 'on' : ''}" style="font-family:${f.css}">${f.label}</button>`).join('')}</div></div>
        <div class="p-row"><span class="p-label">Table</span>
          <div class="seg" id="tstyle">${[['solid', 'Solid'], ['outline', 'Accent line'], ['lines', 'Minimal']].map(([k, l]) => `<button data-v="${k}" class="${tpl.tableStyle === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="p-row"><span class="p-label">Paper</span>
          <div class="seg" id="paper">${Object.keys(PAGES).map((k) => `<button data-v="${k}" class="${tpl.page === k ? 'on' : ''}">${k}</button>`).join('')}</div>
          <label class="toggle"><input type="checkbox" id="zebra" ${tpl.zebra ? 'checked' : ''}><span></span> Stripes</label></div>
        <div class="p-row wrap"><span class="p-label">Blocks</span>
          <div class="blocklist">${tpl.blocks.map((b) => `<button class="bl ${b.visible === false ? 'off' : ''}" data-id="${b.id}">${icon(b.visible === false ? 'eyeOff' : 'eye')}${esc(BLOCK_TYPES[b.type].label)}</button>`).join('')}</div></div>
        <div class="p-row"><span class="p-label">Add</span>
          <div class="btn-row tight"><button class="btn sm" data-add="text">${icon('plus')} Text</button><button class="btn sm" data-add="divider">${icon('plus')} Line</button><button class="btn sm" data-add="band">${icon('plus')} Colour band</button></div></div>
        <p class="hint">Tap a block on the page to select it, drag to move, pull the right edge to resize.</p>
      </div>`;
    panel.querySelectorAll('.sw[data-c]').forEach((b) => (b.onclick = () => change(() => (tpl.accent = b.dataset.c))));
    panel.querySelector('#cc').oninput = (e) => { tpl.accent = e.target.value; render(); commit(); };
    panel.querySelector('#cc').onchange = () => drawPanel();
    const seg = (id, key) => panel.querySelector(id).onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) change(() => (tpl[key] = b.dataset.v)); };
    seg('#font', 'font'); seg('#tstyle', 'tableStyle'); seg('#paper', 'page');
    panel.querySelector('#zebra').onchange = (e) => change(() => (tpl.zebra = e.target.checked));
    panel.querySelectorAll('.bl').forEach((b) => (b.onclick = () => {
      const blk = tpl.blocks.find((x) => x.id === b.dataset.id);
      if (blk.visible === false) change(() => (blk.visible = true));
      selected = blk.id; drawBoxes(); drawPanel();
      const el = ov.querySelector(`[data-id="${blk.id}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }));
    panel.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
      const nb = newBlock(b.dataset.add, tpl.page);
      change(() => (b.dataset.add === 'band' ? tpl.blocks.unshift(nb) : tpl.blocks.push(nb)));
      selected = nb.id; drawBoxes(); drawPanel();
    }));
  };

  const drawBlockPanel = (blk) => {
    const T = BLOCK_TYPES[blk.type];
    const hasSize = !['band', 'divider', 'logo'].includes(blk.type);
    const hasAlign = ['title', 'business', 'client', 'text', 'footer', 'logo'].includes(blk.type);
    const hasColor = ['title', 'text', 'footer', 'business'].includes(blk.type);
    panel.innerHTML = `
      <div class="p-head"><b>${esc(T.label)}</b><button class="btn sm ghost" id="done">Done</button></div>
      <div class="p-row"><span class="p-label">Move</span>
        <div class="nudge">
          <button data-n="-1,0" aria-label="Left">${icon('arrowLeft')}</button><button data-n="0,-1" aria-label="Up">${icon('arrowUp')}</button>
          <button data-n="0,1" aria-label="Down">${icon('arrowDown')}</button><button data-n="1,0" aria-label="Right">${icon('arrowRight')}</button>
        </div>
        <span class="muted small">x ${Math.round(blk.x)} · y ${Math.round(placedY(blk))}</span></div>
      <div class="p-row"><span class="p-label">Width</span><input type="range" id="w" min="40" max="${Math.round(PAGES[tpl.page].w)}" value="${blk.w}"></div>
      ${blk.type === 'band' ? `<div class="p-row"><span class="p-label">Height</span><input type="range" id="h" min="6" max="300" value="${blk.h || 60}"></div>` : ''}
      ${blk.type === 'logo' ? `<div class="p-row"><span class="p-label">Max height</span><input type="range" id="mh" min="20" max="160" value="${blk.maxH || 70}"></div>` : ''}
      ${hasSize ? `<div class="p-row"><span class="p-label">Text size</span><div class="stepper"><button data-s="-0.5">−</button><span>${blk.size}</span><button data-s="0.5">+</button></div></div>` : ''}
      ${hasAlign ? `<div class="p-row"><span class="p-label">Align</span><div class="seg" id="align">${['left', 'center', 'right'].map((a) => `<button data-v="${a}" class="${(blk.align || 'left') === a ? 'on' : ''}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</div></div>` : ''}
      ${hasColor ? `<div class="p-row"><span class="p-label">Colour</span><div class="seg" id="color">${[['', 'Default'], ['accent', 'Accent'], ['white', 'White']].map(([v, l]) => `<button data-v="${v}" class="${(blk.color || '') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}
      ${blk.type === 'divider' ? `<div class="p-row"><span class="p-label">Colour</span><div class="seg" id="color">${[['', 'Grey'], ['accent', 'Accent']].map(([v, l]) => `<button data-v="${v}" class="${(blk.color || '') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}
      ${T.hasText ? `<div class="p-row wrap"><span class="p-label">${blk.type === 'client' || blk.type === 'payment' ? 'Heading' : 'Text'}</span>${blk.type === 'text' ? `<textarea id="txt" rows="2">${esc(blk.text || '')}</textarea>` : `<input id="txt" value="${esc(blk.text ?? '')}">`}</div>` : ''}
      ${blk.type === 'text' ? `<label class="toggle"><input type="checkbox" id="bold" ${blk.bold ? 'checked' : ''}><span></span> Bold</label>` : ''}
      ${['business', 'logo', 'payment'].includes(blk.type) ? `<p class="hint">The content comes from <a href="#/settings">your business settings</a>.</p>` : ''}
      ${blk.type === 'notes' ? '<p class="hint">Notes and terms are set on each invoice (defaults in settings).</p>' : ''}
      <div class="btn-row">
        <button class="btn sm" id="hide">${icon('eyeOff')} Hide</button>
        ${T.unique ? '' : `<button class="btn sm" id="dup">${icon('copy')} Duplicate</button><button class="btn sm danger" id="del">${icon('trash')} Delete</button>`}
      </div>`;
    panel.querySelector('#done').onclick = () => { selected = null; drawBoxes(); drawPanel(); };
    panel.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => {
      const [dx, dy] = b.dataset.n.split(',').map(Number);
      change(() => { blk.x += dx * 2; blk.y = placedY(blk) + dy * 2; });
    }));
    const range = (id, key) => {
      const r = panel.querySelector(id);
      if (!r) return;
      r.onpointerdown = snapshot;
      r.oninput = () => { blk[key] = +r.value; render(); commit(); };
      r.onchange = () => drawPanel();
    };
    range('#w', 'w'); range('#h', 'h'); range('#mh', 'maxH');
    panel.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => change(() => (blk.size = Math.max(5, Math.min(48, (blk.size || 9) + +b.dataset.s))))));
    const seg = (id, key) => { const el = panel.querySelector(id); if (el) el.onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) change(() => (blk[key] = b.dataset.v || undefined)); }; };
    seg('#align', 'align'); seg('#color', 'color');
    const txt = panel.querySelector('#txt');
    if (txt) { txt.onfocus = snapshot; txt.oninput = () => { blk.text = txt.value; render(); commit(); }; }
    const bold = panel.querySelector('#bold');
    if (bold) bold.onchange = () => change(() => (blk.bold = bold.checked));
    panel.querySelector('#hide').onclick = () => { change(() => (blk.visible = false)); selected = null; drawBoxes(); drawPanel(); };
    const dup = panel.querySelector('#dup');
    if (dup) dup.onclick = () => { const c = { ...blk, id: blk.type + '-' + uid(), y: blk.y + 20 }; change(() => tpl.blocks.push(c)); selected = c.id; drawBoxes(); drawPanel(); };
    const del = panel.querySelector('#del');
    if (del) del.onclick = () => { change(() => (tpl.blocks = tpl.blocks.filter((x) => x !== blk))); selected = null; drawBoxes(); drawPanel(); };
  };

  document.getElementById('undo').onclick = () => {
    const prev = undo.pop();
    if (!prev) { toast('Nothing to undo'); return; }
    const t = JSON.parse(prev);
    for (const k of Object.keys(tpl)) delete tpl[k];
    Object.assign(tpl, t);
    if (!tpl.blocks.some((b) => b.id === selected)) selected = null;
    render(); drawPanel(); commit();
  };
  document.getElementById('presets').onclick = async () => {
    const p = await actionSheet('Start from a style', [
      { label: 'Classic — logo top left, blue', icon: 'layout', value: 'classic' },
      { label: 'Modern — colour header band', icon: 'layout', value: 'modern' },
      { label: 'Minimal — serif, black & white', icon: 'layout', value: 'minimal' },
    ]);
    if (!p) return;
    if (!(await confirmSheet('This replaces your current layout. You can undo afterwards.', { ok: 'Use this style', title: 'Apply style?' }))) return;
    snapshot();
    const t = presetTemplate(p);
    for (const k of Object.keys(tpl)) delete tpl[k];
    Object.assign(tpl, t);
    selected = null;
    render(); drawPanel(); commit();
  };
  main.querySelector('#zoom').onclick = (e) => {
    zoom = zoom === 1 ? 1.6 : zoom === 1.6 ? 2.2 : 1;
    e.currentTarget.querySelector('span').textContent = zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`;
    render();
  };

  const onResize = () => render();
  window.addEventListener('resize', onResize);
  render();
  drawPanel();
  preloadImages(layout(tpl, sample, { editing: true })).then((imgs) => { images = imgs; render(); });

  return { cleanup: () => { window.removeEventListener('resize', onResize); save(); } };
}
