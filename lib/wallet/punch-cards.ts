import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Tarjetas de sellos vistas DESDE EL SOCIO (y desde la caja, que ve lo mismo).
//
// Antes se leía `customer_punch_cards` y listo: el socio que nunca consumió no
// veía NADA, así que nunca se enteraba de que la tarjeta existía — justo al
// revés de para qué sirve una punch card. Ahora partimos de los templates
// ACTIVOS y hacemos el left join contra la card del cliente: sin card todavía,
// la tarjeta se muestra en 0 sellos.
//
// Se usa con dos clientes distintos (service-role desde la wallet pública por
// qr_token, y el cliente del staff con su sesión desde la caja) → recibe el
// cliente ya construido en vez de crearlo.

export type WalletPunchCard = {
  /** id de `customer_punch_cards`; null = el socio todavía no empezó esta tarjeta. */
  id: string | null
  templateId: string
  templateName: string
  description: string | null
  imageUrl: string | null
  /** Nombre de ícono lucide configurable para el sello (fallback: Stamp). */
  stampIcon: string | null
  currentStamps: number
  threshold: number
  /** Sellos que faltan para completarla (0 si ya está). */
  remaining: number
  rewardName: string | null
  /** Cómo llamar al premio en la UI ("un café gratis"); cae a `rewardName`. */
  rewardLabel: string | null
  completed: boolean
  /** Canje generado al completarla, si sigue pendiente de retiro. */
  pendingRedemptionId: string | null
}

type TemplateRow = {
  id: string
  name: string
  description: string | null
  image_url: string | null
  stamp_icon: string | null
  reward_label: string | null
  threshold: number
  sort: number
  reward: { name: string } | { name: string }[] | null
}

type CardRow = {
  id: string
  template_id: string
  current_stamps: number
  threshold_snapshot: number
  completed_at: string | null
  reward_redemption_id: string | null
  started_at: string
}

function rewardName(reward: TemplateRow['reward']): string | null {
  const r = Array.isArray(reward) ? reward[0] : reward
  return r?.name ?? null
}

export async function loadWalletPunchCards(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<WalletPunchCard[]> {
  const [{ data: templatesData, error: tplError }, { data: cardsData, error: cardError }] =
    await Promise.all([
      supabase
        .from('punch_card_templates')
        .select(
          'id, name, description, image_url, stamp_icon, reward_label, threshold, sort, reward:rewards(name)',
        )
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('sort', { ascending: true }),
      supabase
        .from('customer_punch_cards')
        .select(
          'id, template_id, current_stamps, threshold_snapshot, completed_at, reward_redemption_id, started_at',
        )
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .is('expired_at', null)
        .order('started_at', { ascending: false }),
    ])

  if (tplError) console.error('[wallet.punchCards] templates', tplError.message)
  if (cardError) console.error('[wallet.punchCards] cards', cardError.message)

  const templates = (templatesData ?? []) as unknown as TemplateRow[]
  if (templates.length === 0) return []
  const cards = (cardsData ?? []) as unknown as CardRow[]

  // Una tarjeta completa sólo sigue siendo "canjeable" mientras su canje esté
  // pendiente; si el mozo ya lo entregó vuelve a mostrarse el progreso vigente.
  const redemptionIds = cards
    .map((c) => c.reward_redemption_id)
    .filter((id): id is string => id !== null)
  const pendingIds = new Set<string>()
  if (redemptionIds.length > 0) {
    const { data } = await supabase
      .from('reward_redemptions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'pending')
      .in('id', redemptionIds)
    for (const row of (data ?? []) as Array<{ id: string }>) pendingIds.add(row.id)
  }

  return templates.map((tpl) => {
    const mine = cards.filter((c) => c.template_id === tpl.id)
    const claimable = mine.find((c) => c.completed_at !== null && c.reward_redemption_id !== null)
    const claimableRedemptionId = claimable?.reward_redemption_id ?? null
    const claimablePending = claimableRedemptionId !== null && pendingIds.has(claimableRedemptionId)
    const open = mine.find((c) => c.completed_at === null)
    const card = claimablePending ? claimable : (open ?? null)

    const threshold = card?.threshold_snapshot ?? tpl.threshold
    const stamps = Math.min(card?.current_stamps ?? 0, threshold)
    const completed = claimablePending || (threshold > 0 && stamps >= threshold)
    const name = rewardName(tpl.reward)

    return {
      id: card?.id ?? null,
      templateId: tpl.id,
      templateName: tpl.name,
      description: tpl.description,
      imageUrl: tpl.image_url,
      stampIcon: tpl.stamp_icon,
      currentStamps: stamps,
      threshold,
      remaining: Math.max(0, threshold - stamps),
      rewardName: name,
      rewardLabel: tpl.reward_label ?? name,
      completed,
      pendingRedemptionId: claimablePending ? claimableRedemptionId : null,
    }
  })
}
