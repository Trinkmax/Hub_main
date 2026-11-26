'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { NOTICE_EVENTS, type PosNotice, parseNotice } from '@/lib/pos/notices/types'
import { isAllowedPushEndpoint } from '@/lib/push/allowed'
import { createClient } from '@/lib/supabase/server'
import {
  POS_VIEW_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

/**
 * Notificaciones push de cada persona: anotar su navegador, darlo de baja y leer sus avisos.
 *
 * Todo corre con la sesión de quien pide (nunca con la clave de servicio): la base decide de quién es
 * cada suscripción (`push_subscribe`: el navegador pasa a ser de quien lo activa) y cada uno lee solo
 * sus avisos (`pos_notices`, por su política).
 */

type Result<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string }

type Access = { tenantId: string; userId: string; supabase: SupabaseClient }

async function authorize(slug: string): Promise<Access | { ok: false; message: string }> {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, POS_VIEW_ROLES)
    return {
      tenantId: access.tenant.id,
      userId: access.user.id,
      supabase: (await createClient()) as unknown as SupabaseClient,
    }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, message: 'Se cerró tu sesión. Volvé a entrar.' }
    }
    if (error instanceof RoleRequiredError || error instanceof TenantNotFoundError) {
      return { ok: false, message: 'No tenés permiso para hacer esto.' }
    }
    throw error
  }
}

/** La clave pública con la que el navegador se anota. `null` = el bar todavía no las tiene generadas. */
export async function pushPublicKey(slug: string): Promise<Result<string | null>> {
  const access = await authorize(slug)
  if ('ok' in access) return access
  const { data, error } = await access.supabase.rpc('push_public_key')
  if (error) {
    console.error('[push.key]', error.code)
    return { ok: false, message: 'No pude preparar los avisos. Probá de nuevo.' }
  }
  return { ok: true, data: typeof data === 'string' && data.length > 0 ? data : null }
}

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(20).max(200),
  auth: z.string().min(8).max(100),
  userAgent: z.string().max(300).optional(),
  /** Sin decir nada, se conserva lo que ese navegador ya tenía elegido. */
  events: z
    .array(z.enum(NOTICE_EVENTS as [string, ...string[]]))
    .max(2)
    .optional(),
})

/** Anotar (o volver a anotar) este navegador para quien está entrando. */
export async function savePushSubscription(
  slug: string,
  input: z.input<typeof subscriptionSchema>,
): Promise<Result> {
  const access = await authorize(slug)
  if ('ok' in access) return access
  const parsed = subscriptionSchema.safeParse(input)
  // Solo servicios de push de verdad: el servidor le va a escribir a esa dirección.
  if (!parsed.success || !isAllowedPushEndpoint(parsed.data.endpoint)) {
    return { ok: false, message: 'Este navegador no devolvió una suscripción válida.' }
  }
  const { error } = await access.supabase.rpc('push_subscribe', {
    p_tenant_id: access.tenantId,
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth: parsed.data.auth,
    p_user_agent: parsed.data.userAgent ?? null,
    p_events: parsed.data.events ?? null,
  })
  if (error) {
    console.error('[push.subscribe]', error.code)
    return { ok: false, message: 'No pude guardar los avisos de este equipo. Probá de nuevo.' }
  }
  return { ok: true }
}

/** Activar los avisos por primera vez en un equipo: además de anotarlo, queda quién fue. */
export async function enablePush(
  slug: string,
  input: z.input<typeof subscriptionSchema>,
): Promise<Result> {
  const saved = await savePushSubscription(slug, input)
  if (!saved.ok) return saved
  const access = await authorize(slug)
  if ('ok' in access) return access
  await logAudit({
    tenantId: access.tenantId,
    userId: access.userId,
    action: 'pos.push_enabled',
    entity: 'push_subscription',
    payload: { events: input.events ?? null },
  })
  return { ok: true }
}

/** Dejar de recibir en este navegador (al apagar los avisos o al cerrar sesión). */
export async function removePushSubscription(slug: string, endpoint: string): Promise<Result> {
  const access = await authorize(slug)
  if ('ok' in access) return access
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2000) {
    return { ok: false, message: 'Falta el equipo a dar de baja.' }
  }
  const { error } = await access.supabase.rpc('push_unsubscribe', { p_endpoint: endpoint })
  if (error) {
    console.error('[push.unsubscribe]', error.code)
    return { ok: false, message: 'No pude apagar los avisos. Probá de nuevo.' }
  }
  return { ok: true }
}

/**
 * Los avisos de cocina de quien pide, desde un momento: lo que pudo perderse con la app atrás o el
 * canal en vivo caído. La política de la tabla deja leer solo los propios.
 */
export async function recentNotices(slug: string, sinceIso: string): Promise<Result<PosNotice[]>> {
  const access = await authorize(slug)
  if ('ok' in access) return access
  const since = Date.parse(sinceIso)
  if (!Number.isFinite(since)) return { ok: false, message: 'Fecha inválida.' }
  // Nunca más de un rato para atrás: un aviso de hace media hora ya no sirve.
  const floor = Date.now() - 10 * 60_000
  const { data, error } = await access.supabase
    .from('pos_notices')
    .select(
      'id, user_id, session_id, kind, station_id, station_name, station_kind, station_icon, table_label, alias, items, units, created_at',
    )
    .eq('tenant_id', access.tenantId)
    .eq('user_id', access.userId)
    .gt('created_at', new Date(Math.max(since, floor)).toISOString())
    // Los más nuevos: si hubo muchos mientras la app estuvo atrás, los que importan son los últimos.
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) {
    console.error('[push.notices]', error.code)
    return { ok: false, message: 'No pude leer los avisos.' }
  }
  const notices = (data ?? [])
    .map((row) => parseNotice(row))
    .filter((notice): notice is PosNotice => notice !== null)
    .reverse()
  return { ok: true, data: notices }
}
