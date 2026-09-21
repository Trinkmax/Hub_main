'use server'

/**
 * Acciones "thin" para uso desde Client Components: envuelven los queries
 * read-only para invocarlos desde useEffect/useTransition sin exponer la
 * capa supabase al cliente.
 *
 * La fecha se valida con zod ANTES de autorizar: una server action es un
 * endpoint público y un `date` roto llegaba hasta Postgres como error crudo.
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
import { getDaySegmentCaps } from './segment-queries'
import { dayRequestSchema, isoDaySchema } from './segment-schemas'
import type { DaySegmentCaps } from './segments'
import type { DayCapacityBucket, ReservationWithJoins } from './types'

const operativoExtrasInputSchema = z.object({
  date: isoDaySchema,
  customerIds: z.array(z.string().uuid()).max(200),
})

const INVALID_DATE = 'La fecha no es válida.'

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
  const parsed = dayRequestSchema.safeParse({ date })
  if (!parsed.success) return { ok: false, message: INVALID_DATE }
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  try {
    const buckets = await getDayCapacitySnapshot({
      tenantId: access.tenant.id,
      date: parsed.data.date,
    })
    return { ok: true, buckets }
  } catch {
    return { ok: false, message: 'No pudimos leer la capacidad del día.' }
  }
}

export async function fetchScheduledEventsForDate(
  slug: string,
  date: string,
): Promise<{ ok: true; events: ScheduledEventWithTemplate[] } | { ok: false; message: string }> {
  const parsed = dayRequestSchema.safeParse({ date })
  if (!parsed.success) return { ok: false, message: INVALID_DATE }
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  try {
    const events = await listScheduledEventsForDate({
      tenantId: access.tenant.id,
      date: parsed.data.date,
    })
    return { ok: true, events }
  } catch {
    return { ok: false, message: 'No pudimos leer los eventos.' }
  }
}

export async function fetchReservationsForDate(
  slug: string,
  date: string,
): Promise<{ ok: true; reservations: ReservationWithJoins[] } | { ok: false; message: string }> {
  const parsed = dayRequestSchema.safeParse({ date })
  if (!parsed.success) return { ok: false, message: INVALID_DATE }
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  try {
    const reservations = await listTimelineForDate({
      tenantId: access.tenant.id,
      date: parsed.data.date,
    })
    return { ok: true, reservations }
  } catch {
    return { ok: false, message: 'No pudimos leer las reservas del día.' }
  }
}

/**
 * Capacidad + eventos + cupos por servicio del día en UNA server action. La
 * timeline del salón los pedía con dos actions separadas cada 30 s: dos
 * invocaciones de función por tick por dispositivo.
 *
 * `caps` son los cupos RESUELTOS (almuerzo/merienda/cena): la cuenta por
 * servicio corre en el cliente sobre las reservas que ya llegan por Realtime,
 * así queda en vivo con la misma función que el calendario. `buckets` sigue
 * para las barras por evento (event:*).
 */
export async function fetchDayExtras(
  slug: string,
  date: string,
): Promise<
  | {
      ok: true
      buckets: DayCapacityBucket[]
      events: ScheduledEventWithTemplate[]
      caps: DaySegmentCaps
    }
  | { ok: false; message: string }
> {
  const parsed = dayRequestSchema.safeParse({ date })
  if (!parsed.success) return { ok: false, message: INVALID_DATE }
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  const tenantId = access.tenant.id
  try {
    const [buckets, events, caps] = await Promise.all([
      getDayCapacitySnapshot({ tenantId, date: parsed.data.date }),
      listScheduledEventsForDate({ tenantId, date: parsed.data.date }),
      getDaySegmentCaps({ tenantId, date: parsed.data.date }),
    ])
    return { ok: true, buckets, events, caps }
  } catch {
    return { ok: false, message: 'No pudimos leer el día.' }
  }
}

/**
 * Todo lo que el tablero operativo refresca junto a las reservas: capacidad,
 * eventos, cupos por servicio y las acreditaciones de puntos del día de los
 * socios con reserva. Una sola invocación por tick, como `fetchDayExtras`.
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
      caps: DaySegmentCaps
    }
  | { ok: false; message: string }
> {
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  const parsed = operativoExtrasInputSchema.safeParse({ date, customerIds })
  if (!parsed.success) return { ok: false, message: 'Pedido inválido.' }
  try {
    const [buckets, events, awards, caps] = await Promise.all([
      getDayCapacitySnapshot({ tenantId: access.tenant.id, date: parsed.data.date }),
      listScheduledEventsForDate({ tenantId: access.tenant.id, date: parsed.data.date }),
      listRecentQrAwards({
        tenantId: access.tenant.id,
        customerIds: parsed.data.customerIds,
        sinceIso: serviceDayStartIso(parsed.data.date),
        untilIso: serviceDayEndIso(parsed.data.date),
      }),
      getDaySegmentCaps({ tenantId: access.tenant.id, date: parsed.data.date }),
    ])
    return { ok: true, buckets, events, awards, caps }
  } catch {
    return { ok: false, message: 'No pudimos leer el día.' }
  }
}
