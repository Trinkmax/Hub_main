import { describe, expect, it } from 'vitest'
import { canUseFloorPlan, canUseTableQr } from '@/lib/floor-plan/access'
import {
  hasBranchChoice,
  inkOn,
  isSectorNameTaken,
  normalizeSectorName,
  planHref,
  relativeLuminance,
  suggestNumberStart,
} from '@/lib/floor-plan/branches'

describe('hasBranchChoice', () => {
  it('con una sola sucursal (o ninguna) no hay selector', () => {
    expect(hasBranchChoice([])).toBe(false)
    expect(hasBranchChoice([{ id: 'a' }])).toBe(false)
  })

  it('con dos o más, sí', () => {
    expect(hasBranchChoice([{ id: 'a' }, { id: 'b' }])).toBe(true)
  })
})

describe('planHref', () => {
  it('sin sucursal es la ruta del editor', () => {
    expect(planHref('hub')).toBe('/hub/local/mesas')
    expect(planHref('hub', null)).toBe('/hub/local/mesas')
  })

  it('la sucursal elegida viaja en ?sucursal=', () => {
    expect(planHref('demo-administracion', 'cerro')).toBe(
      '/demo-administracion/local/mesas?sucursal=cerro',
    )
  })

  it('escapa el slug por las dudas', () => {
    expect(planHref('hub', 'a b&c')).toBe('/hub/local/mesas?sucursal=a%20b%26c')
  })
})

describe('nombres de sector', () => {
  const sectors = [
    { id: 's1', name: 'Salón' },
    { id: 's2', name: 'Terraza' },
  ]

  it('compara como el índice de la base: sin espacios a los costados ni mayúsculas', () => {
    expect(normalizeSectorName('  TERRAZA ')).toBe('terraza')
    expect(normalizeSectorName('Salón')).toBe('salón')
  })

  it('detecta el nombre repetido dentro de la sucursal', () => {
    expect(isSectorNameTaken(sectors, 'terraza')).toBe(true)
    expect(isSectorNameTaken(sectors, '  SALÓN  ')).toBe(true)
    expect(isSectorNameTaken(sectors, 'Reservado')).toBe(false)
  })

  it('otra sucursal puede tener su propia «Terraza» (solo se miran los sectores que se pasan)', () => {
    const otherBranch = [{ id: 'x1', name: 'Planta baja' }]
    expect(isSectorNameTaken(otherBranch, 'Terraza')).toBe(false)
  })

  it('al renombrar, el propio sector no cuenta', () => {
    expect(isSectorNameTaken(sectors, 'Terraza', 's2')).toBe(false)
    expect(isSectorNameTaken(sectors, 'Salón', 's2')).toBe(true)
  })

  it('un nombre vacío no está «repetido» (lo frena otra validación)', () => {
    expect(isSectorNameTaken(sectors, '   ')).toBe(false)
  })
})

describe('suggestNumberStart', () => {
  it('sin mesas numeradas arranca en 1', () => {
    expect(suggestNumberStart([])).toBe(1)
    expect(suggestNumberStart(['Barra', 'VIP'])).toBe(1)
  })

  it('propone la decena que sigue a la mesa más alta', () => {
    expect(suggestNumberStart(['1', '2', '14'])).toBe(20)
    expect(suggestNumberStart(['20', '27'])).toBe(30)
    expect(suggestNumberStart(['6'])).toBe(10)
    expect(suggestNumberStart(['10'])).toBe(20)
    expect(suggestNumberStart(['104', '3'])).toBe(110)
  })

  it('ignora nombres, decimales y espacios', () => {
    expect(suggestNumberStart([' 8 ', 'Barra', '2.5', '-4'])).toBe(10)
  })

  it('no pasa del máximo que acepta el sector', () => {
    expect(suggestNumberStart(['99999'])).toBe(100000)
    expect(suggestNumberStart(['250000'])).toBe(100000)
  })
})

describe('inkOn', () => {
  it('sobre los colores oscuros de sucursal va texto claro', () => {
    expect(inkOn('#2f5d50')).toBe('light') // el verde por defecto
    expect(inkOn('#a8452d')).toBe('light') // el terracota del Cerro
    expect(inkOn('#000000')).toBe('light')
  })

  it('sobre un color claro va tinta: el dueño puede elegir un amarillo', () => {
    expect(inkOn('#ffd400')).toBe('dark')
    expect(inkOn('#ffffff')).toBe('dark')
    expect(inkOn('#9ad0c2')).toBe('dark')
  })

  it('un color que no es #rrggbb cae en texto claro (la franja usa el verde del paño)', () => {
    expect(inkOn('red')).toBe('light')
    expect(inkOn('#fff')).toBe('light')
    expect(relativeLuminance('nope')).toBeNull()
  })

  it('la luminancia sigue la fórmula de WCAG', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3)
  })

  it('el color elegido da 4,5:1 con su texto en los dos casos', () => {
    const paper = 1 // texto claro ≈ blanco
    const ink = 0.017 // --pos-ink
    const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    for (const hex of [
      '#2f5d50',
      '#a8452d',
      '#7a5c00',
      '#3b6fd4',
      '#ffd400',
      '#c9a227',
      '#ffffff',
    ]) {
      const luminance = relativeLuminance(hex) as number
      if (inkOn(hex) === 'light') {
        // La franja oscurece el color un 14 % (≈ 0,64 de su luminancia).
        expect(contrast(paper, luminance * 0.636)).toBeGreaterThanOrEqual(4.5)
      } else {
        expect(contrast(luminance, ink)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('quién puede abrir el editor', () => {
  const flags = (feature_flags: Record<string, boolean>) => ({ feature_flags })

  it('alcanza con el plano o con el punto de venta (cualquiera de los dos)', () => {
    expect(canUseFloorPlan(flags({ floor_plan: true }), false)).toBe(true)
    expect(canUseFloorPlan(flags({ pos: true }), false)).toBe(true)
    expect(canUseFloorPlan(flags({ floor_plan: true, pos: true }), false)).toBe(true)
  })

  it('con los dos apagados no se abre', () => {
    expect(canUseFloorPlan(flags({}), false)).toBe(false)
    expect(canUseFloorPlan(flags({ floor_plan: false, pos: false, table_qr: true }), false)).toBe(
      false,
    )
  })

  it('un superadmin pasa siempre', () => {
    expect(canUseFloorPlan(flags({}), true)).toBe(true)
  })

  it('los QR de mesa siguen a su propio interruptor', () => {
    expect(canUseTableQr(flags({ pos: true }), false)).toBe(false)
    expect(canUseTableQr(flags({ table_qr: true }), false)).toBe(true)
    expect(canUseTableQr(flags({}), true)).toBe(true)
  })
})
