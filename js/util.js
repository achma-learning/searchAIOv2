// Small, dependency-free helpers shared by every module.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Strip JATS/HTML tags that some APIs embed in abstracts and titles. */
export const stripTags = (s) =>
  String(s ?? '')
    .replace(/<(h[1-6])>([^<]{2,40})<\/\1>\s*/gi, '\n$2: ') // structured-abstract headings
    .replace(/<\/?(jats:)?(p|sec|title)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;
export const PMID_RE = /^\s*(?:pmid:?\s*)?(\d{1,9})\s*$/i;

/** Recognise a DOI or PMID typed (or pasted) as the whole query. */
export function detectIdentifier(q) {
  const s = String(q || '').trim();
  const doi = s.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S+)$/i);
  if (doi) return { type: 'doi', value: cleanDoi(doi[1]) };
  const pmid = s.match(PMID_RE);
  if (pmid) return { type: 'pmid', value: pmid[1] };
  return null;
}

export const cleanDoi = (d) =>
  String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/[.,;]+$/, '');

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const yearOf = (v) => {
  const m = String(v ?? '').match(/(1[5-9]\d\d|20\d\d)/);
  return m ? Number(m[1]) : null;
};

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** fetch → JSON with a timeout and a readable error. */
export async function getJSON(url, { timeout = 15000, headers = {}, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(signal?.aborted ? 'aborted' : `${new URL(url).hostname} timed out`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const qs = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

/** Stable id so the same paper found by two sources is saved once. */
export function paperId({ doi, pmid, source, localId }) {
  if (doi) return `doi:${cleanDoi(doi).toLowerCase()}`;
  if (pmid) return `pmid:${pmid}`;
  return `${source}:${localId}`;
}

export const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
