const offlineCache = 'planning-beaute-offline-v1'
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(offlineCache).then((cache) => cache.add('/offline.html')),
  )
})
self.addEventListener('fetch', (event) => {
  if (
    event.request.mode === 'navigate' &&
    new URL(event.request.url).origin === self.location.origin
  ) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/offline.html')),
    )
  }
})
