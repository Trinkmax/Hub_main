// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applyOp,
  applyOps,
  buildView,
  invertOp,
  NO_PENDING,
  type Op,
  opKeys,
  pendDrop,
  pendSettle,
  pendStart,
  pendSync,
  savingKeys,
} from '@/lib/menu/kitchen/ops'
import type { KitchenSnapshot } from '@/lib/menu/kitchen/types'
import {
  A_PUNTO,
  BARRA,
  CHEDDAR,
  CLASICA,
  COCIDO,
  COCINA,
  COMIDA,
  EXTRAS,
  FRIOS,
  group,
  HAMBURGUESAS,
  id,
  JUGOSO,
  link,
  MUZZA,
  option,
  PARRILLA,
  PIZZA,
  PUNTO,
  SIN,
  snapshot,
  station,
  WRAP,
} from './menu-kitchen-fixtures'

/**
 * Lo que la persona acaba de cambiar se ve encima de lo último leído. Cada operación se puede
 * volver a aplicar sin que cambie nada, y la mayoría se deshace.
 */

const base = snapshot()
const stationOf = (state: KitchenSnapshot, node: 'category' | 'item', nodeId: string) =>
  (node === 'category' ? state.categories : state.items).find((each) => each.id === nodeId)
    ?.stationId

const parrilla = station({ id: PARRILLA, name: 'Parrilla', color: '#be123c', position: 3 })
const sabores = group({ id: id('b', 40), name: 'Sabor', selection: 'single', position: 4 })
const frutilla = option({ id: id('d', 40), groupId: sabores.id, label: 'Frutilla' })
const tibio = option({ id: id('d', 41), groupId: PUNTO, label: 'Vuelta y vuelta', position: 3 })

/** Operaciones de todos los tipos, cada una con algo para cambiar sobre `base`. */
const OPS: Op[] = [
  {
    type: 'route',
    changes: [
      { node: 'category', id: PIZZA, to: FRIOS },
      { node: 'item', id: CLASICA, to: BARRA },
      { node: 'item', id: WRAP, to: null },
    ],
  },
  { type: 'station.create', stations: [parrilla] },
  { type: 'station.patch', id: COCINA, patch: { name: 'Plancha', active: false } },
  { type: 'station.order', ids: [BARRA, COCINA, FRIOS] },
  {
    type: 'group.create',
    group: sabores,
    options: [frutilla],
    links: [link(sabores.id, 'item', MUZZA)],
  },
  { type: 'group.patch', id: PUNTO, patch: { name: 'Cocción', required: true } },
  { type: 'group.order', ids: [EXTRAS, PUNTO, SIN] },
  { type: 'option.create', option: tibio },
  { type: 'option.patch', id: CHEDDAR, patch: { priceDeltaCents: 180_000, active: false } },
  { type: 'option.delete', id: JUGOSO },
  { type: 'option.order', groupId: PUNTO, ids: [COCIDO, JUGOSO, A_PUNTO] },
  { type: 'link.set', link: link(PUNTO, 'category', PIZZA), linked: true },
  { type: 'link.set', link: link(PUNTO, 'category', HAMBURGUESAS), linked: false },
]

