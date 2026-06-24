import { z } from 'zod'
import { tryNormalizePhone } from '@/lib/phone'

const nameField = z.string().trim().min(1, 'Requerido').max(60, 'Máximo 60')

// Fecha de nacimiento: YYYY-MM-DD, real y no futura, entre 1900 y hoy.
const birthdateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ingresá tu fecha de nacimiento')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00`)
    if (Number.isNaN(d.getTime())) return false
    const year = d.getUTCFullYear()
    return year >= 1900 && d.getTime() <= Date.now()
  }, 'Fecha de nacimiento inválida')

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
  email: z.string().trim().toLowerCase().email('Email inválido').max(120, 'Máximo 120'),
  birthdate: birthdateField,
  // Honeypot: debe venir vacío. Si trae algo, es bot.
  website: z.union([z.string().max(0, 'spam'), z.undefined(), z.null()]).optional(),
})

export type CaptureSubmitInput = z.infer<typeof captureSubmitSchema>
