// theses.fr: every French doctoral thesis since 1985 (incl. many MD theses),
// with supervisor and jury. Open JSON API, CORS-enabled.
import { getJSON, paperId, qs } from '../util.js';

const API = 'https://theses.fr/api/v1/theses/recherche/';
const ROWS = 20;

const person = (p) => [p?.prenom, p?.nom].filter(Boolean).join(' ');

export function normalize(t) {
  const year = Number(String(t.dateSoutenance || '').slice(-4)) || null;
  const badges = ['theses.fr', t.status === 'enCours' ? 'In progress' : 'Defended'];
  if (t.discipline) badges.push(t.discipline);
  return {
    id: paperId({ doi: t.doi, source: 'thesesfr', localId: t.nnt || t.id }),
    source: 'thesesfr',
    kind: 'thesis',
    title: t.titrePrincipal || t.titreEN || 'Untitled',
    authors: (t.auteurs || []).map(person).filter(Boolean),
    supervisors: (t.directeurs || []).map(person).filter(Boolean),
    year,
    venue: t.etabSoutenanceN || '',
    doi: t.doi || '',
    pmid: '',
    abstract: '',
    keywords: (t.sujets || []).map((s) => s.libelle).filter(Boolean),
    badges,
    url: `https://theses.fr/${t.nnt || t.id}`,
    freeUrl: '',
    citedBy: null,
    lang: '',
  };
}

export default {
  id: 'thesesfr',
  label: 'theses.fr',
  // theses.fr has no date filter in its API: years are filtered on our side.
  supports: { years: 'client', free: true, sort: ['relevance'] },

  async search({ q, filters = {}, cursor = 0, signal }) {
    const filtres = [];
    if (filters.healthOnly !== false) filtres.push('Domaines thématiques="Médecine et santé"');
    if (filters.free) filtres.push('Statut="soutenue"~Statut="Accessibles en ligne"');
    const url = `${API}?${qs({ q, debut: cursor, nombre: ROWS, filtres: filtres.length ? `[${filtres.join('~')}]` : undefined })}`;
    const data = await getJSON(url, { signal });
    const raw = (data.theses || []).map(normalize);
    const items = raw.filter((p) => (!filters.from || (p.year && p.year >= filters.from)) && (!filters.to || (p.year && p.year <= filters.to)));
    const total = data.totalHits ?? raw.length;
    const next = cursor + ROWS;
    return { items, total, cursor: next < total ? next : null };
  },
};
