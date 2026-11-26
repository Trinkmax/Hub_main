/**
 * Notificaciones push desde el navegador: saber si este equipo puede, anotarlo y darlo de baja.
 * Solo se llama desde componentes de cliente (toca `navigator` y `Notification`).
 */

/**
 * supported = puede recibir · needs-install = es un iPhone/iPad que todavía no instaló la app (ahí las
 * notificaciones andan solo desde la app en la pantalla de inicio) · unsupported = este navegador no puede.
 */
export type PushSupport = 'supported' | 'needs-install' | 'unsupported'

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  const has =
    'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'
  if (has) return 'supported'
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return ios ? 'needs-install' : 'unsupported'
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/** Lo que se guarda de una suscripción: a dónde mandar y con qué claves cifrar. */
export type PushKeys = { endpoint: string; p256dh: string; auth: string }

function toBase64Url(buffer: ArrayBuffer | null): string | null {
  if (!buffer) return null
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function pushKeys(subscription: PushSubscription): PushKeys | null {
  const p256dh = toBase64Url(subscription.getKey('p256dh'))
  const auth = toBase64Url(subscription.getKey('auth'))
  if (!p256dh || !auth) return null
  return { endpoint: subscription.endpoint, p256dh, auth }
}

/** El service worker del salón, registrado si todavía no lo estaba (en desarrollo no se registra solo). */
async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  const active = existing ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/' }))
  await navigator.serviceWorker.ready
  return active
}

/** La suscripción que ya tiene este navegador, si tiene. No pide permiso ni registra nada. */
export async function currentPush(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'supported') return null
  try {
    const existing = await navigator.serviceWorker.getRegistration('/')
    return (await existing?.pushManager.getSubscription()) ?? null
  } catch {
    return null
  }
}

/**
 * Pedir permiso (tiene que venir de un toque) y anotar este navegador. Si ya estaba anotado con otra
 * clave del servidor, se vuelve a anotar con la vigente.
 */
export async function subscribePush(
  publicKey: string,
): Promise<
  { ok: true; keys: PushKeys } | { ok: false; reason: 'denied' | 'unsupported' | 'failed' }
> {
  if (pushSupport() !== 'supported') return { ok: false, reason: 'unsupported' }
  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission
  if (permission !== 'granted') return { ok: false, reason: 'denied' }
  try {
    const worker = await registration()
    const key = fromBase64Url(publicKey)
    let subscription = await worker.pushManager.getSubscription()
    const current = toBase64Url(subscription?.options.applicationServerKey ?? null)
    if (subscription && current !== publicKey) {
      await subscription.unsubscribe()
      subscription = null
    }
    subscription ??= await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    })
    const keys = pushKeys(subscription)
    return keys ? { ok: true, keys } : { ok: false, reason: 'failed' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

/** Dejar de recibir en este navegador. Devuelve el endpoint que tenía, para darlo de baja en la base. */
export async function unsubscribePush(): Promise<string | null> {
  const subscription = await currentPush()
  if (!subscription) return null
  const { endpoint } = subscription
  try {
    await subscription.unsubscribe()
  } catch {
    // El navegador no lo soltó: igual se da de baja en la base, que es lo que corta los envíos.
  }
  return endpoint
}

/** Una notificación de prueba, armada acá mismo: sirve para ver cómo suena y vibra este equipo. */
export async function showLocalNotice(
  title: string,
  body: string,
  vibrate: number[],
): Promise<boolean> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return false
  try {
    const worker = await registration()
    await worker.showNotification(title, {
      body,
      tag: 'hub-prueba',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // `vibrate` no está en los tipos de TypeScript, pero los navegadores de Android lo respetan.
      ...({ vibrate, renotify: true } as object),
    })
    return true
  } catch {
    return false
  }
}
