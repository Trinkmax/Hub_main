import { z } from 'zod'
import { slugify } from '@/lib/tenant/slugify'

/**
 * Bordes del editor de páginas HTML (/p/[slug]).
 *
 * Acá NO se valida el HTML: entra tal cual lo pegó marketing y sale tal cual.
 * Lo que sí se controla es el tamaño (el mismo techo que el CHECK de la tabla)
 * y el slug, que es la parte que se convierte en URL pública y global.
 */

/**
 * 512 KB. Es el mismo número que `landing_pages_html_size_check`, y está
 * contado en CARACTERES —no en bytes— porque `length()` de Postgres cuenta
 * caracteres. En JS, `.length` cuenta unidades UTF-16, que para los pares
 * subrogados (emojis) da MÁS que Postgres: si pasa acá, pasa allá.
 */
export const LANDING_HTML_MAX_CHARS = 524_288

/** Lo que va después de /p/. Minúsculas, números y guiones, 2 a 40. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/

export const LANDING_SLUG_HINT = 'Letras minúsculas, números y guiones. Entre 2 y 40 caracteres.'

/**
 * Del nombre que escribió el dueño al slug propuesto ("Fiesta de Halloween 🎃"
 * → "fiesta-de-halloween"). Reusa el slugify del tenant (NFD + corte en 40).
 */
export function suggestLandingSlug(title: string): string {
  return slugify(title)
}

export const landingSlugSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => value.length > 0, 'Poné el final del link')
  .refine((value) => SLUG_RE.test(value), LANDING_SLUG_HINT)

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Poné un nombre para la página')
  .max(80, 'El nombre no puede superar 80 caracteres')

const htmlSchema = z
  .string()
  .max(
    LANDING_HTML_MAX_CHARS,
    'El HTML pasa los 512 KB. Subí las imágenes desde el panel en vez de pegarlas dentro del código.',
  )

/** Alta: sólo nombre y link. El HTML se carga después, en el editor. */
export const landingCreateSchema = z.object({
  title: titleSchema,
  slug: landingSlugSchema,
})

/** Ajustes de la página (nombre, link, si Google la puede indexar). */
export const landingSettingsSchema = z.object({
  id: z.uuid('ID inválido'),
  title: titleSchema,
  slug: landingSlugSchema,
  indexable: z.coerce.boolean(),
})

/** Guardar el código (borrador) o publicarlo. */
export const landingHtmlSchema = z.object({
  id: z.uuid('ID inválido'),
  html: htmlSchema,
})

export const landingIdSchema = z.object({
  id: z.uuid('ID inválido'),
})

export const landingRestoreSchema = z.object({
  id: z.uuid('ID inválido'),
  versionId: z.uuid('Versión inválida'),
})

export type LandingCreateInput = z.infer<typeof landingCreateSchema>
export type LandingSettingsInput = z.infer<typeof landingSettingsSchema>
export type LandingHtmlInput = z.infer<typeof landingHtmlSchema>

/** Para el editor: valida sin lanzar, así el input puede avisar mientras se tipea. */
export function checkSlugFormat(slug: string): string | null {
  const value = slug.trim().toLowerCase()
  if (value.length === 0) return 'Poné el final del link'
  if (!SLUG_RE.test(value)) return LANDING_SLUG_HINT
  return null
}
