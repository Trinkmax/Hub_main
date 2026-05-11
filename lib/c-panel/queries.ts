import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'

export type CustomerPanelData = {
  customer: {
    id: string
    first_name: string
    last_name: string
    qr_token: string
    points_balance: number
    tenant_id: string
  }
  tenant: {
    id: string
    slug: string
    name: string
  }
  active_lunch_card: {
    template_id: string
    template_name: string
    current_stamps: number
    threshold: number
    reward_name: string | null
    hours_from: string | null
    hours_to: string | null
  } | null
  upcoming_events: Array<{
    id: string
    title: string
    starts_at: string
  }>
}

// Lee todo lo necesario para `/c/[token]` saltando RLS (no hay sesión auth
// del cliente). El token largo aleatorio actúa como capability — 128 bits de
// entropía vía gen_random_bytes(16).
export async function getCustomerPanelByToken(token: string): Promise<CustomerPanelData | null> {
  if (!token || token.length < 16 || token.length > 128) return null
  const service = createServiceClient()

  const { data: customer } = await service
    .from('customers')
    .select('id, first_name, last_name, qr_token, points_balance, tenant_id')
    .eq('qr_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return null

  const [{ data: tenant }, { data: cards }, { data: events }] = await Promise.all([
    service.from('tenants').select('id, slug, name').eq('id', customer.tenant_id).maybeSingle(),
    service
      .from('customer_punch_cards')
      .select(
        `
        id, current_stamps, threshold_snapshot,
        template:punch_card_templates!inner(
          id, name, trigger_type, config, reward:rewards(name)
        )
      `,
      )
      .eq('customer_id', customer.id)
      .is('completed_at', null)
      .is('expired_at', null),
    service
      .from('events')
      .select('id, title, starts_at')
      .eq('tenant_id', customer.tenant_id)
      .gt('starts_at', new Date().toISOString())
      .eq('status', 'published')
      .order('starts_at', { ascending: true })
      .limit(5),
  ])

  if (!tenant) return null

  type CardRow = {
    current_stamps: number
    threshold_snapshot: number
    template: {
      id: string
      name: string
      trigger_type: string
      config: Record<string, unknown>
      reward: { name: string | null } | null
    } | null
  }
  const lunchCard = ((cards ?? []) as unknown as CardRow[]).find(
    (c) => c.template?.trigger_type === 'visit_window',
  )

  const active_lunch_card = lunchCard?.template
    ? {
        template_id: lunchCard.template.id,
        template_name: lunchCard.template.name,
        current_stamps: lunchCard.current_stamps,
        threshold: lunchCard.threshold_snapshot,
        reward_name: lunchCard.template.reward?.name ?? null,
        hours_from: (lunchCard.template.config.hours_from as string | undefined) ?? null,
        hours_to: (lunchCard.template.config.hours_to as string | undefined) ?? null,
      }
    : null

  return {
    customer: {
      id: customer.id,
      first_name: customer.first_name,
      last_name: customer.last_name,
      qr_token: customer.qr_token,
      points_balance: customer.points_balance,
      tenant_id: customer.tenant_id,
    },
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
    },
    active_lunch_card,
    upcoming_events: (events ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      starts_at: e.starts_at,
    })),
  }
}
