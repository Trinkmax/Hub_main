import { z } from 'zod'

const nameField = z.string().trim().min(1, 'Requerido').max(80, 'Máximo 80')
const triggerType = z.enum(['item', 'category', 'tag', 'visit_window'])

const timeField = z
  .union([z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Formato HH:mm'), z.literal('')])
  .transform((v) => (v && v.length > 0 ? v : null))
  .nullable()

const visitWindowConfigSchema = z.object({
  hours_from: timeField.optional(),
  hours_to: timeField.optional(),
  days_of_week: z
    .array(z.coerce.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .default([1, 2, 3, 4, 5]),
  max_per_day: z.coerce.number().int().min(1).max(5).default(1),
  period_days: z.coerce.number().int().min(1).max(365).nullable().optional(),
})

const basePunchCard = z.object({
  name: nameField,
  description: z.string().trim().max(400).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  trigger_type: triggerType,
  trigger_ref_id: z.string().uuid().nullable().optional(),
  threshold: z.coerce.number().int().min(2).max(100),
  reward_id: z.string().uuid(),
  expires_after_days: z.coerce.number().int().min(1).max(365).nullable().optional(),
  config: visitWindowConfigSchema.optional(),
})

export const createPunchCardSchema = basePunchCard.superRefine((val, ctx) => {
  if (val.trigger_type === 'visit_window') {
    if (val.trigger_ref_id != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['trigger_ref_id'],
        message: 'visit_window no usa trigger_ref_id',
      })
    }
  } else if (!val.trigger_ref_id) {
    ctx.addIssue({
      code: 'custom',
      path: ['trigger_ref_id'],
      message: 'Elegí el ítem, categoría o tag.',
    })
  }
})

export const updatePunchCardSchema = basePunchCard
  .extend({
    id: z.string().uuid(),
    active: z.coerce.boolean().default(true),
  })
  .superRefine((val, ctx) => {
    if (val.trigger_type === 'visit_window') {
      if (val.trigger_ref_id != null) {
        ctx.addIssue({
          code: 'custom',
          path: ['trigger_ref_id'],
          message: 'visit_window no usa trigger_ref_id',
        })
      }
    } else if (!val.trigger_ref_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['trigger_ref_id'],
        message: 'Elegí el ítem, categoría o tag.',
      })
    }
  })

export const punchCardIdSchema = z.object({ id: z.string().uuid() })

export const lunchVisitSchema = z.object({
  customer_id: z.string().uuid(),
  template_id: z.string().uuid(),
})

export type VisitWindowConfig = z.infer<typeof visitWindowConfigSchema>
