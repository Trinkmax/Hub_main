import type { Partner, PartnerBenefit, TierBenefit } from '@/lib/points/benefits'
import { resolveEarnRate } from '@/lib/points/earn-rate'
import type { LedgerEntry, Reward } from '@/lib/points/queries'
import type { LoyaltyTier } from '@/lib/points/tiers'
import { sortedActiveTiers } from '@/lib/points/tiers'
import type { PerAmountConfig, PointsRule } from '@/lib/points/types'
import { compact } from '../read/common'
import { money } from '../types'
import { pointsWord, type TierNames, tierNames } from './_values'

/**
 * Lo puro del Club: cómo se le muestra a Tex y qué recibe cada acción. Lo que se edita se arma con la
 * fila de ese momento más lo que cambia: las acciones pisan la fila entera, y una foto o un logo que no
 * se dijeron se perderían.
 */

// ─── El club ─────────────────────────────────────────────────────────────────

export type MenuNames = {
  item: (id: string) => string | null
  category: (id: string) => string | null
}

/** `1 punto cada $ 1.000`, `5 puntos por cada Fernet`, `2 puntos por cada ítem de Tragos`. */
export function ruleWords(rule: PointsRule, menu: MenuNames | null): string {
  const config = rule.config as Record<string, unknown>
  const points = pointsWord(Number(config.points ?? 0))
  if (rule.type === 'per_amount') return `${points} cada ${money(Number(config.every_cents ?? 0))}`
  if (typeof config.item_id === 'string') {
    return `${points} por cada ${menu?.item(config.item_id) ?? 'ítem que ya no está'}`
  }
  if (typeof config.category_id === 'string') {
    return `${points} por cada ítem de ${menu?.category(config.category_id) ?? 'una categoría que ya no está'}`
  }
  return points
}

export function ruleRow(rule: PointsRule, menu: MenuNames | null) {
  return compact({
    id: rule.id,
    regla: ruleWords(rule, menu),
    tipo: rule.type === 'per_amount' ? 'Por monto' : 'Por producto',
    prioridad: rule.priority,
    pausada: rule.active ? null : true,
  })
}

/** La regla por monto que usa `award_points_by_amount`: la activa de mayor prioridad. */
export function activeAmountRule(rules: readonly PointsRule[]): PointsRule | null {
  const [top] = rules
    .filter((rule) => rule.active && rule.type === 'per_amount')
    .slice()
    .sort((a, b) => b.priority - a.priority)
  return top ?? null
}

/** Lo que va a sumar «Acreditar»: el mismo cálculo de `award_points_by_amount`. */
export function awardPoints(rule: PointsRule | null, cents: number): number {
  if (!rule) return 0
  const { every_cents: every, points } = rule.config as PerAmountConfig
  if (!(every > 0) || !(points > 0)) return 0
  return Math.floor(cents / every) * points
}

/** ¿Ya se le acreditó ese monto recién? La acción lo rechaza por 3 minutos: el tique no lo promete. */
export function isRecentAward(
  ledger: readonly Pick<LedgerEntry, 'reason' | 'payload' | 'created_at'>[],
  cents: number,
  now: number,
): boolean {
  return ledger.some(
    (entry) =>
      entry.reason === 'qr_award' &&
      Number(entry.payload?.amount_cents) === cents &&
      now - Date.parse(entry.created_at) < AWARD_REPEAT_MS,
  )
}

/** `DUPLICATE_AWARD_WINDOW_MS` de `lib/points/actions.ts`. */
const AWARD_REPEAT_MS = 3 * 60 * 1000

export const BENEFIT_WORDS = {
  item_gratis: 'recurring_reward',
  descuento: 'discount',
  beneficio: 'perk',
  aliado: 'partner',
} as const satisfies Record<string, TierBenefit['kind']>

export const CADENCE_WORDS = {
  mensual: 'monthly',
  cumpleanos: 'birthday',
} as const satisfies Record<string, TierBenefit['cadence']>

