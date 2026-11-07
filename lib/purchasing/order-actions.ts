'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { addDays, todayInCordoba } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'
import {
  PURCHASING_MANAGE_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { effectiveDeliveryDate, nextDeliveryDate } from './dates'
import { toItem, toOrder, toSettings, toSupplier } from './rows'
import { confirmChangesSchema, draftSchema, newDraftSchema, orderIdSchema } from './schemas'
import { orderMessage } from './whatsapp'

/**
 * Lo que hace quien compra en el panel (/compras): revisar, mandar, confirmar con el proveedor y cerrar
 * las diferencias. Solo el dueño (policies `pur_orders_owner_write`). Cada paso es un update condicional
 * sobre el estado: si dos socios tocan el mismo pedido, el segundo se entera en vez de pisar al primero.
 */

export type OrderResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; message: string }

const NO_ACCESS = 'Solo los dueños manejan los pedidos.'
const GENERIC = 'No se pudo guardar. Probá de nuevo en un momento.'
const MOVED = 'Este pedido cambió mientras lo mirabas. Actualizá la página.'

async function authorize(slug: string) {
  try {
    const { tenant, role, user } = await requireTenantAccess(slug)
    requireRole(role, PURCHASING_MANAGE_ROLES)
    return { tenantId: tenant.id, tenantName: tenant.name, userId: user.id }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

function revalidateOrders(slug: string) {
  revalidatePath(`/${slug}/compras`, 'layout')
  revalidatePath(`/${slug}/salon/stock`, 'layout')
}

type Db = Awaited<ReturnType<typeof createClient>>
type Auth = NonNullable<Awaited<ReturnType<typeof authorize>>>

async function loadOrder(db: Db, tenantId: string, orderId: string) {
  const { data, error } = await db
    .from('pur_orders')
    .select('*, pur_order_lines(*)')
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .maybeSingle()
  if (error) {
    console.error('[purchasing.loadOrder]', { code: error.code })
    return null
  }
  return data ? toOrder(data) : null
}

/** Lo que Tomás cambió en el borrador: cantidades, productos agregados, la nota y (si no tenía) el proveedor. */
async function applyDraft(
  db: Db,
  auth: Auth,
  input: ReturnType<typeof draftSchema.parse>,
): Promise<string | null> {
  const order = await loadOrder(db, auth.tenantId, input.orderId)
  if (!order) return 'No encontramos este pedido.'
  if (order.status !== 'draft') return MOVED

  const lineIds = new Set(order.lines.map((l) => l.id))
  for (const l of input.lines) {
    if (!lineIds.has(l.id)) return MOVED
  }
  const changed = input.lines.filter(
    (l) => order.lines.find((o) => o.id === l.id)?.orderedPacks !== l.orderedPacks,
  )
  const results = await Promise.all(
    changed.map((l) =>
      db
        .from('pur_order_lines')
        .update({ ordered_packs: l.orderedPacks })
        .eq('tenant_id', auth.tenantId)
        .eq('order_id', order.id)
        .eq('id', l.id),
    ),
  )
  if (results.some((r) => r.error)) return GENERIC

  if (input.added.length) {
    const { data: items, error } = await db
      .from('pur_items')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .in(
        'id',
        input.added.map((a) => a.itemId),
      )
    if (error) return GENERIC
    const byId = new Map(items.map((i) => [i.id, toItem(i)]))
    const already = new Set(order.lines.map((l) => l.itemId).filter(Boolean))
    let sort = Math.max(0, ...order.lines.map((l) => l.sortOrder))
    const rows = []
    for (const a of input.added) {
      const item = byId.get(a.itemId)
      if (!item) return 'Uno de los productos que agregaste ya no está en la lista.'
      if (already.has(item.id)) return `${item.name} ya está en este pedido.`
      sort += 1
      rows.push({
        tenant_id: auth.tenantId,
        order_id: order.id,
        item_id: item.id,
        name: item.name,
        unit: item.unit,
        pack_label: item.packLabel,
        pack_size: item.packSize,
        target_qty: item.targetQty,
        ordered_packs: a.packs,
        added_by_hand: true,
        sort_order: sort,
      })
    }
    const ins = await db.from('pur_order_lines').insert(rows)
    if (ins.error) return GENERIC
  }

  const patch: { supplier_note: string | null; supplier_id?: string } = {
    supplier_note: input.supplierNote,
  }
  if (input.supplierId && input.supplierId !== order.supplierId) {
    if (order.supplierId) return 'Este pedido ya tiene proveedor.'
    patch.supplier_id = input.supplierId
  }
  const upd = await db
    .from('pur_orders')
    .update(patch)
    .eq('tenant_id', auth.tenantId)
    .eq('id', order.id)
    .eq('status', 'draft')
    .select('id')
  if (upd.error) return GENERIC
  if (!upd.data.length) return MOVED

  if (patch.supplier_id && input.rememberSupplier) {
    const itemIds = order.lines.map((l) => l.itemId).filter((v): v is string => Boolean(v))
    if (itemIds.length) {
      await db
        .from('pur_items')
        .update({ supplier_id: patch.supplier_id, updated_by: auth.userId })
        .eq('tenant_id', auth.tenantId)
        .in('id', itemIds)
        .is('supplier_id', null)
    }
  }
  return null
}

export async function saveDraft(input: unknown): Promise<OrderResult> {
  const parsed = draftSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Revisá las cantidades.' }
  const auth = await authorize(parsed.data.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const problem = await applyDraft(db, auth, parsed.data)
  if (problem) return { ok: false, message: problem }
  revalidateOrders(parsed.data.slug)
  return { ok: true }
}

/**
 * Un pedido armado a mano para un proveedor (lo usa Tex: «pedile a Coca 10 packs»). Queda para revisar,
 * como los que salen del conteo. Si ese proveedor ya tiene uno para revisar no se arma otro: dos
 * borradores del mismo proveedor terminarían en dos WhatsApp. Los productos se suman a ese.
 */
export async function createDraft(input: unknown): Promise<OrderResult<{ orderId: string }>> {
  const parsed = newDraftSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Revisá las cantidades.' }
  const { slug, supplierId, lines, supplierNote } = parsed.data
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()

  const [supplierRes, itemsRes, draftRes] = await Promise.all([
    db
      .from('pur_suppliers')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .eq('id', supplierId)
      .maybeSingle(),
    db
      .from('pur_items')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .in(
        'id',
        lines.map((l) => l.itemId),
      ),
    db
      .from('pur_orders')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .eq('status', 'draft')
      .eq('supplier_id', supplierId)
      .limit(1),
  ])
  if (supplierRes.error || itemsRes.error || draftRes.error) {
    console.error('[purchasing.createDraft]', {
      code: supplierRes.error?.code ?? itemsRes.error?.code ?? draftRes.error?.code,
    })
    return { ok: false, message: GENERIC }
  }
  if (!supplierRes.data) return { ok: false, message: 'Ese proveedor ya no está en la lista.' }
  const supplier = toSupplier(supplierRes.data)
  if (!supplier.active) {
    return { ok: false, message: `${supplier.name} está desactivado en Compras.` }
  }
  if (draftRes.data.length) {
    return {
      ok: false,
      message: `Ya hay un pedido para revisar de ${supplier.name}: los productos se suman a ese.`,
    }
  }

  const items = new Map(itemsRes.data.map((i) => [i.id, toItem(i)]))
  const seen = new Set<string>()
  const rows = []
  for (const [index, line] of lines.entries()) {
    const item = items.get(line.itemId)
    if (!item?.active) return { ok: false, message: 'Uno de los productos ya no está en la lista.' }
    if (seen.has(item.id)) return { ok: false, message: `${item.name} está dos veces.` }
    seen.add(item.id)
    rows.push({
      tenant_id: auth.tenantId,
      item_id: item.id,
      name: item.name,
      unit: item.unit,
      pack_label: item.packLabel,
      pack_size: item.packSize,
      target_qty: item.targetQty,
      ordered_packs: line.packs,
      added_by_hand: true,
      sort_order: index + 1,
    })
  }

  const created = await db
    .from('pur_orders')
    .insert({
      tenant_id: auth.tenantId,
      supplier_id: supplier.id,
      status: 'draft',
      expected_date: nextDeliveryDate(
        todayInCordoba(),
        supplier.deliveryWeekdays,
        supplier.leadDays,
      ),
      supplier_note: supplierNote,
      created_by: auth.userId,
    })
    .select('id')
    .single()
  if (created.error) {
    console.error('[purchasing.createDraft]', { code: created.error.code })
    return { ok: false, message: GENERIC }
  }
  const orderId = created.data.id
  const inserted = await db
    .from('pur_order_lines')
    .insert(rows.map((row) => ({ ...row, order_id: orderId })))
  if (inserted.error) {
    console.error('[purchasing.createDraft]', { code: inserted.error.code })
    // Un pedido sin renglones no le sirve a nadie: se saca.
    await db.from('pur_orders').delete().eq('tenant_id', auth.tenantId).eq('id', orderId)
    return { ok: false, message: GENERIC }
  }
  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'purchasing.order_created',
    entity: 'pur_order',
    entityId: orderId,
    payload: { lines: rows.length },
  })
  revalidateOrders(slug)
  return { ok: true, orderId }
}

/**
 * «Aprobar y abrir WhatsApp»: guarda lo último del borrador, recalcula la entrega si quedó vieja, guarda el
 * mensaje tal como sale y lo marca enviado. El link lo abre el navegador en el mismo toque (si no, los
 * celulares bloquean la ventana): esta action no abre nada.
 */
export async function approveOrder(input: unknown): Promise<OrderResult<{ message: string }>> {
  const parsed = draftSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Revisá las cantidades.' }
  const auth = await authorize(parsed.data.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const problem = await applyDraft(db, auth, parsed.data)
  if (problem) return { ok: false, message: problem }

  const order = await loadOrder(db, auth.tenantId, parsed.data.orderId)
  if (!order || order.status !== 'draft') return { ok: false, message: MOVED }
  const undefinedLines = order.lines.filter((l) => l.orderedPacks == null).map((l) => l.name)
  if (undefinedLines.length) {
    return { ok: false, message: `Completá cuánto pedir de: ${undefinedLines.join(', ')}.` }
  }
  const lines = order.lines.filter((l) => (l.orderedPacks ?? 0) > 0)
  if (!lines.length) return { ok: false, message: 'No hay nada para pedir: usá «Hoy no pido».' }
  if (!order.supplierId) return { ok: false, message: 'Elegí a qué proveedor se le pide.' }

  const [supplierRes, settingsRes] = await Promise.all([
    db
      .from('pur_suppliers')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .eq('id', order.supplierId)
      .single(),
    db.from('pur_settings').select('*').eq('tenant_id', auth.tenantId).maybeSingle(),
  ])
  if (supplierRes.error) return { ok: false, message: GENERIC }
  const supplier = toSupplier(supplierRes.data)
  const settings = toSettings(settingsRes.data)
  const expected = effectiveDeliveryDate(order.expectedDate, supplier, todayInCordoba())

  const message = orderMessage({
    senderName: settings.senderName ?? auth.tenantName,
    contactName: supplier.contactName,
    expectedDate: expected,
    lines: lines.map((l) => ({
      name: l.name,
      packs: l.orderedPacks ?? 0,
      packLabel: l.packLabel,
      packSize: l.packSize,
      unit: l.unit,
    })),
    note: order.supplierNote,
  })

  const now = new Date().toISOString()
  const { data, error } = await db
    .from('pur_orders')
    .update({
      status: 'sent',
      sent_at: now,
      sent_by: auth.userId,
      message,
      expected_date: expected,
    })
    .eq('tenant_id', auth.tenantId)
    .eq('id', order.id)
    .eq('status', 'draft')
    .select('id')
  if (error) return { ok: false, message: GENERIC }
  if (!data.length) return { ok: false, message: MOVED }
  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'purchasing.order_sent',
    entity: 'pur_order',
    entityId: order.id,
    payload: { lines: lines.length, has_whatsapp: Boolean(supplier.whatsapp) },
  })
  revalidateOrders(parsed.data.slug)
  return { ok: true, message }
}

