import { describe, expect, it } from 'vitest'
import {
  applyPatch,
  contentBox,
  DEFAULT_SEATS,
  elementName,
  freeTables,
  listTables,
  planSignature,
  pruneRemoved,
  removedTableOf,
  sectorTableCounts,
  tableNumberSize,
  tableOrdinal,
  toFloorElement,
  toFloorElements,
  unplacedWithRemoved,
} from '@/lib/floor-plan/model'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { MODEL_CAMERA } from '@/lib/pos/floor/projection'
import { buildScene } from '@/lib/pos/floor/scene'

function row(over: Partial<ElementRow> = {}): ElementRow {
  return {
    id: 'el-1',
    area_id: 'area-1',
    kind: 'table',
    shape: 'rect',
    physical_table_id: 'pt-1',
    x: 100,
    y: 200,
    width: 80,
    height: 80,
    rotation: 0,
    corner_radius: 8,
    z_index: 10,
    label: null,
    color: null,
    table: { label: '12', capacity: 4, qr_token: 'tok', active: true },
    ...over,
  }
}

const wall = (over: Partial<ElementRow> = {}): ElementRow =>
  row({
    id: 'wall-1',
    kind: 'wall',
    physical_table_id: null,
    table: null,
    width: 200,
    height: 16,
    z_index: 0,
    ...over,
  })

describe('toFloorElement', () => {
  it('traduce una mesa a la forma que dibuja la maqueta (la de pos_floor_snapshot)', () => {
    expect(toFloorElement(row())).toEqual({
      id: 'el-1',
      area_id: 'area-1',
      kind: 'table',
      shape: 'rect',
      x: 100,
      y: 200,
      w: 80,
      h: 80,
      rotation: 0,
      corner_radius: 8,
      z: 10,
      label: null,
      color: null,
      table_id: 'pt-1',
      table_label: '12',
      capacity: 4,
    })
  })

  it('la decoración no lleva mesa: ni id, ni número, ni lugares', () => {
    const el = toFloorElement(wall({ label: 'Medianera', color: '#445566' }))
    expect(el.kind).toBe('wall')
    expect(el.table_id).toBeNull()
    expect(el.table_label).toBeNull()
    expect(el.capacity).toBeNull()
    expect(el.label).toBe('Medianera')
    expect(el.color).toBe('#445566')
  })

  it('una mesa sin lugares cargados viaja como null (la maqueta dibuja 4 sillas)', () => {
    const el = toFloorElement(
      row({ table: { label: '7', capacity: null, qr_token: 't', active: true } }),
    )
    expect(el.capacity).toBeNull()
    expect(DEFAULT_SEATS).toBe(4)
    const scene = buildScene(MODEL_CAMERA, [el])
    expect(scene.anchors[0]?.seats).toBe(DEFAULT_SEATS)
  })

  it('lo que se está arrastrando, estirando o girando pisa a lo guardado', () => {
    const el = toFloorElement(row(), { x: 340, y: 60, rotation: 45 })
    expect(el.x).toBe(340)
    expect(el.y).toBe(60)
    expect(el.rotation).toBe(45)
    expect(el.w).toBe(80) // lo que el gesto no toca queda igual
    const stretched = toFloorElement(row(), { width: 160 })
    expect(stretched.w).toBe(160)
    expect(stretched.h).toBe(80)
    expect(stretched.x).toBe(100)
  })
})

describe('toFloorElements', () => {
  it('respeta el orden y aplica la geometría en el aire solo a su elemento', () => {
    const rows = [wall(), row(), row({ id: 'el-2', physical_table_id: 'pt-2' })]
    const live = new Map([['el-2', { x: 500 }]])
    const out = toFloorElements(rows, live)
    expect(out.map((e) => e.id)).toEqual(['wall-1', 'el-1', 'el-2'])
    expect(out[1]?.x).toBe(100)
    expect(out[2]?.x).toBe(500)
  })

  it('deja afuera las mesas desactivadas y las que no tienen mesa detrás, como la RPC del salón', () => {
    const rows = [
      row(),
      row({
        id: 'el-off',
        physical_table_id: 'pt-off',
        table: { label: '9', capacity: 2, qr_token: 't', active: false },
      }),
      row({ id: 'el-ghost', physical_table_id: null, table: null }),
      wall(),
    ]
    expect(toFloorElements(rows).map((e) => e.id)).toEqual(['el-1', 'wall-1'])
  })

  it('lo que devuelve se puede dibujar: una mesa = un ancla en la maqueta', () => {
    const scene = buildScene(MODEL_CAMERA, toFloorElements([row(), wall()]))
    expect(scene.anchors).toHaveLength(1)
    expect(scene.anchors[0]?.tableId).toBe('pt-1')
    expect(scene.anchors[0]?.label).toBe('12')
  })
})

