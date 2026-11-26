import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isAllowedPushEndpoint } from '@/lib/push/allowed'
import { getVapid } from '@/lib/push/vapid'
import {
  buildPushRequest,
  type PushOutcome,
  type PushRequest,
  pushOutcome,
  type VapidDetails,
} from '@/lib/push/web-push'
import { createServiceClient } from '@/lib/supabase/service'
import {
  emptyTally,
  NOT_PUSHED,
  type NoticePush,
  noticePush,
  type PushTally,
  pushesNotice,
  pushResultLabel,
  subscriptionFate,
} from './push-payload'
import { noticeEvent, type PosNotice, parseNotice } from './types'

/**
 * Las notificaciones push de los avisos de cocina (`pos_notices`).
 *
 * Lo llama la base: el disparador que escribe los avisos le pega a `/api/cron/pos-push` con los que
 * acaba de escribir. Corre con la clave de servicio (acá no hay nadie con sesión), siempre con el bar
 * de cada aviso a la vista (`tenant_id` en cada consulta que sigue al reclamo).
 *
 * Primero se reclama y después se manda: un aviso se marca como enviado (`pushed_at`) ANTES de salir,
 * y lo manda solo quien logró marcarlo. Si dos llamadas se cruzan, el mozo recibe una sola
 * notificación. El precio es que un aviso reclamado que no llegó a salir no se reintenta: un «para
 * retirar» repetido o a destiempo molesta más que uno que falta, y el aviso igual está en la app.
 *
 * En los logs van cantidades y códigos de respuesta, nunca un endpoint ni un nombre.
 */

/** Sin ids, se barre lo que quedó sin mandar en los últimos minutos. */
const SWEEP_WINDOW_MS = 3 * 60_000
const SWEEP_LIMIT = 50
/** De a cuántos avisos se trabaja: mantiene cortas las direcciones de las consultas (`id=in.(…)`). */
const BATCH = 100
const CONCURRENCY = 10
const SEND_TIMEOUT_MS = 8_000
const KEEP_DAYS = 7
/** Una de cada tantas llamadas, de paso, borra los avisos viejos. */
const HOUSEKEEPING_EVERY = 40

export type PushNoticesResult = {
  notices: number
  sent: number
  gone: number
  failed: number
  skipped: number
}

type Notice = PosNotice & { tenant_id: string }

type Subscription = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth_key: string
  events: string[] | null
  failures: number | null
}

type Send = { notice: Notice; subscription: Subscription; message: NoticePush }
type Sent = { send: Send; outcome: PushOutcome; status: number | null }

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let start = 0; start < list.length; start += size) out.push(list.slice(start, start + size))
  return out
}

function groupBy<T, K>(list: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of list) {
    const group = groups.get(key(item))
    if (group) group.push(item)
    else groups.set(key(item), [item])
  }
  return groups
}

/** Corre `work` sobre todos, de a `limit` a la vez. `work` no tiene que fallar. */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Una escritura de las que quedan para después del envío: si falla, se anota y se sigue. */
async function settle(
  what: string,
  query: PromiseLike<{ error: { code?: string } | null }>,
): Promise<void> {
  try {
    const { error } = await query
    if (error) console.error(`[pos.push] no se pudo anotar ${what}:`, error.code || 'sin código')
  } catch {
    console.error(`[pos.push] no se pudo anotar ${what}`)
  }
}

/** Los avisos a mandar: los que vinieron pedidos o, sin pedido, los recientes que quedaron colgados. */
async function wantedIds(
  service: SupabaseClient,
  ids: string[] | null,
  now: Date,
): Promise<string[]> {
  if (ids && ids.length > 0) return [...new Set(ids)]
  const since = new Date(now.getTime() - SWEEP_WINDOW_MS).toISOString()
  const { data, error } = await service
    .from('pos_notices')
    .select('id')
    .is('pushed_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(SWEEP_LIMIT)
  if (error) throw new Error(`pos_notices: ${error.message}`)
  return ((data ?? []) as { id: string }[]).map((row) => row.id)
}

/** Marca los avisos como enviados y devuelve solo los que marcó esta llamada. */
async function claim(service: SupabaseClient, ids: string[], now: Date): Promise<Notice[]> {
  const { data, error } = await service
    .from('pos_notices')
    .update({ pushed_at: now.toISOString() })
    .in('id', ids)
    .is('pushed_at', null)
    .select('*')
  if (error) throw new Error(`pos_notices: ${error.message}`)
  const notices: Notice[] = []
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const notice = parseNotice(row)
    if (notice && typeof row.tenant_id === 'string') {
      notices.push({ ...notice, tenant_id: row.tenant_id })
    }
  }
  return notices
}

