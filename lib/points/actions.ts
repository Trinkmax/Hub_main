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
import {
  createRewardSchema,
  createRuleSchema,
  createTierSchema,
  type UpdatePointsRedemptionConfigInput,
  updatePointsRedemptionConfigSchema,
  updateRewardSchema,
  updateTierSchema,
} from './schemas'

export type LoyaltyActionState = { ok: true; message?: string } | { ok: false; message: string }

export type AwardResult =
  | {
      ok: true
      customer_id: string
      points_awarded: number
      amount_cents: number
      new_balance: number
    }
  | { ok: false; message: string }

const awardSchema = z.object({
  customer_id: z.string().uuid(),
  amount_cents: z.coerce.number().int().min(1).max(1_000_000_000_000),
})

async function authorizeAnyStaff(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner', 'cashier', 'waiter'])
    return tenant
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

export async function awardPointsByAmount(
  slug: string,
  payload: { customer_id: string; amount_cents: number },
): Promise<AwardResult> {
  const tenant = await authorizeAnyStaff(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = awardSchema.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
  }

  const supabase = await createClient()
  const { data: customer } = await supabase
    .from('customers')
    .select('id, tenant_id')
    .eq('id', parsed.data.customer_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer || customer.tenant_id !== tenant.id) {
    return { ok: false, message: 'Cliente no encontrado.' }
  }

  const { data, error } = await supabase.rpc('award_points_by_amount', {
    p_customer_id: parsed.data.customer_id,
    p_amount_cents: parsed.data.amount_cents,
  })
  if (error) {
    return { ok: false, message: error.message }
  }

  const result = (data ?? {}) as {
    visit_id?: string
    points_awarded?: number
    amount_cents?: number
    new_balance?: number
  }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'points.qr_award',
    entity: 'customer',
    entityId: parsed.data.customer_id,
    payload: { amount_cents: parsed.data.amount_cents, points: result.points_awarded ?? 0 },
  })

  revalidatePath(`/${slug}/clientes/${parsed.data.customer_id}`)

  return {
    ok: true,
    customer_id: parsed.data.customer_id,
    points_awarded: result.points_awarded ?? 0,
    amount_cents: result.amount_cents ?? parsed.data.amount_cents,
    new_balance: result.new_balance ?? 0,
  }
}

export async function lookupCustomerByQr(
  slug: string,
  qrToken: string,
): Promise<
  | {
      ok: true
      customer: {
        id: string
        first_name: string
        last_name: string
        phone: string
        points_balance: number
      }
    }
  | { ok: false; message: string }
> {
  const tenant = await authorizeAnyStaff(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  // Lazy import para no crear ciclo
  const { getCustomerByQrToken } = await import('@/lib/customers/queries')
  const customer = await getCustomerByQrToken({ tenantId: tenant.id, token: qrToken })
  if (!customer) return { ok: false, message: 'QR no reconocido.' }
  return { ok: true, customer }
}

async function authorizeOwner(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return tenant
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

// ──────────────────────────────────────────────────────────
// Rules
// ──────────────────────────────────────────────────────────

export async function createPerAmountRule(
  slug: string,
  _prev: LoyaltyActionState,
  formData: FormData,
): Promise<LoyaltyActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createRuleSchema.safeParse({
    type: 'per_amount',
    config: {
      every_cents: formData.get('every_cents'),
      points: formData.get('points'),
    },
    priority: formData.get('priority') ?? 0,
    active: formData.get('active') === 'on' || formData.get('active') === 'true',
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('points_rules').insert({
    tenant_id: tenant.id,
    type: parsed.data.type,
    config: parsed.data.config,
    priority: parsed.data.priority,
    active: parsed.data.active,
  })
  if (error) return { ok: false, message: 'No pudimos crear la regla.' }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'points_rule.created',
    entity: 'points_rule',
    payload: { type: parsed.data.type, config: parsed.data.config },
  })

  revalidatePath(`/${slug}/club/puntos`)
  return { ok: true, message: 'Regla creada.' }
}

export async function createPerItemRule(
  slug: string,
  payload: { mode: 'item' | 'category'; targetId: string; points: number; priority: number },
): Promise<LoyaltyActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const config =
    payload.mode === 'item'
      ? { item_id: payload.targetId, points: payload.points }
      : { category_id: payload.targetId, points: payload.points }

  const parsed = createRuleSchema.safeParse({
    type: 'per_item',
    config,
    priority: payload.priority,
    active: true,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('points_rules').insert({
    tenant_id: tenant.id,
    type: parsed.data.type,
    config: parsed.data.config,
    priority: parsed.data.priority,
    active: parsed.data.active,
  })
  if (error) return { ok: false, message: 'No pudimos crear la regla.' }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'points_rule.created',
    entity: 'points_rule',
    payload: { type: parsed.data.type, config: parsed.data.config },
  })

  revalidatePath(`/${slug}/club/puntos`)
  return { ok: true, message: 'Regla creada.' }
}

export async function toggleRule(
  slug: string,
  ruleId: string,
  active: boolean,
): Promise<LoyaltyActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(ruleId)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('points_rules')
    .update({ active })
    .eq('id', idParsed.data)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos actualizar.' }

  revalidatePath(`/${slug}/club/puntos`)
  return { ok: true }
}

