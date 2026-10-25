import { db, save, touchSettings } from '../store.js';
import { esc, today, downloadBlob, fmtDate } from '../util.js';
import { header, icon, field, toast, sheet, confirmSheet } from '../ui.js';
import { icloudConfigured, connectICloud, resetICloud, syncNow, onSyncStatus, lastSyncTime, startAutoSync, syncFileBlob, mergeSyncFile } from '../sync.js';

export default function syncView({ main, query }) {
  const s = db.settings;
  // a setup link from another device fills the fields in
  if (query.c && query.t) {
    s.ckContainer = query.c;
    s.ckToken = query.t;
    s.ckEnv = query.e === 'production' ? 'production' : 'development';
    save();
    resetICloud();
    history.replaceState(null, '', '#/sync');
    toast('iCloud settings added from your link');
  }
  header({ title: 'iCloud Sync', back: '#/more', sub: 'Keep your iPhone and Mac in step automatically.' });
  main.innerHTML = `
    <div class="pad">
      <section class="sync-hero card">
        <span class="sync-cloud" id="sync-cloud">${icon('cloud')}</span>
        <div class="sync-state" id="sync-state">Not set up</div>
        <div class="muted small" id="sync-detail"></div>
        <div class="ck-buttons"><div id="ck-signin"></div><div id="ck-signout"></div></div>
        <button class="btn primary" id="sync-now" hidden>${icon('refresh')} Sync now</button>
      </section>

      <div class="group-label">iCloud (automatic)</div>
      <div class="card form" id="ckf">
        <p class="form-intro">Uses Apple's CloudKit to store your Tally data in <b>your own private iCloud</b>. Sign in with the same Apple ID on your iPhone and Mac and every change syncs within seconds. Needs a one-time setup with an Apple Developer account.</p>
        ${field('CloudKit container ID', 'ckContainer', s.ckContainer || '', { placeholder: 'iCloud.com.yourname.tally', extra: 'autocapitalize="off" autocorrect="off" spellcheck="false"' })}
        ${field('API token', 'ckToken', s.ckToken || '', { placeholder: 'Paste the web API token', extra: 'autocapitalize="off" autocorrect="off" spellcheck="false"' })}
        <label class="field"><span class="field-label">Environment</span><select name="ckEnv">
          <option value="development" ${s.ckEnv !== 'production' ? 'selected' : ''}>Development</option>
          <option value="production" ${s.ckEnv === 'production' ? 'selected' : ''}>Production</option></select></label>
        <div class="btn-row">
          <button class="btn sm primary" id="ck-save">Save & connect</button>
          <button class="btn sm" id="ck-link" ${icloudConfigured() ? '' : 'hidden'}>${icon('link')} Send setup to my Mac</button>
          <button class="btn sm ghost" id="ck-help">How to set this up</button>
        </div>
      </div>

      <div class="group-label">No developer account? Sync with a file</div>
      <div class="card form">
        <p class="form-intro">Free and manual: save a sync file to <b>iCloud Drive</b> on one device, then open it on the other. Tally merges the two — nothing gets overwritten, the newest edit of each invoice wins.</p>
        <div class="btn-row">
          <button class="btn sm" id="f-save">${icon('upload')} Save sync file</button>
          <label class="btn sm">${icon('download')} Open sync file<input type="file" accept=".json,application/json" id="f-open" hidden></label>
        </div>
        <p class="hint">On iPhone choose <b>Save to Files → iCloud Drive</b>. On the Mac, open the same file from iCloud Drive.</p>
      </div>
    </div>`;

  const stateEl = main.querySelector('#sync-state');
  const detailEl = main.querySelector('#sync-detail');
  const cloudEl = main.querySelector('#sync-cloud');
  const nowBtn = main.querySelector('#sync-now');
  const LABEL = { off: 'Not set up', connecting: 'Connecting…', 'signed-out': 'Sign in to iCloud', syncing: 'Syncing…', ready: 'Up to date', error: 'Sync problem' };
  const unsub = onSyncStatus((st) => {
    stateEl.textContent = LABEL[st.state] || '';
    const last = lastSyncTime();
    detailEl.textContent = st.state === 'error' ? st.message
      : st.state === 'off' ? 'Set up iCloud below, or use a sync file.'
      : st.state === 'signed-out' ? 'Tap “Sign in with Apple ID” — use the same Apple ID on every device.'
      : last ? `Last synced ${fmtDate(new Date(last).toISOString().slice(0, 10)) === fmtDate(today()) ? 'today' : fmtDate(new Date(last).toISOString().slice(0, 10))} at ${new Date(last).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : st.message;
    cloudEl.className = 'sync-cloud st-' + st.state;
    nowBtn.hidden = !['ready', 'error'].includes(st.state);
  });

  nowBtn.onclick = () => syncNow().then((changed) => toast(changed ? 'Synced — changes from your other device are in' : 'Everything is up to date'));
  if (icloudConfigured()) connectICloud().then((u) => { if (u) syncNow(); }).catch(() => {});

  main.querySelector('#ck-save').onclick = () => {
    const f = Object.fromEntries([...main.querySelectorAll('#ckf [name]')].map((el) => [el.name, el.value.trim()]));
    if (!/^iCloud\./.test(f.ckContainer)) { toast('The container ID starts with “iCloud.”', 'bad'); return; }
    if (f.ckToken.length < 20) { toast('Paste the API token from CloudKit Console', 'bad'); return; }
    const changed = f.ckContainer !== s.ckContainer || f.ckToken !== s.ckToken || f.ckEnv !== s.ckEnv;
    Object.assign(s, f);
    touchSettings();
    save();
    main.querySelector('#ck-link').hidden = false;
    if (changed) {
      // CloudKit can only be configured once per page load
      if (window.CloudKit) { toast('Saved — reloading to connect…'); setTimeout(() => location.reload(), 600); return; }
      resetICloud();
    }
    startAutoSync();
    connectICloud().then((u) => { if (u) syncNow(); }).catch((e) => toast(e.message, 'bad'));
  };

  main.querySelector('#ck-link').onclick = () => {
    const url = `${location.origin}${location.pathname}#/sync?c=${encodeURIComponent(s.ckContainer)}&t=${encodeURIComponent(s.ckToken)}&e=${s.ckEnv || 'development'}`;
    if (navigator.share) navigator.share({ title: 'Tally iCloud setup', url }).catch(() => {});
    else navigator.clipboard.writeText(url).then(() => toast('Link copied — open it on your Mac'));
  };
  main.querySelector('#ck-help').onclick = icloudHelp;

  main.querySelector('#f-save').onclick = () => downloadBlob(syncFileBlob(), `Tally Sync ${today()}.json`);
  main.querySelector('#f-open').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!(await confirmSheet('Merge this file with the data on this device? The newest version of each invoice, client and item is kept.', { ok: 'Merge', title: 'Merge sync file?' }))) return;
    try {
      const changed = await mergeSyncFile(f);
      toast(changed ? 'Merged — this device is up to date' : 'Nothing new in that file');
    } catch (err) { toast(err.message, 'bad'); }
  };

  return { cleanup: unsub };
}

