// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  canBeDefault,
  canDeactivate,
  canDelete,
  moveBranch,
  moveOptions,
  positionWrites,
  sortBranches,
  splitBranches,
} from '@/lib/pos/branches/order'

type Row = { id: string; name: string; position: number; isDefault: boolean; active: boolean }

const row = (id: string, position: number, extra: Partial<Row> = {}): Row => ({
  id,
  name: id,
  position,
  isDefault: false,
  active: true,
  ...extra,
})

/** La principal tiene la posición más alta a propósito: igual va primera. */
const BAR: Row[] = [
  row('cerro', 0),
  row('centro', 1),
  row('alta', 5, { isDefault: true }),
  row('guemes', 2),
  row('vieja', 3, { active: false }),
]

describe('sortBranches', () => {
  it('la principal va siempre primera; después, por posición', () => {
    expect(sortBranches(BAR).map((b) => b.id)).toEqual([
      'alta',
      'cerro',
      'centro',
      'guemes',
      'vieja',
    ])
  })

  it('con la misma posición desempata el nombre', () => {
    const tied = [row('zeta', 1), row('beta', 1), row('alfa', 1)]
    expect(sortBranches(tied).map((b) => b.id)).toEqual(['alfa', 'beta', 'zeta'])
  })

  it('no cambia la lista que recibe', () => {
    const before = BAR.map((b) => b.id)
    sortBranches(BAR)
    expect(BAR.map((b) => b.id)).toEqual(before)
  })
})

describe('splitBranches', () => {
  it('separa las desactivadas', () => {
    const { active, inactive } = splitBranches(BAR)
    expect(active.map((b) => b.id)).toEqual(['alta', 'cerro', 'centro', 'guemes'])
    expect(inactive.map((b) => b.id)).toEqual(['vieja'])
  })
})

describe('moveOptions', () => {
  it('la principal no se mueve', () => {
    expect(moveOptions(BAR, 'alta')).toEqual({ earlier: false, later: false, place: 1, of: 4 })
  })

  it('la que sigue a la principal no puede pasarle por delante', () => {
    expect(moveOptions(BAR, 'cerro')).toEqual({ earlier: false, later: true, place: 2, of: 4 })
  })

  it('la del medio va para los dos lados y la última solo para adelante', () => {
    expect(moveOptions(BAR, 'centro')).toMatchObject({ earlier: true, later: true, place: 3 })
    expect(moveOptions(BAR, 'guemes')).toMatchObject({ earlier: true, later: false, place: 4 })
  })

  it('una desactivada o una que no existe no tiene a dónde ir', () => {
    expect(moveOptions(BAR, 'vieja')).toMatchObject({ earlier: false, later: false })
    expect(moveOptions(BAR, 'nadie')).toMatchObject({ earlier: false, later: false })
  })

  it('con dos sucursales no hay nada que ordenar', () => {
    const two = [row('alta', 0, { isDefault: true }), row('cerro', 1)]
    expect(moveOptions(two, 'cerro')).toMatchObject({ earlier: false, later: false })
  })
})

describe('moveBranch', () => {
  it('corre una sucursal un lugar y deja las desactivadas al final', () => {
    expect(moveBranch(BAR, 'centro', -1)).toEqual(['alta', 'centro', 'cerro', 'guemes', 'vieja'])
    expect(moveBranch(BAR, 'centro', 1)).toEqual(['alta', 'cerro', 'guemes', 'centro', 'vieja'])
  })

  it('no mueve lo que no se puede mover', () => {
    expect(moveBranch(BAR, 'alta', 1)).toBeNull()
    expect(moveBranch(BAR, 'cerro', -1)).toBeNull()
    expect(moveBranch(BAR, 'guemes', 1)).toBeNull()
    expect(moveBranch(BAR, 'vieja', -1)).toBeNull()
  })
})

