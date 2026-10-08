// Citations & exports. Vancouver is the default: it is what medical theses
// and most medical journals (ICMJE) expect.

const initials = (given) =>
  String(given || '').split(/[\s-]+/).filter(Boolean).map((p) => p[0].toUpperCase()).join('');

/** "Jean-Pierre Dupont" → "Dupont JP"; already-Vancouver names pass through. */
export function vancouverName(full) {
  const s = String(full || '').trim().replace(/\.$/, '');
  if (!s) return '';
  if (s.includes(',')) {
    const [family, given] = s.split(',').map((x) => x.trim());
    return `${family} ${initials(given)}`.trim();
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  // "Dupont JP" style (initials last, all caps, ≤3 letters) is already Vancouver.
  if (/^[A-Z]{1,3}$/.test(last)) return s;
  return `${last} ${initials(parts.slice(0, -1).join(' '))}`;
}

export function vancouver(p) {
  const names = (p.authors || []).map(vancouverName).filter(Boolean);
  const authors = names.length > 6 ? `${names.slice(0, 6).join(', ')}, et al` : names.join(', ');
  const title = String(p.title || '').replace(/[.\s]+$/, '');
  let out = authors ? `${authors}. ${title}. ` : `${title}. `;
  if (p.kind === 'thesis') {
    out += `[Thesis]. ${p.venue ? `${p.venue}; ` : ''}${p.year || ''}.`;
  } else {
    out += p.venue ? `${p.venue}. ` : '';
    out += `${p.year || ''}`;
    if (p.volume) out += `;${p.volume}${p.issue ? `(${p.issue})` : ''}`;
    if (p.pages) out += `:${p.pages}`;
    out += '.';
  }
  if (p.doi) out += ` doi:${p.doi}`;
  if (p.pmid) out += ` PMID: ${p.pmid}.`;
  return out.replace(/\s+/g, ' ').trim();
}

const bibEscape = (s) => String(s ?? '').replace(/[{}]/g, '');

export function bibtexKey(p) {
  const first = String((p.authors || [])[0] || 'anon');
  const family = first.includes(',') ? first.split(',')[0] : vancouverName(first).split(' ')[0];
  const word = String(p.title || '').toLowerCase().match(/[a-zà-ÿ]{4,}/)?.[0] || 'paper';
  return `${family}${p.year || ''}${word}`.normalize('NFD').replace(/[^\w]/g, '').toLowerCase();
}

export function bibtex(p) {
  const type = p.kind === 'thesis' ? 'phdthesis' : 'article';
  const fields = [
    ['title', p.title],
    ['author', (p.authors || []).join(' and ')],
    [p.kind === 'thesis' ? 'school' : 'journal', p.venue],
    ['year', p.year],
    ['volume', p.volume],
    ['number', p.issue],
    ['pages', p.pages],
    ['doi', p.doi],
    ['pmid', p.pmid],
    ['url', p.url],
    ['note', p.note],
  ].filter(([, v]) => v);
  return `@${type}{${bibtexKey(p)},\n${fields.map(([k, v]) => `  ${k} = {${bibEscape(v)}}`).join(',\n')}\n}`;
}

/** RIS — imports cleanly into Zotero, Mendeley, EndNote. */
export function ris(p) {
  const lines = [['TY', p.kind === 'thesis' ? 'THES' : 'JOUR'], ['TI', p.title]];
  for (const a of p.authors || []) lines.push(['AU', a]);
  if (p.venue) lines.push([p.kind === 'thesis' ? 'PB' : 'JO', p.venue]);
  if (p.year) lines.push(['PY', p.year]);
  if (p.volume) lines.push(['VL', p.volume]);
  if (p.issue) lines.push(['IS', p.issue]);
  if (p.pages) {
    const [sp, ep] = String(p.pages).split('-');
    lines.push(['SP', sp]);
    if (ep) lines.push(['EP', ep]);
  }
  if (p.doi) lines.push(['DO', p.doi]);
  if (p.url) lines.push(['UR', p.url]);
  if (p.abstract) lines.push(['AB', p.abstract.replace(/\s+/g, ' ')]);
  for (const k of p.tags || []) lines.push(['KW', k]);
  if (p.note) lines.push(['N1', p.note]);
  lines.push(['ER', '']);
  return lines.map(([k, v]) => `${k}  - ${v}`).join('\r\n');
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function csv(items) {
  const cols = ['title', 'authors', 'year', 'venue', 'doi', 'pmid', 'url', 'status', 'tags', 'note'];
  const rows = items.map((p) => cols.map((c) => csvCell(Array.isArray(p[c]) ? p[c].join('; ') : p[c])).join(','));
  return [cols.join(','), ...rows].join('\n');
}
