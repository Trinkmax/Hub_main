import { describe, expect, it } from 'vitest'
import {
  branchSlugLookup,
  branchVisible,
  footerPlaces,
  functionAddress,
  parseBranchParam,
  pickFunction,
  sellingBranches,
  showBranchNames,
  type TicketBranchRow,
  toPublicBranch,
} from '@/lib/ticketing/branches'
import {
  catalogFilterOptions,
  catalogFiltersQuery,
  filmHref,
  filterCatalog,
  hasActiveFilters,
  NO_FILTERS,
  parseCatalogFilters,
  sanitizeCatalogFilters,
} from '@/lib/ticketing/catalog'
import { checkoutHelpMessage, transferProofMessage } from '@/lib/ticketing/copy'
import type { PublicBranch, PublicExperience, PublicFunction } from '@/lib/ticketing/types'

/**
 * Las entradas con sucursales, del lado público y del panel (docs/features/sucursales.md): la
 * película es del bar y cada función es de una sucursal. Lo que se fija:
 * - lo público nombra la sucursal por su slug, en el orden de siempre, y solo si hay más de una
 *   con funciones;
 * - la dirección es la de la sucursal de la función (si no cargó, la del bar);
 * - la cartelera se filtra por sucursal (?sucursal=) sobre lo ya cargado;
 * - una acción del panel solo toca lo de una sucursal que la persona ve.
 */

const ALTA = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const CERRO = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2'
const VIEJA = 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3'

const row = (over: Partial<TicketBranchRow>): TicketBranchRow => ({
  id: ALTA,
  slug: 'alta-cordoba',
  name: 'Alta Córdoba',
  short_name: 'Alta Cba',
  address: 'Av. Juan B. Justo 2500',
  color: '#2F5D50',
  is_default: true,
  position: 0,
  active: true,
  ...over,
})

const ROWS: TicketBranchRow[] = [
  row({
    id: CERRO,
    slug: 'cerro',
    name: 'Cerro',
    short_name: null,
    address: '  ',
    color: 'rojo',
    is_default: false,
    position: 1,
  }),
  row({}),
  row({
    id: VIEJA,
    slug: 'vieja',
    name: 'Vieja',
    is_default: false,
    position: 2,
    active: false,
  }),
]

const ALTA_PUBLIC: PublicBranch = {
  slug: 'alta-cordoba',
  name: 'Alta Córdoba',
  shortName: 'Alta Cba',
  address: 'Av. Juan B. Justo 2500',
  color: '#2f5d50',
}
const CERRO_PUBLIC: PublicBranch = {
  slug: 'cerro',
  name: 'Cerro',
  shortName: null,
  address: null,
  color: '#2f5d50',
}

