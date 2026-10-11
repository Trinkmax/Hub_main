/**
 * El usuario de Instagram de quien reserva: el contacto cuando la reserva se
 * cerró por Instagram y no pasó el teléfono. Se guarda sin la arroba y en
 * minúsculas ("juan.perez"); en pantalla va con la arroba.
 */

/** Tope de Instagram: 30 caracteres entre letras, números, punto y guion bajo. */
export const INSTAGRAM_HANDLE_MAX = 30

const HANDLE_RE = /^[a-z0-9._]{1,30}$/
const PROFILE_URL_RE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/([^/?#\s]+)/i
/** Rutas de Instagram que no son un perfil: un link a una publicación no sirve. */
const NOT_A_PROFILE = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'direct', 'accounts'])

/**
 * Lo que tipearon → el usuario. Acepta "@Juan.Perez", "juan.perez" y el link
 * del perfil pegado ("instagram.com/juan.perez?igsh=…"). `null` si no es un
 * usuario válido (vacío incluido).
 */
export function parseInstagramHandle(input: string | null | undefined): string | null {
  let value = (input ?? '').trim()
  if (value === '') return null
  const fromUrl = value.match(PROFILE_URL_RE)?.[1]
  if (fromUrl) {
    if (NOT_A_PROFILE.has(fromUrl.toLowerCase())) return null
    value = fromUrl
  }
  value = value.replace(/^@+/, '').toLowerCase()
  return HANDLE_RE.test(value) ? value : null
}

/** "juan.perez" → "@juan.perez". */
export function formatInstagramHandle(handle: string): string {
  return `@${handle}`
}

/** El perfil, para abrirlo y escribirle desde ahí. */
export function instagramProfileUrl(handle: string): string {
  return `https://www.instagram.com/${encodeURIComponent(handle)}/`
}

/**
 * Lo que escribieron en un buscador, si puede ser (parte de) un usuario de
 * Instagram: una sola palabra de letras, números, punto o guion bajo, con o sin
 * arroba. Sale en minúsculas y sin la arroba, lista para un `ilike`; como solo
 * deja pasar esos caracteres, no puede romper la sintaxis de un `.or()`.
 */
export function instagramSearchTerm(q: string): string | null {
  const term = q.trim().replace(/^@+/, '').toLowerCase()
  return /^[a-z0-9._]{2,30}$/.test(term) ? term : null
}
