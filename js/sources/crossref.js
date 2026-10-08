// Crossref: metadata for ~150M DOIs across every discipline. No key, CORS-enabled.
// Docs: https://api.crossref.org/swagger-ui/index.html
import { detectIdentifier, getJSON, paperId, qs, stripTags, todayISO } from '../util.js';

const API = 'https://api.crossref.org/works';
const FIELDS = 'DOI,title,author,container-title,short-container-title,issued,published,abstract,type,is-referenced-by-count,URL,publisher,volume,issue,page';
const ROWS = 20;

const dateYear = (d) => d?.['date-parts']?.[0]?.[0] || null;

export function normalize(w) {
  const doi = w.DOI || '';
  const typeLabel = {
    'journal-article': '', 'posted-content': 'Preprint', 'book-chapter': 'Book chapter', book: 'Book',
    'proceedings-article': 'Conference', dissertation: 'Thesis', report: 'Report', dataset: 'Dataset',
  }[w.type];
  return {
    id: paperId({ doi, source: 'crossref', localId: doi }),
    source: 'crossref',
    kind: w.type === 'dissertation' ? 'thesis' : 'article',
    title: stripTags(w.title?.[0] || 'Untitled'),
    authors: (w.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ') || a.name).filter(Boolean),
    year: dateYear(w.issued) || dateYear(w.published),
    venue: w['short-container-title']?.[0] || w['container-title']?.[0] || w.publisher || '',
    volume: w.volume || '',
    issue: w.issue || '',
    pages: w.page || '',
    doi,
    pmid: '',
    abstract: stripTags(w.abstract || ''),
    badges: typeLabel ? [typeLabel] : [],
    url: doi ? `https://doi.org/${doi}` : w.URL,
    freeUrl: '',
    citedBy: w['is-referenced-by-count'] ?? null,
    lang: w.language || '',
  };
}

export default {
  id: 'crossref',
  label: 'Crossref',
  supports: { years: true, free: false, sort: ['relevance', 'newest', 'cited'] },

  async search({ q, filters = {}, cursor = 0, signal, settings = {} }) {
    const id = detectIdentifier(q);
    if (id?.type === 'doi') {
      try {
        const data = await getJSON(`${API}/${encodeURIComponent(id.value)}`, { signal });
        return { items: [normalize(data.message)], total: 1, cursor: null };
      } catch { return { items: [], total: 0, cursor: null }; }
    }
    const filter = [];
    if (filters.from) filter.push(`from-pub-date:${filters.from}`);
    filter.push(`until-pub-date:${filters.to || todayISO()}`);
    const sort = { newest: ['published', 'desc'], cited: ['is-referenced-by-count', 'desc'] }[filters.sort];
    const url = `${API}?${qs({
      query: q,
      rows: ROWS,
      offset: cursor,
      select: FIELDS,
      filter: filter.join(','),
      sort: sort?.[0],
      order: sort?.[1],
      mailto: settings.email, // joins Crossref's "polite pool" when you set an email
    })}`;
    const data = await getJSON(url, { signal });
    const items = (data.message?.items || []).map(normalize);
    const total = data.message?.['total-results'] ?? items.length;
    const next = cursor + ROWS;
    return { items, total, cursor: items.length === ROWS && next < Math.min(total, 9000) ? next : null };
  },
};