describe('applyOp', () => {
  it('marca categorías y productos, y saca la marca', () => {
    const next = applyOp(base, OPS[0] as Op)
    expect(stationOf(next, 'category', PIZZA)).toBe(FRIOS)
    expect(stationOf(next, 'item', CLASICA)).toBe(BARRA)
    expect(stationOf(next, 'item', WRAP)).toBeNull()
    // Lo demás no se toca, y la lectura original tampoco.
    expect(stationOf(next, 'category', COMIDA)).toBe(COCINA)
    expect(stationOf(base, 'category', PIZZA)).toBeNull()
  })

  it('borrar una estación deja sin marca lo que la tenía, como la base', () => {
    const next = applyOp(base, { type: 'station.delete', ids: [FRIOS] })
    expect(next.stations.map((each) => each.id)).toEqual([COCINA, BARRA])
    expect(stationOf(next, 'item', WRAP)).toBeNull()
    expect(next.categories.some((each) => each.stationId === FRIOS)).toBe(false)
  })

  it('borrar un grupo se lleva sus opciones y sus enganches', () => {
    const next = applyOp(base, { type: 'group.delete', id: PUNTO })
    expect(next.groups.some((each) => each.id === PUNTO)).toBe(false)
    expect(next.options.some((each) => each.groupId === PUNTO)).toBe(false)
    expect(next.links.some((each) => each.groupId === PUNTO)).toBe(false)
    expect(next.options.length).toBe(base.options.length - 3)
  })

  it('reordenar pone a cada fila en su lugar y no toca las que no se nombran', () => {
    const next = applyOp(base, { type: 'station.order', ids: [BARRA, COCINA] })
    const position = (stationId: string) =>
      next.stations.find((each) => each.id === stationId)?.position
    expect(position(BARRA)).toBe(0)
    expect(position(COCINA)).toBe(1)
    expect(position(FRIOS)).toBe(1) // no se nombró: queda donde estaba
  })

  it('reordenar opciones solo mueve las de ese grupo', () => {
    const next = applyOp(base, {
      type: 'option.order',
      groupId: PUNTO,
      ids: [COCIDO, CHEDDAR, JUGOSO],
    })
    const position = (optionId: string) =>
      next.options.find((each) => each.id === optionId)?.position
    expect(position(COCIDO)).toBe(0)
    expect(position(JUGOSO)).toBe(2)
    expect(position(CHEDDAR)).toBe(0) // es de otro grupo: no se mueve
  })

  it('una opción de un grupo que ya no está no queda suelta', () => {
    const orphan = option({ id: id('d', 50), groupId: id('b', 99), label: 'Huérfana' })
    expect(applyOp(base, { type: 'option.create', option: orphan })).toBe(base)
  })

  it('enganchar y desenganchar no duplica ni rompe', () => {
    const existing = link(PUNTO, 'category', HAMBURGUESAS)
    expect(applyOp(base, { type: 'link.set', link: existing, linked: true })).toBe(base)
    const off = applyOp(base, { type: 'link.set', link: existing, linked: false })
    expect(off.links).toHaveLength(base.links.length - 1)
    expect(applyOp(off, { type: 'link.set', link: existing, linked: false })).toBe(off)
  })

  it('volver a aplicar una operación no cambia nada: la lectura nueva ya la trae', () => {
    for (const op of OPS) {
      const once = applyOp(base, op)
      expect(applyOp(once, op), op.type).toEqual(once)
    }
    const all = applyOps(base, OPS)
    expect(applyOps(all, OPS)).toEqual(all)
  })

  it('crear lo que ya está no lo duplica', () => {
    const once = applyOp(base, { type: 'station.create', stations: [parrilla] })
    const twice = applyOp(once, {
      type: 'station.create',
      stations: [{ ...parrilla, name: 'Otra' }],
    })
    expect(twice.stations.filter((each) => each.id === PARRILLA)).toHaveLength(1)
    // Manda lo que ya estaba (lo que vino de la base).
    expect(twice.stations.find((each) => each.id === PARRILLA)?.name).toBe('Parrilla')
  })

  it('un grupo a medio llegar se completa: lo que falte de sus opciones y enganches', () => {
    const op: Op = {
      type: 'group.create',
      group: sabores,
      options: [frutilla],
      links: [link(sabores.id, 'item', MUZZA)],
    }
    const half = { ...base, groups: [...base.groups, sabores] }
    const next = applyOp(half, op)
    expect(next.groups.filter((each) => each.id === sabores.id)).toHaveLength(1)
    expect(next.options.some((each) => each.id === frutilla.id)).toBe(true)
    expect(next.links.some((each) => each.groupId === sabores.id)).toBe(true)
  })
})

