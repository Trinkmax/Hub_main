/**
 * La planilla de insumos (`lib/purchasing/sheet.ts` y `sheet-actions.ts`). Lo que se fija:
 * - bajar la planilla y subirla sin tocarla no cambia nada (la ida y la vuelta pasan por el `.xlsx` de verdad);
 * - cada fila va a su insumo por la clave oculta, el código o el nombre, y nunca dos filas al mismo;
 * - una columna que no viene no se toca; una celda vacía borra el dato; borrar una fila no borra el insumo;
 * - zona y proveedor tienen que existir (se sugiere el parecido, nunca se elige solo);
 * - guardar escribe todo junto, no pisa quién creó cada insumo, y si algo cambió desde la vista previa no
 *   guarda; solo el dueño, con Compras prendido.
 */

import { inflateRawSync } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', async () => {
  const { fake, fakeClient } = await import('./tex-mensajeria-kit')
  return {
    createClient: async () => fakeClient(fake.db, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  }
})
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => {
    throw new Error('service_role en la planilla')
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }))

const access = vi.hoisted(() => ({ role: 'owner' as string, purchasing: true }))

vi.mock('@/lib/tenant', async (actual) => ({
  ...(await actual<typeof import('@/lib/tenant')>()),
  requireTenantAccess: vi.fn(async () => ({
    tenant: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'HUB',
      slug: 'hub',
      feature_flags: { purchasing: access.purchasing },
    },
    role: access.role,
    isPlatformAdmin: false,
    user: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  })),
}))

