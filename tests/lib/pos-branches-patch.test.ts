// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { stepAnchor, stepLinks } from '@/lib/pos/branches/links'
import {
  branchColumns,
  describeBranchChange,
  invertBranchChanges,
  planBranchPatch,
} from '@/lib/pos/branches/patch'
import type { Branch, BranchChange } from '@/lib/pos/branches/types'

const CERRO: Branch = {
  id: 'b1',
  name: 'Cerro',
  shortName: null,
  slug: 'cerro',
  color: '#a8452d',
  address: null,
  position: 1,
  isDefault: false,
  active: true,
  updatedAt: '2026-11-13T02:22:57.605825+00:00',
}

describe('planBranchPatch', () => {
  it('si el dato sigue como la persona lo veía, se escribe', () => {
    const plan = planBranchPatch(CERRO, [
      { field: 'name', value: 'Cerro de las Rosas', expected: 'Cerro' },
    ])
    expect(plan).toMatchObject({ kind: 'write', fields: ['name'] })
    expect(plan.kind === 'write' && plan.next.name).toBe('Cerro de las Rosas')
  })

  it('si ya está como se pidió no hay nada que escribir, aunque la persona viera otra cosa', () => {
    expect(
      planBranchPatch(CERRO, [{ field: 'name', value: 'Cerro', expected: 'El Cerro' }]),
    ).toEqual({ kind: 'noop' })
  })

  it('si otra persona lo cambió a otra cosa, no se escribe y se avisa cuál', () => {
    expect(
      planBranchPatch(CERRO, [{ field: 'name', value: 'Villa Belgrano', expected: 'El Cerro' }]),
    ).toEqual({ kind: 'conflict', fields: ['name'] })
  })

  it('un cambio de varios datos va entero o no va', () => {
    const changes: BranchChange[] = [
      { field: 'color', value: '#2c4a7c', expected: '#a8452d' },
      { field: 'address', value: 'Av. Rafael Núñez 4000', expected: 'otra' },
    ]
    expect(planBranchPatch(CERRO, changes)).toEqual({ kind: 'conflict', fields: ['address'] })
  })

  it('el color compara sin mayúsculas', () => {
    expect(
      planBranchPatch(CERRO, [{ field: 'color', value: '#A8452D', expected: '#a8452d' }]),
    ).toEqual({ kind: 'noop' })
    expect(
      planBranchPatch(CERRO, [{ field: 'color', value: '#2c4a7c', expected: '#A8452D' }]),
    ).toMatchObject({ kind: 'write', fields: ['color'] })
  })

  it('vacío y «sin dato» son lo mismo para un texto que puede faltar', () => {
    expect(planBranchPatch(CERRO, [{ field: 'shortName', value: null, expected: null }])).toEqual({
      kind: 'noop',
    })
    expect(
      planBranchPatch(CERRO, [{ field: 'shortName', value: 'El Cerro', expected: null }]),
    ).toMatchObject({ kind: 'write', fields: ['shortName'] })
  })

  it('desactivar es un dato más', () => {
    const plan = planBranchPatch(CERRO, [{ field: 'active', value: false, expected: true }])
    expect(plan).toMatchObject({ kind: 'write', fields: ['active'] })
    expect(plan.kind === 'write' && plan.next.active).toBe(false)
  })
})

describe('branchColumns', () => {
  it('arma solo las columnas que cambian, con el nombre de la base', () => {
    const plan = planBranchPatch(CERRO, [
      { field: 'shortName', value: 'El Cerro', expected: null },
      { field: 'color', value: '#2c4a7c', expected: '#a8452d' },
    ])
    if (plan.kind !== 'write') throw new Error('tenía que escribir')
    expect(branchColumns(plan.fields, plan.next)).toEqual({
      short_name: 'El Cerro',
      color: '#2c4a7c',
    })
  })
})

describe('invertBranchChanges', () => {
  it('deshacer es el mismo cambio al revés', () => {
    expect(
      invertBranchChanges([{ field: 'color', value: '#2c4a7c', expected: '#a8452d' }]),
    ).toEqual([{ field: 'color', value: '#a8452d', expected: '#2c4a7c' }])
  })
})

