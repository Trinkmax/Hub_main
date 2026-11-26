/**
 * Las marcas que acompañan al bar en la carta (sus sponsors) — PURO y testeado
 * (`tests/lib/menu-sponsors.test.ts`).
 *
 * Se guardan en `tenants.settings.carta_sponsors`, la misma bolsa de configuración del bar que usa
 * `capture_prompt`: es una lista corta y ordenada que se lee junto con el bar, sin tabla propia. Leerla
 * (con su validación) es cosa del servidor: `sponsors-schema.ts`. Acá queda lo que también usa el celular.
 *
 * Cada logo es un **sello**: una sola tinta sobre fondo transparente. La carta no lo muestra como una
 * imagen sino como una máscara (`mask-image`) que pinta del color que toque: crema sobre la franja
 * verde, verde sobre el papel. Así siete marcas con siete colores se ven como parte de la carta y no
 * como una pared de avisos. (El archivo va a un bucket público, que es lo que la máscara necesita.)
 *
 * Además, una marca puede llevar palabras (`keywords`): si un producto las nombra («Branca y Cola»),
 * su ficha la muestra. Es la presencia que más le sirve a la marca: al lado de lo que se pide.
 */
import { foldText } from './carta'

export type CartaSponsor = {
  name: string
  /** URL del sello. Ya validada: se puede poner en un `url("…")` de CSS. */
  logoUrl: string
  /** Ancho / alto del sello recortado: reserva su lugar antes de que cargue. */
  ratio: number
  /** Cuánta tinta tiene su caja (0–1), para igualar el peso visual. `null` si no se midió. */
  density: number | null
  /** Palabras que lo vinculan con un producto, ya en minúsculas y sin tildes. */
  keywords: string[]
}

/** Hasta cuántas marcas se muestran. */
export const MAX_SPONSORS = 24

/** Caracteres que rompen un `url("…")` de CSS (o lo que viene después). */
const UNSAFE_IN_CSS_URL = /["'()\\\s<>]/

/**
 * Una URL que se puede meter en CSS sin escaparla: `https` (o una ruta propia que empieza con `/`), sin
 * comillas, paréntesis ni espacios. Cualquier otra cosa no es un logo.
 */
export function safeLogoUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const url = raw.trim()
  if (url.length === 0 || url.length > 600 || UNSAFE_IN_CSS_URL.test(url)) return null
  if (url.startsWith('/') && !url.startsWith('//')) return url
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** La tinta de un logo «normal»: con esto no se agranda ni se achica. */
const REFERENCE_DENSITY = 0.32

/**
 * El tamaño al que se dibuja un sello para que todos pesen parecido. `size` es el lado que tendría un
 * logo cuadrado. Uno apaisado sale más ancho y más bajo, pero no tanto como para igualar la superficie
 * (una palabra larga quedaría de 15 px de alto, ilegible): se lleva un poco más de lugar. Y uno muy
 * lleno de tinta (letras gruesas) sale un poco más chico que uno de trazo fino.
 */
export function sponsorBox(
  sponsor: Pick<CartaSponsor, 'ratio' | 'density'>,
  size: number,
): { width: number; height: number } {
  const ratio = Math.min(8, Math.max(0.2, sponsor.ratio))
  const density = sponsor.density ?? REFERENCE_DENSITY
  const weight = Math.min(1.12, Math.max(0.88, (REFERENCE_DENSITY / density) ** 0.18))
  let width = size * weight * ratio ** 0.6
  let height = width / ratio
  // Un logo muy apaisado no puede llevarse toda la fila; uno muy alto, tampoco toda la altura.
  const fit = Math.min(1, (size * 2.7) / width, (size * 1.15) / height)
  width *= fit
  height *= fit
  return { width: Math.round(width), height: Math.round(height) }
}

/**
 * Las marcas que un producto nombra (hasta dos: «Sernova Speed» nombra dos). Compara palabras enteras,
 * en el nombre y en la descripción: «blu» no aparece adentro de «blue».
 */
export function sponsorsForItem(
  item: { name: string; description: string | null },
  sponsors: ReadonlyArray<CartaSponsor>,
): CartaSponsor[] {
  if (sponsors.length === 0) return []
  const text = ` ${foldText(`${item.name} ${item.description ?? ''}`)} `
  const found: CartaSponsor[] = []
  for (const sponsor of sponsors) {
    if (sponsor.keywords.some((keyword) => text.includes(` ${keyword} `))) {
      found.push(sponsor)
      if (found.length === 2) break
    }
  }
  return found
}
