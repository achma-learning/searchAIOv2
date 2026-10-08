// Optional Google Drive sync. Off until you click "Connect".
//
// Privacy design:
//  • Google's script is only loaded after you opt in (no Google contact on page load).
//  • Scope is `drive.appdata`: a hidden per-app folder in YOUR Drive. This site
//    cannot see any of your other files, and there is no server of ours in between.
//  • The access token lives in memory only; reloading the page forgets it.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'searchaio-library.json';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

let token = null;
let tokenExpiry = 0;
let tokenClient = null;
let fileId = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in (offline or blocked?)'));
    document.head.appendChild(s);
  });
}

export const isConnected = () => Boolean(token && Date.now() < tokenExpiry);

/** Ask Google for a token. `interactive` = show the consent popup if needed. */
export async function connect(clientId, { interactive = true } = {}) {
  if (!clientId) throw new Error('No Google OAuth client ID configured — see Settings → Sync.');
  await loadGis();
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        token = resp.access_token;
        tokenExpiry = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60_000;
        resolve();
      },
      error_callback: (err) => reject(new Error(err?.message || err?.type || 'Google sign-in was closed')),
    });
    tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

export function disconnect() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
  token = null;
  tokenExpiry = 0;
  fileId = null;
}

async function api(url, opts = {}) {
  if (!isConnected()) throw new Error('Google session expired — press Sync again.');
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (res.status === 401) { token = null; throw new Error('Google session expired — press Sync again.'); }
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}`);
  return res;
}

async function findFile() {
  if (fileId) return fileId;
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const res = await api(`${DRIVE}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`);
  fileId = (await res.json()).files?.[0]?.id || null;
  return fileId;
}

export async function download() {
  const id = await findFile();
  if (!id) return null;
  return (await api(`${DRIVE}/${id}?alt=media`)).json();
}

export async function upload(library) {
  const body = JSON.stringify(library);
  const id = await findFile();
  if (id) {
    await api(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    return;
  }
  const boundary = `saio${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await api(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  fileId = (await res.json()).id;
}
