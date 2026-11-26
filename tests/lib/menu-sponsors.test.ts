import { describe, expect, it } from 'vitest'
import {
  type CartaSponsor,
  MAX_SPONSORS,
  safeLogoUrl,
  sponsorBox,
  sponsorsForItem,
} from '@/lib/menu/sponsors'
import { parseCartaSponsors } from '@/lib/menu/sponsors-schema'

const LOGO = 'https://x.supabase.co/storage/v1/object/public/menu-images/t1/sponsors/branca.webp'

const stored = (overrides: Record<string, unknown> = {}) => ({
  name: 'Fernet Branca',
  logo_url: LOGO,
  ratio: 5.3,
  density: 0.45,
  keywords: ['Fernet Branca', 'branca'],
  ...overrides,
})

describe('leer los sponsors del bar', () => {
  it('sin nada cargado no hay sponsors', () => {
    expect(parseCartaSponsors(null)).toEqual([])
    expect(parseCartaSponsors({})).toEqual([])
    expect(parseCartaSponsors({ carta_sponsors: 'carpano' })).toEqual([])
    expect(parseCartaSponsors('x')).toEqual([])
  })

  it('lee los bien cargados, con sus palabras ya listas para comparar', () => {
    expect(parseCartaSponsors({ carta_sponsors: [stored()] })).toEqual([
      {
        name: 'Fernet Branca',
        logoUrl: LOGO,
        ratio: 5.3,
        density: 0.45,
        keywords: ['fernet branca', 'branca'],
      },
    ])
  })

  it('uno mal cargado se saltea y los demás se muestran', () => {
    const sponsors = parseCartaSponsors({
      carta_sponsors: [
        stored({ name: '' }),
        stored({ name: 'Sin proporción', ratio: undefined }),
        stored({ name: 'Proporción imposible', ratio: 40 }),
        stored({ name: 'Logo raro', logo_url: 'javascript:alert(1)' }),
        'cualquier cosa',
        stored({ name: 'Carpano', density: null, keywords: null }),
      ],
    })
    expect(sponsors.map((sponsor) => sponsor.name)).toEqual(['Carpano'])
    expect(sponsors[0]).toMatchObject({ density: null, keywords: [] })
  })

  it('tiene un tope', () => {
    const many = Array.from({ length: MAX_SPONSORS + 6 }, (_, index) =>
      stored({ name: `Marca ${index}` }),
    )
    expect(parseCartaSponsors({ carta_sponsors: many })).toHaveLength(MAX_SPONSORS)
  })

  it('descarta palabras vacías o repetidas', () => {
    const [sponsor] = parseCartaSponsors({
      carta_sponsors: [stored({ keywords: ['Branca', ' BRANCA ', 'x', '', 'Fernét'] })],
    })
    expect(sponsor?.keywords).toEqual(['branca', 'fernet'])
  })
})

