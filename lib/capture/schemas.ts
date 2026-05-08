import { z } from 'zod'
import { tryNormalizePhone } from '@/lib/phone'

const nameField = z.string().trim().min(1, 'Requerido').max(60, 'Máximo 60')

export const captureSubmitSchema = z.object({
  link_slug: z
    .string()
    .min(4)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Link inválido'),
  phone: z
    .string()
    .min(1, 'Ingresá tu teléfono')
    .transform((v, ctx) => {
      const normalized = tryNormalizePhone(v)
      if (!normalized) {
        ctx.addIssue({ code: 'custom', message: 'Teléfono inválido' })
        return z.NEVER
      }
      return normalized
    }),
  first_name: nameField,
  last_name: nameField,
  opt_in_marketing: z.coerce.boolean().default(false),
  // Honeypot: debe venir vacío. Si trae algo, es bot.
  website: z.union([z.string().max(0, 'spam'), z.undefined(), z.null()]).optional(),
})

export type CaptureSubmitInput = z.infer<typeof captureSubmitSchema>