import { logAudit } from '@/lib/audit'
import type { Cell } from '@/lib/imports/types'
import { readWorkbookSheet } from '@/lib/imports/xlsx'
import { toItem, toSupplier, toZone } from '@/lib/purchasing/rows'
import {
  canonicalUnit,
  ITEM_SHEET_COLUMNS,
  itemsSheetFileName,
  itemsWorkbook,
  parseSheetActive,
  parseSheetAmount,
  parseSheetFrequency,
  readItemsSheet,
  type SheetCatalog,
  sheetFingerprint,
} from '@/lib/purchasing/sheet'
import { applyItemsSheet, previewItemsSheet } from '@/lib/purchasing/sheet-actions'
import { buildXlsx } from '@/lib/xlsx/write'
import { FakeDb, type FakeRow, fake } from './tex-mensajeria-kit'

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CREATOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`

const Z = { freezer: id(1), camara: id(2) }
const S = { vafood: id(11), selecta: id(12), waggon: id(13), fractal: id(14) }
const I = { bondiola: id(21), molida: id(22), tomate: id(23), alcaparras: id(24), viejo: id(25) }

const zoneRow = (zid: string, name: string, sort: number): FakeRow => ({
  id: zid,
  tenant_id: TENANT,
  name,
  area: null,
  sort_order: sort,
  active: true,
})
const supplierRow = (sid: string, name: string): FakeRow => ({
  id: sid,
  tenant_id: TENANT,
  name,
  contact_name: null,
  whatsapp: null,
  delivery_weekdays: [],
  lead_days: 1,
  notes: null,
  acc_party_id: null,
  active: true,
})
const itemRow = (iid: string, name: string, extra: FakeRow = {}): FakeRow => ({
  id: iid,
  tenant_id: TENANT,
  code: null,
  name,
  brand: null,
  zone_id: null,
  unit: 'kg',
  frequency: 'frequent',
  target_qty: null,
  pack_label: null,
  pack_size: null,
  supplier_id: null,
  notes: null,
  active: true,
  created_by: CREATOR,
  updated_by: null,
  ...extra,
})

function seed(): Record<string, FakeRow[]> {
  return {
    pur_zones: [
      zoneRow(Z.freezer, 'Freezer carnes y panes', 10),
      zoneRow(Z.camara, 'Cámara de frío', 20),
    ],
    pur_suppliers: [
      supplierRow(S.vafood, 'Va Food'),
      supplierRow(S.selecta, 'La Selecta'),
      supplierRow(S.waggon, 'Waggon'),
      supplierRow(S.fractal, 'Fractal Agricultura'),
    ],
    pur_items: [
      itemRow(I.bondiola, 'Bondiola de cerdo', {
        code: 'INS-006',
        zone_id: Z.freezer,
        target_qty: '10.000',
        pack_label: 'Pieza x 2 kg aprox.',
        pack_size: '2.000',
        supplier_id: S.vafood,
      }),
      itemRow(I.molida, 'Carne Molida Burger', {
        code: 'INS-057',
        zone_id: Z.freezer,
        target_qty: '15.000',
        pack_label: 'Por kg',
        pack_size: '1.000',
        supplier_id: S.selecta,
        notes: 'Objetivo sugerido por el historial: falta revisarlo.',
      }),
      itemRow(I.tomate, 'Tomate perita', {
        code: 'INS-111',
        zone_id: Z.camara,
        target_qty: '7.000',
        pack_label: 'Por kg',
        pack_size: '1.000',
        supplier_id: S.fractal,
      }),
      itemRow(I.alcaparras, 'Alcaparras', {
        code: 'EV-002',
        frequency: 'occasional',
        supplier_id: S.waggon,
      }),
      itemRow(I.viejo, 'Romero seco', { code: 'INS-200', unit: 'unidad', active: false }),
    ],
  }
}

function catalogOf(tables: Record<string, FakeRow[]>): SheetCatalog {
  const t = tables as never as Record<string, never[]>
  return {
    items: (t.pur_items ?? []).map(toItem),
    zones: (t.pur_zones ?? []).map(toZone),
    suppliers: (t.pur_suppliers ?? []).map(toSupplier),
  }
}

const inflate = (data: Uint8Array) => new Uint8Array(inflateRawSync(data))

/** La planilla como la baja el bar: el `.xlsx` de verdad, leído con el lector de los importadores. */
async function downloadedRows(catalog: SheetCatalog): Promise<Cell[][]> {
  const bytes = buildXlsx(
    itemsWorkbook({ ...catalog, barName: 'HUB', downloadedAt: '09/11/2026 18:54' }),
  )
  return (await readWorkbookSheet(bytes, inflate)).rows
}

const col = (title: string) => ITEM_SHEET_COLUMNS.findIndex((c) => c.title === title)

/** Cambia una celda de la fila de ese insumo (por nombre). */
function edit(rows: Cell[][], name: string, title: string, value: Cell): void {
  const row = rows.find((r) => r[col('Insumo')] === name)
  if (!row) throw new Error(`no está ${name}`)
  while (row.length <= col(title)) row.push(null)
  row[col(title)] = value
}

function blankRow(): Cell[] {
  return ITEM_SHEET_COLUMNS.map(() => null)
}

describe('ida y vuelta', () => {
  it('bajarla y subirla sin tocar nada no cambia nada', async () => {
    const catalog = catalogOf(seed())
    const plan = readItemsSheet(await downloadedRows(catalog), catalog)
    expect(plan).toMatchObject({
      noColumns: false,
      missing: [],
      rows: 5,
      updates: [],
      creates: [],
      problems: [],
      same: 5,
      notInSheet: 0,
    })
  })

  it('el libro: por zona en el orden del recorrido, los sin zona al final; las listas en otra hoja', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    expect(rows[0]).toEqual(ITEM_SHEET_COLUMNS.map((c) => c.title))
    expect(rows.slice(1).map((r) => r[col('Insumo')])).toEqual([
      'Bondiola de cerdo',
      'Carne Molida Burger',
      'Tomate perita',
      'Alcaparras',
      'Romero seco',
    ])
    expect(rows[1]).toEqual([
      'INS-006',
      'Bondiola de cerdo',
      null,
      'Freezer carnes y panes',
      'kg',
      10,
      'Pieza x 2 kg aprox.',
      2,
      'Va Food',
      'Frecuente',
      'Sí',
      null,
      I.bondiola,
    ])
    const sheets = itemsWorkbook({ ...catalog, barName: 'HUB', downloadedAt: 'x' })
    expect(sheets.map((s) => [s.name, s.hidden ?? false])).toEqual([
      ['Insumos', false],
      ['Cómo usarla', false],
      ['Listas', true],
    ])
    expect(sheets[0]?.validations?.map((v) => [v.range, v.source.range, v.strict])).toEqual([
      ['D2:D1000', 'A2:A3', true],
      ['E2:E1000', 'E2:E14', false],
      ['I2:I1000', 'B2:B5', true],
      ['J2:J1000', 'C2:C4', true],
      ['K2:K1000', 'D2:D3', true],
    ])
  })

  it('el nombre del archivo', () => {
    expect(itemsSheetFileName('hub', '2026-11-09')).toBe('insumos-hub-2026-11-09.xlsx')
    expect(itemsSheetFileName('Demo Bar/1', '2026-11-09')).toBe(
      'insumos-demo-bar-1-2026-11-09.xlsx',
    )
  })
})

describe('los cambios', () => {
  it('objetivo, proveedor, presentación, desactivar y uno nuevo', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    edit(rows, 'Bondiola de cerdo', 'Objetivo', 12)
    edit(rows, 'Bondiola de cerdo', 'Proveedor', 'La Selecta')
    edit(rows, 'Tomate perita', 'Presentación', 'Cajón x 18 kg')
    edit(rows, 'Tomate perita', 'Cada una trae', 18)
    edit(rows, 'Alcaparras', 'Activo', 'No')
    const fresh = blankRow()
    fresh[col('Insumo')] = 'Queso azul'
    fresh[col('Unidad')] = 'Kg'
    fresh[col('Objetivo')] = '2,5'
    fresh[col('Proveedor')] = 'waggon'
    fresh[col('Zona')] = 'camara de frio'
    rows.push(fresh)

    const plan = readItemsSheet(rows, catalog)
    expect(plan.problems).toEqual([])
    expect(plan.same).toBe(2)
    expect(plan.updates.map((u) => [u.label, u.changes.map((c) => c.text)])).toEqual([
      [
        'Bondiola de cerdo (INS-006)',
        ['Objetivo: 10 kg → 12 kg', 'Proveedor: Va Food → La Selecta'],
      ],
      [
        'Tomate perita (INS-111)',
        ['Presentación: Por kg → Cajón x 18 kg', 'Cada una trae: 1 kg → 18 kg'],
      ],
      ['Alcaparras (EV-002)', ['Se desactiva: deja de aparecer en los conteos']],
    ])
    expect(plan.creates).toHaveLength(1)
    expect(plan.creates[0]).toMatchObject({
      line: 7,
      label: 'Queso azul',
      detail: 'kg · objetivo 2,5 kg · sin presentación · Waggon · Cámara de frío · Frecuente',
      next: {
        name: 'Queso azul',
        unit: 'kg',
        targetQty: 2.5,
        supplierId: S.waggon,
        zoneId: Z.camara,
        frequency: 'frequent',
        active: true,
        code: null,
      },
    })
  })

  it('una celda vacía borra el dato; Frecuencia y Activo vacíos quedan como estaban', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    edit(rows, 'Bondiola de cerdo', 'Objetivo', null)
    edit(rows, 'Bondiola de cerdo', 'Proveedor', '')
    edit(rows, 'Bondiola de cerdo', 'Frecuencia', null)
    edit(rows, 'Bondiola de cerdo', 'Activo', null)
    const [update] = readItemsSheet(rows, catalog).updates
    expect(update?.changes.map((c) => c.text)).toEqual([
      'Objetivo: 10 kg → sin objetivo',
      'Proveedor: Va Food → sin proveedor',
    ])
    expect(update?.next).toMatchObject({ frequency: 'frequent', active: true })
  })

  it('una columna que no viene no se toca', async () => {
    const catalog = catalogOf(seed())
    const rows = (await downloadedRows(catalog)).map((r) =>
      r.filter((_, j) => j !== col('Notas') && j !== col('Activo')),
    )
    const plan = readItemsSheet(rows, catalog)
    expect(plan.missing).toEqual(['Activo', 'Notas'])
    expect(plan.updates).toEqual([])
    expect(plan.same).toBe(5)
  })

  it('borrar filas no borra insumos: quedan como están', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    const plan = readItemsSheet(rows.slice(0, 3), catalog)
    expect(plan).toMatchObject({ rows: 2, same: 2, notInSheet: 3, updates: [], creates: [] })
  })

  it('la misma unidad o el mismo código escritos distinto no son un cambio', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    edit(rows, 'Bondiola de cerdo', 'Unidad', 'KG')
    edit(rows, 'Bondiola de cerdo', 'Código', 'ins-006')
    edit(rows, 'Romero seco', 'Unidad', 'u')
    expect(readItemsSheet(rows, catalog).updates).toEqual([])
  })

  it('volver a activar uno', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    edit(rows, 'Romero seco', 'Activo', 'si')
    const [update] = readItemsSheet(rows, catalog).updates
    expect(update?.changes.map((c) => c.text)).toEqual(['Se vuelve a activar'])
  })
})

describe('a qué insumo va cada fila', () => {
  it('la clave manda: cambiar el código y el nombre es cambiar ese insumo', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    edit(rows, 'Bondiola de cerdo', 'Código', 'INS-106')
    edit(rows, 'Bondiola de cerdo', 'Insumo', 'Bondiola')
    const [update] = readItemsSheet(rows, catalog).updates
    expect(update?.itemId).toBe(I.bondiola)
    expect(update?.changes.map((c) => c.text)).toEqual([
      'Código: INS-006 → INS-106',
      'Nombre: Bondiola de cerdo → Bondiola',
    ])
  })

  it('sin la clave, por el código; sin código, por el nombre', async () => {
    const catalog = catalogOf(seed())
    const rows = (await downloadedRows(catalog)).map((r) => r.slice(0, col('Clave HUB')))
    edit(rows, 'Bondiola de cerdo', 'Insumo', 'Bondiola entera')
    edit(rows, 'Tomate perita', 'Código', null)
    edit(rows, 'Tomate perita', 'Objetivo', 9)
    const plan = readItemsSheet(rows, catalog)
    expect(plan.creates).toEqual([])
    expect(plan.updates.map((u) => [u.itemId, u.changes.map((c) => c.text)])).toEqual([
      [I.bondiola, ['Nombre: Bondiola de cerdo → Bondiola entera']],
      [I.tomate, ['Código: INS-111 → —', 'Objetivo: 7 kg → 9 kg']],
    ])
  })

  it('la planilla vieja de Google también sirve (id, nombre, sector, contenido…)', () => {
    const catalog = catalogOf(seed())
    const rows: Cell[][] = [
      [
        'id',
        'nombre',
        'marca',
        'sector',
        'unidad',
        'objetivo',
        'sugerido',
        'presentacion',
        'contenido',
        'proveedor',
      ],
      [
        'INS-006',
        'Bondiola de cerdo',
        '',
        'Freezer carnes y panes',
        'kg',
        '14',
        'false',
        'Pieza x 2 kg aprox.',
        '2',
        'Va Food',
      ],
      [
        'INS-111',
        'Tomate perita',
        '',
        'Cámara de frío',
        'kg',
        '7',
        'false',
        'Por kg',
        '1',
        'Fractal',
      ],
    ]
    const plan = readItemsSheet(rows, catalog)
    expect(plan.missing).toEqual(['Frecuencia', 'Activo', 'Notas'])
    expect(plan.updates.map((u) => u.changes.map((c) => c.text))).toEqual([
      ['Objetivo: 10 kg → 14 kg'],
    ])
    expect(plan.problems).toEqual([
      {
        line: 3,
        label: 'Tomate perita (INS-111)',
        reasons: ['El proveedor «Fractal» no está en HUB. ¿Es «Fractal Agricultura»?'],
      },
    ])
    expect(plan.notInSheet).toBe(3)
  })

  it('nunca dos filas al mismo insumo', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    const copy = [...(rows[1] ?? [])]
    copy[col('Objetivo')] = 99
    rows.push(copy)
    const plan = readItemsSheet(rows, catalog)
    expect(plan.updates).toEqual([])
    expect(plan.problems).toEqual([
      {
        line: 7,
        label: 'Bondiola de cerdo (INS-006)',
        reasons: ['Este insumo ya está en la fila 2: dejá una sola.'],
      },
    ])
  })

  it('dos insumos con el mismo nombre y sin código: pide el código', () => {
    const tables = seed()
    tables.pur_items?.push(itemRow(id(30), 'Tomate perita', { code: 'INS-300' }))
    const catalog = catalogOf(tables)
    const plan = readItemsSheet(
      [
        ['Insumo', 'Objetivo'],
        ['Tomate perita', 3],
      ],
      catalog,
    )
    expect(plan.problems[0]?.reasons).toEqual([
      'Hay 2 insumos que se llaman así en HUB: poné el código para saber cuál es.',
    ])
  })
})

describe('los problemas', () => {
  it('zona o proveedor que no están: se sugiere el parecido, nunca se elige solo', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    edit(rows, 'Bondiola de cerdo', 'Proveedor', 'Va Foods')
    edit(rows, 'Tomate perita', 'Zona', 'Terraza')
    edit(rows, 'Carne Molida Burger', 'Objetivo', 'mucho')
    const plan = readItemsSheet(rows, catalog)
    expect(plan.updates).toEqual([])
    expect(plan.problems.map((p) => [p.line, p.reasons])).toEqual([
      [2, ['El proveedor «Va Foods» no está en HUB. ¿Es «Va Food»?']],
      [3, ['Objetivo: «mucho» no es un número.']],
      [
        4,
        [
          'La zona «Terraza» no está en HUB. Armala en Insumos › Zonas del recorrido o elegí una de la lista.',
        ],
      ],
    ])
  })

  it('dos proveedores que solo cambian en una tilde: no elige', () => {
    const tables = seed()
    tables.pur_suppliers?.push(supplierRow(id(15), 'San Jose'), supplierRow(id(16), 'San José'))
    const catalog = catalogOf(tables)
    const plan = readItemsSheet(
      [
        ['Código', 'Proveedor'],
        ['INS-006', 'san jose'],
        ['INS-057', 'SAN JOSÉ'],
        ['INS-111', 'San Josè'],
      ],
      catalog,
    )
    expect(plan.updates.map((u) => u.next.supplierId)).toEqual([id(15), id(16)])
    expect(plan.problems[0]?.reasons).toEqual([
      'El proveedor «San Josè» puede ser «San Jose» o «San José»: elegilo de la lista.',
    ])
  })

  it('uno nuevo necesita nombre y unidad, y no puede repetirse', () => {
    const catalog = catalogOf(seed())
    const plan = readItemsSheet(
      [
        ['Insumo', 'Unidad', 'Objetivo'],
        ['Queso azul', '', 2],
        ['', 'kg', 3],
        ['Rúcula', 'atado', 1],
        ['rucula', 'atado', 2],
      ],
      catalog,
    )
    expect(plan.creates.map((c) => c.label)).toEqual(['Rúcula'])
    expect(plan.problems.map((p) => [p.line, p.reasons])).toEqual([
      [2, ['Falta la unidad (kg, L, unidad…).']],
      [3, ['Falta el nombre del insumo.']],
      [5, ['Está repetido: también va en la fila 4.']],
    ])
  })

  it('un código que ya tiene otro insumo', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    edit(rows, 'Bondiola de cerdo', 'Código', 'INS-057')
    const plan = readItemsSheet(
      rows.filter((r) => r[col('Insumo')] !== 'Carne Molida Burger'),
      catalog,
    )
    expect(plan.updates).toEqual([])
    expect(plan.problems).toEqual([
      {
        line: 2,
        label: 'Bondiola de cerdo (INS-057)',
        reasons: ['El código INS-057 ya lo tiene «Carne Molida Burger».'],
      },
    ])
  })

  it('una fila que quedó sin nombre no borra el insumo', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    edit(rows, 'Bondiola de cerdo', 'Insumo', '')
    const plan = readItemsSheet(rows, catalog)
    expect(plan.updates).toEqual([])
    expect(plan.problems[0]?.reasons).toEqual(['Falta el nombre del insumo.'])
  })

  it('sin fila de títulos', () => {
    const catalog = catalogOf(seed())
    expect(
      readItemsSheet(
        [
          ['hola', 'chau'],
          ['1', '2'],
        ],
        catalog,
      ).noColumns,
    ).toBe(true)
    expect(readItemsSheet([], catalog).noColumns).toBe(true)
  })
})

describe('las celdas', () => {
  it('números como se escriben en un CSV argentino', () => {
    const value = (cell: Cell) => {
      const parsed = parseSheetAmount(cell, 'Objetivo')
      return parsed.ok ? parsed.value : parsed.reason
    }
    expect(value(12)).toBe(12)
    expect(value(2.3456)).toBe(2.346)
    expect(value('2,5')).toBe(2.5)
    expect(value('1.5')).toBe(1.5)
    expect(value('1.500')).toBe(1500)
    expect(value('1.500,25')).toBe(1500.25)
    expect(value('10 kg')).toBe(10)
    expect(value(' ')).toBeNull()
    expect(value(null)).toBeNull()
    expect(value('-3')).toBe('Objetivo: no puede ser negativo.')
    expect(value(-3)).toBe('Objetivo: no puede ser negativo.')
    expect(value('dos')).toBe('Objetivo: «dos» no es un número.')
    expect(value(2_000_000)).toBe('Objetivo: es demasiado grande.')
    expect(value(true)).toBe('Objetivo: «Sí» no es un número.')
  })

  it('frecuencia y activo', () => {
    expect(parseSheetFrequency('eventual')).toEqual({ ok: true, value: 'occasional' })
    expect(parseSheetFrequency('Secundario')).toEqual({ ok: true, value: 'secondary' })
    expect(parseSheetFrequency('FRECUENTE')).toEqual({ ok: true, value: 'frequent' })
    expect(parseSheetFrequency('')).toEqual({ ok: true, value: null })
    expect(parseSheetFrequency('a veces').ok).toBe(false)
    expect(parseSheetActive('Sí')).toEqual({ ok: true, value: true })
    expect(parseSheetActive('no')).toEqual({ ok: true, value: false })
    expect(parseSheetActive(false)).toEqual({ ok: true, value: false })
    expect(parseSheetActive('quizás').ok).toBe(false)
  })

  it('las unidades de siempre, escritas de cualquier forma', () => {
    expect(
      ['Kg', 'kilos', 'lt', 'Litros', 'Porcion', 'u', 'gr', 'bolsa'].map(canonicalUnit),
    ).toEqual(['kg', 'kg', 'L', 'L', 'porción', 'unidad', 'g', 'bolsa'])
  })
})

describe('la huella', () => {
  it('es la misma para el mismo plan y cambia si cambia HUB', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    edit(rows, 'Bondiola de cerdo', 'Objetivo', 12)
    const first = sheetFingerprint(readItemsSheet(rows, catalog))
    expect(sheetFingerprint(readItemsSheet(rows, catalog))).toBe(first)
    const tables = seed()
    const molida = tables.pur_items?.find((r) => r.id === I.molida)
    if (molida) molida.target_qty = '16.000'
    expect(sheetFingerprint(readItemsSheet(rows, catalogOf(tables)))).not.toBe(first)
  })

  it('también cambia si alguien tocó en HUB un insumo que la planilla deja igual', async () => {
    const catalog = catalogOf(seed())
    const rows = await downloadedRows(catalog)
    edit(rows, 'Bondiola de cerdo', 'Objetivo', 12)
    const first = sheetFingerprint(readItemsSheet(rows, catalog))
    // Otra persona le cambia el proveedor; la planilla todavía dice Va Food: guardar lo pisaría.
    const tables = seed()
    const bondiola = tables.pur_items?.find((r) => r.id === I.bondiola)
    if (bondiola) bondiola.supplier_id = S.waggon
    const again = readItemsSheet(rows, catalogOf(tables))
    expect(again.updates[0]?.changes.map((c) => c.text)).toEqual([
      'Objetivo: 10 kg → 12 kg',
      'Proveedor: Waggon → Va Food',
    ])
    expect(sheetFingerprint(again)).not.toBe(first)
  })
})

// ─── Las acciones ────────────────────────────────────────────────────────────

async function xlsxFile(rows: Cell[][]): Promise<File> {
  const cells = rows.map((r) => r.map((c) => (typeof c === 'boolean' ? (c ? 'Sí' : 'No') : c)))
  const bytes = buildXlsx([{ name: 'Insumos', header: true, rows: cells }])
  return new File([bytes as Uint8Array<ArrayBuffer>], 'insumos-hub.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function form(file: File, fingerprint?: string): FormData {
  const data = new FormData()
  data.set('file', file)
  if (fingerprint) data.set('fingerprint', fingerprint)
  return data
}

describe('subir y guardar', () => {
  beforeEach(() => {
    fake.db = new FakeDb(seed())
    access.role = 'owner'
    access.purchasing = true
    vi.mocked(logAudit).mockClear()
  })

  async function editedFile(): Promise<File> {
    const rows = await downloadedRows(catalogOf(fake.db.tables))
    edit(rows, 'Bondiola de cerdo', 'Objetivo', 12)
    edit(rows, 'Alcaparras', 'Activo', 'No')
    edit(rows, 'Tomate perita', 'Proveedor', 'Fractal')
    const fresh = blankRow()
    fresh[col('Insumo')] = 'Queso azul'
    fresh[col('Unidad')] = 'kg'
    rows.push(fresh)
    return xlsxFile(rows)
  }

  it('la vista previa no escribe nada', async () => {
    const result = await previewItemsSheet('hub', form(await editedFile()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview).toMatchObject({
      fileName: 'insumos-hub.xlsx',
      rows: 6,
      same: 2,
      notInSheet: 0,
      missing: [],
      noColumns: false,
    })
    expect(result.preview.updates.map((u) => [u.label, u.deactivates])).toEqual([
      ['Bondiola de cerdo (INS-006)', false],
      ['Alcaparras (EV-002)', true],
    ])
    expect(result.preview.creates.map((c) => c.label)).toEqual(['Queso azul'])
    expect(result.preview.problems.map((p) => p.line)).toEqual([4])
    expect(fake.db.writes).toEqual([])
  })

  it('guardar escribe todo junto y no pisa quién creó cada insumo', async () => {
    const file = await editedFile()
    const preview = await previewItemsSheet('hub', form(file))
    if (!preview.ok) throw new Error(preview.message)
    const result = await applyItemsSheet('hub', form(file, preview.preview.fingerprint))
    expect(result).toEqual({ ok: true, updated: 2, created: 1, skipped: 1 })

    expect(fake.db.writes.map((w) => [w.table, w.kind])).toEqual([['pur_items', 'upsert']])
    const items = fake.db.rows('pur_items')
    expect(items).toHaveLength(6)
    const bondiola = items.find((r) => r.id === I.bondiola)
    expect(bondiola).toMatchObject({
      target_qty: 12,
      created_by: CREATOR,
      updated_by: USER,
      tenant_id: TENANT,
    })
    expect(items.find((r) => r.id === I.alcaparras)?.active).toBe(false)
    // El de la fila con problemas queda como estaba.
    expect(items.find((r) => r.id === I.tomate)?.supplier_id).toBe(S.fractal)
    const queso = items.find((r) => r.name === 'Queso azul')
    expect(queso).toMatchObject({
      tenant_id: TENANT,
      unit: 'kg',
      frequency: 'frequent',
      active: true,
      created_by: USER,
    })
    expect(String(queso?.id)).toMatch(/^[0-9a-f-]{36}$/)
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'purchasing.items_sheet_imported',
        payload: expect.objectContaining({ updated: 2, created: 1, skipped: 1 }),
      }),
    )
  })

  it('si algo cambió desde la vista previa, no guarda y muestra lo nuevo', async () => {
    const file = await editedFile()
    const preview = await previewItemsSheet('hub', form(file))
    if (!preview.ok) throw new Error(preview.message)
    const molida = fake.db.rows('pur_items').find((r) => r.id === I.bondiola)
    if (molida) molida.target_qty = '11.000'
    const result = await applyItemsSheet('hub', form(file, preview.preview.fingerprint))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/cambió algún insumo/)
    expect(result.preview?.updates[0]?.changes).toEqual(['Objetivo: 11 kg → 12 kg'])
    expect(fake.db.writes).toEqual([])
  })

  it('sin la huella, no guarda', async () => {
    const result = await applyItemsSheet('hub', form(await editedFile()))
    expect(result).toEqual({ ok: false, message: 'Pedido inválido.' })
    expect(fake.db.writes).toEqual([])
  })

  it('solo el dueño, con Compras prendido', async () => {
    access.role = 'kitchen'
    expect(await previewItemsSheet('hub', form(await editedFile()))).toEqual({
      ok: false,
      message: 'Solo los dueños editan los insumos.',
    })
    access.role = 'owner'
    access.purchasing = false
    expect(await previewItemsSheet('hub', form(await editedFile()))).toEqual({
      ok: false,
      message: 'Solo los dueños editan los insumos.',
    })
  })

  it('un archivo que no es una planilla', async () => {
    const pdf = new File([new TextEncoder().encode('%PDF-1.4 hola')], 'insumos.pdf')
    expect(await previewItemsSheet('hub', form(pdf))).toEqual({
      ok: false,
      message: 'Es un PDF. Subí la planilla en Excel (.xlsx) o CSV.',
    })
    const empty = new File([], 'vacio.xlsx')
    expect(await previewItemsSheet('hub', form(empty))).toEqual({
      ok: false,
      message: 'Elegí la planilla con los insumos.',
    })
  })

  it('también lee un CSV de Excel en castellano', async () => {
    const csv = '﻿Código;Insumo;Objetivo\r\nINS-006;Bondiola de cerdo;12,5\r\n'
    const file = new File([new TextEncoder().encode(csv)], 'insumos.csv', { type: 'text/csv' })
    const result = await previewItemsSheet('hub', form(file))
    expect(result.ok && result.preview.updates[0]?.changes).toEqual(['Objetivo: 10 kg → 12,5 kg'])
  })
})
