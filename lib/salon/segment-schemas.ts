/**
 * zod de cada borde nuevo del cupo por servicio: params de URL (calendario y
 * alta de reserva) e inputs de las server actions.
 *
 * Vive aparte de `segment-actions.ts` porque un archivo 'use server' solo
 * puede exportar funciones async: los schemas, `firstParams` y el tipo del
 * resultado los importan también las páginas y los componentes cliente.
 *
 * Los params de URL usan `.catch(undefined)` en cada campo: un `?meal=` o un
 * `?day=` roto se ignora y la página abre igual con sus defaults, en lugar de
 * tirar un 500 por un link viejo o tipeado a mano.
 */

import { z } from 'zod'
import { isRealIsoDay } from './date-presets'
import { SEGMENT_KEYS } from './segments'

export const segmentKeySchema = z.enum(SEGMENT_KEYS)

/** 'YYYY-MM-DD' que además existe (el 30/02 matchea la forma pero no es un día). */
export const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)')
  .refine(isRealIsoDay, 'Esa fecha no existe')

export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horario inválido (HH:MM)')

/** 'YYYY-MM' con el mismo rango de años que acepta `isRealIsoDay`. */
const ymSchema = z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, 'Mes inválido')

export const dayRequestSchema = z.object({ date: isoDaySchema })

export const reservationSearchSchema = z.object({
  q: z.string().trim().min(2, 'Escribí al menos 2 letras o números').max(60, 'Hasta 60 caracteres'),
})

const capacityField = z
  .number({ error: 'Entre 0 y 999' })
  .int('Entre 0 y 999')
  .min(0, 'Entre 0 y 999')
  .max(999, 'Entre 0 y 999')

const warnAtField = z
  .number({ error: 'Entre 1 y 999' })
  .int('Entre 1 y 999')
  .min(1, 'Entre 1 y 999')
  .max(999, 'Entre 1 y 999')

const WARN_OVER_CAP = 'El aviso tiene que ser menor o igual al cupo'

/** '' o solo espacios → null: una nota vacía es "sin nota", no un string vacío en la DB. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Hasta ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null))
}

/**
 * Una celda de la grilla semanal. `capacity: null` = celda vacía: se borra la
 * fila y ese día vuelve al cupo general. El aviso necesita un cupo y no puede
 * pasarlo (la tabla tiene el mismo CHECK, esto da el mensaje antes).
 */
export const segmentWeeklyCellSchema = z
  .object({
    segment: segmentKeySchema,
    iso_dow: z.literal([1, 2, 3, 4, 5, 6, 7], { error: 'Día de la semana inválido' }),
    capacity: capacityField.nullable(),
    warn_at: warnAtField.nullable(),
  })
  .superRefine((cell, ctx) => {
    if (cell.warn_at === null) return
    if (cell.capacity === null) {
      ctx.addIssue({ code: 'custom', path: ['warn_at'], message: 'Poné el cupo antes del aviso' })
    } else if (cell.warn_at > cell.capacity) {
      ctx.addIssue({ code: 'custom', path: ['warn_at'], message: WARN_OVER_CAP })
    }
  })

export const segmentSettingInputSchema = z.object({
  segment: segmentKeySchema,
  default_time: hhmmSchema,
  warn_note: optionalText(80),
})

/**
 * Lo que guarda "Guardar cupos": la grilla entera (hasta 3 × 7 celdas) y los
 * ajustes de los 3 servicios. Una celda o un servicio repetido es un bug del
 * editor: se rechaza en vez de dejar que gane el último.
 */
export const segmentConfigSaveSchema = z
  .object({
    weekly: z.array(segmentWeeklyCellSchema).max(21),
    settings: z.array(segmentSettingInputSchema).max(3),
  })
  .superRefine((input, ctx) => {
    const cells = new Set<string>()
    input.weekly.forEach((cell, i) => {
      const key = `${cell.segment}:${cell.iso_dow}`
      if (cells.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['weekly', i], message: 'Celda repetida' })
      }
      cells.add(key)
    })
    const segments = new Set<string>()
    input.settings.forEach((setting, i) => {
      if (segments.has(setting.segment)) {
        ctx.addIssue({ code: 'custom', path: ['settings', i], message: 'Servicio repetido' })
      }
      segments.add(setting.segment)
    })
  })

/** Cupo especial de un servicio en una fecha ("abrimos la terraza", feriado). */
export const segmentOverrideSchema = z
  .object({
    override_date: isoDaySchema,
    segment: segmentKeySchema,
    capacity: capacityField,
    warn_at: warnAtField.nullable().default(null),
    reason: optionalText(120),
  })
  .superRefine((o, ctx) => {
    if (o.warn_at !== null && o.warn_at > o.capacity) {
      ctx.addIssue({ code: 'custom', path: ['warn_at'], message: WARN_OVER_CAP })
    }
  })

export const segmentOverrideKeySchema = z.object({
  override_date: isoDaySchema,
  segment: segmentKeySchema,
})

/**
 * /reservas/nuevo: ?date, ?event (alta dentro de un evento), ?meal (servicio)
 * y ?time (hora puntual). `guest_name` lo manda el operativo al cargar un
 * walk-in y antes se ignoraba.
 */
export const newReservationParamsSchema = z.object({
  date: isoDaySchema.optional().catch(undefined),
  event: z.uuid().optional().catch(undefined),
  meal: segmentKeySchema.optional().catch(undefined),
  time: hhmmSchema.optional().catch(undefined),
  guest_name: z.string().trim().min(1).max(120).optional().catch(undefined),
})
export type NewReservationParams = z.infer<typeof newReservationParamsSchema>

/**
 * /eventos/programados: ?month, ?day ('hoy' lo usa ⌘K "Nueva reserva"),
 * ?seg (servicio anclado), ?res (reserva resaltada), ?buscar y ?tab.
 */
export const calendarParamsSchema = z.object({
  month: ymSchema.optional().catch(undefined),
  day: z
    .union([z.literal('hoy'), isoDaySchema])
    .optional()
    .catch(undefined),
  seg: segmentKeySchema.optional().catch(undefined),
  res: z.uuid().optional().catch(undefined),
  buscar: z.string().trim().min(1).max(60).optional().catch(undefined),
  tab: z.enum(['calendario', 'eventos']).optional().catch(undefined),
})
export type CalendarParams = z.infer<typeof calendarParamsSchema>

/**
 * searchParams de Next → un valor por clave. `?a=x&a=y` llega como array; se
 * queda el primero, que es lo que haría cualquier link armado a mano.
 */
export function firstParams(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(sp)) {
    out[key] = Array.isArray(value) ? value[0] : value
  }
  return out
}

export type SegmentActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; message: string; field?: string }
