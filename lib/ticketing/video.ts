/**
 * El video de una película: un link de YouTube como lo pega el dueño (pedido
 * de Nacho Badra, 02/11/2026: «necesito insertar el Short que explica cómo es
 * la experiencia»). Puro: sirve en el panel (validar) y en la página (mostrar).
 */

const ID = /^[A-Za-z0-9_-]{11}$/

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
])

/**
 * El id del video, o `null` si no es un link de YouTube que se entienda.
 * Acepta shorts/…, watch?v=…, youtu.be/…, embed/… y live/…, con o sin
 * `https://` y con los parámetros que agrega «Compartir» (`?si=…`).
 */
export function youtubeVideoId(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  if (!HOSTS.has(host)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  let id: string | null | undefined = null
  if (host === 'youtu.be') {
    id = parts[0]
  } else if (parts[0] === 'watch') {
    id = url.searchParams.get('v')
  } else if (parts[0] && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) {
    id = parts[1]
  }
  return id && ID.test(id) ? id : null
}

/** El reproductor sin cookies de seguimiento, para cuando la persona toca «play». */
export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`
}

/**
 * La miniatura grande (16:9). En un Short trae el cuadro vertical en el medio,
 * así que recortada al centro en un marco 9:16 muestra el video tal cual.
 */
export function youtubeThumbnailUrl(id: string, size: 'max' | 'hq' = 'max'): string {
  return `https://i.ytimg.com/vi/${id}/${size === 'max' ? 'maxresdefault' : 'hqdefault'}.jpg`
}

/** El link para ver el video en YouTube (el «abrir en YouTube»): sirve para Shorts y videos. */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
}
