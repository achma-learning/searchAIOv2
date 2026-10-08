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

/** "sci-hub.ee/" → "https://sci-hub.ee"; junk → fallback. */
export function normalizeOrigin(value, fallback) {
  let s = String(value || '').trim();
  if (!s) return fallback;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try { return new URL(s).origin; } catch { return fallback; }
}

/** Turn whatever the user typed into a usable mirror of `family` (never a directory page). */
export function normalizeMirror(value, family = 'scihub') {
  const f = FAMILIES[family];
  const origin = normalizeOrigin(value, f.fallback);
  return f.directories.includes(new URL(origin).hostname.toLowerCase()) ? f.fallback : origin;
}

/** Sci-Hub accepts a DOI or a PMID after the slash. */
export function scihubLink(mirror, paper) {
  const id = paper?.doi || paper?.pmid;
  return id ? `${normalizeMirror(mirror)}/${encodeURI(id)}` : '';
}

/** The mirror after `current` in the family's list (for "try another mirror"). */
export function nextMirror(current, family = 'scihub') {
  const list = FAMILIES[family].list;
  const i = list.indexOf(normalizeMirror(current, family));
  return list[(i + 1) % list.length];
}

/*
 * Anna's Archive (open source: software.annas-archive.gl/AnnaArchivist/annas-archive).
 * Routes used here, read from allthethings/page/views.py + search.py:
 *   /scidb/<doi>          paper by DOI (it lowercases DOIs, so we send them lowercase)
 *   /isbn/<isbn>          book by ISBN — medical textbooks
 *   /search?q=…&index=journals | content=book_nonfiction | ext=pdf | lang=fr
 *   /dyn/up/              health check, CORS-enabled → {"aa_logged_in":0}
 * Official domains as listed on the site itself (Oct 2026): .gd, .gl, .pk.
 * .li / .org / .se are older domains; .li now serves a parked page.
 */
export const ANNAS_MIRRORS = [
  'https://annas-archive.gd',
  'https://annas-archive.gl',
  'https://annas-archive.pk',
  'https://annas-archive.li',
  'https://annas-archive.org',
  'https://annas-archive.se',
];
export const DEFAULT_ANNAS = ANNAS_MIRRORS[0];
export const ANNAS_STATUS_PAGE = 'https://open-slum.org/'; // Shadow Library Uptime Monitor (linked by Anna's Archive)

export const annasLink = (mirror, paper) =>
  (paper?.doi ? `${normalizeMirror(mirror, 'annas')}/scidb/${encodeURI(paper.doi.toLowerCase())}` : '');
export const annasIsbnLink = (mirror, isbn) => `${normalizeMirror(mirror, 'annas')}/isbn/${isbn}`;
export const openLibraryIsbnLink = (isbn) => `https://openlibrary.org/isbn/${isbn}`;

const FAMILIES = {
  scihub: { label: 'Sci-Hub', list: SCIHUB_MIRRORS, fallback: DEFAULT_SCIHUB, directories: DIRECTORIES },
  annas: { label: "Anna's Archive", list: ANNAS_MIRRORS, fallback: DEFAULT_ANNAS, directories: [] },
};
export const MIRROR_FAMILIES = Object.keys(FAMILIES);
export const familyLabel = (family) => FAMILIES[family].label;
export const familyMirrors = (family) => FAMILIES[family].list;

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
    await fetchImpl(`${normalizeOrigin(mirror, DEFAULT_SCIHUB)}/`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Anna's Archive can do better than "answers or not": its /dyn/up/ endpoint is
 * CORS-enabled, so we can read the reply and confirm it's really the archive.
 * A parked or hijacked domain answers too — but not with {"aa_logged_in": …}.
 */
export async function verifyAnnas(mirror, { timeout = 6000, fetchImpl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetchImpl(`${normalizeMirror(mirror, 'annas')}/dyn/up/`, { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
    if (!res.ok) return false;
    const data = JSON.parse(await res.text());
    return Boolean(data && typeof data === 'object' && 'aa_logged_in' in data);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const PROBES = { scihub: probeMirror, annas: verifyAnnas };
export const probeFor = (family) => PROBES[family];

/**
 * Keep `current` if it answers; otherwise return the first reachable mirror
 * in list order (the list is ordered by how reliably each one serves papers).
 * Returns { mirror, changed, status } — `mirror` is null if nothing answered.
 */
export async function findWorkingMirror(current, { family = 'scihub', mirrors = FAMILIES[family].list, probe = PROBES[family] } = {}) {
  const cur = normalizeMirror(current, family);
  if (await probe(cur)) return { mirror: cur, changed: false, status: { [cur]: true } };
  const others = mirrors.filter((m) => m !== cur);
  const results = await Promise.all(others.map((m) => probe(m)));
  const status = { [cur]: false, ...Object.fromEntries(others.map((m, i) => [m, results[i]])) };
  const found = others.find((_, i) => results[i]) || null;
  return { mirror: found, changed: Boolean(found), status };
}

/* ── Unpaywall API: is there a *legal* free copy? ───────────────────────── */

const VERSION = { publishedVersion: 'published version', acceptedVersion: 'accepted manuscript', submittedVersion: 'preprint' };

/** Unpaywall JSON → { url, pdf, via } for the best free copy, or null. */
export function parseUnpaywall(d) {
  const loc = d?.best_oa_location;
  const url = loc && (loc.url_for_pdf || loc.url || loc.url_for_landing_page);
  if (!url) return null;
  const via = ['Unpaywall', loc.host_type === 'repository' ? 'repository' : 'publisher', VERSION[loc.version], loc.license]
    .filter(Boolean).join(' · ');
  return { url, pdf: Boolean(loc.url_for_pdf), via };
}

/** Look one DOI up. Unpaywall asks every caller for an email address. */
export async function unpaywallLookup(doi, email, { fetchImpl = globalThis.fetch, signal } = {}) {
  const res = await fetchImpl(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`, { signal });
  if (res.status === 404) return null; // DOI unknown to Unpaywall = no known free copy
  if (!res.ok) throw new Error(`Unpaywall answered ${res.status}`);
  return parseUnpaywall(await res.json());
}

/** Run `fn` over `items` with at most `limit` in flight (be polite to free APIs). */
export async function pool(items, limit, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
