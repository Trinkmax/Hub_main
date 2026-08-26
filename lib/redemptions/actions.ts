'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { REDEMPTION_STAFF_ROLES } from '@/lib/tenant/roles'
import { loadWalletPunchCards, type WalletPunchCard } from '@/lib/wallet/punch-cards'
import { customerIdSchema, redeemTokenInputSchema } from './schemas'

// Lado STAFF del canje: mirar un código y entregarlo. Toda la lógica sensible
// (roles, puntos, stock, expiración) vive en las RPC `SECURITY DEFINER`; acá
// validamos el borde, traducimos errores a castellano accionable y auditamos.

export type RedemptionView = {
  redemptionId: string
  status: 'pending' | 'delivered' | 'cancelled'
  source: string
  pointsSpent: number
  expired: boolean
  deliveredAt: string | null
  deliveredByName: string | null
  customerName: string
  customerPointsBalance: number
  rewardName: string | null
  rewardImageUrl: string | null
  notes: string | null
}

export type LookupRedemptionResult =
  | { ok: true; redemption: RedemptionView }
  | { ok: false; message: string }

export type DeliverRedemptionResult =
  | { ok: true; customerName: string; rewardName: string | null; pointsSpent: number }
  | { ok: false; message: string }

async function authorizeStaff(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, REDEMPTION_STAFF_ROLES)
    return { tenant, role }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

const RPC_ERRORS: Record<string, string> = {
  redemption_not_found:
    'Este código no existe o ya se usó. Pedile al socio que lo genere de nuevo.',
  redemption_already_delivered: 'Este beneficio ya fue entregado.',
  redemption_expired: 'El código venció. Pedile al socio que lo genere de nuevo.',
  redemption_cancelled: 'El socio canceló este canje.',
  insufficient_points: 'Al socio ya no le alcanzan los puntos para este canje.',
  reward_out_of_stock: 'Se quedó sin stock. No se puede entregar.',
  forbidden: 'No tenés permiso para validar canjes.',
}

function messageFor(raw: string, fallback: string): string {
  for (const [code, message] of Object.entries(RPC_ERRORS)) {
    if (raw.includes(code)) return message
  }
  return fallback
}

type RedemptionRpc = {
  redemption_id: string
  status: string
  source: string
  points_spent: number
  expired: boolean
  delivered_at: string | null
  delivered_by_name: string | null
  customer_name: string
  customer_points_balance: number
  reward_name: string | null
  reward_image_url: string | null
  notes: string | null
}

function toView(data: unknown): RedemptionView {
  const raw = data as RedemptionRpc
  const status =
    raw.status === 'delivered' || raw.status === 'cancelled' ? raw.status : ('pending' as const)
  return {
    redemptionId: raw.redemption_id,
    status,
    source: raw.source,
    pointsSpent: raw.points_spent ?? 0,
    expired: Boolean(raw.expired),
    deliveredAt: raw.delivered_at,
    deliveredByName: raw.delivered_by_name,
    customerName: raw.customer_name?.trim() || 'Socio',
    customerPointsBalance: raw.customer_points_balance ?? 0,
    rewardName: raw.reward_name,
    rewardImageUrl: raw.reward_image_url,
    notes: raw.notes,
  }
}

/** Paso 1: leer el código escaneado y mostrar qué hay que entregar y a quién. */
export async function lookupRedemption(
  slug: string,
  redeemToken: string,
): Promise<LookupRedemptionResult> {
  const access = await authorizeStaff(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = redeemTokenInputSchema.safeParse({ redeem_token: redeemToken })
  if (!parsed.success) return { ok: false, message: 'Código inválido.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_redemption_by_token', {
    p_redeem_token: parsed.data.redeem_token,
  })
  if (error) {
    const message = messageFor(error.message, 'No pudimos leer el código.')
    if (message === 'No pudimos leer el código.') {
      console.error('[redemptions.lookup]', error.message)
    }
    return { ok: false, message }
  }
  return { ok: true, redemption: toView(data) }
}

/** Paso 2: entregar. Recién acá se descuentan los puntos y el stock. */
export async function deliverRedemption(
  slug: string,
  redeemToken: string,
): Promise<DeliverRedemptionResult> {
  const access = await authorizeStaff(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = redeemTokenInputSchema.safeParse({ redeem_token: redeemToken })
  if (!parsed.success) return { ok: false, message: 'Código inválido.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('deliver_reward_redemption', {
    p_redeem_token: parsed.data.redeem_token,
  })
  if (error) {
    const message = messageFor(error.message, 'No pudimos entregar el beneficio.')
    if (message === 'No pudimos entregar el beneficio.') {
      console.error('[redemptions.deliver]', error.message)
    }
    return { ok: false, message }
  }

  const result = (data ?? {}) as {
    redemption_id?: string
    customer_name?: string
    reward_name?: string | null
    points_spent?: number
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'reward_redemption.delivered',
    entity: 'reward_redemption',
    entityId: result.redemption_id ?? null,
    payload: { points_spent: result.points_spent ?? 0 },
  })

  revalidatePath(`/${slug}/salon/escanear`)
  return {
    ok: true,
    customerName: result.customer_name?.trim() || 'Socio',
    rewardName: result.reward_name ?? null,
    pointsSpent: result.points_spent ?? 0,
  }
}

export type CustomerPunchCardsResult =
  | { ok: true; cards: WalletPunchCard[] }
  | { ok: false; message: string }

/**
 * Tarjetas de sellos de un socio para la caja. Mismo shape que ve el socio en su
 * billetera — el cajero y el cliente miran exactamente lo mismo, que es lo que
 * evita la discusión en el mostrador.
 */
export async function listCustomerCards(
  slug: string,
  customerId: string,
): Promise<CustomerPunchCardsResult> {
  const access = await authorizeStaff(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = customerIdSchema.safeParse({ customer_id: customerId })
  if (!parsed.success) return { ok: false, message: 'Cliente inválido.' }

  const supabase = await createClient()
  const cards = await loadWalletPunchCards(supabase, access.tenant.id, parsed.data.customer_id)
  return { ok: true, cards }
}