describe('freeTables', () => {
  it('en el editor todas las mesas están libres', () => {
    const elements = toFloorElements([
      row(),
      row({ id: 'el-2', physical_table_id: 'pt-2' }),
      wall(),
    ])
    const tables = freeTables(elements)
    expect(Object.keys(tables).sort()).toEqual(['pt-1', 'pt-2'])
    expect(tables['pt-1']?.state.key).toBe('free')
    expect(tables['pt-1']?.state.urgency).toBe('none')
    expect(tables['pt-1']?.partySize).toBeNull()
    expect(tables['pt-1']?.alias).toBeNull()
  })
})

describe('tableOrdinal', () => {
  const elements = toFloorElements([
    wall(),
    row({ id: 'a', physical_table_id: 'pt-a' }),
    wall({ id: 'wall-2' }),
    row({ id: 'b', physical_table_id: 'pt-b' }),
    row({ id: 'c', physical_table_id: 'pt-c' }),
  ])

  it('cuenta solo mesas, en el orden de los elementos', () => {
    expect(tableOrdinal(elements, 'pt-a')).toBe(1)
    expect(tableOrdinal(elements, 'pt-b')).toBe(2)
    expect(tableOrdinal(elements, 'pt-c')).toBe(3)
  })

  it('coincide con el orden de las zonas de toque de la maqueta', () => {
    const scene = buildScene(MODEL_CAMERA, elements)
    scene.anchors.forEach((anchor, index) => {
      expect(tableOrdinal(elements, anchor.tableId)).toBe(index + 1)
    })
  })

  it('null si la mesa no está en este sector', () => {
    expect(tableOrdinal(elements, 'pt-zzz')).toBeNull()
  })
})

describe('contentBox', () => {
  it('null si el sector está vacío', () => {
    expect(contentBox([])).toBeNull()
  })

  it('envuelve todos los elementos con aire alrededor', () => {
    const box = contentBox(
      [
        { x: 100, y: 100, width: 80, height: 80, rotation: 0 },
        { x: 400, y: 300, width: 200, height: 20, rotation: 0 },
      ],
      10,
    )
    expect(box).toEqual({ x: 90, y: 90, width: 520, height: 240 })
  })

  it('una pared girada 90° ocupa su alto como ancho', () => {
    const box = contentBox([{ x: 100, y: 100, width: 200, height: 20, rotation: 90 }], 0)
    expect(box?.x).toBeCloseTo(190, 5)
    expect(box?.y).toBeCloseTo(10, 5)
    expect(box?.width).toBeCloseTo(20, 5)
    expect(box?.height).toBeCloseTo(200, 5)
  })
})

describe('sectorTableCounts', () => {
  it('cuenta las mesas dibujadas por sector (la decoración no cuenta)', () => {
    expect(
      sectorTableCounts([
        row(),
        row({ id: 'el-2', physical_table_id: 'pt-2' }),
        row({ id: 'el-3', physical_table_id: 'pt-3', area_id: 'area-2' }),
        wall(),
        wall({ id: 'w2', area_id: 'area-3' }),
      ]),
    ).toEqual({ 'area-1': 2, 'area-2': 1 })
  })
})

describe('elementName', () => {
  it('nombra mesas y decoración como se les dice en el bar', () => {
    expect(elementName(row())).toBe('Mesa 12')
    expect(elementName(wall())).toBe('Pared')
    expect(elementName(wall({ kind: 'text', label: 'Entrada' }))).toBe('Texto Entrada')
    expect(elementName(row({ table: null, label: null }))).toBe('Mesa')
  })
})

