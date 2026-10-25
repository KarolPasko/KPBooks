// Send invoices straight from the user's own Gmail account.
// Runs entirely in the browser: Google Identity Services gives us a short-lived
// access token (scope: send mail only), then we call the Gmail API directly.
// Nothing goes through any server of ours.
import { db, save } from './store.js';

const SCOPES = 'https://www.googleapis.com/auth/gmail.send openid email';
const TOKEN_KEY = 'tally.gmail.token';

let gisPromise = null;
let tokenClient = null;
let tokenClientId = null;

export const gmailConfigured = () => !!(db.settings.gmailClientId || '').trim();
export const gmailAccount = () => db.settings.gmailEmail || '';

export function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisPromise = null; reject(new Error('Could not reach Google — are you online?')); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

function storedToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    return t && t.exp > Date.now() + 60000 ? t : null;
  } catch { return null; }
}
export const hasValidToken = () => !!storedToken();
function clearToken() { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }

function client() {
  const id = db.settings.gmailClientId.trim();
  if (!tokenClient || tokenClientId !== id) {
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: id, scope: SCOPES, callback: () => {} });
    tokenClientId = id;
  }
  return tokenClient;
}

/**
 * Get an access token. If one is needed, Google's sign-in window opens — so call
 * this directly from a tap handler (after loadGis() has finished).
 */
export function getToken() {
  const t = storedToken();
  if (t) return Promise.resolve(t.token);
  if (!gmailConfigured()) return Promise.reject(new Error('Gmail is not set up yet (More → Settings → Gmail).'));
  if (!(window.google && google.accounts && google.accounts.oauth2)) return Promise.reject(new Error('Google sign-in is still loading — try again in a second.'));
  return new Promise((resolve, reject) => {
    const tc = client();
    tc.callback = async (resp) => {
      if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, 'https://www.googleapis.com/auth/gmail.send')) {
        reject(new Error('Please tick “Send email on your behalf” so Tally can send invoices.'));
        return;
      }
      const tok = { token: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
      try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tok)); } catch { /* ignore */ }
      if (!db.settings.gmailEmail) {
        try {
          const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + tok.token } });
          if (r.ok) { db.settings.gmailEmail = (await r.json()).email || ''; save(); }
        } catch { /* not essential */ }
      }
      resolve(tok.token);
    };
    tc.error_callback = (err) => reject(new Error(err && err.type === 'popup_closed' ? 'Sign-in was closed.' : (err && err.message) || 'Google sign-in failed.'));
    tc.requestAccessToken({ prompt: db.settings.gmailEmail ? '' : 'consent', login_hint: db.settings.gmailEmail || undefined });
  });
}

export function disconnectGmail() {
  const t = storedToken();
  clearToken();
  if (t && window.google && google.accounts) google.accounts.oauth2.revoke(t.token, () => {});
  db.settings.gmailEmail = '';
  save();
}

// ---- MIME message building ----
const utf8b64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const bytesB64 = (u8) => {
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
};
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const headerWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${utf8b64(s)}?=`);
const asciiName = (s) => s.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');

export async function buildMime({ to, cc, subject, body, file }) {
  const boundary = 'tally_' + Math.random().toString(36).slice(2);
  if (!file) {
    return [`To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), `Subject: ${headerWord(subject)}`, 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(utf8b64(body)), ''].join('\r\n');
  }
  const name = asciiName(file.name);
  const pdf = bytesB64(new Uint8Array(await file.arrayBuffer()));
  return [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${headerWord(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(utf8b64(body)),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${name}"`,
    `Content-Disposition: attachment; filename="${name}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(pdf),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export const validEmails = (s) => String(s || '').split(/[,;]\s*/).filter(Boolean).every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()));

/** Send an email with the PDF attached from the signed-in Gmail account. */
export async function sendWithGmail(token, msg) {
  const mime = await buildMime(msg);
  const raw = btoa(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (r.status === 401) { clearToken(); throw new Error('Your Google sign-in expired — tap Send again.'); }
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).error.message; } catch { /* ignore */ }
    if (r.status === 403 && /has not been used|disabled/i.test(detail)) throw new Error('The Gmail API is not enabled in your Google Cloud project yet (see setup step 2).');
    throw new Error('Gmail refused the message' + (detail ? `: ${detail}` : ` (${r.status})`));
  }
  return r.json();
}
