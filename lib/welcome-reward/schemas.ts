import { z } from 'zod'

// Headline visible al cliente sobre la card del regalo (max 80).
// Subtext aclaratorio debajo (max 160).
// reward_id puede ser null cuando enabled=false (el dueño todavía no eligió).
// Si enabled=true, exigimos reward_id no nulo — sin recompensa no hay regalo.
export const updateWelcomeRewardConfigSchema = z
  .object({
    enabled: z.coerce.boolean(),
    reward_id: z
      .union([z.string().uuid(), z.literal(''), z.null(), z.undefined()])
      .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null)),
    headline: z.string().trim().min(1, 'Requerido').max(80, 'Máximo 80'),
    subtext: z.string().trim().min(1, 'Requerido').max(160, 'Máximo 160'),
    bonus_points: z.coerce.number().int().min(0, 'Mínimo 0').max(1_000_000).default(0),
  })
  .refine((data) => !data.enabled || data.reward_id !== null, {
    message: 'Tenés que elegir una recompensa para activar la bienvenida',
    path: ['reward_id'],
  })

export type UpdateWelcomeRewardConfigInput = z.infer<typeof updateWelcomeRewardConfigSchema>
