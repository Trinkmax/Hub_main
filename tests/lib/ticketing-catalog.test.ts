import { describe, expect, it } from 'vitest'
import {
  buildAgenda,
  monthsLabel,
  splitHeadline,
  stepsSummary,
  summarizeCatalog,
} from '@/lib/ticketing/catalog'
import { checkoutUrl, peopleLabel, rejectionReason } from '@/lib/ticketing/copy'
import type { PublicExperience, PublicFunction } from '@/lib/ticketing/types'

function fn(date: string, left: number, eventId = date): PublicFunction {
  return {
    eventId,
    date,
    time: '21:00',
    capacity: 50,
    left,
    state: left <= 0 ? 'sold_out' : left <= 10 ? 'last' : 'available',
  }
}

function exp(partial: Partial<PublicExperience>): PublicExperience {
  return {
    id: partial.slug ?? 'x',
    slug: 'x',
    title: 'X',
    series: 'Cine y degustación',
    tagline: null,
    synopsis: null,
    scheduleNote: null,
    posterUrl: null,
    heroUrl: null,
    accent: '#c0573e',
    steps: [],
    stepsNote: null,
    gallery: [],
    priceCents: 3_500_000,
    depositCents: 500_000,
    maxPartySize: 10,
    terms: null,
    functions: [],
    ...partial,
  }
}

const venuePhoto = { url: 'https://x/hub-1.webp', caption: 'Sala', kind: 'venue' as const }

describe('summarizeCatalog', () => {
  const catalog = [
    exp({
      slug: 'shrek-2',
      title: 'Shrek 2',
      functions: [fn('2026-11-03', 0), fn('2026-12-01', 40)],
      gallery: [venuePhoto, { url: 'https://x/escena.webp', caption: null, kind: 'scene' }],
    }),
    exp({
      slug: 'coraline',
      title: 'Coraline',
      depositCents: 400_000,
      priceCents: 3_000_000,
      functions: [fn('2026-11-24', 5)],
      gallery: [venuePhoto],
    }),
  ]

  it('cuenta películas, funciones y agotadas', () => {
    const s = summarizeCatalog(catalog)
    expect(s.films).toBe(2)
    expect(s.functions).toBe(3)
    expect(s.soldOut).toBe(1)
  })

  it('«desde» es la seña y el precio más bajos', () => {
    const s = summarizeCatalog(catalog)
    expect(s.minDepositCents).toBe(400_000)
    expect(s.minPriceCents).toBe(3_000_000)
  })

  it('la colección solo si todas la comparten', () => {
    expect(summarizeCatalog(catalog).series).toBe('Cine y degustación')
    expect(summarizeCatalog([...catalog, exp({ series: 'Noches temáticas' })]).series).toBeNull()
  })

  it('las fotos reales del bar, sin repetir ni mezclar escenas', () => {
    expect(summarizeCatalog(catalog).venuePhotos).toEqual([venuePhoto])
  })

  it('una cartelera vacía no rompe', () => {
    const s = summarizeCatalog([])
    expect(s).toMatchObject({ films: 0, functions: 0, minDepositCents: null, monthsLabel: null })
  })
})

describe('monthsLabel', () => {
  it('uno, dos o un rango de meses', () => {
    expect(monthsLabel(['2026-11-03', '2026-11-24'])).toBe('noviembre')
    expect(monthsLabel(['2026-12-01', '2026-11-03'])).toBe('noviembre y diciembre')
    expect(monthsLabel(['2026-11-03', '2027-01-05', '2026-12-01'])).toBe('noviembre a enero')
  })
})

describe('splitHeadline', () => {
  it('la última palabra va aparte (otro color)', () => {
    expect(splitHeadline('Cine y degustación')).toEqual(['Cine y', 'degustación'])
    expect(splitHeadline('Cartelera')).toEqual(['', 'Cartelera'])
  })
})

describe('buildAgenda', () => {
  it('todas las funciones juntas, en orden y por mes', () => {
    const agenda = buildAgenda([
      exp({ slug: 'b', title: 'B', functions: [fn('2026-12-01', 3, 'b1')] }),
      exp({
        slug: 'a',
        title: 'A',
        functions: [fn('2026-11-30', 9, 'a1'), fn('2026-12-01', 9, 'a2')],
      }),
    ])
    expect(agenda.map((m) => m.label)).toEqual(['Noviembre 2026', 'Diciembre 2026'])
    expect(agenda[1]?.rows.map((r) => r.fn.eventId)).toEqual(['a2', 'b1'])
  })
})

describe('stepsSummary', () => {
  const step = (label: string | null = null) => ({
    icon: null,
    title: 'x',
    description: null,
    label,
  })

  it('cuenta los pasos y separa el postre', () => {
    expect(stepsSummary([])).toBeNull()
    expect(stepsSummary([step(), step()])).toBe('2 pasos')
    expect(stepsSummary([step(), step(), step('Final · Postre')])).toBe('2 pasos + postre')
    expect(stepsSummary([step(), step('Final · Postre')])).toBe('1 paso + postre')
  })
})

describe('textos para quien compra', () => {
  it('explica el rechazo de Mercado Pago y qué hacer', () => {
    expect(rejectionReason('cc_rejected_insufficient_amount')).toMatch(/saldo/)
    expect(rejectionReason('cc_rejected_call_for_authorize')).toMatch(/banco/)
    expect(rejectionReason(undefined)).toMatch(/no aprobó/)
  })

  it('personas en singular y plural', () => {
    expect(peopleLabel(1)).toBe('1 persona')
    expect(peopleLabel(4)).toBe('4 personas')
  })

  it('reintentar va a la misma preferencia (producción o prueba)', () => {
    expect(checkoutUrl('123-abc', true)).toBe(
      'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=123-abc',
    )
    expect(checkoutUrl('123-abc', false)).toContain('sandbox.mercadopago.com.ar')
  })
})
