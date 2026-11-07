/**
 * Tex en Compras (los pedidos a proveedores). Lo que se fija: que cada tique corra la acción de verdad del
 * panel contra una base de mentira; que el WhatsApp que abre el botón sea, letra por letra, el que queda
 * guardado, y que si el pedido cambió mientras tanto no se marque enviado; que los teléfonos de los
 * proveedores no lleguen a Tex; y que solo el dueño, con Compras prendido, lo tenga.
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', async () => {
  const { fake, fakeClient } = await import('./tex-mensajeria-kit')
  return {
    createClient: async () => fakeClient(fake.db, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  }
})
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => {
    throw new Error('service_role en una herramienta de Tex')
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }))

const access = vi.hoisted(() => ({ role: 'owner' as string }))

vi.mock('@/lib/tenant', async (actual) => ({
  ...(await actual<typeof import('@/lib/tenant')>()),
  requireTenantAccess: vi.fn(async () => ({
    tenant: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'HUB', slug: 'hub' },
    role: access.role,
    user: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  })),
}))

import { texSuggestions } from '@/components/administracion/tex/suggestions'
import { draftOutcome, NO_EDIT } from '@/lib/purchasing/draft'
import { createDraft } from '@/lib/purchasing/order-actions'
import { toOrder } from '@/lib/purchasing/rows'
import { PURCHASING_MANAGE_ROLES } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { pedidosScreens } from '@/lib/tex/area-screens/pedidos'
import { pedidosArea } from '@/lib/tex/areas/pedidos'
import { typedDecisions } from '@/lib/tex/display'
import { settledTicket, type TexTicket, texTicketNeedsTap } from '@/lib/tex/protocol'
import { TEX_SCREENS, texScreenHref, texScreensFor } from '@/lib/tex/screens'
import { parseWeekdays, resolveInOrder, resolveProducts } from '@/lib/tex/tools/pedidos/_values'
import { pedidosManual } from '@/lib/tex/tools/pedidos/manual'
import {
  type TexPrepared,
  type TexToolContext,
  type TexToolResult,
  toInputSchema,
} from '@/lib/tex/tools/types'
import { FakeDb, type FakeRow, fake, PHONE_LIKE, withoutIds } from './tex-mensajeria-kit'

// ─── El bar de prueba ────────────────────────────────────────────────────────

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
/** Distintos de los que inventa la base de mentira al insertar. */
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`

/** Un lunes: Waggon entrega miércoles y viernes; la verdulería, martes, jueves y sábado. */
const TODAY = '2026-11-09'
const NOW = new Date('2026-11-09T13:00:00-03:00')

const CTX: TexToolContext = {
  slug: 'hub',
  tenantId: TENANT,
  tenantName: 'HUB',
  userId: USER,
  role: 'owner',
  features: { purchasing: true } as never,
  isAccountant: false,
  access: { read: true, write: true, admin: false },
  today: TODAY,
}

const S = { waggon: id(1), dulcar: id(2), verdu: id(3) }
const I = {
  coca: id(11),
  sprite: id(12),
  limon: id(13),
  crema: id(14),
  agua: id(15),
  soda: id(16),
}
const O = { waggon: id(21), verdu: id(22), dulcar: id(23), diff: id(24), sin: id(25) }
const L = { coca: id(31), sprite: id(32), limon: id(33), crema: id(34), agua: id(35), soda: id(36) }

const supplier = (sid: string, name: string, extra: FakeRow = {}): FakeRow => ({
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
  ...extra,
})

const item = (iid: string, name: string, extra: FakeRow = {}): FakeRow => ({
  id: iid,
  tenant_id: TENANT,
  code: null,
  name,
  brand: null,
  zone_id: null,
  unit: 'unidad',
  frequency: 'frequent',
  target_qty: null,
  pack_label: null,
  pack_size: null,
  supplier_id: null,
  notes: null,
  active: true,
  ...extra,
})

const order = (oid: string, extra: FakeRow = {}): FakeRow => ({
  id: oid,
  tenant_id: TENANT,
  count_id: null,
  supplier_id: null,
  status: 'draft',
  expected_date: null,
  supplier_note: null,
  kitchen_note: null,
  message: null,
  sent_at: null,
  confirmed_at: null,
  confirmed_with_changes: false,
  received_at: null,
  received_by_name: null,
  closed_at: null,
  discarded_at: null,
  discard_reason: null,
  created_at: '2026-11-09T10:00:00-03:00',
  updated_at: '2026-11-09T10:00:00-03:00',
  ...extra,
})

function line(lid: string, oid: string, of: FakeRow, extra: FakeRow = {}): FakeRow {
  return {
    id: lid,
    tenant_id: TENANT,
    order_id: oid,
    item_id: of.id,
    name: of.name,
    unit: of.unit,
    pack_label: of.pack_label,
    pack_size: of.pack_size,
    counted_qty: null,
    count_state: null,
    target_qty: of.target_qty,
    event_qty: 0,
    event_names: [],
    in_transit_qty: 0,
    suggested_packs: null,
    ordered_packs: null,
    confirmed_packs: null,
    received_state: null,
    received_packs: null,
    added_by_hand: false,
    sort_order: 1,
    ...extra,
  }
}

/** Como PostgREST: cada pedido trae sus renglones (`pur_order_lines(*)`), siempre al día. */
class ComprasDb extends FakeDb {
  rows(table: string): FakeRow[] {
    const rows = super.rows(table)
    if (table === 'pur_orders') {
      const lines = super.rows('pur_order_lines')
      for (const row of rows) row.pur_order_lines = lines.filter((l) => l.order_id === row.id)
    }
    return rows
  }
}

function bar(): ComprasDb {
  const items = {
    coca: item(I.coca, 'Coca Cola 2,25 L', {
      pack_label: 'Pack x 8',
      pack_size: 8,
      supplier_id: S.waggon,
      target_qty: 16,
    }),
    sprite: item(I.sprite, 'Sprite 2,25 L', {
      pack_label: 'Pack x 8',
      pack_size: 8,
      supplier_id: S.waggon,
    }),
    limon: item(I.limon, 'Limón', {
      unit: 'kg',
      pack_label: 'Por kg',
      pack_size: 1,
      supplier_id: S.verdu,
      target_qty: 5,
    }),
    crema: item(I.crema, 'Crema de leche', {
      unit: 'L',
      pack_label: 'Caja x 12',
      pack_size: 12,
      supplier_id: S.dulcar,
    }),
    agua: item(I.agua, 'Agua sin gas', {
      pack_label: 'Pack x 6',
      pack_size: 6,
      supplier_id: S.waggon,
    }),
    soda: item(I.soda, 'Agua con gas', {
      pack_label: 'Pack x 6',
      pack_size: 6,
      supplier_id: S.waggon,
    }),
  }
  return new ComprasDb({
    pur_settings: [
      {
        id: id(41),
        tenant_id: TENANT,
        count_weekdays: [1, 3],
        recipe_base_guests: 60,
        reviewer_name: 'Tomás',
        sender_name: 'HUB Coffee & Bar',
        low_fraction: 0.5,
      },
    ],
    pur_suppliers: [
      supplier(S.waggon, 'Waggon', {
        contact_name: 'Pablo',
        whatsapp: '5493515551234',
        delivery_weekdays: [3, 5],
      }),
      supplier(S.dulcar, 'Dulcar'),
      supplier(S.verdu, 'Verdulería Juan', {
        whatsapp: '5493517776655',
        delivery_weekdays: [2, 4, 6],
      }),
    ],
    pur_items: Object.values(items),
    pur_orders: [
      order(O.waggon, { supplier_id: S.waggon, expected_date: '2026-11-11' }),
      order(O.verdu, { supplier_id: S.verdu, expected_date: '2026-11-10' }),
      order(O.dulcar, {
        supplier_id: S.dulcar,
        status: 'sent',
        sent_at: '2026-11-08T12:00:00-03:00',
        message: 'Hola Dulcar',
      }),
      order(O.diff, {
        supplier_id: S.waggon,
        status: 'with_differences',
        sent_at: '2026-11-05T12:00:00-03:00',
        confirmed_at: '2026-11-05T15:00:00-03:00',
        received_at: '2026-11-07T11:00:00-03:00',
        received_by_name: 'Gustavo',
      }),
      order(O.sin),
    ],
    pur_order_lines: [
      line(L.coca, O.waggon, items.coca, {
        ordered_packs: 2,
        suggested_packs: 2,
        count_state: 'none',
        counted_qty: 0,
      }),
      line(L.sprite, O.waggon, items.sprite, {
        count_state: 'low',
        counted_qty: 4,
        sort_order: 2,
      }),
      line(L.limon, O.verdu, items.limon, { ordered_packs: 3, suggested_packs: 3 }),
      line(L.crema, O.dulcar, items.crema, { ordered_packs: 2 }),
      line(L.agua, O.diff, items.agua, {
        ordered_packs: 3,
        received_state: 'partial',
        received_packs: 1,
      }),
      line(L.soda, O.sin, items.soda, { ordered_packs: 2, added_by_hand: true }),
    ],
  })
}

const db = () => fake.db as ComprasDb
const orderIn = (oid: string) =>
  db()
    .rows('pur_orders')
    .find((row) => row.id === oid)
const linesOf = (oid: string) =>
  db()
    .rows('pur_order_lines')
    .filter((row) => row.order_id === oid)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  access.role = 'owner'
  fake.db = bar()
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Cómo se corren ──────────────────────────────────────────────────────────

function toolNamed(name: string) {
  const tool = pedidosArea.tools.find((t) => t.name === name)
  if (!tool) throw new Error(`No está la herramienta ${name}`)
  return tool
}

async function run(name: string, input: unknown, ctx = CTX): Promise<TexToolResult> {
  const tool = toolNamed(name)
  return tool.run(tool.input.parse(input) as never, ctx)
}

async function prepared(name: string, input: unknown, ctx = CTX): Promise<TexPrepared> {
  const result = await run(name, input, ctx)
  if (result.kind !== 'prepared') throw new Error(`Se esperaba un tique: ${JSON.stringify(result)}`)
  return result.prepared
}

async function errorOf(name: string, input: unknown): Promise<string> {
  const result = await run(name, input)
  if (result.kind !== 'error') throw new Error(`Se esperaba un error: ${JSON.stringify(result)}`)
  return result.message
}

async function dataOf(name: string, input: unknown): Promise<unknown> {
  const result = await run(name, input)
  if (result.kind !== 'data') throw new Error(`Se esperaban datos: ${JSON.stringify(result)}`)
  return result.data
}

/** Lo que guarda el ciclo y le llega al ejecutor: JSON ida y vuelta, como en `acc_tex_actions`. */
function execute(ticket: TexPrepared, ctx = CTX) {
  const executor = pedidosArea.executors[ticket.executor]
  if (!executor) throw new Error(`No está el ejecutor ${ticket.executor}`)
  return executor.run(JSON.parse(JSON.stringify(ticket.payload)), ctx)
}

const rowsOf = (ticket: TexPrepared) =>
  Object.fromEntries(ticket.ticket.rows.map((row) => [row.label, row.value]))

// ─── Quién lo tiene ──────────────────────────────────────────────────────────

describe('las herramientas', () => {
  it.each(
    pedidosArea.tools.map((tool) => [tool.name, tool] as const),
  )('%s está bien armada', (_name, tool) => {
    expect(tool.name).toMatch(/^(ver|buscar|preparar)_[a-z_]+$/)
    expect(tool.description.length).toBeGreaterThan(40)
    const schema = toInputSchema(tool.input)
    expect(schema.type).toBe('object')
    expect(tool.need).toEqual({ roles: PURCHASING_MANAGE_ROLES, feature: 'purchasing' })
    if (tool.name.startsWith('preparar_')) {
      expect(tool.description).toContain('No guarda nada')
      expect(tool.mood).toBe('working')
      expect(JSON.stringify(schema).length).toBeLessThan(2600)
    } else {
      expect(tool.description.length).toBeLessThanOrEqual(240)
      expect(JSON.stringify(schema).length).toBeLessThan(900)
    }
  })

  it('los ejecutores tienen la forma de siempre', () => {
    for (const name of Object.keys(pedidosArea.executors)) {
      expect(name).toMatch(/^pedidos\.[a-z_]+$/)
    }
  })

  it('el área es del dueño, y solo si el bar tiene Compras prendido', () => {
    expect(pedidosArea.visible(CTX)).toBe(true)
    expect(pedidosArea.visible({ ...CTX, features: {} as never })).toBe(false)
    for (const role of ['editor', 'host', 'accountant'] as TenantRole[]) {
      expect(pedidosArea.visible({ ...CTX, role })).toBe(false)
    }
  })

  it('el manual dice cómo se manda y entra en lo que lee de una vez', () => {
    expect(pedidosManual).toContain('preparar_envio_pedido')
    expect(pedidosManual).toContain('Un «sí» escrito no lo manda')
    expect(pedidosManual.length).toBeLessThanOrEqual(6500)
    expect(pedidosArea.summary).toContain('No son las facturas de Administración')
  })
})

describe('las pantallas', () => {
  const MANAGER = resolve(__dirname, '../../app/(manager)/[tenantSlug]')

  it.each(pedidosScreens.map((s) => [s.id, s.path] as const))('%s → %s existe', (_id, path) => {
    expect(existsSync(join(MANAGER, path.replace(':id', '[recipeId]'), 'page.tsx'))).toBe(true)
  })

  it('son del panel, no chocan con las de Administración y piden Compras prendido', () => {
    const ids = TEX_SCREENS.map((screen) => screen.id)
    for (const screen of pedidosScreens) {
      expect(screen.root, screen.id).toBe(true)
      expect(screen.feature, screen.id).toBe('purchasing')
      expect(ids.filter((other) => other === screen.id).length, screen.id).toBe(1)
    }
  })

  it('cada uno ve las suyas', () => {
    const seen = (role: TenantRole, features: Record<string, boolean>) =>
      texScreensFor({ role, features, accounting: true })
        .map((s) => s.id)
        .filter((sid) => sid.startsWith('pedidos.'))
    expect(seen('owner', { purchasing: true }).sort()).toEqual(
      pedidosScreens.map((s) => s.id).sort(),
    )
    expect(seen('owner', {})).toEqual([])
    expect(seen('host', { purchasing: true })).toEqual([])
    expect(seen('accountant', { purchasing: true })).toEqual([])
  })

  it('los links van a Compras, no a Administración', () => {
    expect(texScreenHref('hub', 'pedidos.inicio')).toMatchObject({ href: '/hub/compras' })
    expect(texScreenHref('hub', 'pedidos.receta', { id: id(9) })).toMatchObject({
      href: `/hub/compras/recetas/${id(9)}`,
    })
  })

  it('las sugerencias de Compras no son las de Compras y pagos', () => {
    expect(texSuggestions('/hub/compras', 'owner')).toContain('¿Qué pedidos hay para mandar?')
    expect(texSuggestions('/hub/compras/proveedores', 'owner')).toContain(
      '¿A qué proveedores les falta el WhatsApp?',
    )
    expect(texSuggestions('/hub/administracion/compras', 'owner')).toContain(
      '¿A quién le debo más?',
    )
  })
})

// ─── Mirar ───────────────────────────────────────────────────────────────────

describe('ver_pedidos', () => {
  it('sin filtros: los pedidos como en el panel, la cocina y lo que falta corregir', async () => {
    const data = (await dataOf('ver_pedidos', {})) as Record<string, unknown>
    const para = data.para_mandar as Array<Record<string, unknown>>
    expect(para.map((o) => o.proveedor)).toEqual(['Waggon', 'Verdulería Juan', 'Sin proveedor'])
    expect(para[0]).toMatchObject({
      id: O.waggon,
      entrega: 'mié 11/11',
      falta: 'decir cuánto pedir de Sprite 2,25 L',
      renglones: ['Coca Cola 2,25 L: 2 × Pack x 8', 'Sprite 2,25 L: a definir'],
    })
    expect(para[2]).toMatchObject({ falta: 'elegir a qué proveedor se le pide' })
    expect(data.enviados).toEqual([
      expect.objectContaining({ proveedor: 'Dulcar', enviado: '08/11' }),
    ])
    expect(data.con_diferencias).toEqual([
      expect.objectContaining({
        recibio: 'Gustavo',
        diferencias: ['Agua sin gas: se esperaba 3 × Pack x 6 y llegó 1 × Pack x 6'],
      }),
    ])
    expect(data.cocina_contando).toBe('no hay un conteo abierto')
    expect(data.datos_para_corregir).toMatchObject({
      ejemplos: expect.arrayContaining(['Dulcar: faltan el WhatsApp y los días de entrega.']),
    })
  })

  it('un pedido, renglón por renglón, con lo que había y el objetivo', async () => {
    const data = (await dataOf('ver_pedidos', { pedido: O.waggon })) as Record<string, unknown>
    expect(data.renglones).toEqual([
      expect.objectContaining({
        renglon: L.coca,
        pedir: '2 × Pack x 8',
        habia: 'no hay',
        objetivo: '16 u',
      }),
      expect.objectContaining({ renglon: L.sprite, pedir: 'a definir', habia: 'poco (≈ 4 u)' }),
    ])
  })

  it('por proveedor o por estado', async () => {
    const waggon = (await dataOf('ver_pedidos', { proveedor: 'waggon' })) as Record<string, unknown>
    expect(Object.keys(waggon).sort()).toEqual(['con_diferencias', 'para_mandar'])
    const sent = (await dataOf('ver_pedidos', { estado: 'enviados' })) as Record<string, unknown>
    expect(Object.keys(sent)).toEqual(['enviados'])
  })

  it('no le pasa a Tex el teléfono de ningún proveedor', async () => {
    const all = [
      await dataOf('ver_pedidos', {}),
      await dataOf('ver_pedidos', { pedido: O.waggon }),
      await dataOf('ver_proveedores_compras', {}),
      await dataOf('buscar_insumos', { texto: 'agua' }),
    ]
    const text = withoutIds(JSON.stringify(all))
    expect(text).not.toMatch(PHONE_LIKE)
    expect(text).toContain('termina en 1234')
  })
})

describe('buscar_insumos y ver_proveedores_compras', () => {
  it('encuentra por nombre y dice en qué pedido ya está', async () => {
    const data = (await dataOf('buscar_insumos', { texto: 'coca' })) as {
      insumos: Array<Record<string, unknown>>
    }
    expect(data.insumos).toEqual([
      expect.objectContaining({
        id: I.coca,
        se_compra: 'Pack x 8',
        proveedor: 'Waggon',
        ya_en_el_pedido_de: 'Waggon',
      }),
    ])
    const limon = (await dataOf('buscar_insumos', { texto: 'limon' })) as {
      insumos: Array<Record<string, unknown>>
    }
    expect(limon.insumos[0]).toMatchObject({ se_compra: 'por kg', objetivo: '5 kg' })
  })

  it('los proveedores a los que les falta algo', async () => {
    const data = (await dataOf('ver_proveedores_compras', { faltan_datos: true })) as {
      proveedores: Array<Record<string, unknown>>
      sin_whatsapp: number
    }
    expect(data.proveedores).toEqual([
      expect.objectContaining({
        proveedor: 'Dulcar',
        whatsapp: 'falta',
        entrega: 'faltan los días',
      }),
    ])
    expect(data.sin_whatsapp).toBe(1)
  })
})

// ─── Armar ───────────────────────────────────────────────────────────────────

describe('preparar_pedido', () => {
  it('corrige el del proveedor: lo que falta definir y un producto de la lista', async () => {
    const ticket = await prepared('preparar_pedido', {
      proveedor: 'Waggon',
      productos: [
        { producto: 'sprite', cantidad: 1 },
        { producto: 'agua sin gas', cantidad: 2 },
      ],
    })
    expect(ticket.executor).toBe('pedidos.borrador')
    expect(rowsOf(ticket)).toEqual({
      'Sprite 2,25 L': 'a definir → 1 × Pack x 8',
      'Agua sin gas': 'nuevo: 2 × Pack x 6',
    })
    expect(ticket.ticket.total).toEqual({ label: 'Productos', value: '3' })
    expect(ticket.ticket.subtitle).toBe('Waggon · entrega mié 11/11')

    expect(await execute(ticket)).toMatchObject({ ok: true, href: '/hub/compras', point: 'Waggon' })
    const lines = linesOf(O.waggon)
    expect(lines.find((l) => l.id === L.sprite)?.ordered_packs).toBe(1)
    expect(lines.find((l) => l.item_id === I.agua)).toMatchObject({
      ordered_packs: 2,
      added_by_hand: true,
      sort_order: 3,
    })
    expect(orderIn(O.waggon)?.status).toBe('draft')
  })

  it('a un proveedor sin pedido para revisar le arma uno nuevo', async () => {
    const ticket = await prepared('preparar_pedido', {
      proveedor: 'dulcar',
      productos: [{ producto: 'crema', cantidad: 3 }],
      nota: 'Entregar antes de las 11',
    })
    expect(ticket.executor).toBe('pedidos.nuevo')
    expect(ticket.ticket.title).toBe('Pedido nuevo')
    expect(ticket.ticket.subtitle).toBe('Dulcar · sin días de entrega')
    expect(rowsOf(ticket)).toEqual({
      'Crema de leche': '3 × Caja x 12',
      Nota: 'Entregar antes de las 11',
    })

    const result = await execute(ticket)
    expect(result).toMatchObject({ ok: true, href: '/hub/compras', point: 'Dulcar' })
    const created = db()
      .rows('pur_orders')
      .find((row) => row.supplier_id === S.dulcar && row.status === 'draft')
    expect(created).toMatchObject({
      supplier_note: 'Entregar antes de las 11',
      expected_date: null,
      created_by: USER,
    })
    expect(linesOf(String(created?.id))).toEqual([
      expect.objectContaining({ item_id: I.crema, ordered_packs: 3, added_by_hand: true }),
    ])
  })

  it('un pedido nuevo calcula la entrega con los días del proveedor', async () => {
    db().tables.pur_orders = db()
      .rows('pur_orders')
      .filter((row) => row.id !== O.verdu)
    const ticket = await prepared('preparar_pedido', {
      proveedor: 'verduleria',
      productos: [{ producto: 'limon', cantidad: 4 }],
    })
    expect(ticket.ticket.subtitle).toBe('Verdulería Juan · entrega mañana')
    await execute(ticket)
    const created = db()
      .rows('pur_orders')
      .find((row) => row.supplier_id === S.verdu && row.status === 'draft')
    expect(created?.expected_date).toBe('2026-11-10')
  })

  it('no arma dos para el mismo proveedor, aunque el tique sea viejo', async () => {
    const res = await createDraft({
      slug: 'hub',
      supplierId: S.waggon,
      lines: [{ itemId: I.coca, packs: 1 }],
      supplierNote: null,
    })
    expect(res).toEqual({
      ok: false,
      message: 'Ya hay un pedido para revisar de Waggon: los productos se suman a ese.',
    })
  })

  it('a uno «Sin proveedor» le elige a quién se le pide, y los productos quedan con él', async () => {
    const ticket = await prepared('preparar_pedido', { pedido: O.sin, proveedor: 'Waggon' })
    expect(rowsOf(ticket)).toEqual({ Proveedor: 'Sin proveedor → Waggon' })
    expect(ticket.ticket.warnings.map((w) => w.key)).toContain('recordar')
    await execute(ticket)
    expect(orderIn(O.sin)?.supplier_id).toBe(S.waggon)
    expect(
      db()
        .rows('pur_items')
        .find((row) => row.id === I.soda)?.supplier_id,
    ).toBe(S.waggon)
  })

  it('avisa lo que se le compra a otro proveedor', async () => {
    const ticket = await prepared('preparar_pedido', {
      proveedor: 'Waggon',
      productos: [{ producto: 'limón', cantidad: 2 }],
    })
    expect(ticket.ticket.warnings).toContainEqual(
      expect.objectContaining({
        key: 'otro_proveedor',
        title: 'Limón se le compra a Verdulería Juan',
      }),
    )
  })

  it('nunca elige a ojo ni inventa', async () => {
    expect(
      await errorOf('preparar_pedido', {
        proveedor: 'Waggon',
        productos: [{ producto: 'agua', cantidad: 1 }],
      }),
    ).toMatch(/^«agua» puede ser: Agua con gas.*; Agua sin gas.*\. Preguntale cuál\.$/)
    expect(
      await errorOf('preparar_pedido', {
        proveedor: 'Waggon',
        productos: [{ producto: 'fernet', cantidad: 1 }],
      }),
    ).toContain('buscar_insumos')
    expect(
      await errorOf('preparar_pedido', {
        proveedor: 'Waggon',
        productos: [{ producto: 'agua sin gas', cantidad: 0 }],
      }),
    ).toBe('«Agua sin gas» no está en el pedido: no hay nada que sacar.')
    expect(
      await errorOf('preparar_pedido', {
        proveedor: 'Waggon',
        productos: [
          { producto: 'coca', cantidad: 1 },
          { producto: L.coca, cantidad: 3 },
        ],
      }),
    ).toBe('«Coca Cola 2,25 L» está dos veces.')
    expect(
      await errorOf('preparar_pedido', {
        proveedor: 'Waggon',
        productos: [{ producto: 'coca', cantidad: 2 }],
      }),
    ).toBe('Ya está así: no hay nada para cambiar.')
    expect(await errorOf('preparar_pedido', { proveedor: 'Coto' })).toContain(
      'No encontré el proveedor «Coto»',
    )
  })

  it('uno ya mandado no se corrige sin volverlo a borrador', async () => {
    expect(await errorOf('preparar_pedido', { pedido: O.dulcar, productos: [] })).toBe(
      'Ese pedido está enviado, esperando la respuesta del proveedor. Para corregirlo, primero volvelo a borrador (preparar_estado_pedido con volver_a_borrador).',
    )
  })
})

// ─── Mandar ──────────────────────────────────────────────────────────────────

describe('preparar_envio_pedido', () => {
  const WAGGON_MESSAGE =
    '¡Hola Pablo! Te escribo de HUB Coffee & Bar. Te paso el pedido para el miércoles 11/11:\n\n• Coca Cola 2,25 L: 2 × Pack x 8\n• Sprite 2,25 L: 1 × Pack x 8\n\n¿Me confirmás que llega ese día? ¡Gracias!'

  it('con algo «a definir» no se manda: pregunta', async () => {
    expect(await errorOf('preparar_envio_pedido', { proveedor: 'Waggon' })).toBe(
      'Falta cuánto pedir de: Sprite 2,25 L. Preguntale, o sacalos con cantidad 0.',
    )
  })

  it('el botón abre el chat del proveedor con el mensaje, y queda guardado ese mismo', async () => {
    const ticket = await prepared('preparar_envio_pedido', {
      proveedor: 'Waggon',
      productos: [{ producto: 'sprite', cantidad: 1 }],
    })
    expect(ticket.executor).toBe('pedidos.enviar')
    const { send, confirmLabel, subtitle } = ticket.ticket
    expect(confirmLabel).toBe('Mandar por WhatsApp')
    expect(subtitle).toBe('Waggon · para el miércoles 11/11')
    expect(send?.text).toBe(WAGGON_MESSAGE)
    expect(send?.href).toBe(
      `https://wa.me/5493515551234?text=${encodeURIComponent(WAGGON_MESSAGE)}`,
    )
    expect(rowsOf(ticket)).toEqual({
      'Coca Cola 2,25 L': '2 × Pack x 8',
      'Sprite 2,25 L': '1 × Pack x 8 (era a definir)',
    })

    const result = await execute(ticket)
    expect(result).toMatchObject({
      ok: true,
      message: 'Quedó como enviado a Waggon. Cuando conteste, confirmalo.',
      href: '/hub/compras',
      point: 'Waggon',
    })
    expect(orderIn(O.waggon)).toMatchObject({
      status: 'sent',
      sent_by: USER,
      message: WAGGON_MESSAGE,
      expected_date: '2026-11-11',
    })
    // Lo que le llega a Tex después: sin el teléfono.
    expect(withoutIds(JSON.stringify(result))).not.toMatch(PHONE_LIKE)
  })

  it('el mismo tique dos veces no lo manda dos veces', async () => {
    const ticket = await prepared('preparar_envio_pedido', { pedido: O.verdu })
    expect(await execute(ticket)).toMatchObject({ ok: true })
    expect(await execute(ticket)).toMatchObject({ ok: false, kind: 'failed' })
  })

  it('si el pedido cambió mientras tanto, no lo marca enviado', async () => {
    const ticket = await prepared('preparar_envio_pedido', { pedido: O.verdu })
    const limon = linesOf(O.verdu)[0]
    if (limon) limon.ordered_packs = 5
    const result = await execute(ticket)
    expect(result).toMatchObject({ ok: false, kind: 'failed' })
    expect(result.ok ? '' : result.message).toContain('No lo marqué como enviado')
    expect(orderIn(O.verdu)?.status).toBe('draft')
  })

  it('un tique de ayer con la entrega vieja tampoco: el mensaje ya no diría lo mismo', async () => {
    const ticket = await prepared('preparar_envio_pedido', { pedido: O.verdu })
    expect(ticket.ticket.send?.text).toContain('para el martes 10/11')
    vi.setSystemTime(new Date('2026-11-11T09:00:00-03:00'))
    expect(await execute(ticket)).toMatchObject({ ok: false, kind: 'failed' })
    expect(orderIn(O.verdu)?.status).toBe('draft')
  })

  it('sin WhatsApp cargado, el botón copia el mensaje y lo marca enviado', async () => {
    const draft = await prepared('preparar_pedido', {
      proveedor: 'Dulcar',
      productos: [{ producto: 'crema', cantidad: 1 }],
    })
    await execute(draft)
    const ticket = await prepared('preparar_envio_pedido', { proveedor: 'Dulcar' })
    expect(ticket.ticket.send?.href).toBeNull()
    expect(ticket.ticket.send?.text).toContain(
      '¿Me confirmás disponibilidad y día de entrega? ¡Gracias!',
    )
    expect(ticket.ticket.confirmLabel).toBe('Copiar y marcar enviado')
    expect(ticket.ticket.warnings.map((w) => w.key)).toEqual(['sin_whatsapp', 'sin_dias'])
    expect(await execute(ticket)).toMatchObject({
      ok: true,
      message: 'Copié el mensaje: pegalo en el chat de Dulcar. Quedó como enviado.',
    })
  })

  it('si un proveedor tiene dos para revisar, pregunta cuál', async () => {
    db()
      .rows('pur_orders')
      .push(order(id(26), { supplier_id: S.waggon, created_at: '2026-11-09T11:00:00-03:00' }))
    expect(await errorOf('preparar_envio_pedido', { proveedor: 'Waggon' })).toBe(
      'Waggon tiene 2 pedidos para revisar: pasame el id (ver_pedidos).',
    )
  })

  it('sin nada para pedir o sin proveedor, no hay WhatsApp que armar', async () => {
    expect(
      await errorOf('preparar_envio_pedido', {
        pedido: O.verdu,
        productos: [{ producto: 'limon', cantidad: 0 }],
      }),
    ).toContain('No queda nada para pedir')
    expect(await errorOf('preparar_envio_pedido', { pedido: O.sin })).toContain(
      'no tiene proveedor',
    )
    expect(await errorOf('preparar_envio_pedido', { proveedor: 'Dulcar' })).toBe(
      'Dulcar no tiene un pedido para revisar. Para armarle uno, preparar_pedido.',
    )
  })
})

