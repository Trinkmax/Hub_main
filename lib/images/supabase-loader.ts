'use client'

/**
 * Custom image loader de Next.js — reemplaza por completo al optimizador de Vercel.
 *
 * Por qué existe: la cuota "Image Optimization" del plan Hobby de Vercel (5K
 * transformaciones/mes, POR CUENTA) se agota y `/_next/image` devuelve **402**,
 * rompiendo TODAS las imágenes servidas vía `next/image`. Con este loader,
 * `next/image` NUNCA toca `/_next/image`: la URL final la genera esta función.
 *
 * Qué hace: para objetos PÚBLICOS de Supabase Storage reescribe la URL al
 * endpoint de transformación de Supabase (imgproxy del lado de Supabase, incluido
 * desde el plan Pro):
 *
 *   /storage/v1/object/public/<bucket>/<path>.webp
 *     → /storage/v1/render/image/public/<bucket>/<path>.webp?width=<w>&quality=<q>
 *
 * Supabase redimensiona al ancho pedido y **negocia el mejor formato** (avif/webp)
 * según el header `Accept` del browser. La facturación es por *imagen-origen única*
 * por mes (100 incluidas en Pro, luego USD 5 c/1000), NO por request → no hay
 * muro duro tipo 402 como el de Vercel. Verificado empíricamente contra el proyecto:
 * `render/image` responde 200 y devuelve webp con `Accept: image/webp`.
 *
 * Qué NO transforma (se devuelve `src` intacto):
 *  - Data URLs (QR generados en runtime) y `blob:` (previews de upload).
 *  - Estáticos de `/public` (ej. `/hub-logo.png`) y cualquier URL externa.
 *  - SVG (vectorial: rasterizarlo perdería nitidez) y videos (mp4/webm/mov).
 *  - URLs firmadas privadas (`/object/sign/…`, bucket `message-media`).
 * En todos esos casos no hay nada que optimizar o no debe transformarse, así que
 * el browser recibe el recurso original directo del CDN — sin pasar por Vercel.
 *
 * Módulo puro y client-safe (lo bundlea Next en cada página que use `next/image`):
 * sin `server-only`, sin acceso a red, sin dependencias.
 */

const PUBLIC_OBJECT_MARKER = '/storage/v1/object/public/'
const RENDER_MARKER = '/storage/v1/render/image/public/'

// Solo transformamos rasters: los SVG se sirven vectoriales y los videos no pasan
// por el transformador de imágenes. La extensión se evalúa sobre el path (sin query).
const RASTER_EXT = /\.(?:jpe?g|png|webp|avif)$/i

// Límite duro del transformador de Supabase (width/height 1–2500). Pedir más no
// rompe (Supabase clampea), pero evitamos generar una variante inútil de 2500px.
const SUPABASE_MAX_DIMENSION = 2500

type LoaderProps = { src: string; width: number; quality?: number }

export default function supabaseImageLoader({ src, width, quality }: LoaderProps): string {
  const [path = src, query = ''] = src.split('?')

  // Passthrough para todo lo que no sea un raster público de Supabase Storage.
  if (!path.includes(PUBLIC_OBJECT_MARKER) || !RASTER_EXT.test(path)) return src

  const params = new URLSearchParams(query) // preserva cache-buster (?v=…) si lo hay
  params.set('width', String(Math.min(width, SUPABASE_MAX_DIMENSION)))
  params.set('quality', String(quality ?? 75))
  return `${path.replace(PUBLIC_OBJECT_MARKER, RENDER_MARKER)}?${params.toString()}`
}
