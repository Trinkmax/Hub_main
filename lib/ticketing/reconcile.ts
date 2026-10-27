import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { reconcileOrder } from './settle'

/**
 * La red de abajo de las entradas online: cada 15 minutos (gated en
 * lib/cron/dispatch.ts) se le pregunta a Mercado Pago por los pedidos que
 * siguen sin pagar y cuyo lugar venció hace poco. Atrapa los pagos que el
 * webhook no aplicó (una caída nuestra, una firma mal configurada) cuando la
 * persona además cerró Mercado Pago sin volver a su entrada.
 *
 * Ventana: la preferencia vence junto con el lugar (no se puede pagar
 * después), así que alcanza con mirar hasta 90 minutos después del
 * vencimiento. Los pedidos recién creados (menos de 2 minutos) se dejan: los
 * está resolviendo el webhook o la vuelta del cliente.
 */
export async function reconcileRecentTicketOrders(
  limit = 40,
  now: Date = new Date(),
): Promise<{ checked: number; approved: number; failed: number }> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('ticket_orders')
    .select('id, tenant_id')
    .in('status', ['pending', 'rejected'])
    .not('mp_preference_id', 'is', null)
    .lt('created_at', new Date(now.getTime() - 2 * 60_000).toISOString())
    .gt('hold_expires_at', new Date(now.getTime() - 90 * 60_000).toISOString())
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) {
    console.error('[ticketing.reconcile] no pudimos listar pedidos', { code: error.code })
    return { checked: 0, approved: 0, failed: 0 }
  }

  let approved = 0
  let failed = 0
  const rows = (data as Array<{ id: string; tenant_id: string }> | null) ?? []
  for (const row of rows) {
    try {
      const outcome = await reconcileOrder({
        tenantId: row.tenant_id,
        orderId: row.id,
        source: 'cron',
      })
      if (outcome.kind === 'settled' && outcome.newlyApproved) approved += 1
    } catch (e) {
      failed += 1
      console.error('[ticketing.reconcile] no pudimos conciliar un pedido', {
        tenantId: row.tenant_id,
        orderId: row.id,
        error: (e as Error).message,
      })
    }
  }
  return { checked: rows.length, approved, failed }
}