// ─── Lo que sigue ────────────────────────────────────────────────────────────

describe('preparar_confirmacion_pedido', () => {
  it('tal cual: la cocina ya lo ve sin aviso', async () => {
    const ticket = await prepared('preparar_confirmacion_pedido', { proveedor: 'Dulcar' })
    expect(ticket.ticket.title).toBe('Pedido confirmado')
    expect(rowsOf(ticket)).toEqual({ Respuesta: 'va todo como se pidió', Llega: 'sin fecha' })
    await execute(ticket)
    expect(orderIn(O.dulcar)).toMatchObject({ status: 'confirmed', confirmed_with_changes: false })
  })

  it('con cambios: lo que no tiene, otro día y un aviso para la cocina', async () => {
    const ticket = await prepared('preparar_confirmacion_pedido', {
      pedido: O.dulcar,
      cambios: [{ producto: 'crema', cantidad: 1 }],
      entrega: '2026-11-12',
      nota_cocina: 'Llega a la tarde',
    })
    expect(ticket.ticket.title).toBe('Confirmado con cambios')
    expect(rowsOf(ticket)).toEqual({
      'Crema de leche': '2 × Caja x 12 → 1 × Caja x 12',
      Llega: 'sin fecha → jue 12/11',
      'Para la cocina': 'Llega a la tarde',
    })
    expect(ticket.ticket.warnings.map((w) => w.key)).toEqual(['falta'])
    await execute(ticket)
    expect(orderIn(O.dulcar)).toMatchObject({
      status: 'confirmed',
      confirmed_with_changes: true,
      expected_date: '2026-11-12',
      kitchen_note: 'Llega a la tarde',
    })
    expect(linesOf(O.dulcar)[0]?.confirmed_packs).toBe(1)
  })

  it('solo los enviados, y nunca con una entrega vieja', async () => {
    expect(await errorOf('preparar_confirmacion_pedido', { pedido: O.waggon })).toBe(
      'Ese pedido está para revisar: todavía no se mandó. Se manda con preparar_envio_pedido.',
    )
    expect(
      await errorOf('preparar_confirmacion_pedido', { pedido: O.dulcar, entrega: '2026-11-01' }),
    ).toBe('La fecha de entrega no puede ser de antes de ayer.')
    expect(
      await errorOf('preparar_confirmacion_pedido', {
        pedido: O.dulcar,
        cambios: [{ producto: 'coca', cantidad: 1 }],
      }),
    ).toBe('«coca» no está en este pedido.')
  })
})

