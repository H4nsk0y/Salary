const CACHE_NAME = 'salary-calc-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/app.js',
  '/calc.js',
  '/storage.js',
  '/manifest.json',
  // Если есть иконки, тоже добавить
  '/icon-192.png',
  '/icon-512.png'
];

// Установка service worker и кеширование ресурсов
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Перехват запросов и возврат из кеша, если есть
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Если ресурс есть в кеше, возвращаем его
        if (response) {
          return response;
        }
        // Иначе делаем обычный fetch
        return fetch(event.request);
      })
  );
});

// Очистка старых кешей при активации новой версии
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheWhitelist.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});