describe('planSignature', () => {
  it('es estable si el servidor manda lo mismo', () => {
    expect(planSignature([row(), wall()])).toBe(planSignature([row(), wall()]))
  })

  it('cambia con cualquier cosa que el editor dibuja', () => {
    const base = planSignature([row()])
    expect(planSignature([row({ x: 101 })])).not.toBe(base)
    expect(planSignature([row({ rotation: 90 })])).not.toBe(base)
    expect(planSignature([row({ shape: 'circle' })])).not.toBe(base)
    expect(planSignature([row({ area_id: 'area-2' })])).not.toBe(base)
    expect(
      planSignature([row({ table: { label: '12', capacity: 6, qr_token: 'tok', active: true } })]),
    ).not.toBe(base)
    expect(
      planSignature([row({ table: { label: '12', capacity: 4, qr_token: 'otro', active: true } })]),
    ).not.toBe(base)
    expect(planSignature([row(), wall()])).not.toBe(base)
  })
})

describe('applyPatch', () => {
  it('cambia solo lo que trae el cambio', () => {
    const patched = applyPatch(row(), { shape: 'circle', table: { capacity: 6 } })
    expect(patched.shape).toBe('circle')
    expect(patched.table).toEqual({ label: '12', capacity: 6, qr_token: 'tok', active: true })
    expect(patched.x).toBe(100)
  })

  it('nombre y color de la decoración, incluido borrarlos', () => {
    const base = wall({ label: 'Medianera', color: '#112233' })
    expect(applyPatch(base, { label: 'Fondo' }).label).toBe('Fondo')
    expect(applyPatch(base, { color: null }).color).toBeNull()
    expect(applyPatch(base, { color: null }).label).toBe('Medianera')
  })

  it('los datos de mesa no se le pegan a algo que no es una mesa', () => {
    expect(applyPatch(wall(), { table: { capacity: 4 } }).table).toBeNull()
  })

  it('no muta la fila original', () => {
    const base = row()
    applyPatch(base, { table: { label: '99' } })
    expect(base.table?.label).toBe('12')
  })
})

describe('listTables', () => {
  const data = {
    areas: [
      { id: 'area-1', name: 'Salón', position: 0, width: 1200, height: 800, number_start: 1 },
      { id: 'area-2', name: 'Terraza', position: 1, width: 1200, height: 800, number_start: 20 },
    ],
    elements: [
      row({ table: { label: '10', capacity: 4, qr_token: 'a', active: true } }),
      row({
        id: 'el-2',
        physical_table_id: 'pt-2',
        area_id: 'area-2',
        table: { label: '2', capacity: 2, qr_token: 'b', active: true },
      }),
      wall(),
    ],
    unplacedTables: [{ id: 'pt-3', label: '7', capacity: null, qr_token: 'c' }],
    inactiveTables: [{ id: 'pt-4', label: '1', capacity: 6, qr_token: 'd' }],
  }

  it('junta dibujadas (con su sector), sin ubicar y desactivadas, ordenadas como se cuentan', () => {
    expect(listTables(data).map((t) => [t.label, t.sector, t.active])).toEqual([
      ['1', null, false],
      ['2', 'Terraza', true],
      ['7', null, true],
      ['10', 'Salón', true],
    ])
  })
})

describe('mesas recién quitadas del plano', () => {
  const t50 = { id: 'pt-50', label: '50', capacity: 4, qr_token: 'q50' }
  const t9 = { id: 'pt-9', label: '9', capacity: 2, qr_token: 'q9' }
  const removed = [{ elementId: 'el-50', table: t50 }]

  it('removedTableOf arma la mesa como va a quedar en «sin ubicar»', () => {
    expect(
      removedTableOf(
        row({
          id: 'el-50',
          physical_table_id: 'pt-50',
          table: { label: '50', capacity: 4, qr_token: 'q50', active: true },
        }),
      ),
    ).toEqual({ elementId: 'el-50', table: t50 })
    expect(removedTableOf(wall())).toBeNull()
  })

  it('aparece en «sin ubicar» antes de que conteste el servidor, en orden', () => {
    expect(unplacedWithRemoved([t9], removed, new Set()).map((t) => t.label)).toEqual(['9', '50'])
  })

  it('no se repite si el servidor ya la trae, ni aparece si sigue dibujada', () => {
    expect(unplacedWithRemoved([t50], removed, new Set())).toHaveLength(1)
    expect(unplacedWithRemoved([], removed, new Set(['pt-50']))).toEqual([])
  })

  it('sin nada quitado devuelve lo del servidor', () => {
    expect(unplacedWithRemoved([t9], [], new Set())).toEqual([t9])
  })

  it('pruneRemoved: sigue haciendo falta mientras viaja o el servidor todavía no la muestra', () => {
    const empty = { unplacedTables: [], elements: [] }
    expect(pruneRemoved(removed, empty, new Set())).toEqual(removed)
    expect(pruneRemoved(removed, empty, new Set(['el-50']))).toEqual(removed)
  })

  it('pruneRemoved: sobra cuando el servidor ya la trae sin ubicar', () => {
    expect(pruneRemoved(removed, { unplacedTables: [t50], elements: [] }, new Set())).toEqual([])
  })

  it('pruneRemoved: sobra si no se pudo quitar (el servidor la sigue mostrando dibujada)', () => {
    const still = {
      unplacedTables: [],
      elements: [row({ id: 'el-50', physical_table_id: 'pt-50' })],
    }
    expect(pruneRemoved(removed, still, new Set())).toEqual([])
    // …salvo que todavía esté viajando: ahí el servidor aún no se enteró.
    expect(pruneRemoved(removed, still, new Set(['el-50']))).toEqual(removed)
  })
})

