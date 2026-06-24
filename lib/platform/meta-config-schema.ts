import { z } from 'zod'

export const savePlatformMetaConfigSchema = z.object({
  appId: z.string().trim().min(1).max(64),
  appSecret: z.string().trim().max(256).nullable().optional(), // vacío/null/ausente = conservar el existente
  webhookVerifyToken: z.string().trim().min(1).max(256),
})
export type SavePlatformMetaConfigInput = z.infer<typeof savePlatformMetaConfigSchema>
