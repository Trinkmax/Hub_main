// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  emptyFacts,
  fieldKey,
  liveBranches,
  liveSettings,
  rowKey,
  settingKey,
} from '@/lib/pos/branches/live'
import type { Branch } from '@/lib/pos/branches/types'
import { EMPTY_OVERLAY, overlaySettle, overlayStart } from '@/lib/pos/settings/overlay'
import { DEFAULT_POS_SETTINGS } from '@/lib/pos/settings/types'

/**
 * Lo que «Sucursales» muestra mientras algo se guarda: la última lectura de la base con, encima,
 * lo que la persona acaba de tocar.
 */

const branch = (id: string, over: Partial<Branch> = {}): Branch => ({
  id,
  name: `Sucursal ${id}`,
  shortName: null,
  slug: `sucursal-${id}`,
  color: '#2f5d50',
  address: null,
  position: 0,
  isDefault: false,
  active: true,
  updatedAt: '2026-11-13T12:00:00.000Z',
  ...over,
})

const BASE: Branch[] = [
  branch('a', { name: 'Alta Córdoba', isDefault: true, position: 0 }),
  branch('b', { name: 'Cerro', position: 1 }),
]

describe('las sucursales como se ven ahora', () => {
  it('sin nada tocado, son las leídas (la principal primero)', () => {
    expect(liveBranches([...BASE].reverse(), EMPTY_OVERLAY).map((item) => item.name)).toEqual([
      'Alta Córdoba',
      'Cerro',
    ])
  })

  it('un dato que se está guardando se ve encima de lo leído', () => {
    const overlay = overlayStart(EMPTY_OVERLAY, 1, [
      [fieldKey('b', 'shortName'), 'El Cerro'],
      [fieldKey('b', 'color'), '#a8452d'],
    ])
    const cerro = liveBranches(BASE, overlay).find((item) => item.id === 'b')
    expect(cerro?.shortName).toBe('El Cerro')
    expect(cerro?.color).toBe('#a8452d')
    expect(cerro?.name).toBe('Cerro')
  })

  it('una recién creada aparece aunque la lectura todavía no la traiga', () => {
    const created = branch('c', { name: 'Güemes', position: 2 })
    const overlay = overlayStart(EMPTY_OVERLAY, 1, [[rowKey('c'), created]])
    expect(liveBranches(BASE, overlay).map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('una recién borrada desaparece aunque la lectura todavía la traiga', () => {
    const overlay = overlayStart(EMPTY_OVERLAY, 1, [[rowKey('b'), null]])
    expect(liveBranches(BASE, overlay).map((item) => item.id)).toEqual(['a'])
  })

  it('una lista que volvió del servidor (otra principal) reemplaza las filas y reordena', () => {
    const list = [
      branch('a', { name: 'Alta Córdoba', isDefault: false, position: 0 }),
      branch('b', { name: 'Cerro', isDefault: true, position: 1 }),
    ]
    const started = overlayStart(
      EMPTY_OVERLAY,
      1,
      list.map((item) => [rowKey(item.id), item] as const),
    )
    // Guardado después de la lectura que tiene la pantalla: la marca se queda hasta la próxima.
    const overlay = overlaySettle(started, 1, { savedAt: 200, loadedAt: 100 })
    const shown = liveBranches(BASE, overlay)
    expect(shown.map((item) => item.id)).toEqual(['b', 'a'])
    expect(shown[0]?.isDefault).toBe(true)
  })

  it('un dato tocado se aplica también sobre una fila que vino en la lista', () => {
    const overlay = overlayStart(
      overlayStart(EMPTY_OVERLAY, 1, [[rowKey('b'), branch('b', { name: 'Cerro', position: 1 })]]),
      2,
      [[fieldKey('b', 'name'), 'Cerro de las Rosas']],
    )
    expect(liveBranches(BASE, overlay).find((item) => item.id === 'b')?.name).toBe(
      'Cerro de las Rosas',
    )
  })
})

describe('los ajustes como se ven ahora', () => {
  it('sin nada tocado, son los leídos', () => {
    expect(liveSettings(DEFAULT_POS_SETTINGS, EMPTY_OVERLAY)).toBe(DEFAULT_POS_SETTINGS)
  })

  it('lo tocado va encima, y el resto queda como estaba', () => {
    const overlay = overlayStart(EMPTY_OVERLAY, 1, [
      [settingKey('creditSurchargeBp'), 1200],
      [settingKey('tipPresetsPct'), [10, 15]],
    ])
    const shown = liveSettings(DEFAULT_POS_SETTINGS, overlay)
    expect(shown.creditSurchargeBp).toBe(1200)
    expect(shown.tipPresetsPct).toEqual([10, 15])
    expect(shown.billWarnMinutes).toBe(DEFAULT_POS_SETTINGS.billWarnMinutes)
  })
})

describe('una sucursal recién creada', () => {
  it('no tiene nada cargado; con la caja disponible le falta abrirla', () => {
    expect(emptyFacts(true)).toMatchObject({ sectors: 0, tables: 0, openTables: 0, registers: 0 })
  })

  it('si el bar todavía no tiene caja, la caja no entra en la cuenta', () => {
    expect(emptyFacts(false).registers).toBeNull()
  })
})
