import { z } from 'zod'

export const submitReviewSchema = z.object({
  token: z.string().min(16).max(128),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z
    .union([z.string().trim().max(1000), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null)),
})

export const reviewSettingsSchema = z.object({
  google_maps_review_url: z
    .union([z.string().trim().url('URL inválida').max(500), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null)),
  review_gating_enabled: z.coerce.boolean(),
  review_reward_points: z.coerce.number().int().min(0, 'Mínimo 0').max(1_000_000).default(0),
})

export type SubmitReviewInput = z.infer<typeof submitReviewSchema>
export type ReviewSettingsInput = z.infer<typeof reviewSettingsSchema>
