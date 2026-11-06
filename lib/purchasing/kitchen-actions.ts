'use server'

import { revalidatePath } from 'next/cache'
import { addDays, todayInCordoba } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'
import {
  PURCHASING_KITCHEN_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { getCountContext } from './queries'
import {
  countIdSchema,
  receiveSchema,
  saveCountLinesSchema,
  startCountSchema,
  updateCountSchema,
} from './schemas'
import { buildSuggestion, toSubmitPayload } from './suggest'

/**
 * Lo que hace la cocina desde el celular (/salon/stock): contar y recibir. Dueño, cocina y caja; la base
 * (policies `pur_count*` y las RPC) vuelve a decidir lo mismo.
 */

export type KitchenResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; message: string }

const NO_ACCESS = 'No tenés acceso a Compras en este bar.'
const GENERIC = 'No se pudo guardar. Probá de nuevo en un momento.'

async function authorize(slug: string) {
  try {
    const { tenant, role, user } = await requireTenantAccess(slug)
    requireRole(role, PURCHASING_KITCHEN_ROLES)
    return { tenantId: tenant.id, userId: user.id }
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

function revalidateKitchen(slug: string) {
  revalidatePath(`/${slug}/salon/stock`, 'layout')
  revalidatePath(`/${slug}/compras`, 'layout')
}

export async function startCount(input: unknown): Promise<KitchenResult<{ countId: string }>> {
  const parsed = startCountSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
  const { slug, kind, countDate, eventsUntil, countedByName } = parsed.data
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const today = todayInCordoba()
  if (countDate < addDays(today, -7) || countDate > addDays(today, 7)) {
    return { ok: false, message: 'La fecha del conteo tiene que ser de esta semana.' }
  }
  if (eventsUntil < countDate) {
    return { ok: false, message: '«Contar para los eventos hasta» no puede ser antes de la fecha.' }
  }
  if (eventsUntil > addDays(countDate, 60)) {
    return { ok: false, message: 'Los eventos se cuentan hasta dos meses adelante, como mucho.' }
  }

  const db = await createClient()
  const { data, error } = await db
    .from('pur_counts')
    .insert({
      tenant_id: auth.tenantId,
      kind,
      count_date: countDate,
      events_until: eventsUntil,
      counted_by_name: countedByName,
      created_by: auth.userId,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') {
      const open = await db
        .from('pur_counts')
        .select('id')
        .eq('tenant_id', auth.tenantId)
        .eq('status', 'open')
        .maybeSingle()
      if (open.data) return { ok: true, countId: open.data.id }
    }
    console.error('[purchasing.startCount]', { code: error.code })
    return { ok: false, message: GENERIC }
  }
  revalidateKitchen(slug)
  return { ok: true, countId: data.id }
}

export async function updateCount(input: unknown): Promise<KitchenResult> {
  const parsed = updateCountSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
  const { slug, countId, countedByName, eventsUntil } = parsed.data
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const { data, error } = await db
    .from('pur_counts')
    .update({ counted_by_name: countedByName, events_until: eventsUntil })
    .eq('tenant_id', auth.tenantId)
    .eq('id', countId)
    .eq('status', 'open')
    .select('id')
  if (error) {
    console.error('[purchasing.updateCount]', { code: error.code })
    return { ok: false, message: GENERIC }
  }
  if (!data.length) return { ok: false, message: 'Este conteo ya se envió.' }
  revalidateKitchen(slug)
  return { ok: true }
}

/** Guarda lo que se va marcando (se llama sola, en tandas, mientras la cocina cuenta). */
export async function saveCountLines(input: unknown): Promise<KitchenResult<{ savedAt: string }>> {
  const parsed = saveCountLinesSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Hay un número que no se entiende.' }
  const { slug, countId, lines } = parsed.data
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()

  const count = await db
    .from('pur_counts')
    .select('id, status')
    .eq('tenant_id', auth.tenantId)
    .eq('id', countId)
    .maybeSingle()
  if (count.error) {
    console.error('[purchasing.saveCountLines]', { code: count.error.code })
    return { ok: false, message: GENERIC }
  }
  if (!count.data) return { ok: false, message: 'No encontramos este conteo.' }
  if (count.data.status !== 'open')
    return { ok: false, message: 'Este conteo ya se envió: lo nuevo no se guardó.' }

  const clear = lines.filter((l) => l.state === null).map((l) => l.itemId)
  const upsert = lines
    .filter((l) => l.state !== null)
    .map((l) => ({
      tenant_id: auth.tenantId,
      count_id: countId,
      item_id: l.itemId,
      state: l.state as string,
      // La base pide: «Alcanza» sin número, «No hay» en cero y el exacto con número.
      quantity:
        l.state === 'enough'
          ? null
          : l.state === 'none'
            ? null
            : l.state === 'exact'
              ? (l.quantity ?? 0)
              : l.quantity,
      updated_by: auth.userId,
    }))

  if (clear.length) {
    const { error } = await db
      .from('pur_count_lines')
      .delete()
      .eq('tenant_id', auth.tenantId)
      .eq('count_id', countId)
      .in('item_id', clear)
    if (error) {
      console.error('[purchasing.saveCountLines.clear]', { code: error.code })
      return { ok: false, message: GENERIC }
    }
  }
  if (upsert.length) {
    const { error } = await db
      .from('pur_count_lines')
      .upsert(upsert, { onConflict: 'count_id,item_id' })
    if (error) {
      console.error('[purchasing.saveCountLines.upsert]', { code: error.code })
      return { ok: false, message: GENERIC }
    }
  }
  return { ok: true, savedAt: new Date().toISOString() }
}

export async function discardCount(input: unknown): Promise<KitchenResult> {
  const parsed = countIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Revisá los datos.' }
  const { slug, countId } = parsed.data
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const { data, error } = await db
    .from('pur_counts')
    .update({ status: 'discarded' })
    .eq('tenant_id', auth.tenantId)
    .eq('id', countId)
    .eq('status', 'open')
    .select('id')
  if (error) {
    console.error('[purchasing.discardCount]', { code: error.code })
    return { ok: false, message: GENERIC }
  }
  if (!data.length) return { ok: false, message: 'Este conteo ya se envió.' }
  revalidateKitchen(slug)
  return { ok: true }
}

/**
 * Cierra el conteo: el servidor vuelve a hacer la cuenta con lo guardado (no con lo que diga el celular) y
 * la RPC arma un borrador por proveedor.
 */
export async function submitCount(
  input: unknown,
): Promise<KitchenResult<{ orders: number; products: number }>> {
  const parsed = countIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Revisá los datos.' }
  const { slug, countId } = parsed.data
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_ACCESS }

  const ctx = await getCountContext(auth.tenantId, countId)
  if (!ctx) return { ok: false, message: 'No encontramos este conteo.' }
  if (ctx.count.status !== 'open') return { ok: false, message: 'Este conteo ya se envió.' }

  const orders = buildSuggestion({
    items: ctx.items,
    lines: new Map(ctx.lines.map((l) => [l.itemId, l])),
    needs: ctx.eventNeeds.needs,
    inTransit: ctx.inTransit,
    suppliers: ctx.catalog.suppliers.filter((s) => s.active),
    zones: ctx.catalog.zones,
    lowFraction: ctx.catalog.settings.lowFraction,
    today: todayInCordoba(),
  })

  const db = await createClient()
  const { error } = await db.rpc('pur_submit_count', {
    p_count_id: countId,
    p_orders: toSubmitPayload(orders),
  })
  if (error) {
    console.error('[purchasing.submitCount]', { code: error.code, message: error.message })
    if (error.message.includes('count_not_open'))
      return { ok: false, message: 'Este conteo ya se envió.' }
    return {
      ok: false,
      message: 'No se pudo enviar. Probá de nuevo en un momento: lo contado está guardado.',
    }
  }
  revalidateKitchen(slug)
  return {
    ok: true,
    orders: orders.length,
    products: orders.reduce((n, o) => n + o.lines.length, 0),
  }
}

export type ReceiveDifference = {
  name: string
  unit: string
  packLabel: string | null
  packSize: number | null
  expectedPacks: number
  receivedPacks: number
}

export async function receiveOrder(
  input: unknown,
): Promise<
  KitchenResult<{ status: 'completed' | 'with_differences'; differences: ReceiveDifference[] }>
> {
  const parsed = receiveSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Revisá los datos.' }
  const { slug, orderId, receivedByName, lines } = parsed.data
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_ACCESS }
  const db = await createClient()
  const { data, error } = await db.rpc('pur_receive_order', {
    p_order_id: orderId,
    p_received_by_name: receivedByName,
    p_lines: lines.map((l) => ({ id: l.id, state: l.state, packs: l.packs })),
  })
  if (error) {
    console.error('[purchasing.receiveOrder]', { code: error.code, message: error.message })
    if (error.message.includes('order_not_receivable')) {
      return { ok: false, message: 'Este pedido ya se recibió o volvió a revisión.' }
    }
    if (error.message.includes('lines_incomplete')) {
      return { ok: false, message: 'Falta marcar algún producto.' }
    }
    return { ok: false, message: GENERIC }
  }
  const result = (data ?? {}) as {
    status?: string
    differences?: Array<{
      name: string
      unit: string
      pack_label: string | null
      pack_size: number | null
      expected_packs: number
      received_packs: number
    }>
  }
  revalidateKitchen(slug)
  return {
    ok: true,
    status: result.status === 'with_differences' ? 'with_differences' : 'completed',
    differences: (result.differences ?? []).map((d) => ({
      name: d.name,
      unit: d.unit,
      packLabel: d.pack_label,
      packSize: d.pack_size == null ? null : Number(d.pack_size),
      expectedPacks: Number(d.expected_packs),
      receivedPacks: Number(d.received_packs),
    })),
  }
}
