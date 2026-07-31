import { z } from 'zod'

export const redeemTokenSchema = z
  .string()
  .trim()
  .min(16, 'Código inválido')
  .max(128, 'Código inválido')
  .regex(/^[A-Za-z0-9_-]+$/, 'Código inválido')

export const redeemTokenInputSchema = z.object({ redeem_token: redeemTokenSchema })

export const customerIdSchema = z.object({ customer_id: z.string().uuid('Cliente inválido') })

export const addStampInputSchema = z.object({
  customer_id: z.string().uuid('Cliente inválido'),
  template_id: z.string().uuid('Tarjeta inválida'),
})
