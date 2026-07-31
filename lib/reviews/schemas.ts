import { z } from 'zod'
import { tryNormalizePhone } from '@/lib/phone'

export const submitReviewSchema = z.object({
  token: z.string().min(16).max(128),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z
    .union([z.string().trim().max(1000), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null)),
})

/** Comentario agregado desde la pantalla puente de 5★ (la reseña ya existe). */
export const attachReviewCommentSchema = z.object({
  token: z.string().min(16).max(128),
  reviewId: z.string().uuid(),
  comment: z.string().trim().min(1, 'Escribí algo antes de guardar.').max(1000),
})

export const reviewSettingsSchema = z.object({
  google_maps_review_url: z
    .union([z.string().trim().url('URL inválida').max(500), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null)),
  // El dueño escribe el número como se le canta ("351 283-9101"); normalizamos a
  // E.164 acá porque la columna tiene un CHECK `^\+[1-9][0-9]{7,14}$` y un
  // rechazo de Postgres no le dice nada accionable.
  feedback_whatsapp_phone: z
    .union([z.string().trim().max(30), z.literal(''), z.null(), z.undefined()])
    .transform((v, ctx) => {
      if (typeof v !== 'string' || v.length === 0) return null
      const e164 = tryNormalizePhone(v)
      // Un número mal escrito NO puede convertirse en null silencioso: el dueño
      // creería que lo guardó y el botón de WhatsApp nunca aparecería.
      if (!e164 || !/^\+[1-9]\d{7,14}$/.test(e164)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Número de WhatsApp inválido. Ej: 351 283 9101',
        })
        return z.NEVER
      }
      return e164
    }),
  review_gating_enabled: z.coerce.boolean(),
  review_reward_points: z.coerce.number().int().min(0, 'Mínimo 0').max(1_000_000).default(0),
})

const ratingFilterSchema = z.coerce.number().int().min(1).max(5)

/**
 * `?rating=` del panel del manager. Un valor basura no rompe la página: cae en
 * "todas", que es lo que el owner espera al pegar un link tuneado a mano.
 */
export function parseRatingFilter(raw: unknown): 1 | 2 | 3 | 4 | 5 | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const parsed = ratingFilterSchema.safeParse(raw)
  return parsed.success ? (parsed.data as 1 | 2 | 3 | 4 | 5) : undefined
}

export type SubmitReviewInput = z.infer<typeof submitReviewSchema>
export type AttachReviewCommentInput = z.infer<typeof attachReviewCommentSchema>
export type ReviewSettingsInput = z.infer<typeof reviewSettingsSchema>
