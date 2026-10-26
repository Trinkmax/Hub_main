import 'server-only'
import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import {
  getPayment,
  type MercadoPagoPayment,
  searchPaymentsByReference,
} from '@/lib/mercadopago/client'
import { createServiceClient } from '@/lib/supabase/service'
import { getMercadoPagoCredentials } from './credentials'
import { mercadoPagoAmountToCents } from './pricing'
import type { OrderAttention, OrderStatus } from './types'

/**
 * Aplicar un pago de Mercado Pago a su pedido.
 *
 * Tres caminos llegan acá y los tres terminan en la MISMA función de la base
 * (ticketing_settle_order), que bloquea el pedido y crea la reserva una sola
 * vez:
 *   · el webhook de Mercado Pago (app/api/webhooks/mercadopago),
 *   · la vuelta del cliente a su entrada (trae el payment_id en la URL),
 *   · la entrada preguntando por su pedido cuando el webhook tarda.
 *
 * Nunca se confía en lo que trae el aviso: siempre se le pide el pago a la API
 * de Mercado Pago con el token del bar. Un webhook falso, como mucho, hace que
 * preguntemos de nuevo.
 *
 * Solo se llama desde Route Handlers y Server Actions (revalidatePath no se
 * puede usar durante el render de una página).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SettleSource = 'webhook' | 'return' | 'poll'

export type SettleOutcome =
  | {
      kind: 'settled'
      orderId: string
      status: OrderStatus
      reservationId: string | null
      newlyApproved: boolean
      attention: OrderAttention | null
    }
  | {
      kind: 'ignored'
      reason: 'no_reference' | 'order_not_found' | 'wrong_order' | 'not_connected' | 'no_payments'
    }

type SettleRpcResult = {
  order_id: string
  status: OrderStatus
  reservation_id: string | null
  newly_approved: boolean
  attention: OrderAttention | null
}

async function revalidateTenant(tenantId: string): Promise<void> {
  const service = createServiceClient()
  const { data } = await service.from('tenants').select('slug').eq('id', tenantId).maybeSingle()
  const slug = (data as { slug: string } | null)?.slug
  if (!slug) return
  // La reserva nueva tiene que aparecer al toque en la lista, el calendario
  // (cupo por servicio), el operativo y la pestaña Entradas; y la cartelera
  // tiene que dejar de ofrecer esos lugares.
  for (const path of [
    `/${slug}/reservas`,
    `/${slug}/eventos/programados`,
    `/${slug}/operativo`,
    `/${slug}/salon/reservas-operativo`,
    `/${slug}/entradas`,
  ]) {
    revalidatePath(path)
  }
  revalidatePath(`/entradas/${slug}`, 'layout')
}

export async function applyPayment(
  tenantId: string,
  payment: MercadoPagoPayment,
  source: SettleSource,
): Promise<SettleOutcome> {
  const ref = payment.external_reference ?? ''
  if (!UUID_RE.test(ref)) return { kind: 'ignored', reason: 'no_reference' }

  // Un pago en otra moneda no puede venir de nuestras preferencias (todas en
  // ARS); si pasara, va como «monto distinto» para que lo mire una persona.
  const paidCents =
    payment.currency_id && payment.currency_id !== 'ARS'
      ? 0
      : mercadoPagoAmountToCents(payment.transaction_amount)

  const service = createServiceClient()
  const { data, error } = await service.rpc('ticketing_settle_order', {
    p_tenant_id: tenantId,
    p_order_id: ref,
    p_payment_id: payment.id,
    p_mp_status: payment.status,
    p_mp_status_detail: payment.status_detail ?? null,
    p_payment_type: payment.payment_type_id ?? null,
    p_paid_cents: paidCents,
    p_paid_at: payment.date_approved ?? null,
  })
  if (error) {
    if (error.message.includes('ticketing_order_not_found')) {
      return { kind: 'ignored', reason: 'order_not_found' }
    }
    console.error('[ticketing.settle] ticketing_settle_order falló', {
      tenantId,
      orderId: ref,
      source,
      code: error.code,
    })
    throw new Error('No pudimos aplicar el pago.')
  }

  const result = data as SettleRpcResult
  if (result.newly_approved) {
    await logAudit({
      tenantId,
      userId: null,
      action: 'ticket_order.paid',
      entity: 'ticket_order',
      entityId: result.order_id,
      // Sin nombre ni teléfono (CLAUDE.md §9): ids, plata y de dónde vino.
      payload: {
        reservation_id: result.reservation_id,
        attention: result.attention,
        paid_cents: paidCents,
        payment_type: payment.payment_type_id ?? null,
        source,
      },
    })
  }
  if (
    result.status === 'refunded' &&
    (payment.status === 'refunded' || payment.status === 'charged_back')
  ) {
    await logAudit({
      tenantId,
      userId: null,
      action: 'ticket_order.refunded',
      entity: 'ticket_order',
      entityId: result.order_id,
      payload: { reservation_id: result.reservation_id, mp_status: payment.status, source },
    })
  }
  if (result.newly_approved || result.status === 'refunded') {
    await revalidateTenant(tenantId)
  }

  return {
    kind: 'settled',
    orderId: result.order_id,
    status: result.status,
    reservationId: result.reservation_id,
    newlyApproved: result.newly_approved,
    attention: result.attention,
  }
}

/** Un pago puntual (webhook o vuelta del cliente con ?payment_id=). */
export async function reconcilePaymentById(input: {
  tenantId: string
  paymentId: string
  /** Si viene, el pago tiene que ser de ESE pedido (la vuelta del cliente). */
  expectOrderId?: string
  source: SettleSource
}): Promise<SettleOutcome> {
  const creds = await getMercadoPagoCredentials(input.tenantId)
  if (!creds) return { kind: 'ignored', reason: 'not_connected' }
  const payment = await getPayment(creds.accessToken, input.paymentId)
  if (input.expectOrderId && payment.external_reference !== input.expectOrderId) {
    return { kind: 'ignored', reason: 'wrong_order' }
  }
  return applyPayment(input.tenantId, payment, input.source)
}

/**
 * Todos los pagos de un pedido, del más viejo al más nuevo: el estado final
 * queda bien aunque haya habido un rechazo antes del pago bueno, o una
 * devolución después.
 */
export async function reconcileOrder(input: {
  tenantId: string
  orderId: string
  source: SettleSource
}): Promise<SettleOutcome> {
  const creds = await getMercadoPagoCredentials(input.tenantId)
  if (!creds) return { kind: 'ignored', reason: 'not_connected' }
  const payments = await searchPaymentsByReference(creds.accessToken, input.orderId)
  if (payments.length === 0) return { kind: 'ignored', reason: 'no_payments' }

  const ordered = [...payments].sort((a, b) =>
    (a.date_created ?? '').localeCompare(b.date_created ?? ''),
  )
  let last: SettleOutcome = { kind: 'ignored', reason: 'no_payments' }
  for (const payment of ordered) {
    if (payment.external_reference !== input.orderId) continue
    last = await applyPayment(input.tenantId, payment, input.source)
  }
  return last
}
