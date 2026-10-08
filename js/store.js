// Local-first storage. Everything lives in this browser's localStorage until
// you choose to sync. The library is a CRDT-lite: every record carries
// `updatedAt`, deletions are kept as tombstones, so two devices can merge
// without losing work (last edit of each record wins).

const LIB_KEY = 'saio2.library';
const SETTINGS_KEY = 'saio2.settings';
const HISTORY_KEY = 'saio2.history';

export const STATUSES = ['to-read', 'reading', 'read'];

export const DEFAULT_SETTINGS = {
  theme: 'auto', // auto | light | dark
  defaultMode: 'medical',
  scihubMirror: 'https://sci-hub.works',
  showScihub: true,
  email: '', // optional: Crossref polite pool / OpenAlex
  openalexKey: '',
  googleClientId: '',
  history: true,
};

const read = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
};

export const emptyLibrary = () => ({ version: 1, items: {}, follows: {} });

export function loadLibrary() {
  const lib = read(LIB_KEY, null);
  return lib && lib.items ? { ...emptyLibrary(), ...lib } : emptyLibrary();
}
export const saveLibrary = (lib) => write(LIB_KEY, lib);

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) });
export const saveSettings = (s) => write(SETTINGS_KEY, s);

export const loadHistory = () => read(HISTORY_KEY, []);
export function pushHistory(entry, enabled) {
  if (!enabled) return loadHistory();
  const list = [entry, ...loadHistory().filter((h) => !(h.q === entry.q && h.mode === entry.mode))].slice(0, 30);
  write(HISTORY_KEY, list);
  return list;
}
export const clearHistory = () => write(HISTORY_KEY, []);

const now = () => new Date().toISOString();

/* ── library operations (pure: they return a new library) ─────────────── */

export const liveItems = (lib) =>
  Object.values(lib.items).filter((i) => !i.deleted).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
export const liveFollows = (lib) =>
  Object.values(lib.follows).filter((f) => !f.deleted).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

export const isSaved = (lib, id) => Boolean(lib.items[id] && !lib.items[id].deleted);

export function savePaper(lib, paper, patch = {}) {
  const prev = lib.items[paper.id];
  const base = prev && !prev.deleted ? prev : { ...paper, note: '', tags: [], status: 'to-read', savedAt: now() };
  return { ...lib, items: { ...lib.items, [paper.id]: { ...base, ...patch, deleted: false, updatedAt: now() } } };
}

export function removePaper(lib, id) {
  if (!lib.items[id]) return lib;
  return { ...lib, items: { ...lib.items, [id]: { id, deleted: true, updatedAt: now() } } };
}

export const toggleSaved = (lib, paper) => (isSaved(lib, paper.id) ? removePaper(lib, paper.id) : savePaper(lib, paper));

export const followId = ({ mode, q, lens }) => `${mode}|${lens || ''}|${q.trim().toLowerCase()}`;

export function addFollow(lib, { mode, q, lens, filters }) {
  const id = followId({ mode, q, lens });
  const f = { id, mode, q: q.trim(), lens: lens || '', filters: filters || {}, createdAt: now(), lastSeen: now().slice(0, 10), updatedAt: now() };
  return { ...lib, follows: { ...lib.follows, [id]: f } };
}
export function updateFollow(lib, id, patch) {
  const f = lib.follows[id];
  if (!f) return lib;
  return { ...lib, follows: { ...lib.follows, [id]: { ...f, ...patch, updatedAt: now() } } };
}
export function removeFollow(lib, id) {
  return { ...lib, follows: { ...lib.follows, [id]: { id, deleted: true, updatedAt: now() } } };
}

/** Merge two libraries record by record: newest `updatedAt` wins. */
export function mergeLibraries(a, b) {
  const pick = (x, y) => {
    const out = { ...x };
    for (const [id, rec] of Object.entries(y || {})) {
      const mine = out[id];
      if (!mine || (rec.updatedAt || '') > (mine.updatedAt || '')) out[id] = rec;
    }
    return out;
  };
  return { version: 1, items: pick(a.items || {}, b.items || {}), follows: pick(a.follows || {}, b.follows || {}) };
}

/** Cheap identity check: same records at the same versions. */
export function fingerprint(lib) {
  const part = (o) => Object.entries(o || {}).map(([id, r]) => `${id}@${r.updatedAt}`).sort().join('|');
  return `${part(lib.items)}#${part(lib.follows)}`;
}
