/**
 * Convención de URLs derivadas del bucket `menu-images`.
 *
 * La cuota de Vercel Image Optimization está agotada y no se va a upgradear,
 * así que servimos variantes PREGENERADAS desde Supabase Storage. Al subir un
 * archivo se crean siblings derivados con sufijos fijos antes de la extensión:
 *
 *   Imagen full   `{tenantId}/{stamp}_{rand}.{ext}`        (lado mayor 1600px)
 *   Thumb         `{tenantId}/{stamp}_{rand}_t.{ext}`      (lado mayor 320px, MISMA ext que el full)
 *   Video         `{tenantId}/{stamp}_{rand}_v.{ext}`      (mp4 | webm | mov, tal cual sube)
 *   Poster        `{tenantId}/{stamp}_{rand}_vp.webp`      (frame ~0.5s, lado mayor 1280px)
 *
 * La DB guarda SOLO la URL del full / del video; las derivadas se calculan acá.
 * El thumb conserva siempre la extensión del full para que `thumbUrlFor` sea
 * una transformación pura de string (sin consultar Storage).
 *
 * Este módulo es puro (sin 'use client' ni 'server-only'): se importa igual
 * desde Server Components, Client Components y scripts.
 */

const STORAGE_MARKER = '/storage/v1/object/public/menu-images/'

/** True si la URL apunta al bucket público `menu-images` de Supabase Storage. */
export function isStorageUrl(url: string): boolean {
  return url.includes(STORAGE_MARKER)
}

/**
 * Separa la URL en [base, querystring/hash]. La transformación de sufijos se
 * aplica sólo sobre la base; el resto se preserva tal cual.
 */
function splitSuffix(url: string): [string, string] {
  const m = url.match(/[?#]/)
  if (!m || m.index === undefined) return [url, '']
  return [url.slice(0, m.index), url.slice(m.index)]
}

/**
 * URL del thumbnail (lado mayor 320px) de una imagen full: inserta `_t` antes
 * de la extensión. Si la URL no tiene extensión reconocible, devuelve la URL
 * original (el caller sirve el full y listo).
 *
 * Las URLs YA derivadas (`_t`, `_v`, `_vp`) también se devuelven tal cual: un
 * poster de video (`_vp.webp`) usado como imagen de card no tiene sibling
 * `_vp_t.webp` — derivar de una derivada sería un 404 garantizado.
 *
 *   .../abc123.webp        → .../abc123_t.webp
 *   .../abc123.webp?v=2    → .../abc123_t.webp?v=2
 *   .../abc123_vp.webp     → .../abc123_vp.webp   (sin cambio)
 */
export function thumbUrlFor(url: string): string {
  const [base, rest] = splitSuffix(url)
  const dot = base.lastIndexOf('.')
  const slash = base.lastIndexOf('/')
  if (dot === -1 || dot < slash) return url
  const stem = base.slice(0, dot)
  if (/_(?:t|v|vp)$/.test(stem)) return url
  return `${stem}_t${base.slice(dot)}${rest}`
}

/**
 * URL del poster de un video: mapea `..._v.{ext}` → `..._vp.webp`.
 * Devuelve null si la URL no sigue la convención `_v.{ext}` (no hay poster
 * derivable; el caller decide su fallback).
 *
 *   .../abc123_v.mp4       → .../abc123_vp.webp
 *   .../abc123_v.mp4?v=2   → .../abc123_vp.webp?v=2
 */
export function posterUrlFor(videoUrl: string): string | null {
  const [base, rest] = splitSuffix(videoUrl)
  const stem = base.match(/^(.*)_v\.[A-Za-z0-9]+$/)?.[1]
  if (!stem) return null
  return `${stem}_vp.webp${rest}`
}
