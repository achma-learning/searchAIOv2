// The three ways to search. Each mode = which open APIs answer in-page,
// plus which external sites sit one keystroke away.
import europepmc, { LENSES as EPMC_LENSES } from './sources/europepmc.js';
import crossref from './sources/crossref.js';
import hal from './sources/hal.js';
import thesesfr from './sources/thesesfr.js';
import { makeOpenAlex } from './sources/openalex.js';

export const MODES = {
  general: {
    id: 'general',
    key: '1',
    label: 'General',
    hint: 'All disciplines · Crossref (+ OpenAlex with a key)',
    placeholder: 'Any topic, title, DOI…',
    sources: [crossref, makeOpenAlex()],
    lenses: null,
  },
  medical: {
    id: 'medical',
    key: '2',
    label: 'Medical',
    hint: 'Societies, agencies & peer-reviewed medicine · Europe PMC',
    placeholder: 'e.g. acute appendicitis antibiotics, sepsis children, 10.1056/…, PMID',
    sources: [europepmc],
    lenses: EPMC_LENSES,
    defaultLens: 'guidelines',
  },
  thesis: {
    id: 'thesis',
    key: '3',
    label: 'Thesis',
    hint: 'Past MD & doctoral theses · DUMAS/HAL + theses.fr (+ OpenAlex)',
    placeholder: 'e.g. appendicite enfant, diabète gestationnel, cancer du sein Maroc',
    sources: [hal, thesesfr, makeOpenAlex({ dissertationsOnly: true })],
    lenses: null,
  },
};

export const MODE_ORDER = ['general', 'medical', 'thesis'];
export const DEFAULT_MODE = 'medical';