function icloudHelp() {
  const origin = location.origin;
  sheet({
    title: 'Set up iCloud sync',
    tall: true,
    body: `
      <p>Apple only lets web apps use iCloud through <b>CloudKit</b>, which needs an <b>Apple Developer Program</b> membership (US$99/year). Set it up once, on a Mac if possible:</p>
      <ol class="steps">
        <li>Join at <b>developer.apple.com/programs</b> with your Apple ID.</li>
        <li>In <b>Certificates, Identifiers &amp; Profiles → Identifiers</b>, tap <b>+</b>, choose <b>iCloud Containers</b> and create one, e.g. <code class="copy-code">iCloud.com.yourname.tally</code>.</li>
        <li>Open <b>CloudKit Console</b> (icloud.developer.apple.com) → pick that container → <b>Tokens &amp; Keys</b> → <b>API Tokens</b> → <b>+</b>.
          <ul>
            <li>Name: <i>Tally Web</i></li>
            <li>Sign-in callback: <b>Post Message</b></li>
            <li>Allowed origins: <code class="copy-code">${esc(origin)}</code></li>
          </ul>
          Save and copy the token.</li>
        <li>In Tally: paste the container ID and token, keep <b>Development</b>, tap <b>Save &amp; connect</b>, then <b>Sign in with Apple ID</b>.</li>
        <li>Tap <b>Send setup to my Mac</b> (AirDrop or Notes), open the link in Safari on the Mac, and sign in with the <b>same Apple ID</b>. Done — changes now sync both ways.</li>
      </ol>
      <p class="hint">Optional, for the long term: in CloudKit Console → <b>Schema</b>, tap <b>Deploy Schema Changes…</b> to Production, then switch both devices to <b>Production</b> (do this before you rely on it — data doesn't move between environments).</p>
      <p class="hint">Your data is stored in your <b>private</b> iCloud database — only your Apple ID can read it.</p>`,
  });
}