async function transition(
  input: unknown,
  from: string,
  patch: (userId: string, now: string) => Record<string, unknown>,
  audit: string,
): Promise<OrderResult> {
  const parsed = orderIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Revisá los datos.' }
  const auth = await authorize(parsed.data.slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const { data, error } = await db
    .from('pur_orders')
    .update(patch(auth.userId, new Date().toISOString()))
    .eq('tenant_id', auth.tenantId)
    .eq('id', parsed.data.orderId)
    .eq('status', from)
    .select('id')
  if (error) {
    console.error(`[purchasing.${audit}]`, { code: error.code })
    return { ok: false, message: GENERIC }
  }
  if (!data.length) return { ok: false, message: MOVED }
  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: `purchasing.${audit}`,
    entity: 'pur_order',
    entityId: parsed.data.orderId,
  })
  revalidateOrders(parsed.data.slug)
  return { ok: true }
}

/** «Hoy no pido»: el borrador se descarta (lo que hacía falta vuelve a salir en el próximo conteo). */
export async function skipOrder(input: unknown): Promise<OrderResult> {
  return transition(
    input,
    'draft',
    (userId, now) => ({
      status: 'discarded',
      discard_reason: 'skipped',
      discarded_at: now,
      discarded_by: userId,
    }),
    'order_skipped',
  )
}