async function send(vapid: VapidDetails, item: Send): Promise<Sent> {
  const { subscription, message } = item
  let request: PushRequest
  try {
    request = buildPushRequest({
      subscription: {
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth_key,
      },
      payload: JSON.stringify(message.payload),
      vapid,
      ttlSeconds: message.ttlSeconds,
      urgency: message.urgency,
      topic: message.topic,
    })
  } catch {
    // Las claves de esa suscripción no sirven (las del servidor ya se probaron al leerlas).
    return { send: item, outcome: 'failed', status: null }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  try {
    const response = await fetch(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      // Un servicio de push no redirige: si lo hace, no se lo sigue a ningún lado.
      redirect: 'manual',
      cache: 'no-store',
    })
    // La respuesta no se lee, pero hay que soltarla para que la conexión quede libre.
    await response.body?.cancel().catch(() => undefined)
    return { send: item, outcome: pushOutcome(response.status), status: response.status }
  } catch {
    // Sin respuesta: se cortó la red o pasaron los 8 segundos.
    return { send: item, outcome: 'failed', status: null }
  } finally {
    clearTimeout(timer)
  }
}

/** Deja en cada aviso cómo le fue (`push_result`), juntando en una escritura los que dicen lo mismo. */
async function noteResults(
  service: SupabaseClient,
  tenantId: string,
  results: Map<string, string>,
): Promise<void> {
  const byResult = groupBy([...results], ([, result]) => result)
  await Promise.all(
    [...byResult].map(([push_result, entries]) =>
      settle(
        'el resultado de un aviso',
        service
          .from('pos_notices')
          .update({ push_result })
          .eq('tenant_id', tenantId)
          .in(
            'id',
            entries.map(([id]) => id),
          ),
      ),
    ),
  )
}

/** Manda los avisos ya reclamados de UN bar y deja anotado cómo le fue a cada uno. */
async function deliverTenant(
  service: SupabaseClient,
  vapid: VapidDetails,
  tenantId: string,
  notices: Notice[],
  now: Date,
  failedBy: Map<string, number>,
): Promise<PushTally> {
  const total = emptyTally()
  const users = [...new Set(notices.map((notice) => notice.user_id))]
  const [tenant, subscriptions] = await Promise.all([
    service.from('tenants').select('id, slug').eq('id', tenantId).maybeSingle(),
    service
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth_key, events, failures')
      .eq('tenant_id', tenantId)
      .in('user_id', users),
  ])
  const slug = (tenant.data as { slug?: string | null } | null)?.slug
  if (tenant.error || subscriptions.error || !slug) {
    console.error(
      '[pos.push] no se pudo leer el bar o sus suscripciones:',
      tenant.error?.code || subscriptions.error?.code || 'sin bar',
    )
    await noteResults(service, tenantId, new Map(notices.map((notice) => [notice.id, 'error'])))
    return total
  }

  const byUser = groupBy((subscriptions.data ?? []) as Subscription[], (row) => row.user_id)
  const tallies = new Map(notices.map((notice) => [notice, emptyTally()]))
  const sends: Send[] = []
  for (const [notice, tally] of tallies) {
    // Solo «para retirar» llega como notificación; el resto se ve con la app abierta.
    if (!pushesNotice(notice.kind)) continue
    const event = noticeEvent(notice.kind)
    const message = noticePush(notice, slug)
    for (const subscription of byUser.get(notice.user_id) ?? []) {
      if (!(subscription.events ?? []).includes(event)) continue
      if (!isAllowedPushEndpoint(subscription.endpoint)) {
        // Un endpoint que no es de un servicio de push conocido no se toca.
        tally.skip += 1
        total.skip += 1
        continue
      }
      sends.push({ notice, subscription, message })
    }
  }

  const sent = await pool(sends, CONCURRENCY, (item) => send(vapid, item))

  for (const { send: item, outcome, status } of sent) {
    const column = outcome === 'failed' ? 'fail' : outcome
    const tally = tallies.get(item.notice)
    if (tally) tally[column] += 1
    total[column] += 1
    if (outcome === 'failed') {
      const reason = status === null ? 'sin respuesta' : String(status)
      failedBy.set(reason, (failedBy.get(reason) ?? 0) + 1)
    }
  }

  // Qué queda de cada suscripción después de esta vuelta: sana, con una falla más, o dada de baja.
  const healthy: string[] = []
  const removed: string[] = []
  const failing = new Map<number, string[]>()
  for (const [subscription, results] of groupBy(sent, (result) => result.send.subscription)) {
    const fate = subscriptionFate(
      results.map((result) => result.outcome),
      subscription.failures ?? 0,
    )
    if (fate?.action === 'ok') healthy.push(subscription.id)
    else if (fate?.action === 'delete') removed.push(subscription.id)
    else if (fate?.action === 'fail') {
      failing.set(fate.failures, [...(failing.get(fate.failures) ?? []), subscription.id])
    }
  }

  const writes: Promise<void>[] = [
    noteResults(
      service,
      tenantId,
      new Map(
        [...tallies].map(([notice, tally]) => [
          notice.id,
          pushesNotice(notice.kind) ? pushResultLabel(tally) : NOT_PUSHED,
        ]),
      ),
    ),
  ]
  if (healthy.length > 0) {
    writes.push(
      settle(
        'los envíos que salieron',
        service
          .from('push_subscriptions')
          .update({ last_ok_at: now.toISOString(), failures: 0 })
          .eq('tenant_id', tenantId)
          .in('id', healthy),
      ),
    )
  }
  if (removed.length > 0) {
    writes.push(
      settle(
        'las suscripciones dadas de baja',
        service.from('push_subscriptions').delete().eq('tenant_id', tenantId).in('id', removed),
      ),
    )
  }
  for (const [failures, ids] of failing) {
    writes.push(
      settle(
        'los envíos que fallaron',
        service
          .from('push_subscriptions')
          .update({ failures })
          .eq('tenant_id', tenantId)
          .in('id', ids),
      ),
    )
  }
  await Promise.all(writes)
  return total
}

