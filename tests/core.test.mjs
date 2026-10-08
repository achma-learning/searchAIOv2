import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectIdentifier, cleanDoi, stripTags, paperId } from '../js/util.js';
import { parseBang, engineUrl, ENGINES, engineByBang } from '../js/engines.js';
import { buildQuery, badgesFor, normalize as epmc } from '../js/sources/europepmc.js';
import { normalize as crossref } from '../js/sources/crossref.js';
import { normalize as hal } from '../js/sources/hal.js';
import { normalize as thesesfr } from '../js/sources/thesesfr.js';
import { rebuildAbstract } from '../js/sources/openalex.js';
import { vancouver, vancouverName, bibtex, ris, csv } from '../js/cite.js';
import * as store from '../js/store.js';

test('identifiers: DOI (bare, URL, doi:) and PMID are recognised', () => {
  assert.deepEqual(detectIdentifier('10.1056/NEJMoa2034577'), { type: 'doi', value: '10.1056/NEJMoa2034577' });
  assert.deepEqual(detectIdentifier('https://doi.org/10.1000/xyz.'), { type: 'doi', value: '10.1000/xyz' });
  assert.deepEqual(detectIdentifier('doi: 10.1000/abc'), { type: 'doi', value: '10.1000/abc' });
  assert.deepEqual(detectIdentifier('PMID: 31234567'), { type: 'pmid', value: '31234567' });
  assert.equal(detectIdentifier('appendicitis 2020'), null);
  assert.equal(cleanDoi('https://dx.doi.org/10.1/a;'), '10.1/a');
});

test('stripTags removes JATS markup', () => {
  assert.equal(stripTags('<jats:p>Hello <i>world</i></jats:p>'), 'Hello world');
  assert.equal(stripTags('<h4>Importance</h4>Acute appendicitis.<h4>Objective</h4>To update.'), 'Importance: Acute appendicitis.\nObjective: To update.');
});

test('paperId prefers DOI (lowercased) so sources de-duplicate', () => {
  assert.equal(paperId({ doi: '10.1/ABC', pmid: '1' }), 'doi:10.1/abc');
  assert.equal(paperId({ pmid: '42' }), 'pmid:42');
  assert.equal(paperId({ source: 'hal', localId: 'dumas-1' }), 'hal:dumas-1');
});

test('bangs: found anywhere, rightmost wins, unknown ignored', () => {
  const a = parseBang('!pm sepsis children');
  assert.equal(a.engine.bang, 'pm');
  assert.equal(a.query, 'sepsis children');
  const b = parseBang('sepsis !has children');
  assert.equal(b.engine.bang, 'has');
  assert.equal(b.query, 'sepsis children');
  assert.equal(parseBang('wow !nope'), null);
  assert.equal(engineUrl(engineByBang('toubkal'), 'diabète type 2'),
    'https://toubkal.imist.ma/search?query=diab%C3%A8te%20type%202&submit=OK');
});

test('engine registry: unique bangs, every URL has {q}', () => {
  const bangs = ENGINES.map((e) => e.bang);
  assert.equal(new Set(bangs).size, bangs.length, 'duplicate bang');
  for (const e of ENGINES) assert.ok(e.url.includes('{q}'), e.name);
});

