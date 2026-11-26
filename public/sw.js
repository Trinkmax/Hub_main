// HUB! Salón service worker — cache app shell + assets, network-first for HTML.
// Mutations (POST/PUT/DELETE) NEVER se cachean (queremos avoid stale state).
//
// v3: las páginas guardadas se borran cuando la sesión termina. Traen nombres de clientes (las reservas
// del día, el socio de una mesa) y quedaban a la vista, sin conexión, de quien agarrara después un
// teléfono compartido. Cambiar la versión también limpia lo que ya estaba guardado.
//
// v4: notificaciones push. Cuando una estación empieza o termina lo de una mesa, a quien la atiende le
// llega un aviso aunque tenga la app cerrada o el celular bloqueado (lo manda /api/cron/pos-push).

const VERSION = 'hub-salon-v5'
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

// ── Notificaciones push ──────────────────────────────────────────────────────
// El servidor manda el aviso ya armado: { title, body, tag, strong, vibrate, url }. Acá solo se muestra.
// Con la app a la vista suena y vibra ella (es más rica que la notificación): esta va en silencio.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    const parsed = event.data ? event.data.json() : null
    // Un cuerpo que no es un objeto (o `null`) se trata como vacío: igual se muestra un aviso.
    if (parsed && typeof parsed === 'object') data = parsed
  } catch {
    data = {}
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'HUB! Salón'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // «A la vista» es el salón abierto y adelante: es la única parte de la app que suena por su cuenta.
      // Con otra pantalla abierta (la carta, el panel) la notificación avisa completa. En el iPhone la app
      // no puede vibrar (Apple no deja) y su sonido se calla con la tecla de silencio: ahí la notificación
      // avisa completa siempre, que es la única que hace vibrar el teléfono.
      const iPhone = /iPhone|iPad|iPod/.test(self.navigator.userAgent || '')
      const watching =
        !iPhone &&
        windows.some((client) => {
          if (client.visibilityState !== 'visible') return false
          try {
            return /\/salon(\/|$)/.test(new URL(client.url).pathname)
          } catch {
            return false
          }
        })
      await self.registration.showNotification(title, {
        body: typeof data.body === 'string' ? data.body : '',
        // Un aviso nuevo de la misma mesa y estación reemplaza al anterior, y vuelve a avisar.
        tag: typeof data.tag === 'string' ? data.tag : undefined,
        renotify: typeof data.tag === 'string',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        silent: watching,
        vibrate: watching || !Array.isArray(data.vibrate) ? undefined : data.vibrate,
        // Lo que hay que ir a buscar queda en pantalla hasta que alguien lo toca.
        requireInteraction: data.strong === true,
        timestamp: Date.now(),
        data: { url: typeof data.url === 'string' ? data.url : '/' },
      })
    })(),
  )
})

// Tocar el aviso lleva a la mesa: en la app si ya está abierta; si no, la abre.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url
  // Solo direcciones de esta misma app.
  // «//otro.sitio» también empieza con barra y saldría de la app: no vale.
  const url =
    typeof target === 'string' && target.startsWith('/') && !target.startsWith('//') ? target : '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const mine = windows.filter((client) => client.url.startsWith(self.location.origin))
      // Mejor la ventana del salón que cualquier otra de la app (la tele de cocina, el panel).
      const isSalon = (client) => {
        try {
          const path = new URL(client.url).pathname
          return /\/salon(\/|$)/.test(path) && !/\/salon\/tele(\/|$)/.test(path)
        } catch {
          return false
        }
      }
      const open =
        mine.find(isSalon) ?? mine.find((client) => !/\/salon\/tele(\/|$)/.test(client.url))
      if (open) {
        await open.focus()
        if ('navigate' in open) {
          try {
            await open.navigate(url)
          } catch {
            // La pestaña no se deja mover (está en otra página de la app): queda adelante igual.
          }
        }
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