/**
 * Manda las notificaciones push de esos avisos (o, sin ids, de los recientes que quedaron sin mandar)
 * a los teléfonos de quien atiende cada mesa. Devuelve cuántos avisos reclamó y cómo salieron los
 * envíos: los que el servicio aceptó, los que dieron con una suscripción dada de baja (se borra), los
 * que fallaron y los que se saltearon por tener un endpoint que no es de un servicio de push.
 */
export async function pushNotices(ids: string[] | null): Promise<PushNoticesResult> {
  const service = createServiceClient() as unknown as SupabaseClient
  // Las claves van antes de reclamar nada: si falta configuración, los avisos no se queman.
  const vapid = await getVapid(service)
  const now = new Date()
  const result: PushNoticesResult = { notices: 0, sent: 0, gone: 0, failed: 0, skipped: 0 }
  const failedBy = new Map<string, number>()

  for (const batch of chunks(await wantedIds(service, ids, now), BATCH)) {
    const notices = await claim(service, batch, now)
    result.notices += notices.length
    for (const [tenantId, list] of groupBy(notices, (notice) => notice.tenant_id)) {
      try {
        const tally = await deliverTenant(service, vapid, tenantId, list, now, failedBy)
        result.sent += tally.ok
        result.gone += tally.gone
        result.failed += tally.fail
        result.skipped += tally.skip
      } catch (error) {
        // Lo de este bar ya estaba reclamado y no se reintenta; lo de los demás tiene que salir igual.
        console.error(
          '[pos.push] un bar quedó sin mandar:',
          error instanceof Error ? error.name : 'error',
        )
      }
    }
  }

  if (result.failed > 0 || result.skipped > 0) {
    console.error(
      `[pos.push] avisos:${result.notices} ok:${result.sent} gone:${result.gone} fail:${result.failed} skip:${result.skipped}`,
      Object.fromEntries(failedBy),
    )
  }

  if (Math.random() < 1 / HOUSEKEEPING_EVERY) {
    // Limpieza de toda la plataforma (por eso no lleva bar): los avisos son de minutos, no de semanas.
    const before = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString()
    await settle(
      'la limpieza de avisos viejos',
      service.from('pos_notices').delete().lt('created_at', before),
    )
  }

  return result
}
