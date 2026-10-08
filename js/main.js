// searchAIO · med — app controller.
// One state object, small render functions, one keyboard layer.
import { CONFIG } from '../config.js';
import { MODES, MODE_ORDER, DEFAULT_MODE } from './modes.js';
import europepmc from './sources/europepmc.js';
import { ENGINES, engineByBang, engineUrl, enginesForMode, parseBang } from './engines.js';
import * as store from './store.js';
import * as cite from './cite.js';
import * as gsync from './sync-google.js';
import { SCIHUB_MIRRORS, SCIHUB_STATUS_PAGE, nextMirror, normalizeMirror, scihubLink, unpaywallLink } from './access.js';
import { esc, debounce, detectIdentifier, plural, todayISO } from './util.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

/* ═══ state ═══════════════════════════════════════════════════════════════ */

const S = {
  settings: store.loadSettings(),
  library: store.loadLibrary(),
  history: store.loadHistory(),
  mode: DEFAULT_MODE,
  view: 'search',
  lens: { medical: MODES.medical.defaultLens },
  filters: { from: '', to: '', free: false, sort: 'relevance', healthOnly: true },
  q: '',
  results: [],
  src: {}, // per-source { total, cursor, error, skipped }
  loading: false,
  lensCounts: {},
  sel: -1,
  detail: false,
  runId: 0,
  abort: null,
  libQ: '',
  libStatus: 'all',
  followNew: {}, // followId → count of new papers
  sync: { state: 'off', msg: '' },
};
S.mode = MODES[S.settings.defaultMode] ? S.settings.defaultMode : DEFAULT_MODE;

const mode = () => MODES[S.mode];
const lensOf = () => (mode().lenses ? S.lens[S.mode] || mode().defaultLens : '');
const activeSources = () => mode().sources.filter((s) => !s.needsKey || S.settings.openalexKey);
const list = () => (S.view === 'library' ? libraryList() : S.results);
const current = () => list()[S.sel] || null;
const clientId = () => S.settings.googleClientId || CONFIG.googleClientId;

/* ═══ tiny UI helpers ═════════════════════════════════════════════════════ */

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 2200);
}

function openUrl(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function copy(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast('Clipboard blocked by the browser', 'warn');
  }
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const kbd = (k) => `<kbd>${esc(k)}</kbd>`;

/* ═══ access links: the "read it for free" buttons ════════════════════════ */

const unpaywallUrl = unpaywallLink;
const scihubUrl = (p, mirror = S.settings.scihubMirror) => (S.settings.showScihub ? scihubLink(mirror, p) : '');

// ⇧H walks the mirror list for the selected paper, in case the usual one is down.
let altMirror = null;
let altMirrorFor = null;
function scihubNextMirror(p) {
  if (!S.settings.showScihub) return toast('Sci-Hub button is off (Settings)');
  if (!scihubUrl(p)) return toast('No DOI or PMID for this record');
  altMirror = nextMirror(altMirrorFor === p.id && altMirror ? altMirror : S.settings.scihubMirror);
  altMirrorFor = p.id;
  if (altMirror === normalizeMirror(S.settings.scihubMirror)) altMirror = nextMirror(altMirror);
  openUrl(scihubUrl(p, altMirror));
  toast(`Trying ${new URL(altMirror).hostname} — set it as default in Settings if it works`);
}

/* ═══ persistence & sync ══════════════════════════════════════════════════ */

const autoSync = debounce(() => { if (gsync.isConnected()) syncNow({ quiet: true }); }, 4000);

function setLibrary(next) {
  S.library = next;
  if (!store.saveLibrary(next)) toast('Browser storage is full or blocked — export a backup!', 'warn');
  renderNavCounts();
  autoSync();
}

function setSettings(patch) {
  S.settings = { ...S.settings, ...patch };
  store.saveSettings(S.settings);
}

async function syncNow({ quiet = false } = {}) {
  if (!clientId()) {
    openSettings('sync');
    toast('Add a Google OAuth client ID first (Settings → Sync)', 'warn');
    return;
  }
  S.sync = { state: 'busy', msg: 'Syncing…' };
  renderSyncPill();
  try {
    if (!gsync.isConnected()) await gsync.connect(clientId());
    const remote = await gsync.download();
    const merged = remote ? store.mergeLibraries(S.library, remote) : S.library;
    if (store.fingerprint(merged) !== store.fingerprint(S.library)) {
      S.library = merged;
      store.saveLibrary(merged);
      renderNavCounts();
      renderView();
    }
    if (!remote || store.fingerprint(merged) !== store.fingerprint(remote)) await gsync.upload(merged);
    setSettings({ syncEnabled: true });
    S.sync = { state: 'on', msg: `Synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` };
    if (!quiet) toast('Library synced with Google Drive');
  } catch (e) {
    S.sync = { state: 'error', msg: e.message };
    if (!quiet) toast(e.message, 'warn');
  }
  renderSyncPill();
}

function disconnectSync() {
  gsync.disconnect();
  setSettings({ syncEnabled: false });
  S.sync = { state: 'off', msg: '' };
  renderSyncPill();
  toast('Google sync turned off — your library stays in this browser');
}

/* ═══ search ═════════════════════════════════════════════════════════════ */

function readFilters() {
  const yr = (v) => (/^\d{4}$/.test(v) ? Number(v) : '');
  S.filters = {
    from: yr($('#f-from').value),
    to: yr($('#f-to').value),
    free: $('#f-free').checked,
    sort: $('#f-sort').value,
    healthOnly: $('#f-health').checked,
  };
}

/** Interleave lists from several sources (rank 1 of each, then rank 2…), dropping duplicates. */
function interleave(lists, seen) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const l of lists) {
      const p = l[i];
      if (!p) continue;
      const dup = seen.get(p.id);
      if (dup) {
        // same paper from a second source: keep the richest fields
        for (const k of ['abstract', 'freeUrl', 'pmid', 'venue']) if (!dup[k] && p[k]) dup[k] = p[k];
        continue;
      }
      seen.set(p.id, p);
      out.push(p);
    }
  }
  return out;
}

