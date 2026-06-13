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

const optionalUuid = z
  .union([z.string().uuid(), z.literal(''), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null))

const optionalHex = z
  .union([
    z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hex #RRGGBB'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null))

const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null))

export const createRewardSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalText(300),
  cost_points: z.coerce.number().int().min(1, 'Mínimo 1'),
  stock: z
    .union([z.coerce.number().int().min(0), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
  // Recompensa exclusiva por nivel (null = disponible para todos).
  min_tier_id: optionalUuid,
})

export const updateRewardSchema = createRewardSchema.extend({
  id: z.string().uuid(),
  active: z.coerce.boolean(),
})

export type CreateRuleInput = z.infer<typeof createRuleSchema>
export type CreateRewardInput = z.infer<typeof createRewardSchema>

// ──────────────────────────────────────────────────────────
// Niveles del club (loyalty_tiers)
// ──────────────────────────────────────────────────────────

const tierBaseSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(40),
  color: optionalHex,
  badge_icon: optionalText(40),
  min_lifetime_points: z.coerce.number().int().min(0, 'Mínimo 0'),
  sort: z.coerce.number().int().default(0),
  benefit_cadence: z.enum(['none', 'birthday', 'monthly']).default('none'),
  benefit_reward_id: optionalUuid,
  perks: optionalText(300),
  active: z.coerce.boolean().default(true),
})

const tierRefine = (d: { benefit_cadence: string; benefit_reward_id: string | null }) =>
  d.benefit_cadence === 'none' || d.benefit_reward_id !== null

const tierRefineMsg = {
  message: 'Elegí una recompensa para el beneficio recurrente',
  path: ['benefit_reward_id'],
}

export const createTierSchema = tierBaseSchema.refine(tierRefine, tierRefineMsg)
export const updateTierSchema = tierBaseSchema
  .extend({ id: z.string().uuid() })
  .refine(tierRefine, tierRefineMsg)

export type CreateTierInput = z.infer<typeof createTierSchema>
export type UpdateTierInput = z.infer<typeof updateTierSchema>

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
