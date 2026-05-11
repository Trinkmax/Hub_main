import { isValidPhoneNumber } from 'libphonenumber-js'
import { z } from 'zod'
import { tryNormalizePhone } from '@/lib/phone'

// Acepta E.164 nuevo (`+5493515551234`, vía react-phone-number-input) o
// cualquier formato heredado que pase por tryNormalizePhone (imports viejos,
// capture link). Conserva un solo punto de validación.
const phoneField = z
  .string()
  .min(1, 'Ingresá un teléfono')
  .transform((v, ctx) => {
    const trimmed = v.trim()
    if (trimmed.startsWith('+') && isValidPhoneNumber(trimmed)) {
      return trimmed
    }
    const normalized = tryNormalizePhone(trimmed)
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Teléfono inválido' })
      return z.NEVER
    }
    return normalized
  })

const nameField = z.string().trim().min(1, 'Requerido').max(60, 'Máximo 60 caracteres')

const emailField = z
  .union([z.string().trim().email('Email inválido').max(120), z.literal(''), z.null()])
  .transform((v) => (v && v.length > 0 ? v.toLowerCase() : null))

const birthdateField = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido'), z.literal(''), z.null()])
  .transform((v) => (v && v.length > 0 ? v : null))

export const createCustomerSchema = z.object({
  phone: phoneField,
  first_name: nameField,
  last_name: nameField,
  email: emailField.optional(),
  birthdate: birthdateField.optional(),
  opt_in_marketing: z.coerce.boolean().default(false),
})

export const updateCustomerSchema = z.object({
  id: z.string().uuid(),
  first_name: nameField,
  last_name: nameField,
  phone: phoneField,
  email: emailField.optional(),
  notes: z
    .union([z.string().trim().max(500), z.null(), z.undefined()])
    .transform((v) => (v && v.length > 0 ? v : null)),
  birthdate: birthdateField,
  opt_in_marketing: z.coerce.boolean().default(false),
})

export const customerIdSchema = z.object({ id: z.string().uuid() })

export const tagAssignmentSchema = z.object({
  customer_id: z.string().uuid(),
  tag_id: z.string().uuid(),
})

export const listFiltersSchema = z.object({
  q: z.string().trim().max(80).optional(),
  tag: z.string().uuid().optional(),
  since: z.enum(['30d', '90d', 'never']).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
})

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>
export type ListFilters = z.infer<typeof listFiltersSchema>
