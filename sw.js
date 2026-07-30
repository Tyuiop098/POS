/* =========================================================
   Service Worker — POS Mart PWA
   Cache-first for app shell, network-first for Firebase
   ========================================================= */
const CACHE = 'posmart-v1';
const SHELL = [
  './',
  './index.html',
  './cashier.html',
  './scanner.html',
  './style.css',
  './app.js',
  './cashier.js',
  './scanner.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Firebase & external: network only
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('unpkg') ||
      url.hostname.includes('googleapis')) {
    return;
  }
  // App shell: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