const KIND_TEXT: Readonly<Record<TierBenefit['kind'], string>> = {
  recurring_reward: 'Ítem gratis',
  discount: 'Descuento',
  perk: 'Beneficio',
  partner: 'Marca aliada',
}

const CADENCE_TEXT: Readonly<Record<TierBenefit['cadence'], string | null>> = {
  none: null,
  monthly: 'Cada mes',
  birthday: 'En su cumpleaños',
}

export function tierBenefitRow(
  benefit: TierBenefit,
  rewards: ReadonlyMap<string, string>,
  partners: ReadonlyMap<string, string>,
) {
  return compact({
    id: benefit.id,
    nombre: benefit.label,
    tipo: KIND_TEXT[benefit.kind],
    regalo: benefit.reward_id ? (rewards.get(benefit.reward_id) ?? null) : null,
    cuando: CADENCE_TEXT[benefit.cadence],
    cantidad: benefit.kind === 'recurring_reward' && benefit.quantity > 1 ? benefit.quantity : null,
    descuento: benefit.discount_pct !== null ? `${benefit.discount_pct} %` : null,
    en: benefit.discount_scope,
    aliado: benefit.partner_id ? (partners.get(benefit.partner_id) ?? null) : null,
    pausado: benefit.active ? null : true,
  })
}

/** Los niveles de menor a mayor, con cuántos socios tiene cada uno y sus beneficios. */
export function clubTierRows(
  tiers: readonly LoyaltyTier[],
  benefits: readonly TierBenefit[],
  members: ReadonlyMap<string, number>,
  rewards: ReadonlyMap<string, string>,
  partners: ReadonlyMap<string, string>,
) {
  return tiers
    .slice()
    .sort((a, b) => a.min_category_points - b.min_category_points || a.sort - b.sort)
    .map((tier) =>
      compact({
        id: tier.id,
        nombre: tier.name,
        desde_puntos_de_categoria: tier.min_category_points,
        socios: members.get(tier.id) ?? 0,
        detalle: tier.perks,
        pausado: tier.active ? null : true,
        beneficios: benefits
          .filter((benefit) => benefit.tier_id === tier.id)
          .map((benefit) => tierBenefitRow(benefit, rewards, partners)),
      }),
    )
}

/** La tasa dicha en una línea, solo si se puede decir sin mentir (`resolveEarnRate`). */
export function earnRateWords(rules: readonly PointsRule[]): string | null {
  const rate = resolveEarnRate(rules)
  return rate ? `${pointsWord(rate.points)} cada ${money(rate.everyCents)}` : null
}

export function rewardRow(reward: Reward, tiers: TierNames) {
  return compact({
    id: reward.id,
    nombre: reward.name,
    puntos: reward.cost_points,
    stock: reward.stock === null ? 'Sin límite' : reward.stock,
    desde_nivel: reward.min_tier_id ? (tiers.get(reward.min_tier_id) ?? null) : null,
    categoria: reward.category,
    fuera_del_catalogo: reward.visible_in_catalog ? null : true,
    pausada: reward.active ? null : true,
    detalle: reward.description,
  })
}

export function partnerRow(
  partner: Partner,
  benefits: readonly PartnerBenefit[],
  tiers: readonly LoyaltyTier[],
) {
  const names = tierNames(tiers)
  const own = benefits.filter((benefit) => benefit.partner_id === partner.id)
  const ladder = sortedActiveTiers(tiers)
  const covered = new Set(own.filter((b) => b.active).flatMap((b) => b.tier_ids))
  const left = ladder.filter((tier) => !covered.has(tier.id)).map((tier) => tier.name)
  return compact({
    id: partner.id,
    nombre: partner.name,
    rubro: partner.category,
    web: partner.url,
    en_borrador: partner.active ? null : true,
    beneficios: own.map((benefit) =>
      compact({
        id: benefit.id,
        nombre: benefit.label,
        descuento: benefit.discount_pct !== null ? `${benefit.discount_pct} %` : null,
        detalle: benefit.description,
        niveles: benefit.tier_ids.map((id) => names.get(id) ?? id),
        pausado: benefit.active ? null : true,
      }),
    ),
    niveles_sin_beneficio: left.length > 0 ? left : null,
  })
}