async function search({ append = false, raw } = {}) {
  const input = $('#q');
  const text = (raw ?? input.value).trim();
  if (!append) {
    if (!text) { input.focus(); return; }
    const bang = parseBang(text);
    if (bang) return launch(bang.engine, bang.query || S.q);
    S.q = text;
    S.results = [];
    S.src = {};
    S.sel = -1;
    S.lensCounts = {};
    S.history = store.pushHistory({ q: text, mode: S.mode, at: Date.now() }, S.settings.history);
    writeUrl();
    if (S.mode === 'medical') loadLensCounts();
  }
  readFilters();

  const sources = activeSources().filter((s) => !append || S.src[s.id]?.cursor != null);
  if (!sources.length) return;

  S.abort?.abort();
  const ctrl = (S.abort = new AbortController());
  const runId = ++S.runId;
  S.loading = true;
  if (S.view !== 'search') setView('search');
  renderResults();

  const outcomes = await Promise.allSettled(
    sources.map((src) =>
      src.search({
        q: S.q,
        lens: lensOf(),
        filters: S.filters,
        cursor: append ? S.src[src.id].cursor : undefined,
        signal: ctrl.signal,
        settings: S.settings,
      }),
    ),
  );
  if (runId !== S.runId) return; // a newer search started meanwhile

  const lists = outcomes.map((o, i) => {
    const id = sources[i].id;
    if (o.status === 'fulfilled') {
      S.src[id] = { total: o.value.total, cursor: o.value.cursor, skipped: o.value.skipped };
      return o.value.items;
    }
    S.src[id] = { ...(S.src[id] || {}), error: o.reason?.message || 'failed', cursor: null };
    return [];
  });
  const seen = new Map(S.results.map((p) => [p.id, p]));
  const fresh = interleave(lists, seen);
  S.results = append ? S.results.concat(fresh) : fresh;
  S.loading = false;
  if (!append && S.results.length && S.sel < 0 && window.matchMedia('(min-width: 1100px)').matches) S.sel = 0;
  renderResults();
  renderDetail();
}

async function loadLensCounts() {
  readFilters();
  const q = S.q;
  const counts = await europepmc.countLenses(q, { ...S.filters, sort: '' });
  if (q === S.q && S.mode === 'medical') {
    S.lensCounts = counts;
    renderLenses();
  }
}

const hasMore = () => Object.values(S.src).some((s) => s.cursor != null);

function launch(engine, query) {
  const q = (query ?? $('#q').value).trim();
  if (!q) { toast(`Type something to send to ${engine.name}`); return; }
  openUrl(engineUrl(engine, q));
  toast(`Opened in ${engine.name}`);
}

/* ═══ URL state: every search is a shareable, bookmarkable link ═══════════ */

function writeUrl() {
  const p = new URLSearchParams();
  if (S.mode !== DEFAULT_MODE) p.set('mode', S.mode);
  if (S.q) p.set('q', S.q);
  if (lensOf() && lensOf() !== mode().defaultLens) p.set('lens', lensOf());
  const url = `${location.pathname}${p.toString() ? `?${p}` : ''}`;
  if (url !== `${location.pathname}${location.search}`) history.pushState(null, '', url);
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  const m = p.get('mode');
  if (m && MODES[m]) S.mode = m;
  if (p.get('lens') && MODES[S.mode].lenses?.some((l) => l.id === p.get('lens'))) S.lens[S.mode] = p.get('lens');
  return p.get('q') || '';
}

/* ═══ library helpers ════════════════════════════════════════════════════ */

function libraryList() {
  const q = S.libQ.trim().toLowerCase();
  return store.liveItems(S.library).filter((p) => {
    if (S.libStatus !== 'all' && p.status !== S.libStatus) return false;
    if (!q) return true;
    return [p.title, (p.authors || []).join(' '), p.note, (p.tags || []).join(' '), p.venue, p.doi]
      .join(' ').toLowerCase().includes(q);
  });
}

function toggleSave(p) {
  if (!p) return;
  const was = store.isSaved(S.library, p.id);
  setLibrary(store.toggleSaved(S.library, p));
  toast(was ? 'Removed from library' : 'Saved to library');
  if (S.view === 'library') S.sel = Math.min(S.sel, libraryList().length - 1);
  renderView();
}

function cycleStatus(p) {
  if (!p) return;
  if (!store.isSaved(S.library, p.id)) return toast('Save it first (s)');
  const cur = S.library.items[p.id].status;
  const next = store.STATUSES[(store.STATUSES.indexOf(cur) + 1) % store.STATUSES.length];
  setLibrary(store.savePaper(S.library, p, { status: next }));
  toast(`Marked “${next}”`);
  renderView();
}

function followCurrent() {
  if (!S.q) return toast('Run a search first, then follow it');
  const id = store.followId({ mode: S.mode, q: S.q, lens: lensOf() });
  if (S.library.follows[id] && !S.library.follows[id].deleted) {
    setLibrary(store.removeFollow(S.library, id));
    toast('Stopped following this search');
  } else {
    readFilters();
    setLibrary(store.addFollow(S.library, { mode: S.mode, q: S.q, lens: lensOf(), filters: { ...S.filters, sort: 'relevance' } }));
    toast('Following — new papers will show in your Library');
  }
  renderResultsHeader();
}

const isFollowing = () => {
  const f = S.library.follows[store.followId({ mode: S.mode, q: S.q, lens: lensOf() })];
  return Boolean(f && !f.deleted);
};

/** "Stay up to date": count papers published since you last looked. */
async function checkFollows() {
  const follows = store.liveFollows(S.library);
  await Promise.all(follows.map(async (f) => {
    const src = f.mode === 'medical' ? europepmc : null;
    if (!src?.countSince) return;
    try { S.followNew[f.id] = await src.countSince(f.q, f.lens, f.filters, f.lastSeen); } catch { /* offline: ignore */ }
  }));
  renderNavCounts();
  if (S.view === 'library') renderFollows();
}

function runFollow(id) {
  const f = S.library.follows[id];
  if (!f) return;
  setLibrary(store.updateFollow(S.library, id, { lastSeen: todayISO() }));
  S.followNew[id] = 0;
  S.mode = f.mode;
  if (f.lens) S.lens[f.mode] = f.lens;
  $('#f-from').value = f.filters?.from || '';
  $('#f-to').value = f.filters?.to || '';
  $('#f-free').checked = Boolean(f.filters?.free);
  $('#f-sort').value = 'newest';
  $('#q').value = f.q;
  setView('search');
  renderMode();
  search();
}

/* ═══ rendering ═════════════════════════════════════════════════════════ */

function renderMode() {
  $('#modes').innerHTML = MODE_ORDER.map((id) => {
    const m = MODES[id];
    const on = id === S.mode;
    return `<button role="tab" aria-selected="${on}" class="mode ${on ? 'on' : ''}" data-mode="${id}" title="${esc(m.hint)}">
      <span class="mode-key">${m.key}</span>${esc(m.label)}</button>`;
  }).join('');
  $('#q').placeholder = mode().placeholder;
  const supports = (key) => activeSources().some((s) => s.supports[key]);
  $('#f-free-wrap').hidden = !supports('free');
  $('#f-health-wrap').hidden = S.mode !== 'thesis';
  const sorts = new Set(activeSources().flatMap((s) => s.supports.sort));
  for (const o of $('#f-sort').options) o.hidden = !sorts.has(o.value);
  if (!sorts.has($('#f-sort').value)) $('#f-sort').value = 'relevance';
  document.body.dataset.mode = S.mode;
  renderLenses();
  renderLaunchers();
  renderSearchHint();
}

