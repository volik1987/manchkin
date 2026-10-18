/*
 * Офлайн-режим. После первого открытия игра работает без интернета.
 * ВАЖНО: при каждом обновлении игры меняй VERSION — иначе у игроков останется старая версия.
 */
const VERSION = 'v1.0.0';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/cards.js', 'js/engine.js', 'js/ui.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сначала сеть (чтобы приходили обновления), без сети — из кэша.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
