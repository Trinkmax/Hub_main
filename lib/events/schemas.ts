import { z } from 'zod'

const eventBaseSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(120),
  description: z
    .union([z.string().trim().max(2000), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v && v.length > 0 ? v : null)),
  starts_at: z.string().min(1, 'Fecha requerida'),
  ends_at: z.string().min(1, 'Fecha requerida'),
  capacity: z
    .union([z.coerce.number().int().min(1).max(99999), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
  waitlist_enabled: z.coerce.boolean().default(true),
})

const checkRange = (d: { starts_at: string; ends_at: string }) =>
  new Date(d.ends_at).getTime() > new Date(d.starts_at).getTime()
const rangeMessage = {
  message: 'La fecha de fin debe ser posterior al inicio',
  path: ['ends_at'],
}

export const createEventSchema = eventBaseSchema.refine(checkRange, rangeMessage)

export const updateEventSchema = eventBaseSchema
  .extend({ id: z.string().uuid() })
  .refine(checkRange, rangeMessage)

export const reserveSchema = z.object({
  event_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  guests: z.coerce.number().int().min(1).max(99).default(1),
})

export const reservationIdSchema = z.object({
  reservation_id: z.string().uuid(),
})

export type CreateEventInput = z.infer<typeof createEventSchema>
export type ReserveInput = z.infer<typeof reserveSchema>
