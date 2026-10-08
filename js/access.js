// "Read it for free" links. Pure functions so they can be unit-tested.

// Real Sci-Hub mirrors: each serves a paper at <mirror>/<DOI or PMID>.
// Ordered by reliability when this list was last checked (Oct 2026: .ru, .ee
// and .vg served the PDF). Mirrors come and go — sci-hub.works lists the ones
// currently up. That site is a *directory*, not a mirror: /<doi> does nothing there.
export const SCIHUB_MIRRORS = [
  'https://sci-hub.ru',
  'https://sci-hub.ee',
  'https://sci-hub.vg',
  'https://sci-hub.se',
  'https://sci-hub.st',
  'https://sci-hub.su',
  'https://sci-hub.box',
  'https://sci-hub.red',
  'https://sci-hub.me',
];
export const DEFAULT_SCIHUB = SCIHUB_MIRRORS[0];
export const SCIHUB_STATUS_PAGE = 'https://sci-hub.works';

// Pages that list mirrors instead of serving papers.
const DIRECTORIES = ['sci-hub.works', 'sci-hub.now.sh', 'sci-hub.hkvisa.net'];

/** Turn whatever the user typed into a usable mirror origin (or the default). */
export function normalizeMirror(value) {
  let s = String(value || '').trim();
  if (!s) return DEFAULT_SCIHUB;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const { origin, hostname } = new URL(s);
    return DIRECTORIES.includes(hostname.toLowerCase()) ? DEFAULT_SCIHUB : origin;
  } catch {
    return DEFAULT_SCIHUB;
  }
}

/** Sci-Hub accepts a DOI or a PMID after the slash. */
export function scihubLink(mirror, paper) {
  const id = paper?.doi || paper?.pmid;
  return id ? `${normalizeMirror(mirror)}/${encodeURI(id)}` : '';
}

/** The mirror after `current` in the list (for "try another mirror"). */
export function nextMirror(current) {
  const i = SCIHUB_MIRRORS.indexOf(normalizeMirror(current));
  return SCIHUB_MIRRORS[(i + 1) % SCIHUB_MIRRORS.length];
}

export const unpaywallLink = (paper) => (paper?.doi ? `https://unpaywall.org/${encodeURI(paper.doi)}` : '');

/**
 * Is this mirror reachable? A cross-origin page can't read another site's
 * response, but a `no-cors` request still fails on DNS, connection, TLS or
 * timeout errors — exactly how a dead mirror looks. (This is the same check
 * sci-hub.works runs; it can't see captcha pages, only "up" vs "down".)
 */
export async function probeMirror(mirror, { timeout = 6000, fetchImpl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    await fetchImpl(`${normalizeMirror(mirror)}/`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keep `current` if it answers; otherwise return the first reachable mirror
 * in list order (the list is ordered by how reliably each one serves papers).
 * Returns { mirror, changed, status } — `mirror` is null if nothing answered.
 */
export async function findWorkingMirror(current, { mirrors = SCIHUB_MIRRORS, probe = probeMirror } = {}) {
  const cur = normalizeMirror(current);
  if (await probe(cur)) return { mirror: cur, changed: false, status: { [cur]: true } };
  const others = mirrors.filter((m) => m !== cur);
  const results = await Promise.all(others.map((m) => probe(m)));
  const status = { [cur]: false, ...Object.fromEntries(others.map((m, i) => [m, results[i]])) };
  const found = others.find((_, i) => results[i]) || null;
  return { mirror: found, changed: Boolean(found), status };
}
