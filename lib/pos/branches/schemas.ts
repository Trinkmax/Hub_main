/**
 * El borde de «Sucursales»: lo que el navegador le puede mandar al servidor. Los topes son los
 * de la tabla `branches` (nombre 1–60, corto hasta 14, dirección hasta 160).
 */

import { z } from 'zod'
import { ADDRESS_MAX, cleanText, NAME_MAX, SHORT_NAME_MAX } from './naming'
import { normalizeHex, readsWithLightInk } from './palette'

// Los motivos que se le muestran a la persona van con `refine` (código `custom`): así
// `firstIssue` los distingue de un pedido mal armado, que no tiene nada para decirle.
const name = z
  .string()
  .max(400)
  .transform(cleanText)
  .refine((value) => value.length >= 1, 'Ponele un nombre a la sucursal.')
  .refine((value) => value.length <= NAME_MAX, `El nombre entra en ${NAME_MAX} letras.`)

/** Un texto que puede quedar vacío: vacío se guarda como «sin dato». */
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .max(max * 4)
    .nullable()
    .transform((value) => {
      const clean = cleanText(value ?? '')
      return clean === '' ? null : clean
    })
    .refine((value) => value === null || value.length <= max, tooLong)

const shortName = optionalText(SHORT_NAME_MAX, `El nombre corto entra en ${SHORT_NAME_MAX} letras.`)
const address = optionalText(ADDRESS_MAX, `La dirección entra en ${ADDRESS_MAX} letras.`)

/** El color va de fondo con letra clara encima: tiene que leerse (contraste AA). */
const color = z
  .string()
  .max(9)
  .transform((value, ctx) => {
    const hex = normalizeHex(value)
    if (!hex) {
      ctx.addIssue({ code: 'custom', message: 'Ese color no es válido.' })
      return z.NEVER
    }
    if (!readsWithLightInk(hex)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Sobre ese color el nombre no se lee. Elegí uno de la paleta.',
      })
      return z.NEVER
    }
    return hex
  })

/** Lo que la persona veía: se compara tal cual con lo que hay en la base, sin validar. */
const seenText = z.string().max(400)

export const createBranchSchema = z.object({
  name,
  /** Sin dato, el primer color libre de la paleta. */
  color: color.optional(),
})

const change = z.discriminatedUnion('field', [
  z.object({ field: z.literal('name'), value: name, expected: seenText }),
  z.object({ field: z.literal('shortName'), value: shortName, expected: seenText.nullable() }),
  z.object({ field: z.literal('color'), value: color, expected: seenText }),
  z.object({ field: z.literal('address'), value: address, expected: seenText.nullable() }),
  z.object({ field: z.literal('active'), value: z.boolean(), expected: z.boolean() }),
])

export const updateBranchSchema = z
  .object({
    branchId: z.guid(),
    changes: z.array(change).min(1).max(5),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    for (const [index, entry] of value.changes.entries()) {
      if (seen.has(entry.field)) {
        ctx.addIssue({ code: 'custom', path: ['changes', index], message: 'Dato repetido.' })
      }
      seen.add(entry.field)
    }
  })

export const setDefaultBranchSchema = z.object({
  branchId: z.guid(),
  /** La que la persona veía como principal. */
  expectedDefaultId: z.guid(),
})

export const reorderBranchesSchema = z
  .object({ order: z.array(z.guid()).min(1).max(100) })
  .refine((value) => new Set(value.order).size === value.order.length, {
    message: 'Hay una sucursal repetida.',
  })

export const deleteBranchSchema = z.object({ branchId: z.guid() })

export type CreateBranchInput = z.input<typeof createBranchSchema>
export type UpdateBranchInput = z.input<typeof updateBranchSchema>

/**
 * El motivo de un rechazo, si es de los que se le pueden decir a la persona (un nombre vacío,
 * un texto largo, un color que no se lee). Un pedido mal armado no tiene motivo para mostrar.
 */
export function firstIssue(error: z.ZodError): string | null {
  return error.issues.find((entry) => entry.code === 'custom')?.message ?? null
}
