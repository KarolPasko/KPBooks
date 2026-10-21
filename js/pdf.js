// A small, dependency-free PDF writer. Plays back the layout display list as
// real vector PDF (selectable text, standard fonts), so files are tiny and sharp.
import { layout, pageOps, hexToRgb, FONTS, loadImage } from './layout.js';

export const DATA_MARK = '%TALLY-INVOICE-DATA:';

// Unicode -> WinAnsi byte for the 0x80-0x9F range.
const WIN = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
function pdfString(s) {
  let out = '(';
  for (const ch of String(s)) {
    let c = ch.codePointAt(0);
    if (c === 0x202f || c === 0x2009 || c === 0x00a0) c = 0x20;
    else if (c === 0x2212) c = 0x2d;
    else if (WIN[c]) c = WIN[c];
    else if (c > 0xff || (c >= 0x80 && c < 0xa0)) c = 0x3f; // '?'
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += '\\' + String.fromCharCode(c);
    else if (c < 0x20 || c > 0x7e) out += '\\' + c.toString(8).padStart(3, '0');
    else out += String.fromCharCode(c);
  }
  return out + ')';
}

const f = (n) => (Math.round(n * 100) / 100).toString();
const rgb = (hex) => hexToRgb(hex).map((c) => f(c / 255)).join(' ');

function bytesToBin(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return s;
}
function binToBytes(s) {
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return u8;
}
async function deflate(bin) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([binToBytes(bin)]).stream().pipeThrough(new CompressionStream('deflate'));
    return bytesToBin(new Uint8Array(await new Response(stream).arrayBuffer()));
  } catch { return null; }
}

// Convert any image (PNG with transparency etc.) to JPEG bytes on white.
async function jpegOf(src) {
  const im = await loadImage(src);
  if (!im) return null;
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(im, 0, 0);
  const url = c.toDataURL('image/jpeg', 0.92);
  return { w: c.width, h: c.height, bin: atob(url.split(',')[1]) };
}

const utf8b64 = (str) => {
  const u8 = new TextEncoder().encode(str);
  return btoa(bytesToBin(u8));
};

export async function buildPdf(tpl, data) {
  const lay = layout(tpl, data);
  const fontNames = (FONTS[tpl.font] || FONTS.sans).pdf;
  const objs = []; // index = obj number - 1, value = body string
  const add = (body) => { objs.push(body); return objs.length; };
  const reserve = () => { objs.push(null); return objs.length; };

  const catalog = reserve();
  const pagesId = reserve();
  const f1 = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${fontNames[0]} /Encoding /WinAnsiEncoding >>`);
  const f2 = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${fontNames[1]} /Encoding /WinAnsiEncoding >>`);

  const images = {};
  let imgN = 0;
  for (const src of new Set(lay.ops.filter((o) => o.t === 'img').map((o) => o.src))) {
    const j = await jpegOf(src);
    if (!j) continue;
    const id = add(`<< /Type /XObject /Subtype /Image /Width ${j.w} /Height ${j.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.bin.length} >>\nstream\n${j.bin}\nendstream`);
    images[src] = { name: 'Im' + ++imgN, id };
  }
  const xobj = Object.values(images).map((i) => `/${i.name} ${i.id} 0 R`).join(' ');
  const resources = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xobj ? ` /XObject << ${xobj} >>` : ''} >>`;

  const H = lay.H;
  const kids = [];
  for (let p = 0; p < lay.pages; p++) {
    let c = '';
    for (const o of pageOps(lay, p)) {
      if (o.t === 'rect') {
        c += `${rgb(o.fill)} rg\n`;
        const x = o.x, y = H - o.y - o.h, w = o.w, h = o.h, r = Math.min(o.r || 0, w / 2, h / 2);
        if (r > 0) {
          const k = r * 0.5523;
          c += `${f(x + r)} ${f(y)} m ${f(x + w - r)} ${f(y)} l ${f(x + w - r + k)} ${f(y)} ${f(x + w)} ${f(y + r - k)} ${f(x + w)} ${f(y + r)} c `
            + `${f(x + w)} ${f(y + h - r)} l ${f(x + w)} ${f(y + h - r + k)} ${f(x + w - r + k)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} c `
            + `${f(x + r)} ${f(y + h)} l ${f(x + r - k)} ${f(y + h)} ${f(x)} ${f(y + h - r + k)} ${f(x)} ${f(y + h - r)} c `
            + `${f(x)} ${f(y + r)} l ${f(x)} ${f(y + r - k)} ${f(x + r - k)} ${f(y)} ${f(x + r)} ${f(y)} c f\n`;
        } else c += `${f(x)} ${f(y)} ${f(w)} ${f(h)} re f\n`;
      } else if (o.t === 'line') {
        c += `${rgb(o.color)} RG ${f(o.width)} w ${f(o.x1)} ${f(H - o.y1)} m ${f(o.x2)} ${f(H - o.y2)} l S\n`;
      } else if (o.t === 'text') {
        c += `BT /${o.bold ? 'F2' : 'F1'} ${f(o.size)} Tf ${rgb(o.color)} rg ${f(o.x)} ${f(H - o.y)} Td ${pdfString(o.s)} Tj ET\n`;
      } else if (o.t === 'img' && images[o.src]) {
        c += `q ${f(o.w)} 0 0 ${f(o.h)} ${f(o.x)} ${f(H - o.y - o.h)} cm /${images[o.src].name} Do Q\n`;
      }
    }
    const z = await deflate(c);
    const content = z
      ? add(`<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n${z}\nendstream`)
      : add(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f(lay.W)} ${f(H)}] /Resources ${resources} /Contents ${content} 0 R >>`));
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  const biz = data.settings.business.name || '';
  const info = add(`<< /Title ${pdfString('Invoice ' + data.inv.number)} /Author ${pdfString(biz)} /Producer (Tally Invoices) >>`);

  // Machine-readable copy of the invoice (a PDF comment) so re-importing this PDF is lossless.
  const payload = { v: 1, inv: { ...data.inv, history: undefined } };
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n' + DATA_MARK + utf8b64(JSON.stringify(payload)) + '\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += String(o).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n`;
  out += '%%EOF\n';
  return new Blob([binToBytes(out)], { type: 'application/pdf' });
}

export const pdfFileName = (inv) => `Invoice ${String(inv.number).replace(/[^\w\- ]+/g, '')}.pdf`;
