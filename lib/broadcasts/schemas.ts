import { z } from 'zod'

export const broadcastCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  channel_id: z.string().uuid(),
  template_id: z.string().uuid(),
  audience_id: z.string().uuid(),
  scheduled_at: z.string().datetime().optional(),
  variable_mapping: z.record(z.string(), z.string()).default({}),
})
export type BroadcastCreateInput = z.infer<typeof broadcastCreateSchema>
