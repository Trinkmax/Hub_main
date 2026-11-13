// HUB! Salón service worker — cache app shell + assets, network-first for HTML.
// Mutations (POST/PUT/DELETE) NEVER se cachean (queremos avoid stale state).
//
// v3: las páginas guardadas se borran cuando la sesión termina. Traen nombres de clientes (las reservas
// del día, el socio de una mesa) y quedaban a la vista, sin conexión, de quien agarrara después un
// teléfono compartido. Cambiar la versión también limpia lo que ya estaba guardado.

const VERSION = 'hub-salon-v3'
const SHELL_CACHE = `${VERSION}-shell`
const ASSETS_CACHE = `${VERSION}-assets`

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(SHELL_CACHE))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Solo GET. POST/PUT/DELETE pasan derecho al network — UI muestra
  // toast offline si falla.
  if (request.method !== 'GET') return

  // Skip extensiones, chrome-extension, etc.
  if (!request.url.startsWith(self.location.origin)) return

  const url = new URL(request.url)

  // Llegar a la pantalla de entrar quiere decir que la sesión terminó (alguien salió, o venció): lo
  // guardado ya no es de quien entre después. Se borra, y esa pantalla pasa derecho a la red.
  if (url.pathname === '/login' || url.pathname.startsWith('/login/')) {
    event.waitUntil(caches.delete(SHELL_CACHE))
    return
  }

  // Static assets de Next: cache-first, vida larga.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, ASSETS_CACHE))
    return
  }

  // HTML / Server actions: network-first con cache fallback (cuando hay) para offline view.
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request, SHELL_CACHE))
    return
  }
})

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const fresh = await fetch(request)
    if (fresh.ok) cache.put(request, fresh.clone())
    return fresh
  } catch (error) {
    if (cached) return cached
    throw error
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const fresh = await fetch(request)
    // Una respuesta que llegó después de una redirección es otra página (la de entrar, por ejemplo):
    // no se guarda bajo la dirección que se pidió.
    if (fresh.ok && !fresh.redirected) cache.put(request, fresh.clone())
    return fresh
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw error
  }
}
