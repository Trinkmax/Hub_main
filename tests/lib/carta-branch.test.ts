import { describe, expect, it } from 'vitest'
import {
  applyBranchOverrides,
  cartaBranchHref,
  cartaPickerHref,
  celebrationOf,
  findBranchBySlug,
  NEW_BRANCH_DAYS,
} from '@/lib/menu/carta-branch'

const item = (id: string, price_cents: number) => ({ id, price_cents, name: `Plato ${id}` })

describe('applyBranchOverrides — la carta de una sucursal', () => {
  const menu = [item('mila', 16_500), item('tabla-crunch', 47_000), item('tabla-mila', 55_000)]

  it('sin filas para la sucursal, es la carta del bar tal cual', () => {
    expect(applyBranchOverrides(menu, [])).toEqual(menu)
  })

  it('saca lo que en la sucursal no se vende y deja el resto en el mismo orden', () => {
    const out = applyBranchOverrides(menu, [
      { menu_item_id: 'tabla-crunch', price_cents: null, available: false },
    ])
    expect(out.map((i) => i.id)).toEqual(['mila', 'tabla-mila'])
  })

  it('pone el precio propio de la sucursal y no toca el de los demás', () => {
    const out = applyBranchOverrides(menu, [
      { menu_item_id: 'mila', price_cents: 18_000, available: true },
    ])
    expect(out.find((i) => i.id === 'mila')?.price_cents).toBe(18_000)
    expect(out.find((i) => i.id === 'tabla-mila')?.price_cents).toBe(55_000)
    // Sin mutar la carta del bar: la otra sucursal la sigue leyendo igual.
    expect(menu[0]?.price_cents).toBe(16_500)
  })

  it('una fila que se vende y sin precio propio no cambia nada', () => {
    const out = applyBranchOverrides(menu, [
      { menu_item_id: 'tabla-mila', price_cents: null, available: true },
    ])
    expect(out).toEqual(menu)
  })

  it('lo que no se vende sale aunque tenga precio propio cargado', () => {
    const out = applyBranchOverrides(menu, [
      { menu_item_id: 'mila', price_cents: 18_000, available: false },
    ])
    expect(out.map((i) => i.id)).toEqual(['tabla-crunch', 'tabla-mila'])
  })
})

describe('findBranchBySlug — la sucursal que pide el link', () => {
  const branches = [{ slug: 'alta-cordoba' }, { slug: 'cerro' }]

  it('encuentra la sucursal sin importar mayúsculas ni espacios', () => {
    expect(findBranchBySlug(branches, ' Cerro ')).toEqual({ slug: 'cerro' })
  })

  it('sin parámetro o con uno que no existe, ninguna (y se muestra el selector)', () => {
    expect(findBranchBySlug(branches, undefined)).toBeNull()
    expect(findBranchBySlug(branches, '')).toBeNull()
    expect(findBranchBySlug(branches, 'centro')).toBeNull()
  })
})

describe('celebrationOf — la fiesta de la sucursal que abre', () => {
  it('el día de servicio de la apertura es la inauguración', () => {
    expect(celebrationOf('2026-11-27', '2026-11-27')).toBe('opening')
  })

  it('los días siguientes dice «Nuevo» y después nada', () => {
    expect(celebrationOf('2026-11-27', '2026-11-28')).toBe('new')
    const last = new Date(Date.UTC(2026, 10, 27 + NEW_BRANCH_DAYS - 1)).toISOString().slice(0, 10)
    const after = new Date(Date.UTC(2026, 10, 27 + NEW_BRANCH_DAYS)).toISOString().slice(0, 10)
    expect(celebrationOf('2026-11-27', last)).toBe('new')
    expect(celebrationOf('2026-11-27', after)).toBeNull()
  })

  it('antes de abrir, sin fecha o con una fecha rota, no hay fiesta', () => {
    expect(celebrationOf('2026-11-27', '2026-11-26')).toBeNull()
    expect(celebrationOf(null, '2026-11-27')).toBeNull()
    expect(celebrationOf('27/11/2026', '2026-11-27')).toBeNull()
  })

  it('cruza fin de mes y de año', () => {
    expect(celebrationOf('2026-12-31', '2027-01-01')).toBe('new')
  })
})

describe('las direcciones de la carta', () => {
  it('la carta de una sucursal va en ?sucursal= y conserva el club o la billetera del link', () => {
    expect(cartaBranchHref('hub', 'cerro')).toBe('/carta/hub?sucursal=cerro')
    expect(cartaBranchHref('hub', 'cerro', { club: true })).toBe('/carta/hub?sucursal=cerro&club')
    expect(cartaBranchHref('hub', 'alta-cordoba', { wallet: true })).toBe(
      '/carta/hub?sucursal=alta-cordoba&wallet',
    )
  })

  it('el selector es la dirección del QR', () => {
    expect(cartaPickerHref('hub')).toBe('/carta/hub')
  })
})