const TRIGGER_WORDS: Readonly<Record<string, string>> = {
  manual: 'A mano: se sella desde Acreditar',
  item: 'Al consumir un ítem',
  category: 'Al consumir una categoría',
  tag: 'Al consumir una etiqueta de la carta',
  visit_window: 'Por visita en un horario',
}

export type PunchTemplateLine = {
  id: string
  name: string
  threshold: number
  reward_name?: string
  reward_label: string | null
  trigger_type: string
  active: boolean
  expires_after_days: number | null
  config: Record<string, unknown>
  tier_ids: string[]
}

export function punchCardRow(
  template: PunchTemplateLine,
  tiers: TierNames,
  stats: { inProgress: number; completed: number } | undefined,
) {
  return compact({
    id: template.id,
    nombre: template.name,
    sellos: template.threshold,
    premio: template.reward_label ?? template.reward_name ?? null,
    se_sella: TRIGGER_WORDS[template.trigger_type] ?? null,
    tope_por_dia:
      typeof template.config.max_per_day === 'number' ? template.config.max_per_day : null,
    vence_a_los_dias: template.expires_after_days,
    solo_para:
      template.tier_ids.length > 0 ? template.tier_ids.map((id) => tiers.get(id) ?? id) : null,
    pausada: template.active ? null : true,
    en_curso: stats?.inProgress ?? 0,
    completadas: stats?.completed ?? 0,
  })
}

/** Cuántas tarjetas empezadas y terminadas tiene cada plantilla. */
export function punchCardStats(
  cards: ReadonlyArray<{
    template_id: string
    completed_at: string | null
    expired_at: string | null
    current_stamps: number
  }>,
): Map<string, { inProgress: number; completed: number }> {
  const stats = new Map<string, { inProgress: number; completed: number }>()
  for (const card of cards) {
    const sum = stats.get(card.template_id) ?? { inProgress: 0, completed: 0 }
    if (card.completed_at) sum.completed += 1
    else if (!card.expired_at && card.current_stamps > 0) sum.inProgress += 1
    stats.set(card.template_id, sum)
  }
  return stats
}

// ─── Lo que recibe cada acción ───────────────────────────────────────────────

export type TierChange = {
  name?: string
  min_category_points?: number
  color?: string | null
  perks?: string | null
  active?: boolean
}

/** Lo que recibe `createTier` o `updateTier`: el nivel entero, con lo que cambia. */
export function tierValues(
  current: LoyaltyTier | null,
  change: TierChange,
  nextSort: number,
): Record<string, unknown> {
  return {
    ...(current ? { id: current.id } : {}),
    name: change.name ?? current?.name ?? '',
    color: change.color !== undefined ? change.color : (current?.color ?? null),
    badge_icon: current?.badge_icon ?? null,
    min_category_points: change.min_category_points ?? current?.min_category_points ?? 0,
    sort: current?.sort ?? nextSort,
    perks: change.perks !== undefined ? change.perks : (current?.perks ?? null),
    active: change.active ?? current?.active ?? true,
  }
}

export type TierBenefitChange = {
  kind?: TierBenefit['kind']
  label?: string
  description?: string | null
  reward_id?: string | null
  cadence?: TierBenefit['cadence']
  quantity?: number
  discount_pct?: number | null
  discount_scope?: string | null
  partner_id?: string | null
  active?: boolean
}