describe('invertOp', () => {
  it('deshacer deja todo como estaba', () => {
    for (const op of OPS) {
      const inverse = invertOp(base, op)
      expect(inverse, op.type).not.toBeNull()
      if (!inverse) continue
      const back = applyOp(applyOp(base, op), inverse)
      expect(sorted(back), op.type).toEqual(sorted(base))
    }
  })

  it('deshacer una marca solo devuelve lo que de verdad cambió', () => {
    const inverse = invertOp(base, {
      type: 'route',
      changes: [
        { node: 'category', id: PIZZA, to: FRIOS },
        { node: 'category', id: COMIDA, to: COCINA }, // ya estaba así
        { node: 'item', id: id('e', 99), to: COCINA }, // no existe
      ],
    })
    expect(inverse).toEqual({ type: 'route', changes: [{ node: 'category', id: PIZZA, to: null }] })
  })

  it('lo que no cambia nada no tiene qué deshacer', () => {
    expect(
      invertOp(base, { type: 'route', changes: [{ node: 'category', id: COMIDA, to: COCINA }] }),
    ).toBeNull()
    expect(
      invertOp(base, { type: 'station.patch', id: id('a', 99), patch: { name: 'X' } }),
    ).toBeNull()
    expect(
      invertOp(base, {
        type: 'link.set',
        link: link(PUNTO, 'category', HAMBURGUESAS),
        linked: true,
      }),
    ).toBeNull()
    expect(
      invertOp(base, {
        type: 'station.create',
        stations: [base.stations[0] as (typeof base.stations)[number]],
      }),
    ).toBeNull()
    expect(invertOp(base, { type: 'option.delete', id: id('d', 99) })).toBeNull()
  })

  it('borrar un grupo no se deshace: se confirma antes', () => {
    expect(invertOp(base, { type: 'group.delete', id: PUNTO })).toBeNull()
  })

  it('borrar una estación vuelve a crearla tal cual', () => {
    expect(invertOp(base, { type: 'station.delete', ids: [FRIOS] })).toEqual({
      type: 'station.create',
      stations: [base.stations[1]],
    })
  })

  it('deshacer un cambio de nombre devuelve solo ese campo', () => {
    expect(invertOp(base, { type: 'group.patch', id: PUNTO, patch: { name: 'Cocción' } })).toEqual({
      type: 'group.patch',
      id: PUNTO,
      patch: { name: 'Punto de la carne' },
    })
  })
})

/** El orden de las filas dentro de cada lista no importa para comparar. */
function sorted(state: KitchenSnapshot) {
  const byId = <Row extends { id: string }>(rows: Row[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id))
  return {
    ...state,
    stations: byId(state.stations),
    groups: byId(state.groups),
    options: byId(state.options),
    links: [...state.links].sort((a, b) =>
      `${a.groupId}${a.targetId}`.localeCompare(`${b.groupId}${b.targetId}`),
    ),
  }
}