describe('la URL del logo va a parar a CSS', () => {
  it('acepta https y rutas propias', () => {
    expect(safeLogoUrl(LOGO)).toBe(LOGO)
    expect(safeLogoUrl('/hub-logo.png')).toBe('/hub-logo.png')
    expect(safeLogoUrl(`  ${LOGO}  `)).toBe(LOGO)
  })

  it('rechaza lo que podría romper el `url("…")` o salir a otro lado', () => {
    expect(safeLogoUrl('http://x.com/a.png')).toBeNull()
    expect(safeLogoUrl('//x.com/a.png')).toBeNull()
    expect(safeLogoUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(safeLogoUrl('https://x.com/a.png");background:url("https://evil')).toBeNull()
    expect(safeLogoUrl('https://x.com/a b.png')).toBeNull()
    expect(safeLogoUrl("https://x.com/a'.png")).toBeNull()
    expect(safeLogoUrl('https://x.com/a\\.png')).toBeNull()
    expect(safeLogoUrl('no es una url')).toBeNull()
    expect(safeLogoUrl('')).toBeNull()
    expect(safeLogoUrl(42)).toBeNull()
  })
})

describe('el tamaño de cada sello', () => {
  it('uno cuadrado de tinta normal ocupa el lado pedido', () => {
    expect(sponsorBox({ ratio: 1, density: 0.32 }, 60)).toEqual({ width: 60, height: 60 })
    expect(sponsorBox({ ratio: 1, density: null }, 60)).toEqual({ width: 60, height: 60 })
  })

  it('uno apaisado sale más ancho y más bajo, pero sigue siendo legible', () => {
    const wide = sponsorBox({ ratio: 3, density: 0.32 }, 60)
    expect(wide.width).toBeGreaterThan(60)
    expect(wide.height).toBeLessThan(60)
    // No se achata hasta igualar la superficie: una palabra larga tiene que poder leerse.
    expect(wide.height).toBeGreaterThan(60 / Math.sqrt(3))
    expect(wide.width / wide.height).toBeCloseTo(3, 0)
  })

  it('uno de letras gruesas se achica un poco; uno de trazo fino se agranda', () => {
    const heavy = sponsorBox({ ratio: 1.6, density: 0.46 }, 60)
    const light = sponsorBox({ ratio: 1.6, density: 0.24 }, 60)
    expect(heavy.width).toBeLessThan(light.width)
    expect(heavy.height).toBeLessThan(light.height)
  })

  it('ni muy ancho ni muy alto: no se lleva toda la fila', () => {
    const banner = sponsorBox({ ratio: 8, density: 0.1 }, 60)
    expect(banner.width).toBeLessThanOrEqual(Math.round(60 * 2.7))
    const tower = sponsorBox({ ratio: 0.2, density: 0.1 }, 60)
    expect(tower.height).toBeLessThanOrEqual(Math.round(60 * 1.15))
    // Mantiene su forma al achicarse.
    expect(banner.width / banner.height).toBeGreaterThan(6.5)
  })
})

describe('la marca que nombra un producto', () => {
  const sponsor = (name: string, keywords: string[]): CartaSponsor => ({
    name,
    logoUrl: LOGO,
    ratio: 2,
    density: null,
    keywords,
  })
  const sponsors = [
    sponsor('Fernet Branca', ['branca']),
    sponsor('Spirito Blu', ['spirito blu', 'blu gin', 'gin blu']),
    sponsor('Speed Unlimited', ['speed']),
    sponsor('Sernova', ['sernova']),
    sponsor('Alpes', ['alpes', 'agua o soda']),
  ]
  const found = (name: string, description: string | null = null) =>
    sponsorsForItem({ name, description }, sponsors).map((each) => each.name)

  it('la encuentra en el nombre o en la descripción', () => {
    expect(found('Branca y Cola')).toEqual(['Fernet Branca'])
    expect(found('Jagger perfecto', 'Jägermeister con Speed o Schweppes.')).toEqual([
      'Speed Unlimited',
    ])
    expect(found('Agua o Soda')).toEqual(['Alpes'])
  })

  it('compara palabras enteras', () => {
    // «Blue Lagoon» no es Spirito Blu, ni «Speedy» es Speed.
    expect(found('Blue Lagoon', 'Curaçao azul, vodka y limón.')).toEqual([])
    expect(found('Speedy González')).toEqual([])
    expect(found('Blu Gin Tonic', 'Gin Blu con tónica.')).toEqual(['Spirito Blu'])
    // Un licuado «con agua o leche» no es el agua de la marca.
    expect(found('Licuado', 'Frutas con agua o leche.')).toEqual([])
  })

  it('hasta dos por producto, en el orden del bar', () => {
    expect(found('Sernova Speed')).toEqual(['Speed Unlimited', 'Sernova'])
    expect(found('Branca, Speed y Sernova')).toEqual(['Fernet Branca', 'Speed Unlimited'])
  })

  it('sin palabras cargadas no vincula nada', () => {
    expect(
      sponsorsForItem({ name: 'Carpano Orange', description: null }, [sponsor('Carpano', [])]),
    ).toEqual([])
    expect(sponsorsForItem({ name: 'Carpano Orange', description: null }, [])).toEqual([])
  })
})