describe('positionWrites', () => {
  it('escribe solo las posiciones que cambian', () => {
    const tidy = [
      row('alta', 0, { isDefault: true }),
      row('cerro', 1),
      row('centro', 2),
      row('guemes', 3),
    ]
    expect(positionWrites(tidy, ['alta', 'centro', 'cerro', 'guemes'])).toEqual([
      { id: 'centro', position: 1 },
      { id: 'cerro', position: 2 },
    ])
    expect(positionWrites(tidy, ['alta', 'cerro', 'centro', 'guemes'])).toEqual([])
  })

  it('las que no se nombran quedan al final, en su orden', () => {
    const writes = positionWrites(BAR, ['alta', 'guemes'])
    const finalOrder = [...BAR]
      .map((b) => ({ ...b, position: writes.find((w) => w.id === b.id)?.position ?? b.position }))
      .sort((a, b) => a.position - b.position)
      .map((b) => b.id)
    expect(finalOrder).toEqual(['alta', 'guemes', 'cerro', 'centro', 'vieja'])
  })

  it('ignora ids repetidos o que no son del bar', () => {
    const tidy = [row('alta', 0, { isDefault: true }), row('cerro', 1)]
    expect(positionWrites(tidy, ['alta', 'otro-bar', 'cerro', 'cerro'])).toEqual([])
  })

  it('aplicar lo que devuelve moveBranch deja ese mismo orden', () => {
    const order = moveBranch(BAR, 'guemes', -1)
    expect(order).not.toBeNull()
    const writes = positionWrites(BAR, order ?? [])
    const moved = BAR.map((b) => ({
      ...b,
      position: writes.find((w) => w.id === b.id)?.position ?? b.position,
    }))
    expect(sortBranches(moved).map((b) => b.id)).toEqual(order)
  })
})

describe('canDeactivate', () => {
  const branch = { name: 'Cerro', isDefault: false, active: true }

  it('una sucursal sin mesas abiertas se puede desactivar', () => {
    expect(canDeactivate(branch, { openTables: 0 })).toEqual({ ok: true })
  })

  it('la principal no: primero hay que elegir otra', () => {
    const verdict = canDeactivate({ ...branch, isDefault: true }, { openTables: 0 })
    expect(verdict.ok).toBe(false)
    expect(verdict).toMatchObject({ why: expect.stringContaining('principal') })
  })

  it('con mesas abiertas tampoco, y dice cuántas', () => {
    expect(canDeactivate(branch, { openTables: 1 })).toMatchObject({
      ok: false,
      why: expect.stringContaining('1 mesa abierta'),
    })
    expect(canDeactivate(branch, { openTables: 12 })).toMatchObject({
      ok: false,
      why: expect.stringContaining('12 mesas abiertas'),
    })
  })

  it('una que ya está desactivada no se desactiva de nuevo', () => {
    expect(canDeactivate({ ...branch, active: false }, { openTables: 0 }).ok).toBe(false)
  })
})

describe('canBeDefault', () => {
  it('solo una sucursal activa que todavía no lo es', () => {
    expect(canBeDefault({ isDefault: false, active: true })).toEqual({ ok: true })
    expect(canBeDefault({ isDefault: true, active: true }).ok).toBe(false)
    expect(canBeDefault({ isDefault: false, active: false }).ok).toBe(false)
  })
})

describe('canDelete', () => {
  const empty = { sectors: 0, tables: 0, looseTables: 0, hasHistory: false }

  it('una sucursal vacía se puede borrar', () => {
    expect(canDelete({ isDefault: false }, empty)).toEqual({ ok: true })
  })

  it('la principal no se borra nunca', () => {
    expect(canDelete({ isDefault: true }, empty).ok).toBe(false)
  })

  it('con plano o mesas no se borra, y dice qué tiene', () => {
    expect(
      canDelete({ isDefault: false }, { ...empty, sectors: 3, tables: 20, looseTables: 5 }),
    ).toMatchObject({ ok: false, why: expect.stringContaining('3 sectores y 25 mesas') })
    expect(canDelete({ isDefault: false }, { ...empty, sectors: 1 })).toMatchObject({
      ok: false,
      why: expect.stringContaining('1 sector'),
    })
    expect(canDelete({ isDefault: false }, { ...empty, looseTables: 1 })).toMatchObject({
      ok: false,
      why: expect.stringContaining('1 mesa'),
    })
  })

  it('si alguna vez tuvo mesas abiertas, tampoco: su historia queda guardada', () => {
    expect(canDelete({ isDefault: false }, { ...empty, hasHistory: true })).toMatchObject({
      ok: false,
      why: expect.stringContaining('historia'),
    })
  })
})
