// Sync between devices.
//  - mergeData(): the core. Combines another device's data with ours, record by
//    record — the most recently edited version wins, deletions are respected.
//  - iCloud (CloudKit): automatic sync through the user's own iCloud account,
//    using Apple's CloudKit JS. Needs a CloudKit container + API token (Apple
//    Developer account). Data goes into the user's *private* iCloud database.
//  - Sync file: a free, manual fallback — save a file to iCloud Drive on one
//    device, open it on the other, and the two are merged.
import { db, save, applyFormat } from './store.js';

const RECORD = 'tally-data';
const RECORD_TYPE = 'TallyData';
const STATE_KEY = 'tally.sync.state';

const stamp = (x) => x.updatedAt || x.createdAt || 0;

function mergeList(local, remote, deleted) {
  const map = new Map((local || []).map((x) => [x.id, x]));
  for (const r of remote || []) {
    const l = map.get(r.id);
    if (!l || stamp(r) > stamp(l)) map.set(r.id, r);
  }
  for (const [id, t] of Object.entries(deleted)) {
    const x = map.get(id);
    if (x && stamp(x) <= t) map.delete(id);
  }
  return [...map.values()];
}

/** Merge another device's data into this one. Returns true if anything changed here. */
export function mergeData(remote) {
  if (!remote || typeof remote !== 'object') return false;
  const before = JSON.stringify(db);
  const deleted = { ...(db.deleted || {}) };
  for (const [id, t] of Object.entries(remote.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
  // forget very old deletions (90 days) so the list doesn't grow forever
  const cutoff = Date.now() - 90 * 864e5;
  for (const id of Object.keys(deleted)) if (deleted[id] < cutoff) delete deleted[id];
  db.deleted = deleted;
  db.invoices = mergeList(db.invoices, remote.invoices, deleted);
  db.clients = mergeList(db.clients, remote.clients, deleted);
  db.items = mergeList(db.items, remote.items, deleted);
  if (remote.settings && (remote.settings.updatedAt || 0) > (db.settings.updatedAt || 0)) {
    const next = Math.max(db.settings.nextNumber || 1, remote.settings.nextNumber || 1);
    db.settings = { ...db.settings, ...remote.settings, business: { ...db.settings.business, ...(remote.settings.business || {}) }, nextNumber: next };
  } else if (remote.settings) {
    db.settings.nextNumber = Math.max(db.settings.nextNumber || 1, remote.settings.nextNumber || 1);
  }
  if (remote.template && remote.template.blocks && (remote.template.updatedAt || 0) > (db.template.updatedAt || 0)) db.template = remote.template;
  const changed = JSON.stringify(db) !== before;
  if (changed) { save({ fromSync: true }); applyFormat(); }
  return changed;
}

const snapshot = () => JSON.stringify({ app: 'tally', v: 1, savedAt: Date.now(), ...db });

// ---------------- sync file (manual, free) ----------------
export function syncFileBlob() {
  return new Blob([snapshot()], { type: 'application/json' });
}
export async function mergeSyncFile(file) {
  const data = JSON.parse(await file.text());
  if (!data || !Array.isArray(data.invoices)) throw new Error('That isn’t a Tally sync or backup file.');
  return mergeData(data);
}

// ---------------- iCloud via CloudKit JS ----------------
let ck = null;          // { container, database }
let ckLoading = null;
let status = { state: 'off', message: '' };
const listeners = new Set();
export const onSyncStatus = (fn) => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };
const setStatus = (state, message = '') => { status = { state, message, at: Date.now() }; listeners.forEach((fn) => fn(status)); };
export const syncStatus = () => status;

export const icloudConfigured = () => !!(db.settings.ckContainer && db.settings.ckToken);

function loadCloudKit() {
  if (window.CloudKit) return Promise.resolve();
  if (!ckLoading) {
    ckLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.apple-cloudkit.com/ck/2/cloudkit.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { ckLoading = null; reject(new Error('Could not reach iCloud — are you online?')); };
      document.head.appendChild(s);
    });
  }
  return ckLoading;
}

/**
 * Configure CloudKit and check whether the user is signed in to iCloud.
 * Apple renders its own "Sign in with Apple ID" button into #ck-signin (if it
 * exists on the page) and a sign-out button into #ck-signout.
 */