/** Lo que recibe `createTierBenefit` o `updateTierBenefit`. La foto y el ícono se quedan como están. */
export function tierBenefitValues(
  tierId: string,
  current: TierBenefit | null,
  change: TierBenefitChange,
  nextSort: number,
): Record<string, unknown> {
  return {
    ...(current ? { id: current.id } : {}),
    tier_id: tierId,
    kind: change.kind ?? current?.kind ?? 'perk',
    label: change.label ?? current?.label ?? '',
    description:
      change.description !== undefined ? change.description : (current?.description ?? null),
    icon: current?.icon ?? null,
    image_url: current?.image_url ?? null,
    reward_id: change.reward_id !== undefined ? change.reward_id : (current?.reward_id ?? null),
    cadence:
      change.cadence ?? (current && current.cadence !== 'none' ? current.cadence : 'monthly'),
    quantity: change.quantity ?? current?.quantity ?? 1,
    discount_pct:
      change.discount_pct !== undefined ? change.discount_pct : (current?.discount_pct ?? null),
    discount_scope:
      change.discount_scope !== undefined
        ? change.discount_scope
        : (current?.discount_scope ?? null),
    partner_id: change.partner_id !== undefined ? change.partner_id : (current?.partner_id ?? null),
    sort: current?.sort ?? nextSort,
    active: change.active ?? current?.active ?? true,
  }
}

export type RewardChange = {
  name?: string
  description?: string | null
  cost_points?: number
  stock?: number | null
  category?: string | null
  visible_in_catalog?: boolean
  min_tier_id?: string | null
  active?: boolean
}

/** Lo que recibe `updateReward`: la recompensa entera, con lo que cambia. La foto se queda. */
export function rewardUpdateValues(current: Reward, change: RewardChange) {
  return {
    id: current.id,
    name: change.name ?? current.name,
    description: change.description !== undefined ? change.description : current.description,
    cost_points: change.cost_points ?? current.cost_points,
    stock: change.stock !== undefined ? change.stock : current.stock,
    active: change.active ?? current.active,
    category: change.category !== undefined ? change.category : current.category,
    visible_in_catalog: change.visible_in_catalog ?? current.visible_in_catalog,
    min_tier_id: change.min_tier_id !== undefined ? change.min_tier_id : current.min_tier_id,
    image_url: current.image_url,
  }
}

/** Lo que manda el formulario de «Nueva recompensa». Sin stock es sin límite. */
export function rewardCreateForm(change: RewardChange): FormData {
  const form = new FormData()
  form.set('name', change.name ?? '')
  form.set('description', change.description ?? '')
  form.set('cost_points', String(change.cost_points ?? 0))
  form.set('stock', change.stock === null || change.stock === undefined ? '' : String(change.stock))
  form.set('category', change.category ?? '')
  form.set('visible_in_catalog', change.visible_in_catalog === false ? 'false' : 'true')
  form.set('min_tier_id', change.min_tier_id ?? '')
  form.set('image_url', '')
  return form
}

export type PartnerChange = {
  name?: string
  category?: string | null
  url?: string | null
  active?: boolean
}

/** Lo que recibe `createPartner` o `updatePartner`. El logo y el orden se quedan como están. */
export function partnerValues(
  current: Partner | null,
  change: PartnerChange,
): Record<string, unknown> {
  return {
    ...(current ? { id: current.id } : {}),
    name: change.name ?? current?.name ?? '',
    logo_url: current?.logo_url ?? null,
    category: change.category !== undefined ? change.category : (current?.category ?? null),
    url: change.url !== undefined ? change.url : (current?.url ?? null),
    active: change.active ?? current?.active ?? false,
    sort: current?.sort ?? 0,
  }
}

