import { z } from 'zod'

export const capturePromptConfigSchema = z.object({
  enabled: z.coerce.boolean().default(true),
  headline: z.string().trim().min(1, 'Título requerido').max(80, 'Máximo 80'),
  subtext: z.string().trim().min(1, 'Subtítulo requerido').max(160, 'Máximo 160'),
})

export type CapturePromptConfig = z.infer<typeof capturePromptConfigSchema>

export const DEFAULT_CAPTURE_PROMPT: CapturePromptConfig = {
  enabled: true,
  headline: 'Sumá puntos en cada visita',
  subtext: 'Dejá tu nombre y teléfono y empezá a ganar beneficios.',
}
