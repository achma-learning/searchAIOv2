# searchAIO · med (v2)

A keyboard-driven search tool for medicine. It is built for **MD students preparing their thesis**, and it stays useful afterwards for **clinicians keeping up to date** and for **researchers and professors**.

It is private by default. There's no account, no tracking and no server of ours. Your library stays in your browser unless you turn on Google Drive sync.

---

## Three search modes

| Key | Mode | What answers in the page | Sites one keystroke away |
|---|---|---|---|
| `1` | **General** | Crossref (≈150 M records, every discipline), plus OpenAlex if you add a free key | Google, DuckDuckGo, Scholar, Semantic Scholar, Wikipedia, Perplexity, CORE, DOAJ, arXiv… |
| `2` | **Medical** *(default)* | Europe PMC (all of PubMed, PMC and preprints), starting with **guidelines and statements from learned societies and recognised bodies** | PubMed, Trip, Cochrane, HAS, NICE, WHO IRIS, CISMeF, ESC, Min. Santé Maroc… |
| `3` | **Thesis** | DUMAS/HAL (French MD *thèses d'exercice*, usually with the PDF) and theses.fr (doctoral theses, with supervisor) | Toubkal (Maroc), FMPM theses, CISMeF thèses, SUDOC, OATD… |

### Evidence pyramid lenses (Medical mode)

Use `[` and `]` to move between the levels: **Guidelines & statements → Systematic reviews / meta-analyses → RCTs → Narrative reviews → Everything**. Each level shows how many hits it has for your query, so you can see at a glance how much evidence of each kind exists.

### Read the full text, legally or not

Every result with a DOI has two buttons:

- **Unpaywall** (`u`) sends you to a legal open-access copy of the same paper (author manuscript, repository or publisher OA) when one exists.
- **Sci-Hub** (`h`) opens the paper at `<mirror>/<DOI or PMID>` on the mirror set in Settings (default `https://sci-hub.ru`). If a mirror is down, **`⇧H`** opens the same paper on the next mirror in the list, and **`⇧D`** keeps that mirror as your default.
  - **The default switches automatically.** Once a day, and only if you have used Sci-Hub, the app checks whether your mirror still answers. If it doesn't, the first working mirror in the list becomes your default and a short message tells you. *Settings → Check mirrors now* shows every mirror's status. A mirror can answer and still show a captcha instead of the paper; the check can't see that, so the list is ordered by which mirrors actually served papers when tested. [sci-hub.works](https://sci-hub.works) is a *status page* that lists working mirrors; it isn't a mirror itself, so it can't open papers. The app replaces it automatically if it is set. You can pick another mirror or hide the button in Settings. *Whether using Sci-Hub is legal depends on your country, and that responsibility is yours.*
- **Legal free copies are marked before you click.** Add your email in Settings and the app asks Unpaywall about every result that has a DOI. A green **Free PDF / Free full text** button (`p`) then appears wherever a free copy exists; hover it to see where the copy comes from (repository or publisher, which version, which license). PMC articles and DUMAS PDFs get the button without any setup. Unpaywall receives the DOIs of your results, not your search words, and nothing is sent until you set an email.
- **Anna's Archive** (`a`) opens the paper on Anna's Archive at `/scidb/<DOI>`. It's a fallback for when Sci-Hub doesn't have the paper, and it shows or hides together with the Sci-Hub button. **`⇧A`** opens the same paper on the next domain and `⇧D` keeps it. The default is `annas-archive.gd`, followed by `.gl` and `.pk`, the official domains the site lists itself. Anna's Archive domains are switched automatically like Sci-Hub mirrors, with one difference: the app **verifies** them through the archive's own CORS-enabled health check (`/dyn/up/`). A parked domain such as today's `.li` answers but fails that check, so the app moves past it.
- **Books by ISBN.** Type a textbook's ISBN (e.g. `978-0-07-180215-4`). `Enter` opens it on Anna's Archive (`/isbn/<isbn>`), and `⇧Enter` opens it on Open Library, where loans are legal. Launchers: `!annab` (nonfiction PDFs), `!annafr` (French-language books), `!annaj` (journal articles only), `!anna` (everything), `!ol` (Open Library). The Anna's launchers use whichever domain you have chosen.
- The Anna's Archive features follow its [open-source code](https://software.annas-archive.gl/AnnaArchivist/annas-archive): the routes and search parameters come from `allthethings/page/views.py` and `search.py`. Its JSON record APIs need a paid membership key, so the app doesn't use them.

---

## Keyboard

Every action has a key. Single-letter keys work whenever you are not typing in a box.

| | |
|---|---|
| `/` | focus search · `Enter` search · `⇧ Enter` send the query to the mode's first site |
| `!bang` | `sepsis !has` opens HAS, `!pm` PubMed, `!toubkal` Toubkal (`Tab` completes, `e` lists all) |
| `1` `2` `3` | General · Medical · Thesis (`Alt+1/2/3` from inside a box) |
| `[` `]` | evidence level |
| `j` `k` / `↓` `↑` | move through results · `gg` / `G` first / last · `m` load more |
| `Enter` | details pane (abstract, citation, notes) |
| `o` `p` `u` `h` `H` `a` `A` `D` | open record · free full text · Unpaywall · Sci-Hub · Sci-Hub next mirror · Anna's Archive · Anna's next domain · keep the mirror just tried |
| `s` `n` `r` | save · note · reading status (to-read → reading → read) |
| `c` `b` | copy Vancouver citation · copy BibTeX |
| `f` | follow this search, so new papers show up in the Library |
| `l` | Library ⇄ search · `S` sync · `Ctrl/⌘ K` command palette · `?` help · `t` theme |

Searches are URLs (`?mode=thesis&q=…`), so you can bookmark them, share them, or **add the tool as a browser search engine** with the template `https://<your-site>/?q=%s`.

---

## Library: built for a thesis, still useful afterwards

- Save with `s`. Each saved paper can have a **note**, **tags** and a **reading status**.
- Export to **RIS** (Zotero, Mendeley, EndNote), **BibTeX** (LaTeX), **CSV** (spreadsheet) or a **JSON backup**. Import merges a backup into your library without overwriting it.
- **Followed searches** (`f`) are for staying up to date after the diploma. Once a day the app counts papers published since you last looked (Medical mode) and puts a dot on *Library* when something is new.

## Privacy and optional Google sync

- By default everything (library, notes, history, settings) is stored in your browser's `localStorage`. Search queries go only to the source you are searching. The page sends `no-referrer` and loads no fonts, analytics or trackers.
- **Sync with Google is opt-in.** Google's script is loaded only when you click *Connect*. Sync uses the `drive.appdata` scope, which is a hidden app folder in **your own** Drive: the site cannot see any of your other files. The token is kept in memory only. When two devices change the library, the merge keeps the newest edit of each paper, and deletions sync too because they are kept as tombstones.

To enable sync on your deployment:

1. In [Google Cloud Console](https://console.cloud.google.com), enable the **Google Drive API**.
2. Under Credentials, choose **Create OAuth client ID → Web application** and add your site origin (e.g. `https://<user>.github.io`) to *Authorized JavaScript origins*.
3. On the OAuth consent screen, add the scope `…/auth/drive.appdata`.
4. Put the client ID in [`config.js`](./config.js). It is safe to commit because a client ID is public. Each user can also paste their own ID in Settings → Sync.

---

## Run it

There is no build step and there are no dependencies. Because ES modules need `http://`, you can't open the file directly with `file://`.

```bash
python3 -m http.server 8000      # then open http://localhost:8000
npm test                         # unit tests (Node ≥ 20, no install needed)
```

**Deploy:** enable GitHub Pages on `main` / root and the site works as is. It is also an installable PWA: the app shell works offline, and only searches need the network.

## How it works

```
index.html            page skeleton (dialogs, regions)
css/app.css           one stylesheet, light/dark, system fonts
config.js             deploy-time config (Google client ID)
js/main.js            state → render functions → one keyboard layer
js/modes.js           the 3 modes: which sources answer, which lenses exist
js/engines.js         external sites + !bangs ({q} URL templates)
js/sources/*.js       one adapter per open API → common "paper" shape
js/cite.js            Vancouver, BibTeX, RIS, CSV
js/access.js          Unpaywall + Sci-Hub links, mirror list
js/store.js           local-first library, merge, follows, settings
js/sync-google.js     optional Drive appData sync
sw.js                 offline app shell
tests/                node:test unit tests of all pure logic
```

Every source adapter returns the same shape: `{ id, title, authors, year, venue, doi, pmid, abstract, badges, url, freeUrl, … }`. The `id` is built from the DOI when there is one, so a paper found by two sources is shown and saved only once. When a mode has several sources, they run in parallel and their result lists are **interleaved by rank** (each source's #1, then each #2, and so on), so no source drowns out the others.

**Add an external site:** add one line to `ENGINES` in `js/engines.js`. The test suite checks that bangs are unique and that every URL contains `{q}`.
**Add an API:** write `js/sources/<name>.js` exporting `{ id, label, supports, search() }` and list it in a mode in `js/modes.js`.

## What v2 changes from the two earlier projects

| | [achma-learning/searchAIO](https://github.com/achma-learning/searchAIO) | [maa384/searchAIO](https://github.com/maa384/searchAIO) | **v2** |
|---|---|---|---|
| Idea | a 6 000-line single-file *launcher*: prefix/!bang → opens 55+ sites | a React/Supabase *workspace*: Europe PMC results, save, notes | **both**: in-page results from open APIs and one-keystroke launching to sites without an API |
| Results in page | no | Europe PMC only | Europe PMC, Crossref, HAL/DUMAS, theses.fr, OpenAlex |
| Thesis search | links only | no | real results with supervisor and PDF, plus Moroccan sources as launchers |
| Evidence level | no | one type filter | guideline → SR/MA → RCT → review lenses with live counts |
| Free access | no | no | Unpaywall, Sci-Hub, direct PMC/DUMAS PDF |
| Keyboard | search box only | none | whole app (vim-style + palette) |
| Saved data | none | localStorage | localStorage + optional Drive sync + RIS/BibTeX/CSV + follows |
| Stack | no build, but one huge file | ~60 npm deps, vendor-locked builder | no build, no deps, small modules, unit-tested, CI |

## Roadmap ideas

- French/Arabic interface strings (the UI is English for now; queries work in any language).
- PRISMA screening mode: include/exclude reasons and counts for systematic-review theses.
- Moroccan thesis repositories, if any of them publishes an open API.

## License

No license has been chosen yet. Add one (the original searchAIO uses MIT) before inviting outside contributions.
