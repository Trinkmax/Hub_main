import { z } from 'zod'

const nameField = z.string().trim().min(1, 'Requerido').max(80, 'Máximo 80')

/**
 * Cómo avanza la tarjeta. `manual` es el default desde 2026-07: el cajero
 * aprieta "+1" en /acreditar. Los triggers automáticos (item/category/tag)
 * dependen del módulo de mesas prendido.
 */
export const PUNCH_TRIGGER_TYPES = ['manual', 'item', 'category', 'tag', 'visit_window'] as const
export type PunchTriggerType = (typeof PUNCH_TRIGGER_TYPES)[number]

const triggerType = z.enum(PUNCH_TRIGGER_TYPES)

/** Triggers que necesitan apuntar a un ítem / categoría / etiqueta concreta. */
const TRIGGERS_WITH_REF = new Set<PunchTriggerType>(['item', 'category', 'tag'])

export function triggerNeedsRef(trigger: string): boolean {
  return TRIGGERS_WITH_REF.has(trigger as PunchTriggerType)
}

const timeField = z
  .union([z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Formato HH:mm'), z.literal('')])
  .transform((v) => (v && v.length > 0 ? v : null))
  .nullable()

const optionalPositiveInt = (max: number) =>
  z
    .union([z.coerce.number().int().min(1).max(max), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null))

/**
 * Config del template. `max_per_day` (tope de sellos por día) aplica a
 * cualquier trigger y lo lee `add_punch_stamp`; el resto sólo tiene sentido
 * para `visit_window` y lo lee `register_lunch_visit`.
 */
const punchConfigSchema = z.object({
  hours_from: timeField.optional(),
  hours_to: timeField.optional(),
  days_of_week: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7).optional(),
  max_per_day: optionalPositiveInt(20).optional(),
  period_days: optionalPositiveInt(365).optional(),
})

const basePunchCard = z.object({
  name: nameField,
  description: z.string().trim().max(400).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  /** Ícono Lucide del sello (ej: Coffee). Cae a un sello genérico si viene vacío. */
  stamp_icon: z.string().trim().max(40).nullable().optional(),
  /** Texto del premio tal cual lo lee el socio ("el 7mo café va de regalo"). */
  reward_label: z.string().trim().max(120).nullable().optional(),
  trigger_type: triggerType,
  trigger_ref_id: z.string().uuid().nullable().optional(),
  threshold: z.coerce
    .number()
    .int()
    .min(2, 'Mínimo 2 sellos')
    .max(100, 'Máximo 100 sellos')
    .describe('Sellos que hay que juntar para ganar el premio'),
  reward_id: z.string().uuid('Elegí qué se gana al completarla'),
  expires_after_days: z.coerce.number().int().min(1).max(365).nullable().optional(),
  config: punchConfigSchema.optional(),
  /**
   * Niveles habilitados a sellarla. Vacío = todos, que es lo que hace que las
   * tarjetas de siempre sigan andando igual. El set es arbitrario (no "de tal
   * nivel para arriba") porque el dueño puede querer saltear un nivel.
   */
  tier_ids: z.array(z.string().uuid()).max(20).default([]),
  /** Qué ve el socio que no llega al nivel: bloqueada (true) o nada. */
  show_when_locked: z.coerce.boolean().default(true),
})

const refineTriggerRef = (
  val: { trigger_type: PunchTriggerType; trigger_ref_id?: string | null },
  ctx: z.RefinementCtx,
) => {
  if (TRIGGERS_WITH_REF.has(val.trigger_type)) {
    if (!val.trigger_ref_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['trigger_ref_id'],
        message: 'Elegí el ítem, categoría o etiqueta.',
      })
    }
  } else if (val.trigger_ref_id != null) {
    ctx.addIssue({
      code: 'custom',
      path: ['trigger_ref_id'],
      message: 'Este disparador no apunta a un ítem.',
    })
  }
}

export const createPunchCardSchema = basePunchCard.superRefine(refineTriggerRef)

export const updatePunchCardSchema = basePunchCard
  .extend({
    id: z.string().uuid(),
    active: z.coerce.boolean().default(true),
  })
  .superRefine(refineTriggerRef)

export const punchCardIdSchema = z.object({ id: z.string().uuid() })

export const reorderPunchCardsSchema = z.object({
  ordered_ids: z.array(z.string().uuid()).max(200),
})

export const lunchVisitSchema = z.object({
  customer_id: z.string().uuid(),
  template_id: z.string().uuid(),
})

/** Un sello manual: mismo par cliente + template que el almuerzo. */
export const stampSchema = lunchVisitSchema

export type PunchConfig = z.infer<typeof punchConfigSchema>
/** @deprecated Alias histórico: la config ya no es exclusiva de `visit_window`. */
export type VisitWindowConfig = PunchConfig
