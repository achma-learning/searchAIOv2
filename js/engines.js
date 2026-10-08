// External engines: sites without an open API that we hand the query to.
// Type `!bang query` (bang anywhere in the line) or pick one in the palette.
// `{q}` is replaced by the URL-encoded query. `modes` decides where the engine
// appears in the "Also search in" row; every bang works in every mode.

const gsite = (site) => `https://www.google.com/search?q=site:${site}+{q}`;

export const ENGINES = [
  // ── Medical: societies, agencies, evidence databases ────────────────────
  { bang: 'pm',      name: 'PubMed',              modes: ['medical'], url: 'https://pubmed.ncbi.nlm.nih.gov/?term={q}' },
  { bang: 'pmg',     name: 'PubMed · guidelines', modes: ['medical'], url: 'https://pubmed.ncbi.nlm.nih.gov/?term={q}%20AND%20(guideline%5Bpt%5D%20OR%20practice%20guideline%5Bpt%5D%20OR%20consensus%20development%20conference%5Bpt%5D)' },
  { bang: 'trip',    name: 'Trip (guidelines)',   modes: ['medical'], url: 'https://www.tripdatabase.com/Searchresult?criteria={q}' },
  { bang: 'coch',    name: 'Cochrane',            modes: ['medical'], url: 'https://www.cochranelibrary.com/search?q={q}' },
  { bang: 'has',     name: 'HAS',                 modes: ['medical'], url: 'https://www.has-sante.fr/jcms/fc_2875171/fr/resultat-de-recherche?text={q}' },
  { bang: 'nice',    name: 'NICE',                modes: ['medical'], url: 'https://www.nice.org.uk/search?q={q}' },
  { bang: 'who',     name: 'WHO IRIS',            modes: ['medical'], url: 'https://iris.who.int/discover?query={q}' },
  { bang: 'csfbp',   name: 'CISMeF · bonnes pratiques', modes: ['medical'], url: 'https://doccismef.chu-rouen.fr/dc/#env=bp&q={q}' },
  { bang: 'reco',    name: 'RecoMédicales',       modes: ['medical'], url: gsite('recomedicales.fr') },
  { bang: 'esc',     name: 'ESC guidelines',      modes: ['medical'], url: gsite('escardio.org/Guidelines') },
  { bang: 'msps',    name: 'Min. Santé Maroc',    modes: ['medical'], url: gsite('sante.gov.ma') },
  { bang: 'cdc',     name: 'CDC',                 modes: ['medical'], url: 'https://search.cdc.gov/search/?query={q}' },
  { bang: 'utd',     name: 'UpToDate',            modes: ['medical'], url: 'https://www.uptodate.com/contents/search?search={q}' },
  { bang: 'epmc',    name: 'Europe PMC (site)',   modes: [],          url: 'https://europepmc.org/search?query={q}' },
  { bang: 'nejm',    name: 'NEJM',                modes: [],          url: 'https://www.nejm.org/search?q={q}' },
  { bang: 'mesh',    name: 'MeSH browser',        modes: [],          url: 'https://meshb.nlm.nih.gov/search?searchInField=allTerms&searchString={q}' },
  { bang: 'vidal',   name: 'VIDAL',               modes: [],          url: 'https://www.vidal.fr/recherche.html?query={q}' },
  { bang: 'ammps',   name: 'AMMPS médicaments',   modes: [],          url: 'https://ammps.gov.ma/recherche-medicaments?search={q}' },
  { bang: 'rp',      name: 'Radiopaedia',         modes: [],          url: 'https://radiopaedia.org/search?q={q}' },
  { bang: 'ct',      name: 'ClinicalTrials.gov',  modes: [],          url: 'https://clinicaltrials.gov/search?term={q}' },

  // ── Theses: Moroccan, French, international ─────────────────────────────
  { bang: 'toubkal', name: 'Toubkal (Maroc)',     modes: ['thesis'],  url: 'https://toubkal.imist.ma/search?query={q}&submit=OK' },
  { bang: 'fmpm',    name: 'Thèses FMPM',         modes: ['thesis'],  url: 'https://thesefmpm.vercel.app/search?page=1&search={q}' },
  { bang: 'csfth',   name: 'CISMeF · thèses',     modes: ['thesis'],  url: 'https://doccismef.chu-rouen.fr/dc/#env=thm&q={q}' },
  { bang: 'dumas',   name: 'DUMAS',               modes: ['thesis'],  url: 'https://dumas.ccsd.cnrs.fr/search/index/?q={q}' },
  { bang: 'tfr',     name: 'theses.fr',           modes: ['thesis'],  url: 'https://theses.fr/resultats?q={q}' },
  { bang: 'sudoc',   name: 'SUDOC',               modes: ['thesis'],  url: 'https://www.sudoc.abes.fr/cbs/xslt//DB=2.1/CMD?ACT=SRCHA&IKT=1016&SRT=RLV&TRM={q}' },
  { bang: 'oatd',    name: 'OATD (worldwide)',    modes: ['thesis'],  url: 'https://oatd.org/oatd/search?q={q}' },
  { bang: 'ndltd',   name: 'NDLTD',               modes: [],          url: 'http://search.ndltd.org/search.php?q={q}' },

  // ── General web & scholarly ─────────────────────────────────────────────
  { bang: 'sc',      name: 'Google Scholar',      modes: ['general', 'medical', 'thesis'], url: 'https://scholar.google.com/scholar?q={q}' },
  { bang: 'g',       name: 'Google',              modes: ['general'], url: 'https://www.google.com/search?q={q}' },
  { bang: 'ddg',     name: 'DuckDuckGo',          modes: ['general'], url: 'https://duckduckgo.com/?q={q}' },
  { bang: 'brave',   name: 'Brave',               modes: ['general'], url: 'https://search.brave.com/search?q={q}' },
  { bang: 'ss',      name: 'Semantic Scholar',    modes: ['general'], url: 'https://www.semanticscholar.org/search?q={q}' },
  { bang: 'w',       name: 'Wikipedia',           modes: ['general'], url: 'https://en.wikipedia.org/w/index.php?search={q}' },
  { bang: 'yt',      name: 'YouTube',             modes: ['general'], url: 'https://www.youtube.com/results?search_query={q}' },
  { bang: 'pplx',    name: 'Perplexity',          modes: ['general'], url: 'https://www.perplexity.ai/search?q={q}' },
  { bang: 'consensus', name: 'Consensus',         modes: ['general'], url: 'https://consensus.app/results/?q={q}' },
  { bang: 'claude',  name: 'Claude',              modes: [],          url: 'https://claude.ai/new?q={q}' },
  { bang: 'gpt',     name: 'ChatGPT',             modes: [],          url: 'https://chatgpt.com/?q={q}' },
  { bang: 'bing',    name: 'Bing',                modes: [],          url: 'https://www.bing.com/search?q={q}' },
];

const BY_BANG = new Map(ENGINES.map((e) => [e.bang, e]));
export const engineByBang = (bang) => BY_BANG.get(String(bang || '').toLowerCase());
export const enginesForMode = (mode) => ENGINES.filter((e) => e.modes.includes(mode));

export const engineUrl = (engine, query) => engine.url.replaceAll('{q}', encodeURIComponent(query.trim()));

/**
 * Find a known `!bang` anywhere in the line (rightmost wins, like DuckDuckGo).
 * Returns { engine, query } with the bang removed, or null.
 */
export function parseBang(input) {
  const tokens = String(input || '').split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const m = tokens[i].match(/^!([\w.-]+)$/);
    const engine = m && engineByBang(m[1]);
    if (engine) {
      const rest = tokens.slice(0, i).concat(tokens.slice(i + 1)).join(' ');
      return { engine, query: rest };
    }
  }
  return null;
}
