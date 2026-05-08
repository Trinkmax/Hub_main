import { z } from 'zod'
import { tryNormalizePhone } from '@/lib/phone'

const browserTokenField = z.string().min(16, 'Token inválido').max(64, 'Token inválido')

const qrTokenField = z.string().min(8, 'QR inválido').max(32, 'QR inválido')

const phoneField = z
  .string()
  .min(1, 'Ingresá un teléfono')
  .transform((v, ctx) => {
    const normalized = tryNormalizePhone(v)
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Teléfono inválido' })
      return z.NEVER
    }
    return normalized
  })

const nameField = z.string().trim().min(1, 'Requerido').max(60, 'Máximo 60')

export const joinSessionSchema = z.object({
  qr_token: qrTokenField,
  browser_token: browserTokenField,
  display_name: z
    .union([z.string().trim().min(1).max(40), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null)),
})

export const registerCustomerSchema = z.object({
  qr_token: qrTokenField,
  browser_token: browserTokenField,
  phone: phoneField,
  first_name: nameField,
  last_name: nameField,
  birthdate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido'), z.literal('')])
    .transform((v) => (v && v.length > 0 ? v : null))
    .nullable()
    .optional(),
  opt_in_marketing: z.coerce.boolean().default(false),
  // honeypot
  website: z.string().optional(),
})

export const submitTicketSchema = z.object({
  qr_token: qrTokenField,
  browser_token: browserTokenField,
  items: z
    .array(
      z.object({
        menu_item_id: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(50),
        notes: z.string().trim().max(200).nullable().optional(),
        assigned_to_guest_id: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1, 'Tu carrito está vacío'),
  idempotency_key: z.string().min(8).max(64),
})

export const cancelTicketSchema = z.object({
  ticket_id: z.string().uuid(),
  browser_token: browserTokenField,
})

export const requestBillSchema = z.object({
  qr_token: qrTokenField,
  browser_token: browserTokenField,
})
