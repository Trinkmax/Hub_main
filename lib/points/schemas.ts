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

const optionalNumber = (schema: z.ZodType<number>) =>
  z
    .union([schema, z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null))

// ──────────────────────────────────────────────────────────
// Recompensas del catálogo de canje
// ──────────────────────────────────────────────────────────

/** Categorías canónicas del catálogo (multi-tenant: texto libre, éstas son sugeridas). */
export const REWARD_CATEGORIES = ['desayuno', 'almuerzo', 'cena', 'evento'] as const

export const createRewardSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalText(300),
  cost_points: z.coerce.number().int().min(1, 'Mínimo 1'),
  stock: optionalNumber(z.coerce.number().int().min(0)),
  category: optionalText(40),
  visible_in_catalog: z.coerce.boolean().default(true),
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
// Niveles del club (loyalty_tiers) — nivel por puntos de categoría
// ──────────────────────────────────────────────────────────

const tierBaseSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(40),
  color: optionalHex,
  badge_icon: optionalText(40),
  min_category_points: z.coerce.number().int().min(0, 'Mínimo 0'),
  sort: z.coerce.number().int().default(0),
  perks: optionalText(300),
  active: z.coerce.boolean().default(true),
})

export const createTierSchema = tierBaseSchema
export const updateTierSchema = tierBaseSchema.extend({ id: z.string().uuid() })

export type CreateTierInput = z.infer<typeof createTierSchema>
export type UpdateTierInput = z.infer<typeof updateTierSchema>

// ──────────────────────────────────────────────────────────
// Beneficios de nivel (tier_benefits)
// ──────────────────────────────────────────────────────────

export const tierBenefitKindSchema = z.enum(['recurring_reward', 'discount', 'perk', 'partner'])
export const tierBenefitCadenceSchema = z.enum(['none', 'birthday', 'monthly'])

const tierBenefitBase = z.object({
  tier_id: z.string().uuid(),
  kind: tierBenefitKindSchema,
  label: z.string().trim().min(1, 'Nombre requerido').max(80),
  description: optionalText(200),
  icon: optionalText(40),
  reward_id: optionalUuid,
  cadence: tierBenefitCadenceSchema.default('monthly'),
  quantity: z.coerce.number().int().min(1, 'Mínimo 1').max(20, 'Máximo 20').default(1),
  discount_pct: optionalNumber(z.coerce.number().min(0).max(100)),
  discount_scope: optionalText(60),
  partner_id: optionalUuid,
  sort: z.coerce.number().int().default(0),
  active: z.coerce.boolean().default(true),
})

const refineBenefitShape = (d: z.infer<typeof tierBenefitBase>, ctx: z.RefinementCtx) => {
  if (d.kind === 'recurring_reward' && !d.reward_id) {
    ctx.addIssue({ code: 'custom', message: 'Elegí la recompensa gratis', path: ['reward_id'] })
  }
  if (d.kind === 'discount' && d.discount_pct === null) {
    ctx.addIssue({ code: 'custom', message: 'Indicá el % de descuento', path: ['discount_pct'] })
  }
  if (d.kind === 'partner' && !d.partner_id) {
    ctx.addIssue({ code: 'custom', message: 'Elegí la marca aliada', path: ['partner_id'] })
  }
}

export const createTierBenefitSchema = tierBenefitBase.superRefine(refineBenefitShape)
export const updateTierBenefitSchema = tierBenefitBase
  .extend({ id: z.string().uuid() })
  .superRefine(refineBenefitShape)

export type CreateTierBenefitInput = z.infer<typeof createTierBenefitSchema>
export type UpdateTierBenefitInput = z.infer<typeof updateTierBenefitSchema>

// ──────────────────────────────────────────────────────────
// Marcas aliadas (partners)
// ──────────────────────────────────────────────────────────

export const createPartnerSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(80),
  logo_url: optionalText(500),
  discount_label: optionalText(40),
  category: optionalText(40),
  url: optionalText(500),
  active: z.coerce.boolean().default(false),
  sort: z.coerce.number().int().default(0),
})

export const updatePartnerSchema = createPartnerSchema.extend({ id: z.string().uuid() })

export type CreatePartnerInput = z.infer<typeof createPartnerSchema>
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>

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
