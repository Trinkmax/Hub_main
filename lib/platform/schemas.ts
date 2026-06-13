import { z } from 'zod'
import { FEATURE_KEYS } from './features'

export const setTenantFeatureSchema = z.object({
  tenantId: z.string().uuid(),
  key: z.enum(FEATURE_KEYS as [string, ...string[]]),
  enabled: z.boolean(),
})

export type SetTenantFeatureInput = z.infer<typeof setTenantFeatureSchema>
