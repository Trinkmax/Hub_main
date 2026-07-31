// Aliados por categoría (PURO → testeable, sin I/O).
//
// Decisión del dueño: el socio ve SÓLO el beneficio de SU nivel para cada marca,
// nunca la suma de los de abajo. Si Guapa da 10% en Select y 30% en Black, el
// socio Black ve "Guapa — 30% off" y nada más de esa marca.
//
// Las marcas que en su nivel no le dan nada NO se esconden: se muestran con el
// nivel que necesita ("Desde Gold"). Esconderlas sería tirar el único motivo
// visible para querer subir.

import { type LoyaltyTier, sortedActiveTiers } from '@/lib/points/tiers'

export type PartnerBenefitRow = {
  id: string
  partner_id: string
  label: string
  description: string | null
  discount_pct: number | null
  image_url: string | null
  sort: number
}

export type PartnerBenefitTierRow = { benefit_id: string; tier_id: string }

export type WalletPartnerBenefit = {
  id: string
  label: string
  description: string | null
  discountPct: number | null
  imageUrl: string | null
}

/** Un aliado con lo que da en un nivel concreto (fila de la vista por categoría). */
export type WalletPartnerTierEntry = {
  partnerId: string
  partnerName: string
  logoUrl: string | null
  category: string | null
  benefit: WalletPartnerBenefit
}

/** Qué le toca a cada marca según el nivel del socio. */
export type PartnerResolution = {
  /** El beneficio de SU nivel para esta marca (null = en su nivel no da nada). */
  myBenefit: WalletPartnerBenefit | null
  /** Nivel más bajo donde esta marca sí da algo, cuando `myBenefit` es null. */
  unlockTierName: string | null
}

function toBenefit(row: PartnerBenefitRow): WalletPartnerBenefit {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    discountPct: row.discount_pct,
    imageUrl: row.image_url,
  }
}

/** Beneficios de cada nivel, indexados por `tier_id` y ordenados por `sort`. */
export function groupBenefitsByTier(
  benefits: readonly PartnerBenefitRow[],
  links: readonly PartnerBenefitTierRow[],
): Map<string, PartnerBenefitRow[]> {
  const byId = new Map(benefits.map((b) => [b.id, b]))
  const out = new Map<string, PartnerBenefitRow[]>()
  for (const link of links) {
    const benefit = byId.get(link.benefit_id)
    if (!benefit) continue
    const arr = out.get(link.tier_id)
    if (arr) arr.push(benefit)
    else out.set(link.tier_id, [benefit])
  }
  for (const arr of out.values()) arr.sort((a, b) => a.sort - b.sort)
  return out
}

/**
 * Para cada `partnerId`: qué le da en su nivel actual y, si no le da nada, desde
 * qué nivel empieza a darle. `tiers` se recorre de menor a mayor umbral para que
 * "Desde X" sea siempre el escalón más barato al que le conviene llegar.
 */
export function resolvePartnersForTier(
  partnerIds: readonly string[],
  benefitsByTier: ReadonlyMap<string, PartnerBenefitRow[]>,
  tiers: readonly LoyaltyTier[],
  currentTierId: string | null,
): Map<string, PartnerResolution> {
  const ladder = sortedActiveTiers(tiers)

  const mine = currentTierId ? (benefitsByTier.get(currentTierId) ?? []) : []
  const mineByPartner = new Map<string, PartnerBenefitRow>()
  for (const b of mine) if (!mineByPartner.has(b.partner_id)) mineByPartner.set(b.partner_id, b)

  const out = new Map<string, PartnerResolution>()
  for (const partnerId of partnerIds) {
    const own = mineByPartner.get(partnerId)
    if (own) {
      out.set(partnerId, { myBenefit: toBenefit(own), unlockTierName: null })
      continue
    }
    let unlockTierName: string | null = null
    for (const tier of ladder) {
      if (tier.id === currentTierId) continue
      const rows = benefitsByTier.get(tier.id)
      if (rows?.some((b) => b.partner_id === partnerId)) {
        unlockTierName = tier.name
        break
      }
    }
    out.set(partnerId, { myBenefit: null, unlockTierName })
  }
  return out
}

/**
 * La escalera de aliados: por cada nivel, qué marcas y qué da cada una. Espeja
 * `progression` (mismo orden de niveles) para que la vista 'niveles' pueda
 * mostrarla con el mismo lenguaje visual que los beneficios.
 */
export function buildPartnerTiers(
  partners: ReadonlyArray<{
    id: string
    name: string
    logoUrl: string | null
    category: string | null
  }>,
  benefitsByTier: ReadonlyMap<string, PartnerBenefitRow[]>,
  tiers: readonly LoyaltyTier[],
): Array<{ tierId: string; entries: WalletPartnerTierEntry[] }> {
  const byId = new Map(partners.map((p) => [p.id, p]))
  return sortedActiveTiers(tiers).map((tier) => {
    const seen = new Set<string>()
    const entries: WalletPartnerTierEntry[] = []
    for (const row of benefitsByTier.get(tier.id) ?? []) {
      if (seen.has(row.partner_id)) continue
      const partner = byId.get(row.partner_id)
      if (!partner) continue
      seen.add(row.partner_id)
      entries.push({
        partnerId: partner.id,
        partnerName: partner.name,
        logoUrl: partner.logoUrl,
        category: partner.category,
        benefit: toBenefit(row),
      })
    }
    return { tierId: tier.id, entries }
  })
}