describe('describeBranchChange', () => {
  it('dice cómo quedó, en una línea', () => {
    expect(
      describeBranchChange({ field: 'name', value: 'Cerro de las Rosas', expected: 'Cerro' }, 'x'),
    ).toBe('Cerro ahora se llama Cerro de las Rosas')
    expect(
      describeBranchChange({ field: 'shortName', value: 'C. Rosas', expected: null }, 'Cerro'),
    ).toBe('Cerro: en el salón se lee «C. Rosas»')
    expect(
      describeBranchChange({ field: 'shortName', value: null, expected: 'C. Rosas' }, 'Cerro'),
    ).toBe('Cerro: en el salón se lee el nombre entero')
    expect(
      describeBranchChange({ field: 'color', value: '#2c4a7c', expected: '#a8452d' }, 'Cerro'),
    ).toBe('Cerro: ahora es azul noche')
    expect(
      describeBranchChange({ field: 'address', value: 'Núñez 4000', expected: null }, 'Cerro'),
    ).toBe('Cerro: dirección guardada')
    expect(describeBranchChange({ field: 'active', value: false, expected: true }, 'Cerro')).toBe(
      'Cerro quedó desactivada',
    )
    expect(describeBranchChange({ field: 'active', value: true, expected: false }, 'Cerro')).toBe(
      'Cerro volvió a estar activa',
    )
  })
})

describe('stepLinks', () => {
  const ctx = { tenantSlug: 'hub', branchSlug: 'cerro' }

  it('el plano se abre parado en la sucursal', () => {
    expect(stepLinks({ id: 'plan', state: 'todo', issue: 'no_sectors' }, ctx)).toEqual([
      { label: 'Dibujar el plano', href: '/hub/local/mesas?sucursal=cerro' },
    ])
    expect(stepLinks({ id: 'plan', state: 'done', issue: null }, ctx)[0]?.label).toBe(
      'Abrir el plano',
    )
  })

  it('el primer enlace de la carta es el que resuelve lo que falta', () => {
    expect(stepLinks({ id: 'menu', state: 'todo', issue: 'empty_menu' }, ctx)).toEqual([
      { label: 'Ir a la carta', href: '/hub/menu' },
    ])
    expect(stepLinks({ id: 'menu', state: 'todo', issue: 'unassigned' }, ctx)[0]).toEqual({
      label: 'Estaciones de cocina',
      href: '/hub/menu/cocina',
    })
    expect(stepLinks({ id: 'menu', state: 'todo', issue: 'nothing_sold' }, ctx)[0]).toEqual({
      label: 'Precios de acá',
      href: '/hub/menu/precios?sucursal=cerro',
    })
    expect(stepLinks({ id: 'menu', state: 'done', issue: null }, ctx)).toHaveLength(2)
  })

  it('la cocina no lleva enlaces (su link es para la tele) y la caja tampoco hasta que llega', () => {
    expect(stepLinks({ id: 'kitchen', state: 'todo', issue: 'never_seen' }, ctx)).toEqual([])
    expect(stepLinks({ id: 'cash', state: 'soon', issue: null }, ctx)).toEqual([])
    expect(stepLinks({ id: 'cash', state: 'todo', issue: 'no_register' }, ctx)[0]).toMatchObject({
      href: '/hub/salon/caja?sucursal=cerro',
      newTab: true,
    })
  })

  it('el cobro lleva a los ajustes de esta misma pantalla, al bloque de cobrar', () => {
    expect(stepLinks({ id: 'charge', state: 'todo', issue: 'no_alias' }, ctx)).toEqual([
      { label: 'Cargar el alias', href: '/hub/local/sucursales?ver=ajustes#ajustes-cobro' },
    ])
  })

  it('un nombre raro de sucursal viaja bien en el link', () => {
    const links = stepLinks(
      { id: 'plan', state: 'done', issue: null },
      { tenantSlug: 'hub', branchSlug: 'a b&c' },
    )
    expect(links[0]?.href).toBe('/hub/local/mesas?sucursal=a%20b%26c')
  })

  it('cada paso tiene su ancla', () => {
    expect(stepAnchor('plan')).toBe('paso-plan')
  })
})
