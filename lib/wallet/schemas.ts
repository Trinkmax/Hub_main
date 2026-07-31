import { z } from 'zod'

// Bordes de la wallet pública. El ÚNICO input de identidad es el `qr_token` del
// socio (capability): nunca se acepta un customer_id ni un tenant_id del request.

/** Mismo largo que `generate_qr_token` (ver customers.qr_token / redeem_token). */
export const walletTokenSchema = z
  .string()
  .trim()
  .min(16, 'Código inválido')
  .max(128, 'Código inválido')
  .regex(/^[A-Za-z0-9_-]+$/, 'Código inválido')

export const requestRedemptionSchema = z.object({
  qr_token: walletTokenSchema,
  reward_id: z.string().uuid('Recompensa inválida'),
})

export const redemptionRefSchema = z.object({
  qr_token: walletTokenSchema,
  redemption_id: z.string().uuid('Canje inválido'),
})

export type RequestRedemptionInput = z.infer<typeof requestRedemptionSchema>
export type RedemptionRefInput = z.infer<typeof redemptionRefSchema>