export async function deleteRule(slug: string, ruleId: string): Promise<LoyaltyActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(ruleId)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('points_rules')
    .delete()
    .eq('id', idParsed.data)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos borrar.' }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'points_rule.deleted',
    entity: 'points_rule',
    entityId: idParsed.data,
  })

  revalidatePath(`/${slug}/club/puntos`)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────
// Rewards
// ──────────────────────────────────────────────────────────

export async function createReward(
  slug: string,
  _prev: LoyaltyActionState,
  formData: FormData,
): Promise<LoyaltyActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createRewardSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description'),
    cost_points: formData.get('cost_points'),
    stock: formData.get('stock'),
    min_tier_id: formData.get('min_tier_id'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('rewards').insert({
    tenant_id: tenant.id,
    name: parsed.data.name,
    description: parsed.data.description,
    cost_points: parsed.data.cost_points,
    stock: parsed.data.stock,
    min_tier_id: parsed.data.min_tier_id,
  })
  if (error) return { ok: false, message: 'No pudimos crear la recompensa.' }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'reward.created',
    entity: 'reward',
    payload: { name: parsed.data.name, cost_points: parsed.data.cost_points },
  })

  revalidatePath(`/${slug}/club/puntos`)
  return { ok: true, message: 'Recompensa creada.' }
}

export async function updateReward(
  slug: string,
  payload: {
    id: string
    name: string
    description: string | null
    cost_points: number
    stock: number | null
    active: boolean
    min_tier_id?: string | null
  },
): Promise<LoyaltyActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateRewardSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('rewards')
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      cost_points: parsed.data.cost_points,
      stock: parsed.data.stock,
      active: parsed.data.active,
      min_tier_id: parsed.data.min_tier_id,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos actualizar.' }

  revalidatePath(`/${slug}/club`)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────
// Niveles del club (loyalty_tiers)
// ──────────────────────────────────────────────────────────

export async function createTier(slug: string, input: unknown): Promise<LoyaltyActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createTierSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('loyalty_tiers').insert({
    tenant_id: tenant.id,
    name: parsed.data.name,
    color: parsed.data.color,
    badge_icon: parsed.data.badge_icon,
    min_lifetime_points: parsed.data.min_lifetime_points,
    sort: parsed.data.sort,
    benefit_cadence: parsed.data.benefit_cadence,
    benefit_reward_id: parsed.data.benefit_reward_id,
    perks: parsed.data.perks,
    active: parsed.data.active,
  })
  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Ya existe un nivel con ese umbral de puntos.' }
    }
    return { ok: false, message: 'No pudimos crear el nivel.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'loyalty_tier.created',
    entity: 'loyalty_tier',
    payload: { name: parsed.data.name, min_lifetime_points: parsed.data.min_lifetime_points },
  })

  revalidatePath(`/${slug}/club/niveles`)
  return { ok: true, message: 'Nivel creado.' }
}

export async function updateTier(slug: string, input: unknown): Promise<LoyaltyActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateTierSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('loyalty_tiers')
    .update({
      name: parsed.data.name,
      color: parsed.data.color,
      badge_icon: parsed.data.badge_icon,
      min_lifetime_points: parsed.data.min_lifetime_points,
      sort: parsed.data.sort,
      benefit_cadence: parsed.data.benefit_cadence,
      benefit_reward_id: parsed.data.benefit_reward_id,
      perks: parsed.data.perks,
      active: parsed.data.active,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Ya existe un nivel con ese umbral de puntos.' }
    }
    return { ok: false, message: 'No pudimos actualizar el nivel.' }
  }

  revalidatePath(`/${slug}/club/niveles`)
  return { ok: true }
}

export async function deleteTier(slug: string, id: string): Promise<LoyaltyActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(id)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('loyalty_tiers')
    .delete()
    .eq('id', idParsed.data)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos borrar el nivel.' }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'loyalty_tier.deleted',
    entity: 'loyalty_tier',
    entityId: idParsed.data,
  })

  revalidatePath(`/${slug}/club/niveles`)
  return { ok: true }
}

export async function deleteReward(slug: string, id: string): Promise<LoyaltyActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(id)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('rewards')
    .delete()
    .eq('id', idParsed.data)
    .eq('tenant_id', tenant.id)
  if (error) {
    if (error.code === '23503') {
      return {
        ok: false,
        message: 'No se puede borrar: hay canjes asociados. Pausá la recompensa.',
      }
    }
    return { ok: false, message: 'No pudimos borrar.' }
  }

  revalidatePath(`/${slug}/club/puntos`)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────
// Config de redención de puntos como descuento al cobrar
// ──────────────────────────────────────────────────────────

export async function updatePointsRedemptionConfigAction(
  slug: string,
  input: UpdatePointsRedemptionConfigInput,
): Promise<LoyaltyActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updatePointsRedemptionConfigSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('tenants')
    .update({
      points_redemption_enabled: parsed.data.enabled,
      points_to_cents_rate: parsed.data.ratePointsToCents,
      points_redemption_max_pct: parsed.data.maxPct,
    })
    .eq('id', tenant.id)

  if (error) {
    console.error('[points.updateRedemptionConfig]', error.message)
    return { ok: false, message: 'No se pudo guardar la configuración.' }
  }

  revalidatePath(`/${slug}/club/puntos`)
  return { ok: true, message: 'Configuración guardada' }
}
