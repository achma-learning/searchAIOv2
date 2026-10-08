// Offline app shell. API calls always go to the network (results must be fresh);
// the app itself loads instantly and works offline for your saved library.
const CACHE = 'saio2-v6';
const SHELL = [
  './', 'index.html', 'config.js', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/main.js', 'js/modes.js', 'js/engines.js', 'js/store.js', 'js/cite.js', 'js/util.js', 'js/access.js', 'js/sync-google.js',
  'js/sources/europepmc.js', 'js/sources/crossref.js', 'js/sources/hal.js', 'js/sources/thesesfr.js', 'js/sources/openalex.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Same-origin files: network first (so updates land), cache as fallback.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