function renderLenses() {
  const el = $('#lenses');
  const lenses = mode().lenses;
  el.hidden = !lenses;
  if (!lenses) return (el.innerHTML = '');
  const cur = lensOf();
  el.innerHTML = `<span class="lens-label" title="Rungs of the evidence pyramid — switch with [ and ]">Evidence</span>` +
    lenses.map((l) => {
      const n = S.lensCounts[l.id];
      return `<button role="radio" aria-checked="${l.id === cur}" class="lens ${l.id === cur ? 'on' : ''}" data-lens="${l.id}" title="${esc(l.label)}">
        ${esc(l.short)}${n != null ? `<span class="lens-n">${n > 9999 ? `${Math.round(n / 1000)}k` : n.toLocaleString()}</span>` : ''}</button>`;
    }).join('') + `<span class="lens-keys">${kbd('[')}${kbd(']')}</span>`;
}

function renderLaunchers() {
  const engines = enginesForMode(S.mode);
  $('#launchers').innerHTML = `<span class="lens-label">Also search in</span>` +
    engines.map((e) => `<button type="button" class="launcher" data-bang="${e.bang}" title="Open “${esc(e.name)}” in a new tab · or type !${e.bang} in the box">${esc(e.name)}<span class="bang">!${e.bang}</span></button>`).join('') +
    `<button type="button" class="launcher more" data-cmd="palette-engines" title="All ${ENGINES.length} engines (e)">more… ${kbd('e')}</button>`;
}

function renderSearchHint() {
  const v = $('#q').value;
  const hint = $('#search-hint');
  const bang = parseBang(v);
  const last = v.split(/\s+/).pop() || '';
  if (bang) {
    hint.innerHTML = `↗ ${kbd('Enter')} opens <strong>${esc(bang.engine.name)}</strong> in a new tab`;
  } else if (/^![\w.-]*$/.test(last)) {
    const sugg = ENGINES.filter((e) => e.bang.startsWith(last.slice(1).toLowerCase())).slice(0, 6);
    hint.innerHTML = sugg.length
      ? `${kbd('Tab')} ${sugg.map((e) => `<span class="sugg"><b>!${esc(e.bang)}</b> ${esc(e.name)}</span>`).join(' ')}`
      : 'Unknown bang — press <kbd>e</kbd> outside the box to browse engines';
  } else if (detectIdentifier(v)) {
    hint.textContent = `Identifier detected — looking up this exact ${detectIdentifier(v).type.toUpperCase()}`;
  } else {
    hint.innerHTML = `<span class="muted">${esc(mode().hint)} · ${kbd('Enter')} search · ${kbd('⇧ Enter')} ${esc(enginesForMode(S.mode)[0]?.name || 'web')} · <b>!bang</b> to jump to a site</span>`;
  }
}

function renderResultsHeader() {
  const head = $('#results-head');
  if (!head) return;
  const totals = Object.entries(S.src)
    .filter(([, s]) => !s.skipped)
    .map(([id, s]) => {
      const src = mode().sources.find((x) => x.id === id);
      return s.error
        ? `<span class="src-err" title="${esc(s.error)}">${esc(src?.label || id)}: unavailable</span>`
        : `<span>${esc(src?.label || id)}: ${(s.total ?? 0).toLocaleString()}</span>`;
    }).join(' · ');
  head.innerHTML = `<div class="rh-left"><strong>${S.results.length ? plural(S.results.length, 'result') + ' shown' : ''}</strong> <span class="muted">${totals}</span></div>
    ${S.q ? `<button class="btn small ${isFollowing() ? 'on' : ''}" data-cmd="follow" title="Get notified of new papers for this search (f)">${isFollowing() ? '★ Following' : '☆ Follow'} ${kbd('f')}</button>` : ''}`;
}

function badge(b) {
  const cls = { Guideline: 'g', 'Meta-analysis': 'ma', 'Systematic review': 'sr', RCT: 'rct', PDF: 'pdf', DUMAS: 'dumas' }[b] || '';
  return `<span class="badge ${cls}">${esc(b)}</span>`;
}

function authorsShort(a = []) {
  if (!a.length) return '';
  return a.length > 4 ? `${a.slice(0, 3).join(', ')} … ${a[a.length - 1]}` : a.join(', ');
}

function card(p, i) {
  const saved = store.isSaved(S.library, p.id);
  const lib = S.library.items[p.id];
  const un = unpaywallUrl(p);
  const sh = scihubUrl(p);
  const meta = [p.year, p.venue].filter(Boolean).map(esc).join(' · ');
  return `<article class="card ${i === S.sel ? 'sel' : ''}" data-i="${i}" id="card-${i}">
    <div class="card-meta"><span>${meta}</span>${(p.badges || []).map(badge).join('')}
      ${p.citedBy ? `<span class="cited" title="Times cited">❝ ${p.citedBy}</span>` : ''}
      ${saved ? `<span class="badge saved" title="In your library">★ ${esc(lib.status)}</span>` : ''}</div>
    <h3 class="card-title"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" data-i="${i}">${esc(p.title)}</a></h3>
    ${p.authors?.length ? `<p class="card-authors">${esc(authorsShort(p.authors))}</p>` : ''}
    ${p.supervisors?.length ? `<p class="card-authors">Supervisor: ${esc(p.supervisors.join(', '))}</p>` : ''}
    ${p.abstract ? `<p class="card-abs">${esc(p.abstract.slice(0, 420))}</p>` : ''}
    ${S.view === 'library' && lib?.note ? `<p class="card-note">✎ ${esc(lib.note)}</p>` : ''}
    <div class="card-actions">
      ${p.freeUrl ? `<a class="act free" href="${esc(p.freeUrl)}" target="_blank" rel="noopener noreferrer" title="Free full text (p)">Free full text ${kbd('p')}</a>` : ''}
      ${un ? `<a class="act oa" href="${esc(un)}" target="_blank" rel="noopener noreferrer" title="Find a legal free copy via Unpaywall (u)">Unpaywall ${kbd('u')}</a>` : ''}
      ${sh ? `<a class="act sh" href="${esc(sh)}" target="_blank" rel="noopener noreferrer" title="Open via Sci-Hub (h)">Sci-Hub ${kbd('h')}</a>` : ''}
      <button class="act ${saved ? 'on' : ''}" data-act="save" data-i="${i}" title="Save / unsave (s)">${saved ? '★ Saved' : '☆ Save'} ${kbd('s')}</button>
      <button class="act" data-act="cite" data-i="${i}" title="Copy Vancouver citation (c)">Cite ${kbd('c')}</button>
      <button class="act" data-act="detail" data-i="${i}" title="Details, abstract, notes (Enter)">Details ${kbd('↵')}</button>
    </div>
  </article>`;
}