test('Europe PMC query: lens, years, free, identifiers', () => {
  const q = buildQuery('appendicitis', { lens: 'guidelines', from: 2015, to: 2020, free: true });
  assert.match(q, /^\(appendicitis\) AND \(PUB_TYPE:"guideline"/);
  assert.match(q, /PUB_YEAR:\[2015 TO 2020\]/);
  assert.match(q, /HAS_FREE_FULLTEXT:Y/);
  assert.equal(buildQuery('appendicitis', { lens: 'all' }), '(appendicitis)');
  assert.match(buildQuery('x', { sort: 'newest' }), /FIRST_PDATE:\[1800-01-01 TO \d{4}-\d\d-\d\d\]/);
  assert.equal(buildQuery('10.1056/x', { lens: 'guidelines' }), 'DOI:"10.1056/x"');
  assert.equal(buildQuery('12345678', { lens: 'rct' }), 'EXT_ID:12345678 AND SRC:MED');
});

test('evidence badges', () => {
  assert.deepEqual(badgesFor(['review', 'systematic review', 'meta-analysis']).sort(), ['Meta-analysis', 'Systematic review']);
  assert.deepEqual(badgesFor(['journal article'], 'ESC Guidelines for heart failure'), ['Guideline']);
  assert.deepEqual(badgesFor(['randomized controlled trial', 'clinical trial']), ['RCT']);
});

test('Europe PMC normaliser: free full text via PMC', () => {
  const p = epmc({
    id: '1', source: 'MED', pmid: '1', pmcid: 'PMC9', doi: '10.1/x', title: 'A title.', isOpenAccess: 'Y', inEPMC: 'Y',
    authorString: 'Smith J, Doe A.', pubYear: '2020', journalInfo: { volume: '3', issue: '2', journal: { isoabbreviation: 'Lancet' } },
    pageInfo: '10-20', pubTypeList: { pubType: ['practice guideline'] }, abstractText: '<b>Abs</b>',
  });
  assert.equal(p.id, 'doi:10.1/x');
  assert.equal(p.title, 'A title');
  assert.deepEqual(p.authors, ['Smith J', 'Doe A']);
  assert.equal(p.freeUrl, 'https://europepmc.org/article/PMC/PMC9');
  assert.equal(p.url, 'https://pubmed.ncbi.nlm.nih.gov/1/');
  assert.deepEqual(p.badges, ['Guideline']);
  assert.equal(p.abstract, 'Abs');
});

test('Crossref, HAL, theses.fr normalisers', () => {
  const c = crossref({ DOI: '10.2/y', title: ['T'], author: [{ given: 'Ana', family: 'Lopez' }], issued: { 'date-parts': [[2019]] }, 'container-title': ['J'], type: 'journal-article' });
  assert.equal(c.year, 2019);
  assert.deepEqual(c.authors, ['Ana Lopez']);
  const h = hal({ halId_s: 'dumas-1', docType_s: 'MEM', instance_s: 'dumas', title_s: ['Thèse'], authFullName_s: ['A B'], director_s: ['C D'], producedDateY_i: 2021, uri_s: 'u', fileMain_s: 'pdf', structName_s: ['UFR', 'Université de Brest'] });
  assert.equal(h.kind, 'thesis');
  assert.equal(h.freeUrl, 'pdf');
  assert.equal(h.venue, 'Université de Brest');
  assert.deepEqual(h.supervisors, ['C D']);
  const t = thesesfr({ id: '1990LIL2M067', nnt: '1990LIL2M067', titrePrincipal: 'Appendicite', dateSoutenance: '01/01/1990', auteurs: [{ prenom: 'P', nom: 'S' }], directeurs: [{ prenom: 'G', nom: 'D' }], discipline: 'Médecine', status: 'soutenue', etabSoutenanceN: 'Lille 2' });
  assert.equal(t.year, 1990);
  assert.equal(t.url, 'https://theses.fr/1990LIL2M067');
  assert.deepEqual(t.supervisors, ['G D']);
});

test('OpenAlex inverted abstract rebuild', () => {
  assert.equal(rebuildAbstract({ world: [1], hello: [0] }), 'hello world');
});

test('Vancouver citation', () => {
  assert.equal(vancouverName('Jean-Pierre Dupont'), 'Dupont JP');
  assert.equal(vancouverName('Smith JA'), 'Smith JA');
  assert.equal(vancouverName('Lopez, Ana Maria'), 'Lopez AM');
  const cit = vancouver({ authors: ['Smith J', 'Doe A'], title: 'Trial.', venue: 'Lancet', year: 2020, volume: '3', issue: '2', pages: '10-20', doi: '10.1/x', pmid: '1' });
  assert.equal(cit, 'Smith J, Doe A. Trial. Lancet. 2020;3(2):10-20. doi:10.1/x PMID: 1.');
  const many = vancouver({ authors: ['A A', 'B B', 'C C', 'D D', 'E E', 'F F', 'G G'], title: 'T', year: 2001 });
  assert.match(many, /F F, et al\. T\./);
  assert.match(vancouver({ kind: 'thesis', authors: ['Amal Idrissi'], title: 'Appendicite', venue: 'FMPM', year: 2022 }), /Idrissi A\. Appendicite\. \[Thesis\]\. FMPM; 2022\./);
});

test('BibTeX, RIS, CSV exports', () => {
  const p = { title: 'Héart {failure}', authors: ['Ana Lopez'], year: 2020, venue: 'J', doi: '10.1/x', kind: 'article', tags: ['ch2'], note: 'n "q"' };
  const b = bibtex(p);
  assert.match(b, /^@article\{lopez2020heart,/);
  assert.match(b, /title = \{Héart failure\}/);
  const r = ris(p);
  assert.match(r, /^TY  - JOUR/);
  assert.match(r, /KW  - ch2/);
  assert.match(r, /ER  - $/);
  assert.match(csv([p]), /"n ""q"""/);
});

test('library: save, note, remove (tombstone) and merge', () => {
  let a = store.emptyLibrary();
  const paper = { id: 'doi:1', title: 'One' };
  a = store.savePaper(a, paper);
  assert.ok(store.isSaved(a, 'doi:1'));
  a = store.savePaper(a, paper, { note: 'hello' });
  assert.equal(a.items['doi:1'].note, 'hello');
  assert.equal(a.items['doi:1'].status, 'to-read');

  // Device B removes it later → tombstone wins over the older save.
  const b = store.removePaper(structuredClone(a), 'doi:1');
  b.items['doi:1'].updatedAt = '9999-01-01T00:00:00.000Z';
  const m = store.mergeLibraries(a, b);
  assert.equal(store.isSaved(m, 'doi:1'), false);
  assert.equal(store.liveItems(m).length, 0);

  // Merge is symmetric and idempotent.
  assert.equal(store.fingerprint(store.mergeLibraries(a, b)), store.fingerprint(store.mergeLibraries(b, a)));
  assert.equal(store.fingerprint(store.mergeLibraries(m, m)), store.fingerprint(m));
});

test('follows: add / remove', () => {
  let lib = store.addFollow(store.emptyLibrary(), { mode: 'medical', q: 'Sepsis ', lens: 'guidelines' });
  assert.equal(store.liveFollows(lib).length, 1);
  assert.equal(store.liveFollows(lib)[0].q, 'Sepsis');
  lib = store.removeFollow(lib, store.followId({ mode: 'medical', q: 'sepsis', lens: 'guidelines' }));
  assert.equal(store.liveFollows(lib).length, 0);
});
