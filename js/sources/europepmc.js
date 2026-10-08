// Europe PMC: PubMed + PMC + preprints + guidelines, open REST API with CORS.
// Docs: https://europepmc.org/RestfulWebService
import { detectIdentifier, getJSON, paperId, qs, stripTags, todayISO } from '../util.js';

const API = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

// Lenses = rungs of the evidence pyramid. The "guidelines" lens is the default
// of medical mode: what societies and recognised bodies actually recommend.
export const LENSES = [
  {
    id: 'guidelines',
    label: 'Guidelines & statements',
    short: 'Guidelines',
    clause:
      '(PUB_TYPE:"guideline" OR PUB_TYPE:"practice guideline" OR PUB_TYPE:"consensus development conference" OR ' +
      'PUB_TYPE:"consensus development conference, nih" OR TITLE:"guideline" OR TITLE:"guidelines" OR ' +
      'TITLE:"consensus statement" OR TITLE:"position statement" OR TITLE:"recommendations" OR TITLE:"position paper")',
  },
  { id: 'sysrev', label: 'Systematic reviews & meta-analyses', short: 'SR / MA', clause: '(PUB_TYPE:"systematic review" OR PUB_TYPE:"meta-analysis")' },
  { id: 'rct', label: 'Randomised trials', short: 'RCT', clause: '(PUB_TYPE:"randomized controlled trial")' },
  { id: 'reviews', label: 'Narrative reviews', short: 'Reviews', clause: '(PUB_TYPE:"review" NOT PUB_TYPE:"systematic review")' },
  { id: 'all', label: 'Everything', short: 'All', clause: '' },
];

const SORT = { newest: 'FIRST_PDATE_D desc', cited: 'CITED desc' };

export function buildQuery(q, { lens = 'all', from, to, free, sort } = {}) {
  const id = detectIdentifier(q);
  // An identifier is a lookup, not a topic: lenses and filters would only hide it.
  if (id?.type === 'doi') return `DOI:"${id.value}"`;
  if (id?.type === 'pmid') return `EXT_ID:${id.value} AND SRC:MED`;

  const parts = [`(${q.trim()})`];
  const clause = LENSES.find((l) => l.id === lens)?.clause;
  if (clause) parts.push(clause);
  if (from || to) parts.push(`PUB_YEAR:[${from || 1800} TO ${to || 2999}]`);
  if (free) parts.push('(HAS_FREE_FULLTEXT:Y OR OPEN_ACCESS:Y)');
  // Europe PMC lists some papers with future "first publication" dates;
  // without a ceiling they would always top a newest-first sort.
  if (sort === 'newest' && !to) parts.push(`FIRST_PDATE:[1800-01-01 TO ${todayISO()}]`);
  return parts.join(' AND ');
}

const BADGES = [
  [/practice guideline|^guideline|consensus development/i, 'Guideline'],
  [/meta-analysis/i, 'Meta-analysis'],
  [/systematic review/i, 'Systematic review'],
  [/randomized controlled trial/i, 'RCT'],
  [/clinical trial/i, 'Trial'],
  [/^review/i, 'Review'],
  [/case reports?/i, 'Case report'],
  [/preprint/i, 'Preprint'],
];

export function badgesFor(pubTypes = [], title = '') {
  const out = new Set();
  for (const t of pubTypes) for (const [re, label] of BADGES) if (re.test(t)) out.add(label);
  if (!out.has('Guideline') && /\b(guidelines?|consensus statement|position statement|recommendations)\b/i.test(title)) out.add('Guideline');
  if (out.has('Systematic review') || out.has('Meta-analysis')) out.delete('Review');
  if (out.has('RCT')) out.delete('Trial');
  return [...out];
}

export function normalize(r) {
  const pubTypes = r.pubTypeList?.pubType || [];
  const authors = r.authorList?.author?.map((a) => a.fullName || [a.lastName, a.initials].filter(Boolean).join(' ')).filter(Boolean)
    || (r.authorString ? r.authorString.replace(/\.$/, '').split(/,\s*/) : []);
  const ft = r.fullTextUrlList?.fullTextUrl || [];
  const freeLink = ft.find((u) => /^(OA|F)$/.test(u.availabilityCode) && u.documentStyle === 'pdf')
    || ft.find((u) => /^(OA|F)$/.test(u.availabilityCode));
  const pmcid = r.pmcid || '';
  const freeUrl = pmcid && (r.isOpenAccess === 'Y' || r.inEPMC === 'Y')
    ? `https://europepmc.org/article/PMC/${pmcid}`
    : freeLink?.url || '';
  const doi = r.doi || '';
  const pmid = r.pmid || '';
  const title = stripTags(r.title || 'Untitled').replace(/\.$/, '');
  return {
    id: paperId({ doi, pmid, source: 'epmc', localId: `${r.source}-${r.id}` }),
    source: 'europepmc',
    kind: 'article',
    title,
    authors,
    year: Number(r.pubYear) || null,
    venue: r.journalInfo?.journal?.isoabbreviation || r.journalInfo?.journal?.title || r.journalTitle || r.bookOrReportDetails?.publisher || '',
    volume: r.journalInfo?.volume || '',
    issue: r.journalInfo?.issue || '',
    pages: r.pageInfo || '',
    doi,
    pmid,
    pmcid,
    abstract: stripTags(r.abstractText || ''),
    badges: badgesFor(pubTypes, title),
    url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : doi ? `https://doi.org/${doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
    freeUrl,
    citedBy: r.citedByCount ?? null,
    lang: r.language || '',
  };
}

export default {
  id: 'europepmc',
  label: 'Europe PMC',
  supports: { years: true, free: true, sort: ['relevance', 'newest', 'cited'] },

  async search({ q, lens, filters = {}, cursor, signal }) {
    const query = buildQuery(q, { lens, ...filters });
    const url = `${API}?${qs({
      query,
      format: 'json',
      resultType: 'core',
      pageSize: 25,
      cursorMark: cursor || '*',
      sort: SORT[filters.sort],
    })}`;
    const data = await getJSON(url, { signal });
    const items = (data.resultList?.result || []).map(normalize);
    const next = items.length === 25 && data.nextCursorMark && data.nextCursorMark !== cursor ? data.nextCursorMark : null;
    return { items, total: data.hitCount ?? items.length, cursor: next };
  },

  /** Hit counts per lens — the evidence pyramid for this query, in one glance. */
  async countLenses(q, filters = {}, signal) {
    if (detectIdentifier(q)) return {};
    const entries = await Promise.all(
      LENSES.map(async (l) => {
        const url = `${API}?${qs({ query: buildQuery(q, { ...filters, lens: l.id }), format: 'json', resultType: 'idlist', pageSize: 1 })}`;
        try { return [l.id, (await getJSON(url, { signal })).hitCount ?? null]; } catch { return [l.id, null]; }
      }),
    );
    return Object.fromEntries(entries);
  },

  /** How many papers matching a followed search appeared since `sinceISO`. */
  async countSince(q, lens, filters, sinceISO) {
    const query = `${buildQuery(q, { ...filters, lens, sort: '' })} AND FIRST_PDATE:[${sinceISO} TO ${todayISO()}]`;
    const data = await getJSON(`${API}?${qs({ query, format: 'json', resultType: 'idlist', pageSize: 1 })}`);
    return data.hitCount ?? 0;
  },
};
