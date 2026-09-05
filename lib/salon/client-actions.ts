'use server'

/**
 * Acciones "thin" para uso desde Client Components: envuelven los queries
 * read-only para invocarlos desde useEffect/useTransition sin exponer la
 * capa supabase al cliente.
 */

import { z } from 'zod'
import { listRecentQrAwards, type RecentQrAward } from '@/lib/points/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  SALON_READ_ROLES,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { serviceDayEndIso, serviceDayStartIso } from './operativo'
import {
  getDayCapacitySnapshot,
  listScheduledEventsForDate,
  listTimelineForDate,
  type ScheduledEventWithTemplate,
} from './queries'
import type { DayCapacityBucket, ReservationWithJoins } from './types'

const operativoExtrasInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerIds: z.array(z.string().uuid()).max(200),
})

async function authorizeRead(slug: string) {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, SALON_READ_ROLES)
    return access
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    )
      return null
    throw error
  }
}

export async function fetchDayCapacity(
  slug: string,
  date: string,
): Promise<{ ok: true; buckets: DayCapacityBucket[] } | { ok: false; message: string }> {
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  try {
    const buckets = await getDayCapacitySnapshot({ tenantId: access.tenant.id, date })
    return { ok: true, buckets }
  } catch {
    return { ok: false, message: 'No pudimos leer la capacidad del día.' }
  }
}

export async function fetchScheduledEventsForDate(
  slug: string,
  date: string,
): Promise<{ ok: true; events: ScheduledEventWithTemplate[] } | { ok: false; message: string }> {
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  try {
    const events = await listScheduledEventsForDate({ tenantId: access.tenant.id, date })
    return { ok: true, events }
  } catch {
    return { ok: false, message: 'No pudimos leer los eventos.' }
  }
}

export async function fetchReservationsForDate(
  slug: string,
  date: string,
): Promise<{ ok: true; reservations: ReservationWithJoins[] } | { ok: false; message: string }> {
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  try {
    const reservations = await listTimelineForDate({ tenantId: access.tenant.id, date })
    return { ok: true, reservations }
  } catch {
    return { ok: false, message: 'No pudimos leer las reservas del día.' }
  }
}

/**
 * Capacidad + eventos del día en UNA server action. La timeline del salón los
 * pedía con dos actions separadas cada 30 s: dos invocaciones de función por
 * tick por dispositivo.
 */
export async function fetchDayExtras(
  slug: string,
  date: string,
): Promise<
  | { ok: true; buckets: DayCapacityBucket[]; events: ScheduledEventWithTemplate[] }
  | { ok: false; message: string }
> {
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  try {
    const [buckets, events] = await Promise.all([
      getDayCapacitySnapshot({ tenantId: access.tenant.id, date }),
      listScheduledEventsForDate({ tenantId: access.tenant.id, date }),
    ])
    return { ok: true, buckets, events }
  } catch {
    return { ok: false, message: 'No pudimos leer el día.' }
  }
}

/**
 * Todo lo que el tablero operativo refresca junto a las reservas: capacidad,
 * eventos y las acreditaciones de puntos del día de los socios con reserva.
 * Una sola invocación por tick, como `fetchDayExtras`.
 */
export async function fetchOperativoExtras(
  slug: string,
  date: string,
  customerIds: ReadonlyArray<string>,
): Promise<
  | {
      ok: true
      buckets: DayCapacityBucket[]
      events: ScheduledEventWithTemplate[]
      awards: RecentQrAward[]
    }
  | { ok: false; message: string }
> {
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  const parsed = operativoExtrasInputSchema.safeParse({ date, customerIds })
  if (!parsed.success) return { ok: false, message: 'Pedido inválido.' }
  try {
    const [buckets, events, awards] = await Promise.all([
      getDayCapacitySnapshot({ tenantId: access.tenant.id, date: parsed.data.date }),
      listScheduledEventsForDate({ tenantId: access.tenant.id, date: parsed.data.date }),
      listRecentQrAwards({
        tenantId: access.tenant.id,
        customerIds: parsed.data.customerIds,
        sinceIso: serviceDayStartIso(parsed.data.date),
        untilIso: serviceDayEndIso(parsed.data.date),
      }),
    ])
    return { ok: true, buckets, events, awards }
  } catch {
    return { ok: false, message: 'No pudimos leer el día.' }
  }
}
