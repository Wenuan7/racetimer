const CACHE_NAME = 'kart-endurance-mvp-v2'

self.addEventListener('install', (event) => {
  const base = self.registration.scope
  const urls = [
    base,
    new URL('index.html', base).href,
    new URL('manifest.webmanifest', base).href,
    new URL('favicon.svg', base).href,
  ]
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(urls)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key)
          }
          return Promise.resolve()
        }),
      )
    }),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached
      }
      return fetch(event.request)
    }),
  )
})
