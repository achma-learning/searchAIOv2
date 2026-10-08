// OpenAlex: 250M+ works, with open-access links built in. Since 2025 it needs a
// free API key (https://openalex.org/settings/api) — add yours in Settings and
// General + Thesis modes use it alongside the key-free sources.
import { cleanDoi, detectIdentifier, getJSON, paperId, qs, todayISO } from '../util.js';

const API = 'https://api.openalex.org/works';
const ROWS = 25;

/** OpenAlex ships abstracts as an inverted index { word: [positions] }. */
export function rebuildAbstract(inv) {
  if (!inv) return '';
  const words = [];
  for (const [w, positions] of Object.entries(inv)) for (const p of positions) words[p] = w;
  return words.filter(Boolean).join(' ');
}

export function normalize(w) {
  const doi = cleanDoi(w.doi || '');
  const pmid = String(w.ids?.pmid || '').replace(/\D/g, '');
  const badges = [];
  if (w.type === 'review') badges.push('Review');
  if (w.type === 'dissertation') badges.push('Thesis');
  if (w.type === 'preprint') badges.push('Preprint');
  return {
    id: paperId({ doi, pmid, source: 'openalex', localId: String(w.id).split('/').pop() }),
    source: 'openalex',
    kind: w.type === 'dissertation' ? 'thesis' : 'article',
    title: w.display_name || w.title || 'Untitled',
    authors: (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean),
    year: w.publication_year || null,
    venue: w.primary_location?.source?.display_name || w.authorships?.[0]?.institutions?.[0]?.display_name || '',
    volume: w.biblio?.volume || '',
    issue: w.biblio?.issue || '',
    pages: [w.biblio?.first_page, w.biblio?.last_page].filter(Boolean).join('-'),
    doi,
    pmid,
    abstract: rebuildAbstract(w.abstract_inverted_index),
    badges,
    url: doi ? `https://doi.org/${doi}` : w.primary_location?.landing_page_url || w.id,
    freeUrl: w.open_access?.oa_url || '',
    citedBy: w.cited_by_count ?? null,
    lang: w.language || '',
  };
}

export function makeOpenAlex({ dissertationsOnly = false } = {}) {
  return {
    id: dissertationsOnly ? 'openalex-theses' : 'openalex',
    label: dissertationsOnly ? 'OpenAlex theses' : 'OpenAlex',
    needsKey: true,
    supports: { years: true, free: true, sort: ['relevance', 'newest', 'cited'] },

    async search({ q, filters = {}, cursor, signal, settings = {} }) {
      if (!settings.openalexKey) return { items: [], total: 0, cursor: null, skipped: true };
      const id = detectIdentifier(q);
      const filter = [];
      if (id?.type === 'doi') filter.push(`doi:https://doi.org/${id.value}`);
      if (id?.type === 'pmid') filter.push(`ids.pmid:${id.value}`);
      if (dissertationsOnly) filter.push('type:dissertation');
      if (filters.from) filter.push(`from_publication_date:${filters.from}-01-01`);
      filter.push(`to_publication_date:${filters.to ? `${filters.to}-12-31` : todayISO()}`);
      if (filters.free) filter.push('is_oa:true');
      const url = `${API}?${qs({
        search: id ? undefined : q,
        filter: filter.join(','),
        'per-page': ROWS,
        cursor: cursor || '*',
        sort: { newest: 'publication_date:desc', cited: 'cited_by_count:desc' }[filters.sort],
        api_key: settings.openalexKey,
        mailto: settings.email,
      })}`;
      const data = await getJSON(url, { signal });
      const items = (data.results || []).map(normalize);
      return { items, total: data.meta?.count ?? items.length, cursor: items.length === ROWS ? data.meta?.next_cursor || null : null };
    },
  };
}