describe('preparar_reclamo_pedido', () => {
  it('abre el chat con el reclamo y no toca el pedido', async () => {
    const ticket = await prepared('preparar_reclamo_pedido', { pedido: O.diff })
    expect(ticket.ticket.confirmLabel).toBe('Reclamar por WhatsApp')
    expect(ticket.ticket.send?.href).toMatch(/^https:\/\/wa\.me\/5493515551234\?text=/)
    expect(ticket.ticket.send?.text).toContain(
      'En el pedido que llegó el sábado 07/11 hubo diferencias',
    )
    expect(ticket.ticket.send?.text).toContain(
      '• Agua sin gas: pedimos 3 × Pack x 6 y llegaron 1 × Pack x 6',
    )
    expect(rowsOf(ticket)).toEqual({ 'Agua sin gas': 'se pidió 3 × Pack x 6, llegó 1 × Pack x 6' })
    const writes = db().writes.length
    expect(await execute(ticket)).toMatchObject({ ok: true })
    expect(db().writes.length).toBe(writes)
    expect(orderIn(O.diff)?.status).toBe('with_differences')
  })
})

describe('preparar_estado_pedido', () => {
  it.each([
    ['no_pedir', O.verdu, { status: 'discarded', discard_reason: 'skipped' }],
    ['volver_a_borrador', O.dulcar, { status: 'draft', sent_at: null }],
    ['cerrar', O.diff, { status: 'completed', closed_by: USER }],
  ] as const)('%s', async (accion, oid, after) => {
    const ticket = await prepared('preparar_estado_pedido', { pedido: oid, accion })
    expect(ticket.executor).toBe('pedidos.estado')
    expect(await execute(ticket)).toMatchObject({ ok: true })
    expect(orderIn(oid)).toMatchObject(after)
  })

  it('cada una en su estado', async () => {
    expect(await errorOf('preparar_estado_pedido', { pedido: O.waggon, accion: 'cerrar' })).toBe(
      'Ese pedido está para revisar: todavía no se mandó.',
    )
  })
})

