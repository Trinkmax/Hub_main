// Tipos + helpers PUROS de beneficios de nivel y marcas aliadas.
// Los beneficios ricos por nivel viven en `tier_benefits`; las marcas en `partners`.

export type TierBenefitCadence = 'none' | 'birthday' | 'monthly'
export type TierBenefitKind = 'recurring_reward' | 'discount' | 'perk' | 'partner'

export const BENEFIT_KINDS: readonly TierBenefitKind[] = [
  'recurring_reward',
  'discount',
  'perk',
  'partner',
] as const

export type Partner = {
  id: string
  name: string
  logo_url: string | null
  discount_label: string | null
  category: string | null
  url: string | null
  active: boolean
  sort: number
}

export type TierBenefit = {
  id: string
  tier_id: string
  kind: TierBenefitKind
  label: string
  description: string | null
  icon: string | null
  /** Foto propia del beneficio. Manda en la card grande de la billetera; el `icon` se usa en chips y listas. */
  image_url: string | null
  reward_id: string | null
  cadence: TierBenefitCadence
  quantity: number
  discount_pct: number | null
  discount_scope: string | null
  partner_id: string | null
  sort: number
  active: boolean
}

/**
 * Beneficio de una marca aliada, asignado a un set ARBITRARIO de niveles
 * (`tier_ids`): la misma marca puede dar 10% a Select/Gold y 30% a Black sin
 * que exista relación "de tal nivel para arriba". El socio ve SÓLO el beneficio
 * de su nivel, no la suma de los de abajo.
 */
export type PartnerBenefit = {
  id: string
  partner_id: string
  label: string
  description: string | null
  discount_pct: number | null
  image_url: string | null
  sort: number
  active: boolean
  tier_ids: string[]
}

/** Beneficios activos de una marca visibles para un nivel, en orden de carga. */
export function partnerBenefitsForTier(
  benefits: readonly PartnerBenefit[],
  tierId: string,
): PartnerBenefit[] {
  return benefits
    .filter((b) => b.active && b.tier_ids.includes(tierId))
    .slice()
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, 'es'))
}

/**
 * Niveles que NO reciben ningún beneficio activo de esta marca — el socio de
 * ese nivel no vería nada de ella. Alimenta el aviso del editor de Aliados.
 */
export function tiersWithoutPartnerBenefit<T extends { id: string }>(
  tiers: readonly T[],
  benefits: readonly PartnerBenefit[],
): T[] {
  const covered = new Set<string>()
  for (const b of benefits) {
    if (!b.active) continue
    for (const t of b.tier_ids) covered.add(t)
  }
  return tiers.filter((t) => !covered.has(t.id))
}

/** Metadata de presentación por tipo de beneficio (título de sección + icono Lucide default). */
export const BENEFIT_KIND_META: Record<
  TierBenefitKind,
  { label: string; groupTitle: string; icon: string }
> = {
  recurring_reward: { label: 'Ítem gratis', groupTitle: 'Tuyos cada mes', icon: 'Gift' },
  discount: { label: 'Descuento', groupTitle: 'Descuentos', icon: 'Percent' },
  perk: { label: 'Beneficio', groupTitle: 'Beneficios', icon: 'Sparkles' },
  partner: { label: 'Marca aliada', groupTitle: 'Marcas aliadas', icon: 'Handshake' },
}

export const CADENCE_LABEL: Record<TierBenefitCadence, string> = {
  none: 'Sin recurrencia',
  monthly: 'Cada mes',
  birthday: 'En tu cumpleaños',
}

/** Sólo beneficios activos, ordenados por (kind en orden canónico, sort, label). */
export function sortedActiveBenefits(benefits: readonly TierBenefit[]): TierBenefit[] {
  const kindOrder = new Map(BENEFIT_KINDS.map((k, i) => [k, i]))
  return benefits
    .filter((b) => b.active)
    .slice()
    .sort(
      (a, b) =>
        (kindOrder.get(a.kind) ?? 99) - (kindOrder.get(b.kind) ?? 99) ||
        a.sort - b.sort ||
        a.label.localeCompare(b.label, 'es'),
    )
}

/** Agrupa beneficios activos por kind, en el orden canónico, saltando grupos vacíos. */
export function groupBenefitsByKind(
  benefits: readonly TierBenefit[],
): { kind: TierBenefitKind; items: TierBenefit[] }[] {
  const active = sortedActiveBenefits(benefits)
  return BENEFIT_KINDS.map((kind) => ({
    kind,
    items: active.filter((b) => b.kind === kind),
  })).filter((g) => g.items.length > 0)
}
