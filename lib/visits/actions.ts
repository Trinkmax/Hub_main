'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

const closeTableSchema = z.object({
  customer_id: z.string().uuid(),
  items: z
    .array(
      z.object({ item_id: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(99) }),
    )
    .min(1, 'Tenés que agregar al menos un ítem'),
  notes: z
    .union([z.string().trim().max(300), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v && v.length > 0 ? v : null)),
})

const redeemSchema = z.object({
  customer_id: z.string().uuid(),
  reward_id: z.string().uuid(),
})

export type CloseTableState =
  | {
      ok: true
      visit_id: string
      points_awarded: number
      breakdown: Array<{ description: string; points: number }>
    }
  | { ok: false; message: string }

export type RedeemState =
  | { ok: true; redemption_id: string; balance_after: number }
  | { ok: false; message: string; code?: string }

async function authorizeCashierOrOwner(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner', 'cashier'])
    return { tenant, role }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    )
      return null
    throw error
  }
}

export async function closeTable(
  slug: string,
  payload: {
    customer_id: string
    items: { item_id: string; quantity: number }[]
    notes?: string | null
  },
): Promise<CloseTableState> {
  const access = await authorizeCashierOrOwner(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = closeTableSchema.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('close_table', {
    p_customer_id: parsed.data.customer_id,
    p_items: parsed.data.items,
    p_notes: parsed.data.notes,
  })
  if (error) {
    console.error('[close_table] failed:', error.message)
    return { ok: false, message: humanizeRpcError(error.message) }
  }

  const result = Array.isArray(data) ? data[0] : data
  if (!result) return { ok: false, message: 'No pudimos cerrar la mesa.' }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'visit.closed',
    entity: 'visit',
    entityId: result.visit_id,
    payload: { points_awarded: result.points_awarded },
  })

  revalidatePath(`/${slug}/clientes/${parsed.data.customer_id}`)
  revalidatePath(`/${slug}/clientes`)

  const breakdown = (
    (result.breakdown as unknown as { description: string; points: number }[]) ?? []
  ).map((b) => ({ description: b.description, points: b.points }))

  return {
    ok: true,
    visit_id: result.visit_id,
    points_awarded: result.points_awarded,
    breakdown,
  }
}

export async function redeemReward(
  slug: string,
  payload: { customer_id: string; reward_id: string },
): Promise<RedeemState> {
  const access = await authorizeCashierOrOwner(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = redeemSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('redeem_reward', {
    p_customer_id: parsed.data.customer_id,
    p_reward_id: parsed.data.reward_id,
  })
  if (error) {
    return { ok: false, message: humanizeRpcError(error.message), code: error.message }
  }

  const result = Array.isArray(data) ? data[0] : data
  if (!result) return { ok: false, message: 'No pudimos canjear.' }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'reward.redeemed',
    entity: 'reward_redemption',
    entityId: result.redemption_id,
    payload: { reward_id: parsed.data.reward_id },
  })

  revalidatePath(`/${slug}/clientes/${parsed.data.customer_id}`)

  return {
    ok: true,
    redemption_id: result.redemption_id,
    balance_after: result.balance_after,
  }
}

function humanizeRpcError(message: string): string {
  if (message.includes('insufficient_balance')) return 'El cliente no tiene puntos suficientes.'
  if (message.includes('reward_inactive')) return 'La recompensa está pausada.'
  if (message.includes('out_of_stock')) return 'No queda stock de esa recompensa.'
  if (message.includes('reward_not_found')) return 'La recompensa no existe.'
  if (message.includes('customer_not_found')) return 'El cliente no existe.'
  if (message.includes('forbidden')) return 'No tenés permiso para esta acción.'
  if (message.includes('items_required')) return 'Agregá al menos un ítem.'
  if (message.includes('invalid_quantity')) return 'Las cantidades deben ser positivas.'
  if (message.includes('invalid_or_inactive_item')) return 'Hay un ítem inválido o pausado.'
  return 'No pudimos completar la acción.'
}