describe('preparar_proveedor_compras', () => {
  it('carga el WhatsApp, el contacto y los días, y a Tex no le vuelve el número', async () => {
    const ticket = await prepared('preparar_proveedor_compras', {
      proveedor: 'Dulcar',
      whatsapp: '351 555-9876',
      contacto: 'Marta',
      dias_entrega: ['martes', 'Viernes'],
    })
    expect(rowsOf(ticket)).toEqual({
      WhatsApp: 'sin WhatsApp → +54 9 351 555-9876',
      Contacto: 'sin contacto → Marta',
      Entrega: 'sin días → martes y viernes',
    })
    const result = await execute(ticket)
    expect(result).toMatchObject({ ok: true, href: '/hub/compras/proveedores', point: 'Dulcar' })
    expect(
      db()
        .rows('pur_suppliers')
        .find((row) => row.id === S.dulcar),
    ).toMatchObject({
      whatsapp: '5493515559876',
      contact_name: 'Marta',
      delivery_weekdays: [2, 5],
      lead_days: 1,
    })
    expect(withoutIds(JSON.stringify(result.ok ? result.data : null))).not.toMatch(PHONE_LIKE)
  })

  it('no guarda un número que no es un celular ni un día que no existe', async () => {
    expect(
      await errorOf('preparar_proveedor_compras', { proveedor: 'Dulcar', whatsapp: '123' }),
    ).toContain('no parece un número')
    expect(
      await errorOf('preparar_proveedor_compras', {
        proveedor: 'Dulcar',
        dias_entrega: ['feriado'],
      }),
    ).toBe('«feriado» no es un día de la semana.')
    expect(
      await errorOf('preparar_proveedor_compras', {
        proveedor: 'Waggon',
        whatsapp: '+54 9 351 555-1234',
      }),
    ).toBe('Ya está así: no hay nada para cambiar.')
  })
})

