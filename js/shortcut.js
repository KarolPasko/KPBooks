// Send invoices automatically through an iPhone Shortcut ("Send Email" with the
// compose sheet turned off). No Google setup needed: the Shortcut sends from
// whichever account is in the iPhone Mail app, e.g. Gmail.
// The app copies a small JSON payload (recipient, subject, body, PDF as base64)
// to the clipboard and opens the Shortcut, which reads it from the clipboard.
import { db } from './store.js';

export const shortcutEnabled = () => !!db.settings.shortcutEnabled;
export const shortcutName = () => (db.settings.shortcutName || 'Tally Send').trim();

export async function shortcutPayload({ to, subject, body, file }) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return JSON.stringify({ to, subject, body, filename: file.name, pdf: btoa(bin) });
}

// Call straight from a tap so iOS allows the clipboard write.
export function runShortcut(payload) {
  const name = encodeURIComponent(shortcutName());
  const viaClipboard = `shortcuts://run-shortcut?name=${name}&input=clipboard`;
  const viaText = `shortcuts://run-shortcut?name=${name}&input=text&text=${encodeURIComponent(payload)}`;
  if (!navigator.clipboard || !navigator.clipboard.writeText) { location.href = viaText; return Promise.resolve(); }
  return navigator.clipboard.writeText(payload)
    .then(() => { location.href = viaClipboard; })
    .catch(() => { location.href = viaText; });
}
