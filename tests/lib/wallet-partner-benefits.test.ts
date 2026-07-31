import { describe, expect, it } from 'vitest'
import type { LoyaltyTier } from '@/lib/points/tiers'
import {
  buildPartnerTiers,
  groupBenefitsByTier,
  type PartnerBenefitRow,
  resolvePartnersForTier,
} from '@/lib/wallet/partner-benefits'

// Regla del dueño: el socio ve SÓLO el beneficio de SU nivel para cada marca,
// nunca la suma de los de abajo. Y las marcas que en su nivel no le dan nada se
// muestran igual, con el nivel que necesita — es el empujón para subir.

const tier = (id: string, name: string, min: number): LoyaltyTier => ({
  id,
  name,
  color: null,
  badge_icon: null,
  min_category_points: min,
  sort: min,
  perks: null,
  active: true,
})

const CLASSIC = tier('classic', 'Classic', 0)
const GOLD = tier('gold', 'Gold', 500)
const BLACK = tier('black', 'Black', 1500)
const TIERS = [BLACK, CLASSIC, GOLD] // desordenados a propósito

const benefit = (id: string, partnerId: string, sort = 0): PartnerBenefitRow => ({
  id,
  partner_id: partnerId,
  label: `Beneficio ${id}`,
  description: null,
  discount_pct: null,
  image_url: null,
  sort,
})

const GUAPA_GOLD = benefit('g10', 'guapa')
const GUAPA_BLACK = benefit('g30', 'guapa')
const LUZ_BLACK = benefit('l20', 'luz')

const LINKS = [
  { benefit_id: GUAPA_GOLD.id, tier_id: GOLD.id },
  { benefit_id: GUAPA_BLACK.id, tier_id: BLACK.id },
  { benefit_id: LUZ_BLACK.id, tier_id: BLACK.id },
]
const BY_TIER = groupBenefitsByTier([GUAPA_GOLD, GUAPA_BLACK, LUZ_BLACK], LINKS)

describe('groupBenefitsByTier', () => {
  it('indexa por tier y descarta links huérfanos', () => {
    const map = groupBenefitsByTier([GUAPA_GOLD], [...LINKS, { benefit_id: 'ghost', tier_id: 'x' }])
    expect(map.get(GOLD.id)).toEqual([GUAPA_GOLD])
    expect(map.get('x')).toBeUndefined()
  })

  it('ordena los beneficios de cada nivel por `sort`', () => {
    const a = benefit('a', 'p1', 5)
    const b = benefit('b', 'p2', 1)
    const map = groupBenefitsByTier(
      [a, b],
      [
        { benefit_id: 'a', tier_id: GOLD.id },
        { benefit_id: 'b', tier_id: GOLD.id },
      ],
    )
    expect(map.get(GOLD.id)?.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('resolvePartnersForTier', () => {
  it('el socio Black ve el beneficio Black de Guapa, no el de Gold', () => {
    const out = resolvePartnersForTier(['guapa'], BY_TIER, TIERS, BLACK.id)
    expect(out.get('guapa')?.myBenefit?.id).toBe(GUAPA_BLACK.id)
    expect(out.get('guapa')?.unlockTierName).toBeNull()
  })

  it('el socio Gold ve el de Gold y NO hereda el de Black', () => {
    const out = resolvePartnersForTier(['guapa'], BY_TIER, TIERS, GOLD.id)
    expect(out.get('guapa')?.myBenefit?.id).toBe(GUAPA_GOLD.id)
  })

  it('marca que no le da nada en su nivel → el escalón más barato que sí le da', () => {
    const out = resolvePartnersForTier(['guapa', 'luz'], BY_TIER, TIERS, CLASSIC.id)
    expect(out.get('guapa')).toEqual({ myBenefit: null, unlockTierName: 'Gold' })
    expect(out.get('luz')).toEqual({ myBenefit: null, unlockTierName: 'Black' })
  })

  it('socio sin nivel (todavía por debajo del primero) ve todo bloqueado', () => {
    const out = resolvePartnersForTier(['guapa'], BY_TIER, TIERS, null)
    expect(out.get('guapa')?.myBenefit).toBeNull()
    expect(out.get('guapa')?.unlockTierName).toBe('Gold')
  })

  it('marca sin ningún beneficio cargado → ni beneficio ni nivel de desbloqueo', () => {
    const out = resolvePartnersForTier(['otra'], BY_TIER, TIERS, GOLD.id)
    expect(out.get('otra')).toEqual({ myBenefit: null, unlockTierName: null })
  })
})

describe('buildPartnerTiers', () => {
  const partners = [
    { id: 'guapa', name: 'Guapa', logoUrl: null, category: 'Indumentaria' },
    { id: 'luz', name: 'Luz', logoUrl: null, category: null },
  ]

  it('devuelve un escalón por nivel activo, en orden de umbral', () => {
    const out = buildPartnerTiers(partners, BY_TIER, TIERS)
    expect(out.map((t) => t.tierId)).toEqual([CLASSIC.id, GOLD.id, BLACK.id])
    expect(out[0]?.entries).toEqual([])
    expect(out[1]?.entries.map((e) => e.partnerName)).toEqual(['Guapa'])
    expect(out[2]?.entries.map((e) => e.partnerName)).toEqual(['Guapa', 'Luz'])
  })

  it('una marca aparece una sola vez por nivel aunque tenga dos beneficios ahí', () => {
    const extra = benefit('g31', 'guapa', 9)
    const byTier = groupBenefitsByTier(
      [GUAPA_BLACK, extra],
      [
        { benefit_id: GUAPA_BLACK.id, tier_id: BLACK.id },
        { benefit_id: extra.id, tier_id: BLACK.id },
      ],
    )
    const out = buildPartnerTiers(partners, byTier, TIERS)
    expect(out.find((t) => t.tierId === BLACK.id)?.entries).toHaveLength(1)
  })

  it('ignora beneficios de marcas que ya no están en la lista', () => {
    const out = buildPartnerTiers([partners[0] as (typeof partners)[number]], BY_TIER, TIERS)
    expect(out.find((t) => t.tierId === BLACK.id)?.entries.map((e) => e.partnerId)).toEqual([
      'guapa',
    ])
  })
})