describe('las sucursales en lo público', () => {
  it('solo lo que se muestra: sin id, con el color sano y sin direcciones vacías', () => {
    expect(toPublicBranch(ROWS[1] as TicketBranchRow)).toEqual(ALTA_PUBLIC)
    expect(toPublicBranch(ROWS[0] as TicketBranchRow)).toEqual(CERRO_PUBLIC)
  })

  it('las que tienen funciones, la principal primero (también una apagada con funciones)', () => {
    expect(sellingBranches(ROWS, [CERRO, ALTA, null, CERRO]).map((b) => b.slug)).toEqual([
      'alta-cordoba',
      'cerro',
    ])
    expect(sellingBranches(ROWS, [VIEJA]).map((b) => b.slug)).toEqual(['vieja'])
    expect(sellingBranches(ROWS, [])).toEqual([])
  })

  it('de id a slug, y nada si no se sabe', () => {
    const slugOf = branchSlugLookup(ROWS)
    expect(slugOf(CERRO)).toBe('cerro')
    expect(slugOf(null)).toBeNull()
    expect(slugOf('otra')).toBeNull()
  })

  it('se dice dónde es cada función solo con más de una sucursal', () => {
    expect(showBranchNames([ALTA_PUBLIC])).toBe(false)
    expect(showBranchNames([ALTA_PUBLIC, CERRO_PUBLIC])).toBe(true)
  })

  it('la dirección: la de la sucursal o, si no cargó, la del bar', () => {
    expect(functionAddress(ALTA_PUBLIC, 'Calle del bar 1')).toBe('Av. Juan B. Justo 2500')
    expect(functionAddress(CERRO_PUBLIC, 'Calle del bar 1')).toBe('Calle del bar 1')
    expect(functionAddress(null, ' ')).toBeNull()
  })

  it('el pie: una dirección con una sucursal, cada una con su nombre con varias', () => {
    expect(footerPlaces([], 'Calle del bar 1')).toEqual([
      { label: null, address: 'Calle del bar 1' },
    ])
    expect(footerPlaces([ALTA_PUBLIC], 'Calle del bar 1')).toEqual([
      { label: null, address: 'Av. Juan B. Justo 2500' },
    ])
    // El Cerro no cargó dirección: no se lista con la del bar al lado.
    expect(footerPlaces([ALTA_PUBLIC, CERRO_PUBLIC], 'Calle del bar 1')).toEqual([
      { label: 'Alta Córdoba', address: 'Av. Juan B. Justo 2500' },
    ])
    expect(footerPlaces([CERRO_PUBLIC, { ...CERRO_PUBLIC, slug: 'x' }], 'Calle del bar 1')).toEqual(
      [{ label: null, address: 'Calle del bar 1' }],
    )
    expect(footerPlaces([], null)).toEqual([])
  })

  it('el ?sucursal= de un link: un slug con forma, o nada', () => {
    expect(parseBranchParam('Cerro ')).toBe('cerro')
    expect(parseBranchParam('alta-cordoba')).toBe('alta-cordoba')
    expect(parseBranchParam('../x')).toBeNull()
    expect(parseBranchParam(['cerro'])).toBeNull()
    expect(parseBranchParam(undefined)).toBeNull()
  })
})

const fn = (
  eventId: string,
  date: string,
  branch: string | null,
  state: PublicFunction['state'] = 'available',
): PublicFunction => ({
  eventId,
  date,
  time: '21:00',
  capacity: 54,
  left: state === 'sold_out' ? 0 : 20,
  state,
  branch,
})

describe('la función con la que arranca la película', () => {
  const functions = [
    fn('a1', '2026-12-01', 'alta-cordoba', 'sold_out'),
    fn('c1', '2026-12-01', 'cerro'),
    fn('a2', '2026-12-05', 'alta-cordoba'),
    fn('c2', '2026-12-05', 'cerro'),
  ]

  it('la misma noche en las dos: gana la sucursal pedida', () => {
    expect(pickFunction(functions, { date: '2026-12-05', branch: 'cerro' })?.eventId).toBe('c2')
    expect(pickFunction(functions, { date: '2026-12-05', branch: null })?.eventId).toBe('a2')
  })

  it('la del día pedido aunque sea de otra sucursal, antes que otro día', () => {
    expect(pickFunction(functions, { date: '2026-12-01', branch: 'alta-cordoba' })?.eventId).toBe(
      'c1',
    )
  })

  it('sin fecha: la primera con lugar de esa sucursal, o la primera con lugar', () => {
    expect(pickFunction(functions, { date: null, branch: 'alta-cordoba' })?.eventId).toBe('a2')
    expect(pickFunction(functions, { date: null, branch: 'otra' })?.eventId).toBe('c1')
    expect(pickFunction([functions[0] as PublicFunction], { date: null, branch: null })).toBeNull()
  })
})

const exp = (slug: string, functions: PublicFunction[]): PublicExperience => ({
  id: slug,
  slug,
  title: slug,
  series: null,
  tagline: null,
  synopsis: null,
  scheduleNote: null,
  posterUrl: null,
  heroUrl: null,
  cardUrl: null,
  videoUrl: null,
  accent: '#c0573e',
  steps: [],
  stepsNote: null,
  gallery: [],
  priceCents: 4_500_000,
  depositCents: 2_000_000,
  cashPriceCents: null,
  allowFullPayment: false,
  minPartySize: 2,
  maxPartySize: 10,
  priceNote: null,
  terms: null,
  functions,
})

