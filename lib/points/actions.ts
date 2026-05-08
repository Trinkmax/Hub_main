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
import { createRewardSchema, createRuleSchema, updateRewardSchema } from './schemas'

export type LoyaltyActionState = { ok: true; message?: string } | { ok: false; message: string }

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

  revalidatePath(`/${slug}/configuracion/puntos`)
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

  revalidatePath(`/${slug}/configuracion/puntos`)
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

  revalidatePath(`/${slug}/configuracion/puntos`)
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

  revalidatePath(`/${slug}/configuracion/puntos`)
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
  })
  if (error) return { ok: false, message: 'No pudimos crear la recompensa.' }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'reward.created',
    entity: 'reward',
    payload: { name: parsed.data.name, cost_points: parsed.data.cost_points },
  })

  revalidatePath(`/${slug}/configuracion/puntos`)
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
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos actualizar.' }

  revalidatePath(`/${slug}/configuracion/puntos`)
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

  revalidatePath(`/${slug}/configuracion/puntos`)
  return { ok: true }
}