/** «Volver a borrador»: no se mandó, o hay que corregirlo antes de reenviarlo. */
export async function backToDraft(input: unknown): Promise<OrderResult> {
  return transition(
    input,
    'sent',
    () => ({ status: 'draft', sent_at: null, sent_by: null }),
    'order_back_to_draft',
  )
}

/** «Confirmado, va todo como se pidió»: recién ahí la cocina lo ve sin el aviso. */
export async function confirmOrder(input: unknown): Promise<OrderResult> {
  return transition(
    input,
    'sent',
    (userId, now) => ({
      status: 'confirmed',
      confirmed_at: now,
      confirmed_by: userId,
      confirmed_with_changes: false,
    }),
    'order_confirmed',
  )
}

/** «Cerrar» las diferencias: lo que faltó vuelve solo en el próximo pedido sugerido. */
export async function closeDifferences(input: unknown): Promise<OrderResult> {
  return transition(
    input,
    'with_differences',
    (userId, now) => ({ status: 'completed', closed_at: now, closed_by: userId }),
    'order_closed',
  )
}

/** «Hubo cambios»: lo que viene de verdad (0 = no lo tiene), cuándo llega y una nota para la cocina. */
export async function confirmWithChanges(input: unknown): Promise<OrderResult> {
  const parsed = confirmChangesSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Revisá las cantidades.' }
  const { slug, orderId, lines, expectedDate, kitchenNote } = parsed.data
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const order = await loadOrder(db, auth.tenantId, orderId)
  if (!order) return { ok: false, message: 'No encontramos este pedido.' }
  if (order.status !== 'sent') return { ok: false, message: MOVED }
  const ids = new Set(order.lines.map((l) => l.id))
  if (lines.some((l) => !ids.has(l.id))) return { ok: false, message: MOVED }
  if (expectedDate && expectedDate < addDays(todayInCordoba(), -1)) {
    return { ok: false, message: 'La fecha de entrega no puede ser de antes de ayer.' }
  }

  const results = await Promise.all(
    lines.map((l) =>
      db
        .from('pur_order_lines')
        .update({ confirmed_packs: l.confirmedPacks })
        .eq('tenant_id', auth.tenantId)
        .eq('order_id', orderId)
        .eq('id', l.id),
    ),
  )
  if (results.some((r) => r.error)) return { ok: false, message: GENERIC }
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('pur_orders')
    .update({
      status: 'confirmed',
      confirmed_at: now,
      confirmed_by: auth.userId,
      confirmed_with_changes: true,
      expected_date: expectedDate,
      kitchen_note: kitchenNote,
    })
    .eq('tenant_id', auth.tenantId)
    .eq('id', orderId)
    .eq('status', 'sent')
    .select('id')
  if (error) return { ok: false, message: GENERIC }
  if (!data.length) return { ok: false, message: MOVED }
  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'purchasing.order_confirmed',
    entity: 'pur_order',
    entityId: orderId,
    payload: { with_changes: true, lines: lines.length },
  })
  revalidateOrders(slug)
  return { ok: true }
}