function emptyState() {
  const recent = S.history.filter((h) => h.mode === S.mode).slice(0, 6);
  const tips = {
    medical: `<h2>What do societies and agencies recommend?</h2>
      <p>Medical mode searches <b>Europe PMC</b> (all of PubMed + PMC + preprints) and starts on the top of the evidence pyramid:
      <b>guidelines, consensus and position statements</b> from learned societies and recognised bodies.
      Step down with ${kbd(']')} to systematic reviews, trials, reviews, then everything. The counts on each rung show how much evidence exists.</p>`,
    thesis: `<h2>Find the theses that came before yours.</h2>
      <p>Thesis mode searches <b>DUMAS / HAL</b> (French MD “thèses d’exercice”, usually with the full PDF) and <b>theses.fr</b> (every French doctoral thesis, with supervisor).
      Moroccan theses (Toubkal, FMPM) have no open API — they are one keystroke away in the row above, or with ${kbd('!toubkal')} / ${kbd('!fmpm')}.</p>
      <p class="muted">Tip: search in French for French-speaking faculties; note who supervised similar work — they are potential jury members.</p>`,
    general: `<h2>Everything with a DOI.</h2>
      <p>General mode searches <b>Crossref</b> (≈150 M scholarly records, every discipline). Add a free OpenAlex key in Settings for richer ranking and built-in open-access links.
      For the open web, press ${kbd('⇧ Enter')} or use a bang like ${kbd('!g')}.</p>`,
  }[S.mode];
  return `<div class="empty">
    ${tips}
    ${recent.length ? `<div class="recent"><span class="lens-label">Recent</span>${recent.map((h) => `<button class="chip" data-recent="${esc(h.q)}">${esc(h.q)}</button>`).join('')}</div>` : ''}
    <div class="keys-teaser">
      <div>${kbd('/')} search</div><div>${kbd('1')}${kbd('2')}${kbd('3')} modes</div><div>${kbd('j')}${kbd('k')} move</div>
      <div>${kbd('u')} Unpaywall</div><div>${kbd('h')} Sci-Hub</div><div>${kbd('s')} save</div><div>${kbd('c')} cite</div><div>${kbd('?')} all keys</div>
    </div>
  </div>`;
}

function renderResults() {
  const el = $('#results');
  if (!S.q && !S.loading) {
    el.innerHTML = emptyState();
    $('#detail').hidden = true;
    return;
  }
  const errors = Object.entries(S.src).filter(([, s]) => s.error);
  let body = '';
  if (S.results.length) {
    body = `<div class="cards">${S.results.map(card).join('')}</div>`;
    if (S.loading) body += `<div class="loading">Loading more…</div>`;
    else if (hasMore()) body += `<button class="btn more" data-cmd="more">Load more ${kbd('m')}</button>`;
  } else if (S.loading) {
    body = `<div class="loading"><span class="spinner"></span> Searching ${esc(activeSources().map((s) => s.label).join(', '))}…</div>`;
  } else {
    const lensHint = S.mode === 'medical' && lensOf() !== 'all'
      ? `<p>Nothing on this rung of the evidence pyramid. Press ${kbd(']')} to step down, or pick another level above.</p>` : '';
    body = `<div class="empty small"><h2>No results${errors.length ? ' (a source failed)' : ''}.</h2>${lensHint}
      <p>Try fewer or broader words, another language (French ↔ English), or send the query elsewhere:</p>
      <div class="recent">${enginesForMode(S.mode).slice(0, 6).map((e) => `<button class="chip" data-bang="${e.bang}">${esc(e.name)} ↗</button>`).join('')}</div></div>`;
  }
  el.innerHTML = `<div class="results-head" id="results-head"></div>${body}`;
  renderResultsHeader();
}

