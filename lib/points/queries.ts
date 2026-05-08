import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { PointsRule } from './types'

export type Reward = {
  id: string
  name: string
  description: string | null
  cost_points: number
  stock: number | null
  active: boolean
  image_url: string | null
}

export async function listRules(opts: { tenantId: string }): Promise<PointsRule[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('points_rules')
    .select('id, type, config, priority, active')
    .eq('tenant_id', opts.tenantId)
    .order('priority', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as PointsRule[]
}

export async function listRewards(opts: { tenantId: string }): Promise<Reward[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('rewards')
    .select('id, name, description, cost_points, stock, active, image_url')
    .eq('tenant_id', opts.tenantId)
    .order('cost_points', { ascending: true })
  if (error) throw error
  return (data ?? []) as Reward[]
}

export async function listActiveRewards(opts: { tenantId: string }): Promise<Reward[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('rewards')
    .select('id, name, description, cost_points, stock, active, image_url')
    .eq('tenant_id', opts.tenantId)
    .eq('active', true)
    .order('cost_points', { ascending: true })
  return (data ?? []) as Reward[]
}

export type LedgerEntry = {
  id: string
  delta: number
  reason: string
  payload: Record<string, unknown>
  created_at: string
  visit_id: string | null
  redemption_id: string | null
}

export async function listCustomerLedger(opts: {
  tenantId: string
  customerId: string
  limit?: number
}): Promise<LedgerEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('points_transactions')
    .select('id, delta, reason, payload, created_at, visit_id, redemption_id')
    .eq('tenant_id', opts.tenantId)
    .eq('customer_id', opts.customerId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (error) throw error
  return (data ?? []) as unknown as LedgerEntry[]
}

export type VisitListEntry = {
  id: string
  visited_at: string
  total_amount_cents: number
  notes: string | null
  source: string
}

export async function listCustomerVisits(opts: {
  tenantId: string
  customerId: string
  limit?: number
}): Promise<VisitListEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('visits')
    .select('id, visited_at, total_amount_cents, notes, source')
    .eq('tenant_id', opts.tenantId)
    .eq('customer_id', opts.customerId)
    .order('visited_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (error) throw error
  return (data ?? []) as VisitListEntry[]
}

export type RedemptionListEntry = {
  id: string
  reward_id: string
  reward_name: string
  points_spent: number
  redeemed_at: string
  status: string
}

export async function listCustomerRedemptions(opts: {
  tenantId: string
  customerId: string
}): Promise<RedemptionListEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reward_redemptions')
    .select('id, reward_id, points_spent, redeemed_at, status, reward:rewards(name)')
    .eq('tenant_id', opts.tenantId)
    .eq('customer_id', opts.customerId)
    .order('redeemed_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string
      reward_id: string
      points_spent: number
      redeemed_at: string
      status: string
      reward: { name: string } | { name: string }[] | null
    }
    const reward = Array.isArray(r.reward) ? r.reward[0] : r.reward
    return {
      id: r.id,
      reward_id: r.reward_id,
      reward_name: reward?.name ?? 'Recompensa',
      points_spent: r.points_spent,
      redeemed_at: r.redeemed_at,
      status: r.status,
    }
  })
}
