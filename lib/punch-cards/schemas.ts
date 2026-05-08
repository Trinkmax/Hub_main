import { z } from 'zod'

const nameField = z.string().trim().min(1, 'Requerido').max(80, 'Máximo 80')
const triggerType = z.enum(['item', 'category', 'tag'])

export const createPunchCardSchema = z.object({
  name: nameField,
  description: z.string().trim().max(400).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  trigger_type: triggerType,
  trigger_ref_id: z.string().uuid(),
  threshold: z.coerce.number().int().min(2).max(100),
  reward_id: z.string().uuid(),
  expires_after_days: z.coerce.number().int().min(1).max(365).nullable().optional(),
})

export const updatePunchCardSchema = createPunchCardSchema.extend({
  id: z.string().uuid(),
  active: z.coerce.boolean().default(true),
})

export const punchCardIdSchema = z.object({ id: z.string().uuid() })