describe('tableNumberSize', () => {
  /** Lo que ocupa la etiqueta con ese tamaño (0,56 em por carácter + el aire de los costados). */
  const needs = (label: string, size: number) => label.length * 0.56 * size + 10

  it('un número corto va con el lado más chico de la mesa, entre 13 y 30', () => {
    expect(tableNumberSize(80, 80, '12').size).toBe(28.8)
    expect(tableNumberSize(140, 80, '7').size).toBe(28.8)
    expect(tableNumberSize(200, 200, '7').size).toBe(30)
    expect(tableNumberSize(40, 40, '7').size).toBe(14.4)
    expect(tableNumberSize(30, 30, '7').size).toBe(13)
  })

  it('una etiqueta larga se achica hasta entrar en la mesa', () => {
    const vip = tableNumberSize(80, 80, '50VIP')
    expect(vip.size).toBe(25)
    expect(needs('50VIP', vip.size)).toBeLessThanOrEqual(80)

    const long = tableNumberSize(80, 80, 'Mesa VIP 12')
    expect(long.size).toBeLessThan(vip.size)
    expect(needs('Mesa VIP 12', long.size)).toBeLessThanOrEqual(80.1)
  })

  it('no baja de 9: más chico ya no se lee', () => {
    expect(tableNumberSize(40, 40, 'Mesa del fondo a la derecha').size).toBe(9)
    expect(tableNumberSize(40, 40, 'Mesa del fondo a la derecha').cap).toBe(9)
  })

  it('el tope es lo más grande que entra: un número corto puede crecer con el plano alejado', () => {
    const short = tableNumberSize(80, 80, '12')
    expect(short.cap).toBeGreaterThan(short.size)
    expect(needs('12', short.cap)).toBeLessThanOrEqual(80.1)
    // Una etiqueta que ya está al límite no crece.
    const vip = tableNumberSize(80, 80, '50VIP')
    expect(vip.cap).toBe(vip.size)
  })

  it('el número va derecho: con la mesa de costado cuenta el alto', () => {
    // 160 × 60 acostada entra «50VIP» sin achicar; parada (90°) queda en 60 de ancho.
    expect(tableNumberSize(160, 60, '50VIP').size).toBe(21.6)
    expect(tableNumberSize(160, 60, '50VIP', 90).size).toBe(17.86)
    expect(tableNumberSize(160, 60, '50VIP', 270).size).toBe(17.86)
    // Girada 180° es la misma mesa.
    expect(tableNumberSize(160, 60, '50VIP', 180).size).toBe(21.6)
  })

  it('en diagonal el ancho libre es la cuerda del rectángulo girado', () => {
    // Cuadrada a 45°: la cuerda horizontal por el centro es lado × √2.
    const flat = tableNumberSize(80, 80, 'Mesa VIP 12')
    const diagonal = tableNumberSize(80, 80, 'Mesa VIP 12', 45)
    expect(diagonal.size).toBeGreaterThan(flat.size)
    expect(diagonal.cap).toBeCloseTo((80 * Math.SQRT2 - 10) / (11 * 0.56), 1)
  })

  it('cuenta caracteres, no bytes, y no la rompe una etiqueta vacía', () => {
    expect(tableNumberSize(80, 80, 'Ñandú').size).toBe(tableNumberSize(80, 80, 'Nandu').size)
    expect(tableNumberSize(80, 80, '').size).toBe(28.8)
    expect(tableNumberSize(80, 80, '   ').size).toBe(28.8)
  })
})
