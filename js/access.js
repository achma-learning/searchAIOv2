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
