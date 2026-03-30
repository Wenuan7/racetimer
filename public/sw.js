// 使用「网络优先」避免缓存旧 index.html 引用的旧 JS 哈希，导致白屏
const CACHE_NAME = 'kart-endurance-mvp-v4'

self.addEventListener('install', (event) => {
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
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) =>
            cache.put(event.request, copy).catch(() => {}),
          )
        }
        return response
      })
      .catch(() => caches.match(event.request)),
  )
})