function renderDetail() {
  const pane = S.view === 'library' ? $('#lib-detail') : $('#detail');
  const p = current();
  const wide = window.matchMedia('(min-width: 1100px)').matches;
  if (!p || (!S.detail && !wide)) { pane.hidden = true; document.body.classList.remove('drawer'); return; }
  if (!wide) document.body.classList.toggle('drawer', S.detail);
  pane.hidden = false;
  const saved = store.isSaved(S.library, p.id);
  const lib = S.library.items[p.id] || {};
  const un = unpaywallUrl(p);
  const sh = scihubUrl(p);
  pane.innerHTML = `
    <div class="d-head"><span class="muted">${esc(p.source)} · ${esc(p.kind)}</span>
      <button class="icon-btn" data-cmd="close-detail" aria-label="Close details" title="Close (Esc)">✕</button></div>
    <h2 class="d-title">${esc(p.title)}</h2>
    <p class="d-authors">${esc((p.authors || []).join(', '))}</p>
    ${p.supervisors?.length ? `<p class="d-authors">Supervised by ${esc(p.supervisors.join(', '))}</p>` : ''}
    <p class="muted">${[p.venue, p.year, p.doi && `doi:${p.doi}`, p.pmid && `PMID ${p.pmid}`].filter(Boolean).map(esc).join(' · ')}</p>
    <div class="d-badges">${(p.badges || []).map(badge).join('')}</div>
    <div class="d-actions">
      <a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open record ${kbd('o')}</a>
      ${p.freeUrl ? `<a class="btn primary" href="${esc(p.freeUrl)}" target="_blank" rel="noopener noreferrer">Free full text ${kbd('p')}</a>` : ''}
      ${un ? `<a class="btn oa" href="${esc(un)}" target="_blank" rel="noopener noreferrer">Unpaywall ${kbd('u')}</a>` : ''}
      ${sh ? `<a class="btn sh" href="${esc(sh)}" target="_blank" rel="noopener noreferrer">Sci-Hub ${kbd('h')}</a>
        <button class="btn small sh" data-act="scihub-next" title="Mirror down? Open the same paper on the next Sci-Hub mirror">Other mirror ${kbd('⇧H')}</button>` : ''}
    </div>
    ${p.keywords?.length ? `<p class="d-kw">${p.keywords.slice(0, 12).map((k) => `<span class="chip static">${esc(k)}</span>`).join('')}</p>` : ''}
    <h3>Abstract</h3>
    <p class="d-abs">${p.abstract ? esc(p.abstract) : '<span class="muted">No abstract in this record — open it or try the free-access buttons.</span>'}</p>
    <h3>Cite</h3>
    <p class="d-cite">${esc(cite.vancouver(p))}</p>
    <div class="d-actions">
      <button class="btn small" data-act="cite">Vancouver ${kbd('c')}</button>
      <button class="btn small" data-act="bibtex">BibTeX ${kbd('b')}</button>
      <button class="btn small" data-act="ris">RIS</button>
    </div>
    <h3>Your notes <span class="muted small">(${saved ? 'saved in your library' : 'typing a note saves the paper'})</span></h3>
    <textarea id="note" rows="4" placeholder="Why it matters for your thesis or practice, key numbers, limits…">${esc(lib.note || '')}</textarea>
    <div class="d-row">
      <label>Tags <input id="tags" type="text" value="${esc((lib.tags || []).join(', '))}" placeholder="chapter 2, to discuss…"></label>
      <label>Status <select id="status" ${saved ? '' : 'disabled'}>${store.STATUSES.map((s) => `<option ${lib.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    </div>
    <div class="d-actions"><button class="btn ${saved ? '' : 'primary'}" data-act="save">${saved ? '★ Remove from library' : '☆ Save to library'} ${kbd('s')}</button></div>`;
}

function renderNavCounts() {
  const n = store.liveItems(S.library).length;
  const c = $('#lib-count');
  c.hidden = !n;
  c.textContent = n;
  const fresh = Object.values(S.followNew).reduce((a, b) => a + (b || 0), 0);
  const dot = $('#lib-new');
  dot.hidden = !fresh;
  dot.title = `${fresh} new papers in followed searches`;
  $('#nav-library').classList.toggle('on', S.view === 'library');
}

function renderSyncPill() {
  const pill = $('#sync-pill');
  const configured = Boolean(clientId());
  pill.hidden = !configured && S.sync.state === 'off';
  const icon = { off: '☁', busy: '⟳', on: '☁✓', error: '☁!' }[S.sync.state];
  pill.textContent = icon;
  pill.dataset.state = S.sync.state;
  pill.title = S.sync.state === 'off'
    ? (S.settings.syncEnabled ? 'Google sync: press to reconnect (S)' : 'Sync library with Google Drive (S)')
    : `Google sync: ${S.sync.msg}`;
}

function renderFollows() {
  const follows = store.liveFollows(S.library);
  $('#follows').innerHTML = follows.length ? `<div class="follows">
      <h2>Followed searches <span class="muted small">— stay up to date after the diploma</span></h2>
      ${follows.map((f) => {
        const n = S.followNew[f.id];
        return `<div class="follow">
          <div><strong>${esc(f.q)}</strong> <span class="muted">${esc(MODES[f.mode]?.label || f.mode)}${f.lens ? ` · ${esc(f.lens)}` : ''} · since ${esc(f.lastSeen)}</span></div>
          <div class="follow-actions">
            ${n ? `<span class="badge new">${n} new</span>` : n === 0 ? '<span class="muted small">nothing new</span>' : ''}
            <button class="btn small" data-follow-run="${esc(f.id)}">Open newest</button>
            <button class="btn small" data-follow-del="${esc(f.id)}" title="Unfollow">✕</button>
          </div></div>`;
      }).join('')}
    </div>` : '';
}

function renderLibrary() {
  const all = store.liveItems(S.library);
  $('#lib-sub').textContent = `${plural(all.length, 'paper')} · stored in this browser${S.sync.state === 'on' ? ' and synced to your Google Drive' : ''}.`;
  const counts = Object.fromEntries(store.STATUSES.map((s) => [s, all.filter((p) => p.status === s).length]));
  $('#lib-status').innerHTML = ['all', ...store.STATUSES].map((s) =>
    `<button class="lens ${S.libStatus === s ? 'on' : ''}" data-libstatus="${s}">${s}<span class="lens-n">${s === 'all' ? all.length : counts[s]}</span></button>`).join('');
  renderFollows();
  const items = libraryList();
  $('#lib-results').innerHTML = items.length
    ? `<div class="cards">${items.map(card).join('')}</div>`
    : `<div class="empty small"><h2>${all.length ? 'No saved paper matches this filter.' : 'Your library is empty.'}</h2>
       <p>Press ${kbd('s')} on any result to keep it here with your notes, tags and reading status. Export to Zotero/Mendeley (RIS), LaTeX (BibTeX) or a spreadsheet (CSV) anytime.</p></div>`;
}

function renderView() {
  $('#view-search').hidden = S.view !== 'search';
  $('#view-library').hidden = S.view !== 'library';
  if (S.view === 'library') renderLibrary(); else renderResults();
  renderDetail();
  renderNavCounts();
  renderStatusbar();
}

function renderStatusbar() {
  const keys = S.view === 'library'
    ? [['j/k', 'move'], ['↵', 'details'], ['r', 'status'], ['n', 'note'], ['s', 'remove'], ['c', 'cite'], ['l', 'back'], ['?', 'help']]
    : [['/', 'search'], ['1 2 3', 'mode'], ['j/k', 'move'], ['↵', 'details'], ['u', 'Unpaywall'], ['h', 'Sci-Hub'], ['s', 'save'], ['l', 'library'], ['?', 'help']];
  $('#statusbar').innerHTML = keys.map(([k, v]) => `<span>${kbd(k)} ${v}</span>`).join('');
}

/** Move the selection and keep the card on screen. */
function select(i, { scroll = true } = {}) {
  const n = list().length;
  if (!n) return;
  S.sel = Math.max(0, Math.min(n - 1, i));
  const root = S.view === 'library' ? $('#lib-results') : $('#results');
  $$('.card.sel', root).forEach((c) => c.classList.remove('sel'));
  const el = $(`#card-${S.sel}`, root);
  el?.classList.add('sel');
  if (scroll) el?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  renderDetail();
  if (S.view === 'search' && S.sel >= S.results.length - 3 && hasMore() && !S.loading) search({ append: true });
}

/** Close the drawer; on wide screens also drop the selection (the pane follows it). */
function closeDetail() {
  S.detail = false;
  if (window.matchMedia('(min-width: 1100px)').matches) {
    S.sel = -1;
    $$('.card.sel').forEach((c) => c.classList.remove('sel'));
  }
  renderDetail();
}

function setView(v) {
  S.view = v;
  S.sel = v === 'library' && libraryList().length ? 0 : S.view === 'search' && S.results.length ? 0 : -1;
  S.detail = false;
  if (v === 'library') checkFollows();
  renderView();
}

function setMode(id) {
  if (!MODES[id]) return;
  const changed = id !== S.mode;
  S.mode = id;
  if (S.view !== 'search') setView('search');
  renderMode();
  if (changed && S.q) search({ raw: S.q });
  else renderResults();
  writeUrl();
}

function setLens(id) {
  if (!mode().lenses) return;
  S.lens[S.mode] = id;
  renderLenses();
  if (S.q) search({ raw: S.q });
  writeUrl();
}

function stepLens(delta) {
  const ls = mode().lenses;
  if (!ls) return;
  const i = ls.findIndex((l) => l.id === lensOf());
  setLens(ls[(i + delta + ls.length) % ls.length].id);
}

/* ═══ dialogs: palette, help, settings ═══════════════════════════════════ */

function paletteItems() {
  const q = $('#q').value.trim() || S.q;
  const items = [
    ...MODE_ORDER.map((id) => ({ label: `Mode: ${MODES[id].label}`, hint: MODES[id].key, run: () => setMode(id) })),
    { label: 'Open library', hint: 'l', run: () => setView('library') },
    { label: 'Follow / unfollow this search', hint: 'f', run: followCurrent },
    { label: 'Sync library with Google Drive', hint: 'S', run: () => syncNow() },
    { label: 'Export library · BibTeX', run: () => exportLib('bib') },
    { label: 'Export library · RIS (Zotero, Mendeley, EndNote)', run: () => exportLib('ris') },
    { label: 'Export library · CSV', run: () => exportLib('csv') },
    { label: 'Backup library · JSON', run: () => exportLib('json') },
    { label: 'Toggle theme', hint: 't', run: cycleTheme },
    { label: 'Settings', hint: ',', run: () => openSettings() },
    { label: 'Keyboard shortcuts', hint: '?', run: openHelp },
    ...ENGINES.map((e) => ({ label: `${e.name}${q ? ` — “${q}”` : ''}`, hint: `!${e.bang}`, group: 'engine', run: () => launch(e, q) })),
    ...S.history.slice(0, 10).map((h) => ({ label: `Recent: ${h.q}`, hint: MODES[h.mode]?.label, run: () => { setMode(h.mode); $('#q').value = h.q; search(); } })),
  ];
  return items;
}

function fuzzy(needle, hay) {
  needle = needle.toLowerCase(); hay = hay.toLowerCase();
  if (!needle) return 1;
  const idx = hay.indexOf(needle);
  if (idx >= 0) return 100 - idx;
  let j = 0;
  for (const ch of hay) if (ch === needle[j]) j++;
  return j === needle.length ? 1 : 0;
}

let palSel = 0;
let palFiltered = [];
function renderPalette() {
  const term = $('#pal-q').value;
  // "!…" narrows the palette to external engines, matched on bang or name.
  const engineOnly = term.startsWith('!');
  const t = engineOnly ? term.slice(1).trim() : term;
  palFiltered = paletteItems()
    .filter((it) => !engineOnly || it.group === 'engine')
    .map((it) => ({ it, s: Math.max(fuzzy(t, it.label), it.hint ? fuzzy(t, it.hint.replace(/^!/, '')) * 2 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 40)
    .map((x) => x.it);
  palSel = Math.min(palSel, Math.max(0, palFiltered.length - 1));
  $('#pal-list').innerHTML = palFiltered.map((it, i) =>
    `<li role="option" aria-selected="${i === palSel}" class="${i === palSel ? 'on' : ''}" data-pal="${i}"><span>${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</li>`).join('')
    || '<li class="muted">No match</li>';
  $('#pal-list .on')?.scrollIntoView({ block: 'nearest' });
}

function openPalette(prefill = '') {
  const d = $('#dlg-palette');
  $('#pal-q').value = prefill;
  palSel = 0;
  renderPalette();
  if (!d.open) d.showModal();
  $('#pal-q').focus();
}

function runPalette(i) {
  const it = palFiltered[i];
  $('#dlg-palette').close();
  it?.run();
}

function openHelp() {
  const rows = [
    ['Search', [['/', 'Focus the search box'], ['Enter', 'Search in-page'], ['⇧ Enter', 'Send query to the first site of this mode'], ['!bang', 'e.g. “sepsis !has” opens HAS — Tab completes'], ['↓ / Esc', 'Leave the box to navigate results'], ['↑ (empty box)', 'Recall your last search']]],
    ['Modes & filters', [['1 2 3', 'General · Medical · Thesis (Alt+1/2/3 from inside a box)'], ['[ ]', 'Evidence level: guidelines → SR/MA → RCT → reviews → all'], ['f', 'Follow this search (new papers appear in Library)'], ['e', 'Send the query to any of the external sites']]],
    ['Results', [['j / k', 'Next / previous'], ['g g / G', 'First / last'], ['Enter', 'Toggle details pane'], ['o', 'Open the record'], ['p', 'Free full text, when known'], ['u', 'Unpaywall — legal open-access copy'], ['h', 'Sci-Hub'], ['H', 'Sci-Hub on the next mirror (if one is down)'], ['m', 'Load more']]],
    ['Library', [['s', 'Save / remove'], ['n', 'Write a note'], ['r', 'Cycle status: to-read → reading → read'], ['c', 'Copy Vancouver citation'], ['b', 'Copy BibTeX'], ['l', 'Library ⇄ search'], ['S', 'Sync with Google Drive']]],
    ['Anywhere', [['Ctrl/⌘ K', 'Command palette'], ['t', 'Light / dark / auto theme'], [',', 'Settings'], ['?', 'This help'], ['Esc', 'Close whatever is open']]],
  ];
  $('#dlg-help').innerHTML = `<div class="dlg-head"><h2 id="help-title">Keyboard</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
    <p class="muted">Everything is reachable without a mouse. Keys work whenever you are not typing in a box.</p>
    <div class="help-grid">${rows.map(([title, keys]) => `<section><h3>${title}</h3><dl>${keys.map(([k, v]) => `<dt>${k.split(' / ').map(kbd).join(' / ')}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>`).join('')}</div>`;
  $('#dlg-help').showModal();
}

function openSettings(focus) {
  const s = S.settings;
  const d = $('#dlg-settings');
  d.innerHTML = `<div class="dlg-head"><h2 id="settings-title">Settings</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
    <form id="settings-form" class="settings">
      <fieldset><legend>General</legend>
        <label>Default mode <select name="defaultMode">${MODE_ORDER.map((m) => `<option value="${m}" ${s.defaultMode === m ? 'selected' : ''}>${MODES[m].label}</option>`).join('')}</select></label>
        <label>Theme <select name="theme">${['auto', 'light', 'dark'].map((t) => `<option ${s.theme === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" name="history" ${s.history ? 'checked' : ''}> Remember recent searches (this browser only)</label>
        <button type="button" class="btn small" data-cmd="clear-history">Clear recent searches</button>
      </fieldset>
      <fieldset><legend>Free access</legend>
        <label class="chk"><input type="checkbox" name="showScihub" ${s.showScihub ? 'checked' : ''}> Show the Sci-Hub button</label>
        <label>Sci-Hub mirror
          <input name="scihubMirror" list="scihub-mirrors" value="${esc(s.scihubMirror)}" placeholder="${esc(SCIHUB_MIRRORS[0])}">
          <datalist id="scihub-mirrors">${SCIHUB_MIRRORS.map((m) => `<option value="${m}">`).join('')}</datalist>
        </label>
        <p class="muted small">Pick a mirror or type another. Mirrors go up and down — <a href="${SCIHUB_STATUS_PAGE}" target="_blank" rel="noopener noreferrer">sci-hub.works</a> shows which ones work today (it is a list, not a mirror). ${kbd('⇧H')} on a paper tries the next mirror. Check what is legal where you live — Unpaywall only finds legal open-access copies.</p>
      </fieldset>
      <fieldset><legend>Better results (optional)</legend>
        <label>Email <input name="email" type="email" value="${esc(s.email)}" placeholder="you@example.org"></label>
        <p class="muted small">Sent only to Crossref/OpenAlex as a courtesy (“polite pool” — faster, more reliable).</p>
        <label>OpenAlex API key <input name="openalexKey" value="${esc(s.openalexKey)}" placeholder="free at openalex.org/settings/api"></label>
        <p class="muted small">Adds OpenAlex (250 M works, open-access links) to General and Thesis modes.</p>
      </fieldset>
      <fieldset id="sync-fieldset"><legend>Sync with Google (optional)</legend>
        <p class="muted small">Private by default: your library lives in this browser. Turn on sync to keep it in a hidden app folder of <b>your own</b> Google Drive and share it between devices. This site cannot read your other files; Google is not contacted until you press Connect.</p>
        <label>OAuth client ID <input name="googleClientId" value="${esc(s.googleClientId)}" placeholder="${CONFIG.googleClientId ? 'using this site’s default' : '…apps.googleusercontent.com'}"></label>
        <div class="d-actions">
          <button type="button" class="btn primary" data-cmd="sync">${gsync.isConnected() ? 'Sync now' : 'Connect & sync'}</button>
          ${gsync.isConnected() || s.syncEnabled ? '<button type="button" class="btn" data-cmd="sync-off">Turn off sync</button>' : ''}
        </div>
        <p class="muted small">${esc(S.sync.msg || '')}</p>
      </fieldset>
      <div class="d-actions end"><button class="btn primary" type="submit">Save</button></div>
    </form>`;
  d.showModal();
  if (focus === 'sync') $('#sync-fieldset input', d)?.focus();
}

function saveSettingsForm(form) {
  const f = new FormData(form);
  setSettings({
    defaultMode: f.get('defaultMode'),
    theme: f.get('theme'),
    history: f.has('history'),
    showScihub: f.has('showScihub'),
    scihubMirror: normalizeMirror(f.get('scihubMirror')),
    email: (f.get('email') || '').trim(),
    openalexKey: (f.get('openalexKey') || '').trim(),
    googleClientId: (f.get('googleClientId') || '').trim(),
  });
  applyTheme();
  renderMode();
  renderView();
  renderSyncPill();
  toast('Settings saved');
}

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  setSettings({ theme: order[(order.indexOf(S.settings.theme) + 1) % 3] });
  applyTheme();
  toast(`Theme: ${S.settings.theme}`);
}

/* ═══ export / import ════════════════════════════════════════════════════ */

function exportLib(fmt) {
  const items = store.liveItems(S.library);
  if (!items.length && fmt !== 'json') return toast('Library is empty');
  const stamp = todayISO();
  if (fmt === 'bib') download(`library-${stamp}.bib`, items.map(cite.bibtex).join('\n\n'), 'application/x-bibtex');
  if (fmt === 'ris') download(`library-${stamp}.ris`, items.map(cite.ris).join('\r\n'), 'application/x-research-info-systems');
  if (fmt === 'csv') download(`library-${stamp}.csv`, `﻿${cite.csv(items)}`, 'text/csv;charset=utf-8');
  if (fmt === 'json') download(`searchaio-backup-${stamp}.json`, JSON.stringify(S.library, null, 1), 'application/json');
}

async function importLib(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data.items) throw new Error('not a searchAIO backup');
    setLibrary(store.mergeLibraries(S.library, data));
    renderView();
    toast('Backup merged into your library');
  } catch (e) {
    toast(`Import failed: ${e.message}`, 'warn');
  }
}

/* ═══ actions on the selected paper ══════════════════════════════════════ */

function act(name, p = current()) {
  if (!p) return;
  switch (name) {
    case 'save': return toggleSave(p);
    case 'cite': return copy(cite.vancouver(p), 'Vancouver citation copied');
    case 'bibtex': return copy(cite.bibtex(p), 'BibTeX copied');
    case 'ris': return copy(cite.ris(p), 'RIS copied');
    case 'open': return openUrl(p.url);
    case 'free': return p.freeUrl ? openUrl(p.freeUrl) : act('unpaywall', p);
    case 'unpaywall': return unpaywallUrl(p) ? openUrl(unpaywallUrl(p)) : toast('No DOI — Unpaywall needs one');
    case 'scihub':
      if (!S.settings.showScihub) return toast('Sci-Hub button is off (Settings)');
      return scihubUrl(p) ? openUrl(scihubUrl(p)) : toast('No DOI or PMID for this record');
    case 'scihub-next': return scihubNextMirror(p);
    case 'detail':
      S.detail = !S.detail;
      return renderDetail();
    case 'note':
      S.detail = true;
      renderDetail();
      return $('#note')?.focus();
    case 'status': return cycleStatus(p);
  }
}

/* ═══ events ═════════════════════════════════════════════════════════════ */

function isTyping(el) {
  return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

let pendingG = 0;

function onKey(e) {
  // Dialogs own the keyboard while open.
  const pal = $('#dlg-palette');
  if (pal.open) {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { palSel = Math.min(palSel + 1, palFiltered.length - 1); renderPalette(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { palSel = Math.max(palSel - 1, 0); renderPalette(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); runPalette(palSel); }
    else if (e.key === 'Escape') { e.preventDefault(); pal.close(); }
    return;
  }
  const dlg = $('dialog[open]');
  if (dlg) {
    // Don't rely on the browser's built-in Esc handling (it can be skipped).
    if (e.key === 'Escape') { e.preventDefault(); dlg.close(); }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(); }
  if (e.altKey && MODE_ORDER.some((m) => MODES[m].key === e.key)) {
    e.preventDefault();
    return setMode(MODE_ORDER.find((m) => MODES[m].key === e.key));
  }

  let t = e.target;
  if (t.closest?.('dialog:not([open])')) { t.blur(); t = document.body; }
  if (t === $('#q')) return onSearchKey(e);
  if (isTyping(t)) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (pendingG && Date.now() - pendingG < 900) {
    pendingG = 0;
    if (e.key === 'g') return select(0);
    if (e.key === 'l') return setView('library');
    if (e.key === 's') return setView('search');
  }

  const k = e.key;
  const handled = {
    '/': () => { $('#q').focus(); $('#q').select(); },
    1: () => setMode('general'),
    2: () => setMode('medical'),
    3: () => setMode('thesis'),
    '[': () => stepLens(-1),
    ']': () => stepLens(1),
    j: () => select(S.sel + 1),
    ArrowDown: () => select(S.sel + 1),
    k: () => (S.sel <= 0 && S.view === 'search' ? $('#q').focus() : select(S.sel - 1)),
    ArrowUp: () => (S.sel <= 0 && S.view === 'search' ? $('#q').focus() : select(S.sel - 1)),
    G: () => select(list().length - 1),
    Home: () => select(0),
    End: () => select(list().length - 1),
    g: () => { pendingG = Date.now(); },
    Enter: () => act('detail'),
    o: () => act('open'),
    p: () => act('free'),
    u: () => act('unpaywall'),
    h: () => act('scihub'),
    H: () => act('scihub-next'),
    s: () => act('save'),
    c: () => act('cite'),
    b: () => act('bibtex'),
    n: () => act('note'),
    r: () => act('status'),
    m: () => hasMore() && !S.loading && search({ append: true }),
    f: () => followCurrent(),
    e: () => openPalette('!'),
    l: () => setView(S.view === 'library' ? 'search' : 'library'),
    S: () => syncNow(),
    t: () => cycleTheme(),
    ',': () => openSettings(),
    '?': () => openHelp(),
    Escape: () => {
      if (S.view === 'library' && !S.detail) setView('search');
      else closeDetail();
    },
  }[k];
  if (handled) {
    e.preventDefault();
    handled();
  }
}

function onSearchKey(e) {
  const input = e.target;
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    const bang = parseBang(input.value);
    if (bang) return launch(bang.engine, bang.query);
    const first = enginesForMode(S.mode)[0];
    if (first) launch(first, input.value);
    return;
  }
  if (e.key === 'Tab' && !e.shiftKey) {
    const last = input.value.split(/\s+/).pop() || '';
    if (/^![\w.-]*$/.test(last) && !engineByBang(last.slice(1))) {
      const hit = ENGINES.find((en) => en.bang.startsWith(last.slice(1).toLowerCase()));
      if (hit) {
        e.preventDefault();
        input.value = `${input.value.slice(0, input.value.length - last.length)}!${hit.bang} `;
        renderSearchHint();
      }
    }
    return;
  }
  if (e.key === 'ArrowDown' && list().length) {
    e.preventDefault();
    input.blur();
    return select(Math.max(0, S.sel));
  }
  if (e.key === 'ArrowUp' && !input.value && S.history[0]) {
    e.preventDefault();
    input.value = S.history[0].q;
    return renderSearchHint();
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (input.value && input.value !== S.q) input.value = S.q;
    else input.blur();
  }
}

function onClick(e) {
  const t = e.target.closest('[data-mode],[data-lens],[data-bang],[data-cmd],[data-act],[data-recent],[data-libstatus],[data-follow-run],[data-follow-del],[data-pal],[data-close],.card');
  if (!t) return;
  const d = t.dataset;
  if (d.close !== undefined) return t.closest('dialog').close();
  if (d.mode) return setMode(d.mode);
  if (d.lens) return setLens(d.lens);
  if (d.bang) return launch(engineByBang(d.bang), $('#q').value || S.q);
  if (d.recent) { $('#q').value = d.recent; return search(); }
  if (d.libstatus) { S.libStatus = d.libstatus; S.sel = 0; return renderView(); }
  if (d.followRun) return runFollow(d.followRun);
  if (d.followDel) { setLibrary(store.removeFollow(S.library, d.followDel)); return renderFollows(); }
  if (d.pal) return runPalette(Number(d.pal));
  if (d.act) {
    const card = t.closest('.card');
    if (card) select(Number(card.dataset.i), { scroll: false });
    return act(d.act);
  }
  if (d.cmd) {
    return ({
      library: () => setView(S.view === 'library' ? 'search' : 'library'),
      settings: () => openSettings(),
      help: openHelp,
      palette: () => openPalette(),
      'palette-engines': () => openPalette('!'),
      sync: () => syncNow(),
      'sync-off': disconnectSync,
      more: () => search({ append: true }),
      follow: followCurrent,
      'close-detail': closeDetail,
      'export-bib': () => exportLib('bib'),
      'export-ris': () => exportLib('ris'),
      'export-csv': () => exportLib('csv'),
      'export-json': () => exportLib('json'),
      'import-json': () => $('#import-file').click(),
      'clear-history': () => { store.clearHistory(); S.history = []; toast('Recent searches cleared'); },
    }[d.cmd] || (() => {}))();
  }
  // plain click on a card selects it (links inside still open normally)
  if (t.classList.contains('card')) select(Number(d.i), { scroll: false });
}

function bind() {
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onClick);
  // Enter hands the keyboard to the results: j/k, s, u, h… work at once; `/` comes back.
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); $('#q').blur(); search(); });
  $('#q').addEventListener('input', renderSearchHint);
  for (const id of ['#f-from', '#f-to', '#f-free', '#f-sort', '#f-health']) {
    $(id).addEventListener('change', () => {
      if (!S.q) return;
      search({ raw: S.q });
    });
  }
  $('#lib-q').addEventListener('input', (e) => { S.libQ = e.target.value; S.sel = 0; renderLibrary(); renderDetail(); });
  $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) importLib(e.target.files[0]); e.target.value = ''; });
  $('#pal-q').addEventListener('input', () => { palSel = 0; renderPalette(); });
  $('#dlg-settings').addEventListener('submit', (e) => {
    if (e.target.id !== 'settings-form') return;
    e.preventDefault();
    saveSettingsForm(e.target);
    $('#dlg-settings').close();
  });
  for (const d of $$('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // click backdrop
    // Hand the keyboard back to the page, or the next shortcut lands in the closed dialog.
    d.addEventListener('close', () => { if (d.contains(document.activeElement)) document.activeElement.blur(); });
  }

  // Notes / tags / status edit the selected paper (and save it on first keystroke).
  const notesHost = (e, p = current()) => {
    if (!p) return;
    if (e.target.id === 'note') setLibrary(store.savePaper(S.library, p, { note: e.target.value }));
    if (e.target.id === 'tags') setLibrary(store.savePaper(S.library, p, { tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }));
    if (e.target.id === 'status') { setLibrary(store.savePaper(S.library, p, { status: e.target.value })); renderView(); }
  };
  const saveDebounced = debounce(notesHost, 350);
  for (const pane of ['#detail', '#lib-detail']) {
    $(pane).addEventListener('input', (e) => { if (e.target.id === 'note' || e.target.id === 'tags') saveDebounced(e, current()); });
    $(pane).addEventListener('change', (e) => {
      if (e.target.id === 'status') notesHost(e);
      if (e.target.id === 'note' || e.target.id === 'tags') {
        notesHost(e);
        // refresh the card so the ★ badge appears, without stealing focus
        const el = $(`#card-${S.sel}`, S.view === 'library' ? $('#lib-results') : $('#results'));
        if (el) { el.outerHTML = card(current(), S.sel); }
      }
    });
  }

  window.addEventListener('popstate', () => {
    const q = readUrl();
    $('#q').value = q;
    renderMode();
    if (q) search({ raw: q }); else { S.q = ''; S.results = []; renderResults(); }
  });
  window.addEventListener('storage', (e) => {
    // another tab changed the library → stay consistent
    if (e.key === 'saio2.library') { S.library = store.loadLibrary(); renderView(); }
  });
  window.matchMedia('(min-width: 1100px)').addEventListener('change', renderDetail);
}

/* ═══ boot ═══════════════════════════════════════════════════════════════ */

function boot() {
  const q = readUrl();
  applyTheme();
  bind();
  renderMode();
  renderView();
  renderSyncPill();
  if (q) {
    $('#q').value = q;
    search();
  } else {
    $('#q').focus();
  }
  // Stay-up-to-date check runs at most once a day, quietly.
  const last = localStorage.getItem('saio2.followCheck');
  if (store.liveFollows(S.library).length && last !== todayISO()) {
    try { localStorage.setItem('saio2.followCheck', todayISO()); } catch { /* private mode */ }
    setTimeout(checkFollows, 1500);
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();

// Exposed for debugging in the console: `saio.state`
window.saio = { state: S };
