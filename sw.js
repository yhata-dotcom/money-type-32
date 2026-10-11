/* オフライン対策：ネット優先（3秒で諦める）、つながらなければ保存しておいた版を出す */
const CACHE = 'mt32-v1';
const ASSETS = ['./', './index.html', './style.css?v=1', './data.js?v=1', './emblems.js?v=1', './app.js?v=1',
  './assets/qrcode.js?v=1', './assets/emblem.png', './assets/apple-touch-icon.png', './assets/icon-192.png', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(req, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const page = await cache.match('./');
        if (page) return page;
      }
      throw err;
    }
  })());
});
