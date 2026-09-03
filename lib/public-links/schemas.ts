import { z } from 'zod'
import { CURATED_ICONS } from '@/components/icons/curated-lucide'

/**
 * Bordes del editor de links públicos.
 *
 * La URL es el campo delicado: termina en un `<a href>` de una página que ve
 * cualquiera que entre desde Instagram. Sólo http/https — nada de `javascript:`
 * ni `data:`.
 */

const optionalText = z.union([z.string(), z.null(), z.undefined()]).transform((v) => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length === 0 ? null : s
})

const textUpTo = (max: number) =>
  optionalText.refine((v) => v === null || v.length <= max, `No puede superar ${max} caracteres`)

/**
 * Acepta lo que la gente realmente pega ("hubbar.com.ar", "www.pedix.app/hub")
 * y lo completa con https://. Después exige que sea una URL parseable.
 */
export function normalizeUrl(raw: string): string {
  const value = raw.trim()
  if (value.length === 0) return value
  // Si ya trae un esquema —el que sea— no se toca. Prefijarle `https://` a un
  // `javascript:alert(1)` lo convertiría en una URL formalmente válida y el
  // filtro de más abajo lo dejaría pasar: el chequeo tiene que ver el esquema
  // original.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value
  return `https://${value}`
}

const publicUrl = z
  .string()
  .trim()
  .min(1, 'Poné el link')
  .max(2000, 'El link es demasiado largo')
  .transform(normalizeUrl)
  .refine((v) => {
    try {
      const parsed = new URL(v)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }, 'El link no es válido. Tiene que empezar con https://')

/**
 * El ícono viaja en un input hidden, así que el IconPicker NO es una defensa:
 * hay que validar contra el catálogo. `Object.hasOwn` y no `in`: `CURATED_ICONS`
 * es un objeto literal y heredaría `constructor`, `toString`… — cualquiera de
 * esos nombres pasaría el chequeo y después React intentaría renderizar
 * `Object` como componente, tirando abajo la página pública Y su vista previa.
 */
const curatedIcon = optionalText.refine(
  (v) => v === null || Object.hasOwn(CURATED_ICONS, v),
  'Ese ícono no existe',
)

export const publicLinkCreateSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Poné el texto del botón')
    .max(80, 'El texto no puede superar 80 caracteres'),
  description: textUpTo(120),
  url: publicUrl,
  icon: curatedIcon,
  highlight: z.coerce.boolean(),
})

export const publicLinkUpdateSchema = publicLinkCreateSchema.extend({
  id: z.uuid('ID inválido'),
})

export const publicLinkPageSchema = z.object({
  headline: textUpTo(80),
  bio: textUpTo(280),
  active: z.coerce.boolean(),
})

export const publicLinkOrderSchema = z.object({
  ids: z.array(z.uuid()).min(1, 'Nada para ordenar').max(60),
})

export type PublicLinkCreate = z.infer<typeof publicLinkCreateSchema>
export type PublicLinkUpdate = z.infer<typeof publicLinkUpdateSchema>
export type PublicLinkPageInput = z.infer<typeof publicLinkPageSchema>
