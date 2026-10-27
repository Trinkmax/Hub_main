import { describe, expect, it } from 'vitest'
import {
  buildAgenda,
  catalogFilterOptions,
  catalogFiltersQuery,
  filmHref,
  filterCatalog,
  hasActiveFilters,
  monthsLabel,
  NO_FILTERS,
  parseCatalogFilters,
  sanitizeCatalogFilters,
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
    cashPriceCents: null,
    minPartySize: 1,
    maxPartySize: 10,
    priceNote: null,
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

describe('filtros de la cartelera', () => {
  // La cartelera del 27/10/2026: todo agotado menos Shrek 2 el viernes 30.
  const cartelera = [
    exp({
      slug: 'ratatouille',
      title: 'Ratatouille',
      functions: [fn('2026-11-02', 0, 'r1'), fn('2026-11-09', 0, 'r2')],
    }),
    exp({
      slug: 'shrek-2',
      title: 'Shrek 2',
      functions: [fn('2026-10-27', 0, 's1'), fn('2026-10-30', 54, 's2'), fn('2026-11-03', 0, 's3')],
    }),
    exp({ slug: 'coraline', title: 'Coraline', functions: [fn('2026-11-24', 0, 'c1')] }),
    exp({ slug: 'nueva', title: 'Nueva', functions: [] }),
  ]

  it('«Disponibles» deja solo Shrek 2 del viernes 30', () => {
    const visible = filterCatalog(cartelera, { ...NO_FILTERS, availability: 'available' })
    expect(visible.map((e) => e.slug)).toEqual(['shrek-2'])
    expect(visible[0]?.functions.map((f) => f.eventId)).toEqual(['s2'])
  })

  it('«Agotadas» muestra solo las fechas sin lugar', () => {
    const visible = filterCatalog(cartelera, { ...NO_FILTERS, availability: 'sold_out' })
    expect(visible.map((e) => e.slug)).toEqual(['ratatouille', 'shrek-2', 'coraline'])
    expect(visible[1]?.functions.map((f) => f.eventId)).toEqual(['s1', 's3'])
  })

  it('por mes: cada película con sus fechas de ese mes, y sin las que no tienen', () => {
    const visible = filterCatalog(cartelera, { ...NO_FILTERS, month: '2026-10' })
    expect(visible.map((e) => e.slug)).toEqual(['shrek-2'])
    expect(visible[0]?.functions.map((f) => f.eventId)).toEqual(['s1', 's2'])
  })

  it('por película: esa sola, con todas sus fechas (aunque no tenga ninguna)', () => {
    expect(filterCatalog(cartelera, { ...NO_FILTERS, film: 'nueva' }).map((e) => e.slug)).toEqual([
      'nueva',
    ])
    const shrek = filterCatalog(cartelera, { ...NO_FILTERS, film: 'shrek-2' })
    expect(shrek[0]?.functions).toHaveLength(3)
  })

  it('los filtros se suman', () => {
    const visible = filterCatalog(cartelera, {
      month: '2026-11',
      film: 'shrek-2',
      availability: 'available',
    })
    expect(visible).toEqual([])
  })

  it('sin filtros, la cartelera entera (las que no tienen fechas también)', () => {
    expect(filterCatalog(cartelera, NO_FILTERS)).toEqual(cartelera)
    expect(hasActiveFilters(NO_FILTERS)).toBe(false)
  })

  it('las opciones salen de la cartelera: los meses con funciones y las películas', () => {
    const options = catalogFilterOptions(cartelera)
    expect(options.months).toEqual([
      { value: '2026-10', label: 'Octubre' },
      { value: '2026-11', label: 'Noviembre' },
    ])
    expect(options.films.map((f) => f.label)).toEqual([
      'Ratatouille',
      'Shrek 2',
      'Coraline',
      'Nueva',
    ])
  })

  it('si los meses cruzan de año, llevan el año', () => {
    const options = catalogFilterOptions([
      exp({ functions: [fn('2026-12-20', 9), fn('2027-01-10', 9)] }),
    ])
    expect(options.months.map((m) => m.label)).toEqual(['Diciembre 2026', 'Enero 2027'])
  })

  it('la URL ida y vuelta, y lo que no se entiende se ignora', () => {
    const filters = parseCatalogFilters({ mes: '2026-11', pelicula: 'shrek-2', ver: 'disponibles' })
    expect(filters).toEqual({ month: '2026-11', film: 'shrek-2', availability: 'available' })
    expect(catalogFiltersQuery(filters)).toBe('?mes=2026-11&pelicula=shrek-2&ver=disponibles')
    expect(catalogFiltersQuery(NO_FILTERS)).toBe('')
    expect(parseCatalogFilters({ ver: 'agotadas' }).availability).toBe('sold_out')
    expect(
      parseCatalogFilters({ mes: '2026-13', pelicula: '../x', ver: ['disponibles', 'agotadas'] }),
    ).toEqual(NO_FILTERS)
  })

  it('un link viejo (mes que ya pasó, película despublicada) no deja la cartelera vacía', () => {
    const options = catalogFilterOptions(cartelera)
    expect(
      sanitizeCatalogFilters(
        { month: '2026-09', film: 'chihiro', availability: 'available' },
        options,
      ),
    ).toEqual({ month: null, film: null, availability: 'available' })
  })

  it('el link a la película lleva la fecha y, si se filtró, «Disponibles»', () => {
    expect(filmHref('hub', 'shrek-2')).toBe('/entradas/hub/shrek-2')
    expect(filmHref('hub', 'shrek-2', { date: '2026-10-30' })).toBe(
      '/entradas/hub/shrek-2?fecha=2026-10-30',
    )
    expect(filmHref('hub', 'shrek-2', { date: '2026-10-30', onlyAvailable: true })).toBe(
      '/entradas/hub/shrek-2?fecha=2026-10-30&ver=disponibles',
    )
  })
})
