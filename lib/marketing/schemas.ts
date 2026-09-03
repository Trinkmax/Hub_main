import { z } from 'zod'
import { TASK_CATEGORIES, TASK_KINDS, TASK_STATUSES } from './constants'

/**
 * Bordes del tablero de marketing.
 *
 * Todos los opcionales llegan del FormData como `''` (un `<input>` vacío nunca
 * manda null) o como `null` si el campo directamente no vino. El schema
 * normaliza las dos formas a `null` acá, así la DB nunca ve strings vacíos
 * disfrazados de dato y `coalesce(defined_date, ideal_date)` sigue funcionando.
 */

/** `'' | null | undefined` → null; cualquier otra cosa → string recortado. */
const optionalText = z.union([z.string(), z.null(), z.undefined()]).transform((v) => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length === 0 ? null : s
})

const textUpTo = (max: number) =>
  optionalText.refine((v) => v === null || v.length <= max, `No puede superar ${max} caracteres`)

/** `<input type="date">` vacío → null; con valor → `yyyy-MM-dd`. */
const isoDateOrNull = optionalText.refine(
  (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v),
  'Fecha inválida',
)

const uuidOrNull = optionalText.refine(
  (v) => v === null || z.uuid().safeParse(v).success,
  'Persona inválida',
)

/**
 * Link al material. Sólo http/https: un `javascript:` acá terminaría en un
 * `<a href>` del panel, y el campo lo carga cualquier socio.
 */
const httpUrlOrNull = optionalText
  .refine(
    (v) => v === null || /^https?:\/\/\S+$/i.test(v),
    'El link tiene que empezar con http:// o https://',
  )
  .refine((v) => v === null || v.length <= 2000, 'El link es demasiado largo')

export const marketingTaskCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Poné qué hay que hacer')
    .max(160, 'El título no puede superar 160 caracteres'),
  category: z.enum(TASK_CATEGORIES),
  kind: z.enum(TASK_KINDS),
  status: z.enum(TASK_STATUSES),
  specifications: textUpTo(2000),
  notes: textUpTo(4000),
  file_url: httpUrlOrNull,
  responsible_user_id: uuidOrNull,
  involved_user_id: uuidOrNull,
  ideal_date: isoDateOrNull,
  defined_date: isoDateOrNull,
})

export const marketingTaskUpdateSchema = marketingTaskCreateSchema.extend({
  id: z.uuid('ID inválido'),
})

export const marketingTaskStatusSchema = z.object({
  id: z.uuid('ID inválido'),
  status: z.enum(TASK_STATUSES),
})

// ──────────────────────────────────────────────
// Checklist semanal
// ──────────────────────────────────────────────

export const routineUpsertSchema = z.object({
  id: z.uuid('ID inválido').nullable().optional(),
  title: z
    .string()
    .trim()
    .min(1, 'Poné un nombre')
    .max(160, 'El nombre no puede superar 160 caracteres'),
  description: textUpTo(400),
  slots: z.coerce
    .number()
    .int('Tiene que ser un número entero')
    .min(1, 'Al menos 1 vez por semana')
    .max(14, 'Máximo 14 veces por semana'),
})

export const routineCheckSchema = z.object({
  routine_id: z.uuid('ID inválido'),
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Semana inválida'),
  slot: z.coerce.number().int().min(0).max(13),
  done: z.boolean(),
})

export type MarketingTaskCreate = z.infer<typeof marketingTaskCreateSchema>
export type MarketingTaskUpdate = z.infer<typeof marketingTaskUpdateSchema>
export type RoutineUpsert = z.infer<typeof routineUpsertSchema>
export type RoutineCheck = z.infer<typeof routineCheckSchema>
