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

/** Turn whatever the user typed into a usable Sci-Hub mirror (never a directory page). */
export function normalizeMirror(value) {
  const origin = normalizeOrigin(value, DEFAULT_SCIHUB);
  return DIRECTORIES.includes(new URL(origin).hostname.toLowerCase()) ? DEFAULT_SCIHUB : origin;
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

// Anna's Archive "SciDB": papers by DOI (it also mirrors Sci-Hub/LibGen), plus books.
// Domains change like Sci-Hub's; .li served /scidb/<doi> when last checked.
export const ANNAS_MIRRORS = ['https://annas-archive.li', 'https://annas-archive.gd', 'https://annas-archive.org', 'https://annas-archive.se'];
export const DEFAULT_ANNAS = ANNAS_MIRRORS[0];
export const annasLink = (mirror, paper) =>
  (paper?.doi ? `${normalizeOrigin(mirror, DEFAULT_ANNAS)}/scidb/${encodeURI(paper.doi)}` : '');

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