describe('la cartelera por sucursal', () => {
  const cartelera = [
    exp('shrek-2', [fn('s1', '2026-12-01', 'alta-cordoba'), fn('s2', '2026-12-02', 'cerro')]),
    exp('coraline', [fn('c1', '2026-12-03', 'alta-cordoba')]),
  ]

  it('las sucursales para elegir: solo si más de una tiene funciones', () => {
    expect(catalogFilterOptions(cartelera, [ALTA_PUBLIC, CERRO_PUBLIC]).branches).toEqual([
      { value: 'alta-cordoba', label: 'Alta Córdoba', color: '#2f5d50' },
      { value: 'cerro', label: 'Cerro', color: '#2f5d50' },
    ])
    const soloAlta = [exp('coraline', [fn('c1', '2026-12-03', 'alta-cordoba')])]
    expect(catalogFilterOptions(soloAlta, [ALTA_PUBLIC, CERRO_PUBLIC]).branches).toEqual([])
    expect(catalogFilterOptions(cartelera).branches).toEqual([])
  })

  it('eligiendo el Cerro: sus funciones y sin las películas que no van ahí', () => {
    const visible = filterCatalog(cartelera, { ...NO_FILTERS, branch: 'cerro' })
    expect(visible.map((e) => e.slug)).toEqual(['shrek-2'])
    expect(visible[0]?.functions.map((f) => f.eventId)).toEqual(['s2'])
    expect(hasActiveFilters({ ...NO_FILTERS, branch: 'cerro' })).toBe(true)
  })

  it('la URL ida y vuelta, y una sucursal que no vende se ignora', () => {
    const filters = parseCatalogFilters({ sucursal: 'cerro', ver: 'disponibles' })
    expect(filters).toEqual({ ...NO_FILTERS, availability: 'available', branch: 'cerro' })
    expect(catalogFiltersQuery(filters)).toBe('?ver=disponibles&sucursal=cerro')
    const options = catalogFilterOptions(cartelera, [ALTA_PUBLIC, CERRO_PUBLIC])
    expect(sanitizeCatalogFilters(filters, options).branch).toBe('cerro')
    expect(sanitizeCatalogFilters({ ...filters, branch: 'vieja' }, options).branch).toBeNull()
  })

  it('el link a la película lleva la sucursal de la función', () => {
    expect(filmHref('hub', 'shrek-2', { date: '2026-12-02', branch: 'cerro' })).toBe(
      '/entradas/hub/shrek-2?fecha=2026-12-02&sucursal=cerro',
    )
    expect(filmHref('hub', 'shrek-2', { branch: null })).toBe('/entradas/hub/shrek-2')
  })

  it('los mensajes de WhatsApp dicen dónde, si hay varias', () => {
    expect(
      checkoutHelpMessage({
        tenantName: 'HUB',
        title: 'Shrek 2',
        dateLabel: 'miércoles 2 de diciembre',
        time: '21:00',
        partySize: 2,
        guestName: 'Ana',
        branchName: 'Cerro',
      }),
    ).toBe(
      '¡Hola HUB! Quiero reservar Shrek 2, miércoles 2 de diciembre a las 21:00 hs en Cerro, 2 personas, a nombre de Ana. La página no me dejó pagar.',
    )
    expect(
      transferProofMessage({
        tenantName: 'HUB',
        title: 'Shrek 2',
        dateLabel: 'miércoles 2 de diciembre',
        time: '21:00',
        partySize: 2,
        guestName: 'Ana',
        amountLabel: '$ 40.000',
        alias: 'mi.bar.pagos',
        code: 'E38D8CEB',
        branchName: 'Cerro',
      }),
    ).toContain('a las 21:00 hs en Cerro, 2 personas')
  })
})

describe('las acciones del panel y la sucursal', () => {
  const alta = {
    id: ALTA,
    name: 'Alta Córdoba',
    shortName: null,
    slug: 'alta-cordoba',
    color: '#2f5d50',
    address: null,
    position: 0,
    isDefault: true,
    openedOn: null,
    seatCapacity: null,
  }

  it('la anfitriona toca lo de sus sucursales; un dueño, lo de todas', () => {
    expect(branchVisible({ branches: [alta], unrestricted: false }, ALTA)).toBe(true)
    expect(branchVisible({ branches: [alta], unrestricted: false }, CERRO)).toBe(false)
    expect(branchVisible({ branches: [alta], unrestricted: false }, null)).toBe(false)
    expect(branchVisible({ branches: [alta], unrestricted: true }, CERRO)).toBe(true)
  })
})