/** Una web que se pueda abrir: `www.algo.com` se completa y lo que no es http no entra. */
export function partnerUrl(raw: string): string | null {
  const clean = raw.trim()
  if (!clean) return null
  const url = /^[a-z][a-z0-9+.-]*:/i.test(clean) ? clean : `https://${clean}`
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

export type PartnerBenefitChange = {
  label?: string
  description?: string | null
  discount_pct?: number | null
  active?: boolean
  tier_ids?: string[]
}

/** Lo que recibe `createPartnerBenefit` o `updatePartnerBenefit`. La foto se queda. */
export function partnerBenefitValues(
  partnerId: string,
  current: PartnerBenefit | null,
  change: PartnerBenefitChange,
): Record<string, unknown> {
  return {
    ...(current ? { id: current.id } : {}),
    partner_id: partnerId,
    label: change.label ?? current?.label ?? '',
    description:
      change.description !== undefined ? change.description : (current?.description ?? null),
    discount_pct:
      change.discount_pct !== undefined ? change.discount_pct : (current?.discount_pct ?? null),
    image_url: current?.image_url ?? null,
    active: change.active ?? current?.active ?? true,
    tier_ids: change.tier_ids ?? current?.tier_ids ?? [],
  }
}

export type PunchCardChange = {
  name?: string
  description?: string | null
  threshold?: number
  reward_id?: string
  reward_label?: string | null
  tier_ids?: string[]
  max_per_day?: number | null
}

/** Lo que tiene de una tarjeta el editor: todo viaja, para no perder la foto ni el disparador. */
export type PunchCardCurrent = {
  id: string
  name: string
  description: string | null
  image_url: string | null
  stamp_icon: string | null
  reward_label: string | null
  trigger_type: string
  trigger_ref_id: string | null
  threshold: number
  reward_id: string
  expires_after_days: number | null
  active: boolean
  config: Record<string, unknown>
  tier_ids: string[]
  show_when_locked: boolean
}

/** La tarjeta entera, con lo que cambia: lo que validan `createPunchCardSchema` y `updatePunchCardSchema`. */
export function punchCardValues(current: PunchCardCurrent | null, change: PunchCardChange) {
  const config: Record<string, unknown> = { ...(current?.config ?? {}) }
  if (change.max_per_day === null) delete config.max_per_day
  else if (change.max_per_day !== undefined) config.max_per_day = change.max_per_day
  return {
    ...(current ? { id: current.id } : {}),
    name: change.name ?? current?.name ?? '',
    description:
      change.description !== undefined ? change.description : (current?.description ?? null),
    image_url: current?.image_url ?? null,
    stamp_icon: current?.stamp_icon ?? null,
    reward_label:
      change.reward_label !== undefined ? change.reward_label : (current?.reward_label ?? null),
    trigger_type: current?.trigger_type ?? 'manual',
    trigger_ref_id: current?.trigger_ref_id ?? null,
    threshold: change.threshold ?? current?.threshold ?? 0,
    reward_id: change.reward_id ?? current?.reward_id ?? '',
    expires_after_days: current?.expires_after_days ?? null,
    active: current?.active ?? true,
    config,
    tier_ids: change.tier_ids ?? current?.tier_ids ?? [],
    show_when_locked: current?.show_when_locked ?? true,
  }
}

export type PunchCardValues = ReturnType<typeof punchCardValues>

/** Lo que manda el editor de una tarjeta (`parsePunchCardForm`). */
export function punchCardForm(values: PunchCardValues): FormData {
  const form = new FormData()
  if (values.id) form.set('id', values.id)
  form.set('name', values.name)
  form.set('description', values.description ?? '')
  form.set('image_url', values.image_url ?? '')
  form.set('stamp_icon', values.stamp_icon ?? '')
  form.set('reward_label', values.reward_label ?? '')
  form.set('trigger_type', values.trigger_type)
  form.set('trigger_ref_id', values.trigger_ref_id ?? '')
  form.set('threshold', String(values.threshold))
  form.set('reward_id', values.reward_id)
  form.set('expires_after_days', values.expires_after_days ? String(values.expires_after_days) : '')
  if (values.active) form.set('active', 'on')
  form.set('config', JSON.stringify(values.config))
  for (const tierId of values.tier_ids) form.append('tier_ids', tierId)
  form.set('show_when_locked', values.show_when_locked ? 'on' : 'off')
  return form
}