describe('las acciones siguen siendo del dueño', () => {
  it('si quien confirma ya no es dueño, no se escribe nada', async () => {
    const ticket = await prepared('preparar_envio_pedido', { pedido: O.verdu })
    access.role = 'host'
    const result = await execute(ticket)
    expect(result).toMatchObject({ ok: false, kind: 'failed' })
    expect(result.ok ? '' : result.message).toContain('Solo los dueños manejan los pedidos.')
    expect(orderIn(O.verdu)?.status).toBe('draft')
  })
})

// ─── Puro ────────────────────────────────────────────────────────────────────

describe('lo que se calcula sin base', () => {
  const lines = bar()
    .rows('pur_orders')
    .map((row) => toOrder(row as never))

  it('el borrador con cambios: lo nuevo va al final y lo «a definir» no se manda', () => {
    const waggon = lines.find((o) => o.id === O.waggon)
    if (!waggon) throw new Error('falta el pedido')
    const plain = draftOutcome({
      order: waggon,
      supplier: { contactName: null, deliveryWeekdays: [3, 5], leadDays: 1 },
      edit: NO_EDIT,
      senderName: 'HUB',
      today: TODAY,
    })
    expect(plain.undefinedNames).toEqual(['Sprite 2,25 L'])
    expect(plain.toOrder.map((l) => l.name)).toEqual(['Coca Cola 2,25 L'])

    const edited = draftOutcome({
      order: waggon,
      supplier: null,
      edit: {
        packs: new Map([[L.coca, 0]]),
        added: [
          {
            item: {
              id: I.agua,
              name: 'Agua sin gas',
              unit: 'unidad',
              packLabel: 'Pack x 6',
              packSize: 6,
            },
            packs: 1,
          },
        ],
        note: 'Antes de las 11',
      },
      senderName: 'HUB',
      today: TODAY,
    })
    expect(edited.lines.map((l) => l.name)).toEqual([
      'Coca Cola 2,25 L',
      'Sprite 2,25 L',
      'Agua sin gas',
    ])
    expect(edited.toOrder.map((l) => l.name)).toEqual(['Agua sin gas'])
    expect(edited.message).toContain('• Agua sin gas: 1 × Pack x 6\n\nAntes de las 11')
  })

  it('los productos: por renglón, por insumo o por nombre', () => {
    const waggon = lines.find((o) => o.id === O.waggon)?.lines ?? []
    const items = bar()
      .rows('pur_items')
      .map((row) => ({
        id: String(row.id),
        code: null,
        name: String(row.name),
        brand: null,
        zoneId: null,
        unit: String(row.unit),
        frequency: 'frequent' as const,
        targetQty: null,
        packLabel: (row.pack_label as string | null) ?? null,
        packSize: (row.pack_size as number | null) ?? null,
        supplierId: (row.supplier_id as string | null) ?? null,
        notes: null,
        active: true,
      }))
    const found = resolveProducts({
      wanted: [
        { producto: I.sprite, cantidad: 1.23456 },
        { producto: 'COCA', cantidad: 4 },
        { producto: 'limon', cantidad: 2 },
      ],
      lines: waggon,
      items,
    })
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect([...found.value.packs]).toEqual([
      [L.sprite, 1.235],
      [L.coca, 4],
    ])
    expect(found.value.added.map((a) => [a.item.name, a.packs])).toEqual([['Limón', 2]])
    expect(resolveInOrder([{ producto: 'sprite', cantidad: 2 }], waggon)).toMatchObject({
      ok: true,
    })
  })

  it('los días de entrega, como los dicen', () => {
    expect(parseWeekdays(['Lunes', 'miércoles', 'sáb', 'mie'])).toEqual({
      ok: true,
      value: [1, 3, 6],
    })
  })
})