export async function connectICloud() {
  if (!icloudConfigured()) { setStatus('off'); return null; }
  setStatus('connecting', 'Connecting to iCloud…');
  await loadCloudKit();
  if (!ck) {
    CloudKit.configure({
      containers: [{
        containerIdentifier: db.settings.ckContainer.trim(),
        apiTokenAuth: {
          apiToken: db.settings.ckToken.trim(),
          persist: true,
          signInButton: { id: 'ck-signin', theme: 'black' },
          signOutButton: { id: 'ck-signout', theme: 'black' },
        },
        environment: db.settings.ckEnv === 'production' ? 'production' : 'development',
      }],
    });
    const container = CloudKit.getDefaultContainer();
    ck = { container, database: container.privateCloudDatabase };
  }
  const user = await ck.container.setUpAuth();
  if (user) {
    setStatus('ready', 'Signed in to iCloud');
    watchSignOut();
    return user;
  }
  setStatus('signed-out', 'Sign in with your Apple ID to sync');
  ck.container.whenUserSignsIn().then(() => { setStatus('ready', 'Signed in to iCloud'); watchSignOut(); syncNow(); }).catch(() => {});
  return null;
}
function watchSignOut() {
  ck.container.whenUserSignsOut().then(() => { setStatus('signed-out', 'Signed out of iCloud'); connectICloud().catch(() => {}); }).catch(() => {});
}

// Re-run setup after the container settings change.
export function resetICloud() {
  ck = null;
  setStatus(icloudConfigured() ? 'connecting' : 'off');
}

let syncing = null;
let again = false;
const ckError = (r) => (r && r.hasErrors ? r.errors[0] : null);

/** Pull from iCloud, merge, and push our merged copy back. */
export function syncNow() {
  if (!ck || status.state === 'signed-out' || status.state === 'off') return Promise.resolve(false);
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    setStatus('syncing', 'Syncing…');
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await ck.database.fetchRecords([RECORD]);
      const err = ckError(res);
      let tag;
      let remoteJson = null;
      if (err && err.ckErrorCode !== 'NOT_FOUND') throw new Error(err.reason || err.ckErrorCode);
      if (!err && res.records[0]) {
        const rec = res.records[0];
        tag = rec.recordChangeTag;
        remoteJson = rec.fields && rec.fields.json ? rec.fields.json.value : null;
      }
      const changedHere = remoteJson ? mergeData(JSON.parse(remoteJson)) : false;
      const ours = snapshot();
      // only upload when iCloud doesn't already have exactly what we have
      if (remoteJson && withoutStamp(remoteJson) === withoutStamp(ours)) {
        finish(changedHere);
        return changedHere;
      }
      if (ours.length > 950000) throw new Error('Your data is too big for one iCloud record (try a smaller logo).');
      const saved = await ck.database.saveRecords([{
        recordType: RECORD_TYPE,
        recordName: RECORD,
        ...(tag ? { recordChangeTag: tag } : {}),
        fields: { json: { value: ours } },
      }]);
      const serr = ckError(saved);
      if (!serr) { finish(changedHere); return changedHere; }
      // someone else saved first: fetch again, merge, retry
      if (serr.ckErrorCode !== 'CONFLICT') throw new Error(serr.reason || serr.ckErrorCode);
    }
    throw new Error('iCloud kept changing — will try again shortly.');
  })()
    .catch((e) => { setStatus('error', e.message || String(e)); return false; })
    .finally(() => {
      syncing = null;
      if (again) { again = false; setTimeout(syncNow, 500); }
    });
  return syncing;
}
function finish(changedHere) {
  const t = new Date();
  try { localStorage.setItem(STATE_KEY, JSON.stringify({ lastSync: t.getTime() })); } catch { /* ignore */ }
  setStatus('ready', `Synced ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  if (changedHere) window.dispatchEvent(new CustomEvent('sync-changed'));
}
const withoutStamp = (json) => json.replace(/"savedAt":\d+,?/, '');

export function lastSyncTime() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}').lastSync || 0; } catch { return 0; }
}

/** Start automatic syncing: on launch, after every change, and when the app comes back to the front. */
let autoStarted = false;
export function startAutoSync() {
  if (!icloudConfigured() || autoStarted) return;
  autoStarted = true;
  connectICloud().then((u) => { if (u) syncNow(); }).catch((e) => setStatus('error', e.message));
  let t;
  window.addEventListener('store-saved', () => { clearTimeout(t); t = setTimeout(syncNow, 1500); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
}
