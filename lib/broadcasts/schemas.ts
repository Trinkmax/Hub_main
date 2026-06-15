import { z } from 'zod'
import { variableMappingSchema } from './variables'

export const broadcastCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  channel_id: z.string().uuid(),
  template_id: z.string().uuid(),
  audience_id: z.string().uuid(),
  scheduled_at: z.string().datetime().optional(),
  variable_mapping: variableMappingSchema.default({}),
})
export type BroadcastCreateInput = z.infer<typeof broadcastCreateSchema>

export const broadcastTestSchema = z.object({
  channel_id: z.string().uuid(),
  template_id: z.string().uuid(),
  to_phone: z.string().trim().min(6),
  variable_mapping: variableMappingSchema.default({}),
})
export type BroadcastTestInput = z.infer<typeof broadcastTestSchema>
