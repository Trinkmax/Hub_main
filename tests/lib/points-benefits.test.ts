import { describe, expect, it } from 'vitest'
import {
  groupBenefitsByKind,
  type PartnerBenefit,
  partnerBenefitsForTier,
  sortedActiveBenefits,
  type TierBenefit,
  tiersWithoutPartnerBenefit,
} from '@/lib/points/benefits'

// Los niveles del club de HUB, de menor a mayor.
const SELECT = { id: 'tier-select', name: 'Select' }
const GOLD = { id: 'tier-gold', name: 'Gold' }
const BLACK = { id: 'tier-black', name: 'Black' }
const SIGNATURE = { id: 'tier-signature', name: 'Signature' }
const TIERS = [SELECT, GOLD, BLACK, SIGNATURE]

function partnerBenefit(overrides: Partial<PartnerBenefit> & { id: string }): PartnerBenefit {
  return {
    partner_id: 'partner-guapa',
    label: '10% off',
    description: null,
    discount_pct: 10,
    image_url: null,
    sort: 0,
    active: true,
    tier_ids: [],
    ...overrides,
  }
}

function tierBenefit(overrides: Partial<TierBenefit> & { id: string }): TierBenefit {
  return {
    tier_id: GOLD.id,
    kind: 'perk',
    label: 'Beneficio',
    description: null,
    icon: null,
    image_url: null,
    reward_id: null,
    cadence: 'none',
    quantity: 1,
    discount_pct: null,
    discount_scope: null,
    partner_id: null,
    sort: 0,
    active: true,
    ...overrides,
  }
}

describe('partnerBenefitsForTier', () => {
  // El caso textual del dueño: la misma marca da 10% a Select/Gold y 30% a
  // Black/Signature. El socio ve SÓLO el de su nivel, no la suma de los de abajo.
  const guapa = [
    partnerBenefit({
      id: 'b-10',
      label: '10% off',
      discount_pct: 10,
      sort: 0,
      tier_ids: [SELECT.id, GOLD.id],
    }),
    partnerBenefit({
      id: 'b-30',
      label: '30% off',
      discount_pct: 30,
      sort: 1,
      tier_ids: [BLACK.id, SIGNATURE.id],
    }),
  ]

  it('devuelve el beneficio del nivel pedido y nada más', () => {
    expect(partnerBenefitsForTier(guapa, GOLD.id).map((b) => b.label)).toEqual(['10% off'])
    expect(partnerBenefitsForTier(guapa, BLACK.id).map((b) => b.label)).toEqual(['30% off'])
  })

  it('no acumula los beneficios de los niveles de abajo', () => {
    const black = partnerBenefitsForTier(guapa, BLACK.id)
    expect(black).toHaveLength(1)
    expect(black.some((b) => b.label === '10% off')).toBe(false)
  })

  it('permite saltear un nivel del medio (set arbitrario, no "de tal para arriba")', () => {
    const salteado = [partnerBenefit({ id: 'b-x', tier_ids: [SELECT.id, BLACK.id] })]
    expect(partnerBenefitsForTier(salteado, SELECT.id)).toHaveLength(1)
    expect(partnerBenefitsForTier(salteado, GOLD.id)).toHaveLength(0)
    expect(partnerBenefitsForTier(salteado, BLACK.id)).toHaveLength(1)
  })

  it('ignora los beneficios pausados', () => {
    const pausado = [partnerBenefit({ id: 'b-off', active: false, tier_ids: [GOLD.id] })]
    expect(partnerBenefitsForTier(pausado, GOLD.id)).toEqual([])
  })

  it('respeta el orden del dueño (sort) y desempata por label', () => {
    const varios = [
      partnerBenefit({ id: 'b-c', label: 'C', sort: 2, tier_ids: [GOLD.id] }),
      partnerBenefit({ id: 'b-a', label: 'A', sort: 0, tier_ids: [GOLD.id] }),
      partnerBenefit({ id: 'b-b2', label: 'B2', sort: 1, tier_ids: [GOLD.id] }),
      partnerBenefit({ id: 'b-b1', label: 'B1', sort: 1, tier_ids: [GOLD.id] }),
    ]
    expect(partnerBenefitsForTier(varios, GOLD.id).map((b) => b.label)).toEqual([
      'A',
      'B1',
      'B2',
      'C',
    ])
  })

  it('devuelve vacío para un nivel sin nada de esa marca', () => {
    expect(partnerBenefitsForTier(guapa, 'tier-inexistente')).toEqual([])
  })
})

describe('tiersWithoutPartnerBenefit', () => {
  it('lista los niveles que no verían nada de la marca', () => {
    const soloBlack = [partnerBenefit({ id: 'b-30', tier_ids: [BLACK.id] })]
    expect(tiersWithoutPartnerBenefit(TIERS, soloBlack).map((t) => t.name)).toEqual([
      'Select',
      'Gold',
      'Signature',
    ])
  })

  it('con la marca cubriendo todos los niveles no avisa nada', () => {
    const todos = [partnerBenefit({ id: 'b-all', tier_ids: TIERS.map((t) => t.id) })]
    expect(tiersWithoutPartnerBenefit(TIERS, todos)).toEqual([])
  })

  it('un beneficio pausado NO cubre el nivel', () => {
    const pausado = [
      partnerBenefit({ id: 'b-off', active: false, tier_ids: TIERS.map((t) => t.id) }),
    ]
    expect(tiersWithoutPartnerBenefit(TIERS, pausado)).toHaveLength(TIERS.length)
  })

  it('sin beneficios cargados, todos los niveles quedan descubiertos', () => {
    expect(tiersWithoutPartnerBenefit(TIERS, [])).toHaveLength(TIERS.length)
  })
})

describe('sortedActiveBenefits', () => {
  it('ordena por tipo canónico y después por el orden que arrastró el dueño', () => {
    const list = [
      tierBenefit({ id: 'perk', kind: 'perk', label: 'Barra VIP', sort: 0 }),
      tierBenefit({ id: 'rr', kind: 'recurring_reward', label: 'Café gratis', sort: 5 }),
      tierBenefit({ id: 'disc-b', kind: 'discount', label: 'B', sort: 1 }),
      tierBenefit({ id: 'disc-a', kind: 'discount', label: 'A', sort: 0 }),
    ]
    expect(sortedActiveBenefits(list).map((b) => b.id)).toEqual(['rr', 'disc-a', 'disc-b', 'perk'])
  })

  it('deja afuera los pausados', () => {
    const list = [
      tierBenefit({ id: 'on', label: 'Visible' }),
      tierBenefit({ id: 'off', label: 'Pausado', active: false }),
    ]
    expect(sortedActiveBenefits(list).map((b) => b.id)).toEqual(['on'])
  })
})

describe('groupBenefitsByKind', () => {
  it('agrupa por tipo saltando los grupos vacíos', () => {
    const list = [
      tierBenefit({ id: 'p1', kind: 'perk' }),
      tierBenefit({ id: 'p2', kind: 'perk' }),
      tierBenefit({ id: 'rr', kind: 'recurring_reward' }),
    ]
    const groups = groupBenefitsByKind(list)
    expect(groups.map((g) => g.kind)).toEqual(['recurring_reward', 'perk'])
    expect(groups[1]?.items).toHaveLength(2)
  })
})
