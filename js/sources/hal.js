// HAL + DUMAS (France's open archive). DUMAS holds thousands of medical
// "thèses d'exercice" (MD theses) with the full PDF — exactly what a student
// preparing their own thesis wants to read. Docs: https://api.archives-ouvertes.fr/docs/search
import { getJSON, paperId, qs, stripTags } from '../util.js';

const API = 'https://api.archives-ouvertes.fr/search/';
const ROWS = 20;
const FIELDS = 'halId_s,docType_s,instance_s,title_s,authFullName_s,director_s,producedDateY_i,uri_s,fileMain_s,openAccess_bool,abstract_s,structName_s,doiId_s,keyword_s,language_s';

const first = (v) => (Array.isArray(v) ? v[0] : v) || '';

export function normalize(d) {
  const doi = d.doiId_s || '';
  const isMemoire = d.docType_s === 'MEM';
  const badges = [d.instance_s === 'dumas' ? 'DUMAS' : 'HAL', isMemoire ? 'Exercise thesis / mémoire' : d.docType_s === 'HDR' ? 'HDR' : 'Doctoral thesis'];
  if (d.fileMain_s) badges.push('PDF');
  // Structures are listed most-specific first; the last one is usually the university.
  const structs = d.structName_s || [];
  return {
    id: paperId({ doi, source: 'hal', localId: d.halId_s }),
    source: 'hal',
    kind: 'thesis',
    title: stripTags(first(d.title_s) || 'Untitled'),
    authors: d.authFullName_s || [],
    supervisors: d.director_s || [],
    year: d.producedDateY_i || null,
    venue: structs[structs.length - 1] || structs[0] || '',
    doi,
    pmid: '',
    abstract: stripTags(first(d.abstract_s)),
    keywords: d.keyword_s || [],
    badges,
    url: d.uri_s,
    freeUrl: d.fileMain_s || '',
    citedBy: null,
    lang: first(d.language_s),
  };
}

export default {
  id: 'hal',
  label: 'HAL · DUMAS',
  supports: { years: true, free: true, sort: ['relevance', 'newest'] },

  async search({ q, filters = {}, cursor = 0, signal }) {
    const fq = ['docType_s:(THESE OR MEM OR HDR)'];
    if (filters.healthOnly !== false) fq.push('level0_domain_s:sdv'); // life & health sciences
    if (filters.from || filters.to) fq.push(`producedDateY_i:[${filters.from || '*'} TO ${filters.to || '*'}]`);
    if (filters.free) fq.push('openAccess_bool:true');
    const url = `${API}?${qs({
      q,
      fq,
      wt: 'json',
      rows: ROWS,
      start: cursor,
      fl: FIELDS,
      sort: filters.sort === 'newest' ? 'producedDate_tdate desc' : undefined,
    })}`;
    const data = await getJSON(url, { signal });
    const items = (data.response?.docs || []).map(normalize);
    const total = data.response?.numFound ?? items.length;
    const next = cursor + ROWS;
    return { items, total, cursor: next < total ? next : null };
  },
};