describe('lo que todavía no confirmó la base', () => {
  const mark: Op = { type: 'route', changes: [{ node: 'category', id: PIZZA, to: FRIOS }] }
  const rename: Op = { type: 'station.patch', id: COCINA, patch: { name: 'Plancha' } }

  it('se ve enseguida, encima de lo leído', () => {
    const log = pendStart(NO_PENDING, 1, mark)
    expect(stationOf(buildView(base, log), 'category', PIZZA)).toBe(FRIOS)
    expect(buildView(base, NO_PENDING)).toBe(base)
    expect(savingKeys(log)).toEqual(new Set([`category:${PIZZA}`]))
  })

  it('si falla, vuelve a lo leído', () => {
    const log = pendDrop(pendStart(pendStart(NO_PENDING, 1, mark), 2, rename), 1)
    const view = buildView(base, log)
    expect(stationOf(view, 'category', PIZZA)).toBeNull()
    expect(view.stations[0]?.name).toBe('Plancha')
  })

  it('guardado: deja de estar «guardando» y se queda hasta que llegue una lectura posterior', () => {
    const started = pendStart(NO_PENDING, 1, mark)
    const saved = pendSettle(started, 1, { savedAt: 2_000, loadedAt: 1_000 })
    expect(saved).toEqual([{ token: 1, op: mark, saving: false, savedAt: 2_000 }])
    expect(savingKeys(saved).size).toBe(0)
    // Una lectura anterior al guardado no la incluye: se queda.
    expect(pendSync(saved, 1_500)).toBe(saved)
    // Una posterior sí: sobra.
    expect(pendSync(saved, 2_000)).toEqual([])
  })

  it('si la lectura que hay ya es posterior al guardado, se va en el momento', () => {
    const started = pendStart(NO_PENDING, 1, mark)
    expect(pendSettle(started, 1, { savedAt: 2_000, loadedAt: 2_500 })).toEqual([])
  })

  it('si entró a medias, queda solo lo que entró', () => {
    const both: Op = {
      type: 'route',
      changes: [
        { node: 'category', id: PIZZA, to: FRIOS },
        { node: 'item', id: CLASICA, to: BARRA },
      ],
    }
    const applied: Op = { type: 'route', changes: [{ node: 'item', id: CLASICA, to: BARRA }] }
    const settled = pendSettle(pendStart(NO_PENDING, 1, both), 1, {
      savedAt: 2_000,
      loadedAt: 1_000,
      op: applied,
    })
    const view = buildView(base, settled)
    expect(stationOf(view, 'category', PIZZA)).toBeNull()
    expect(stationOf(view, 'item', CLASICA)).toBe(BARRA)
  })

  it('si no entró nada, la operación se va', () => {
    const settled = pendSettle(pendStart(NO_PENDING, 1, mark), 1, {
      savedAt: 2_000,
      loadedAt: 1_000,
      op: null,
    })
    expect(settled).toEqual([])
  })

  it('lo que sigue guardándose sobrevive a una lectura nueva', () => {
    const log = pendStart(NO_PENDING, 1, mark)
    expect(pendSync(log, 9_999)).toBe(log)
  })

  it('una lectura nueva con el cambio de otra persona no pisa lo mío pendiente', () => {
    // Otra persona pasó Comida a Barra; yo estoy guardando Pizza → Fríos.
    const theirs = applyOp(base, {
      type: 'route',
      changes: [{ node: 'category', id: COMIDA, to: BARRA }],
    })
    const view = buildView({ ...theirs, loadedAt: 3_000 }, pendStart(NO_PENDING, 1, mark))
    expect(stationOf(view, 'category', COMIDA)).toBe(BARRA)
    expect(stationOf(view, 'category', PIZZA)).toBe(FRIOS)
  })

  it('las operaciones se aplican en el orden en que se hicieron', () => {
    const first: Op = { type: 'route', changes: [{ node: 'category', id: PIZZA, to: FRIOS }] }
    const second: Op = { type: 'route', changes: [{ node: 'category', id: PIZZA, to: BARRA }] }
    const log = pendStart(pendStart(NO_PENDING, 1, first), 2, second)
    expect(stationOf(buildView(base, log), 'category', PIZZA)).toBe(BARRA)
  })
})

describe('opKeys', () => {
  it('dice qué toca cada operación', () => {
    expect(opKeys(OPS[0] as Op)).toEqual([`category:${PIZZA}`, `item:${CLASICA}`, `item:${WRAP}`])
    expect(opKeys({ type: 'station.patch', id: COCINA, patch: {} })).toEqual([`station:${COCINA}`])
    expect(opKeys({ type: 'group.delete', id: PUNTO })).toEqual([`group:${PUNTO}`])
    expect(opKeys({ type: 'option.order', groupId: PUNTO, ids: [JUGOSO] })).toEqual([
      `option:${JUGOSO}`,
    ])
    expect(opKeys({ type: 'link.set', link: link(PUNTO, 'item', MUZZA), linked: true })).toEqual([
      `link:${PUNTO}:item:${MUZZA}`,
    ])
    for (const op of OPS) expect(opKeys(op).length, op.type).toBeGreaterThan(0)
  })
})
