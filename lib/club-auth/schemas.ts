import { z } from 'zod'
import { tryNormalizePhone } from '@/lib/phone'

/**
 * Bordes de la cuenta del socio (el cliente final del bar).
 *
 * Módulo puro a propósito (sin `server-only`): lo importan tanto las Server
 * Actions de `lib/club-auth/actions.ts` como el schema de alta en
 * `lib/capture/schemas.ts`, y los tests unitarios lo ejercitan sin Supabase.
 */

/**
 * Mínimo 6 — es el mismo piso que valida la RPC (`weak_password`), así que
 * subirlo acá sin tocar la DB sólo movería el error de lugar. Tope 72 porque
 * bcrypt trunca ahí: aceptar más daría una falsa sensación de fuerza.
 */
export const clubPasswordField = z
  .string()
  .min(6, 'La contraseña necesita al menos 6 caracteres')
  .max(72, 'Máximo 72 caracteres')

/**
 * En el login NO aplicamos la política de largo: una contraseña vieja más
 * corta que la política actual tiene que poder entrar, y devolver "mínimo 6"
 * antes de consultar la DB filtraría información sobre la política.
 */
export const clubPasswordLoginField = z.string().min(1, 'Ingresá tu contraseña').max(200)

export const clubLinkSlugField = z
  .string()
  .min(4)
  .max(32)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Link inválido')

export const clubTenantSlugField = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'Local inválido')

export const clubPhoneField = z
  .string()
  .min(1, 'Ingresá tu teléfono')
  .transform((v, ctx) => {
    const normalized = tryNormalizePhone(v)
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Teléfono inválido' })
      return z.NEVER
    }
    return normalized
  })

/**
 * Código OTP de 6 dígitos. Limpiamos todo lo que no sea número porque el socio
 * suele pegarlo desde WhatsApp con espacios, guiones o el texto alrededor.
 */
export const clubResetCodeField = z
  .string()
  .min(1, 'Ingresá el código')
  .max(40)
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => /^\d{6}$/.test(v), 'El código son 6 números')

/** Ticket de un solo uso que devuelve `club_verify_reset_code` (token opaco). */
export const clubResetTicketField = z.string().min(8, 'Pedido inválido').max(200)

export const clubLoginSchema = z.object({
  link_slug: clubLinkSlugField,
  phone: clubPhoneField,
  password: clubPasswordLoginField,
})

export const clubResetRequestSchema = z.object({
  link_slug: clubLinkSlugField,
  phone: clubPhoneField,
})

export const clubVerifyCodeSchema = z.object({
  link_slug: clubLinkSlugField,
  phone: clubPhoneField,
  code: clubResetCodeField,
})

export const clubSetPasswordSchema = z.object({
  reset_ticket: clubResetTicketField,
  password: clubPasswordField,
})

export const clubLogoutSchema = z.object({
  tenant_slug: clubTenantSlugField,
})

export type ClubLoginInput = z.infer<typeof clubLoginSchema>
export type ClubResetRequestInput = z.infer<typeof clubResetRequestSchema>
export type ClubVerifyCodeInput = z.infer<typeof clubVerifyCodeSchema>
export type ClubSetPasswordInput = z.infer<typeof clubSetPasswordSchema>