describe('el tique que abre WhatsApp', () => {
  const base: TexTicket = {
    actionId: 'a1',
    kind: 'pedido_envio',
    title: 'Pedido por WhatsApp',
    subtitle: null,
    rows: [],
    total: null,
    entry: [],
    warnings: [],
    confirmLabel: 'Mandar por WhatsApp',
    send: { href: 'https://wa.me/5493515551234?text=Hola', text: 'Hola' },
    status: 'pending',
    result: null,
    error: null,
  }

  it('va con su botón; decidido, no guarda el link', () => {
    expect(texTicketNeedsTap(base)).toBe(true)
    expect(settledTicket(base).send).toBeNull()
    expect(texTicketNeedsTap(settledTicket(base))).toBe(false)
    expect(texTicketNeedsTap({ send: undefined })).toBe(false)
  })

  it('un «sí» escrito confirma los demás, no el que abre WhatsApp', () => {
    const actions = [
      { id: 'a1', toolUseId: 't1', status: 'pending', ticket: { send: base.send } },
      { id: 'a2', toolUseId: 't2', status: 'pending', ticket: { send: null } },
      { id: 'a3', toolUseId: 't3', status: 'done', ticket: {} },
    ]
    expect(typedDecisions(actions, ['t1', 't2', 't3'], 'yes')).toEqual({
      decisions: [{ actionId: 'a2', approve: true }],
      tapToSend: true,
    })
    expect(typedDecisions(actions, ['t1', 't2'], 'no')).toEqual({
      decisions: [
        { actionId: 'a1', approve: false },
        { actionId: 'a2', approve: false },
      ],
      tapToSend: false,
    })
    expect(typedDecisions(actions.slice(0, 1), ['t1'], 'yes')).toEqual({
      decisions: [],
      tapToSend: true,
    })
  })
})
