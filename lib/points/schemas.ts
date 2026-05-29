import { z } from 'zod'

export const perAmountConfigSchema = z.object({
  every_cents: z.coerce.number().int().min(1, 'Debe ser > 0'),
  points: z.coerce.number().int().min(1, 'Debe ser ≥ 1'),
})

export const perItemByIdConfigSchema = z.object({
  item_id: z.string().uuid(),
  points: z.coerce.number().int().min(1),
})

export const perItemByCategoryConfigSchema = z.object({
  category_id: z.string().uuid(),
  points: z.coerce.number().int().min(1),
})

export const createRuleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('per_amount'),
    config: perAmountConfigSchema,
    priority: z.coerce.number().int().default(0),
    active: z.coerce.boolean().default(true),
  }),
  z.object({
    type: z.literal('per_item'),
    config: z.union([perItemByIdConfigSchema, perItemByCategoryConfigSchema]),
    priority: z.coerce.number().int().default(0),
    active: z.coerce.boolean().default(true),
  }),
])

export const updateRuleSchema = z.object({
  id: z.string().uuid(),
  priority: z.coerce.number().int(),
  active: z.coerce.boolean(),
})

export const createRewardSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z
    .union([z.string().trim().max(300), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v && v.length > 0 ? v : null)),
  cost_points: z.coerce.number().int().min(1, 'Mínimo 1'),
  stock: z
    .union([z.coerce.number().int().min(0), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
})

export const updateRewardSchema = createRewardSchema.extend({
  id: z.string().uuid(),
  active: z.coerce.boolean(),
})

export type CreateRuleInput = z.infer<typeof createRuleSchema>
export type CreateRewardInput = z.infer<typeof createRewardSchema>

// ──────────────────────────────────────────────────────────
// Redención de puntos como descuento al cobrar
// ──────────────────────────────────────────────────────────

export const updatePointsRedemptionConfigSchema = z.object({
  enabled: z.coerce.boolean(),
  ratePointsToCents: z.coerce
    .number()
    .int('Tiene que ser un entero')
    .min(1, 'Mínimo 1 centavo')
    .max(100000, 'Demasiado alto'),
  maxPct: z.coerce.number().min(0, 'Mínimo 0%').max(100, 'Máximo 100%'),
})

export type UpdatePointsRedemptionConfigInput = z.infer<typeof updatePointsRedemptionConfigSchema>
