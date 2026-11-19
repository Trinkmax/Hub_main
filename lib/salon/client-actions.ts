'use server'

/**
 * Acciones "thin" para uso desde Client Components: envuelven los queries
 * read-only para invocarlos desde useEffect/useTransition sin exponer la
 * capa supabase al cliente.
 *
 * La fecha se valida con zod ANTES de autorizar: una server action es un
 * endpoint público y un `date` roto llegaba hasta Postgres como error crudo.
 *
 * La sucursal (docs/features/sucursales.md › La regla para cada pantalla, punto 2):
 * el navegador manda el filtro con el que se dibujó la pantalla y acá se recorta a
 * lo que la persona ve hoy (`clampBranchFilter`). Nunca se relee la cookie: si otra
 * pestaña cambió de sucursal, esta pantalla no cambia de datos sin cambiar de título.
 */

import { z } from 'zod'
import { type BranchFilter, clampBranchFilter } from '@/lib/branches/filter'
import { getBranchScope } from '@/lib/branches/scope'
import { listRecentQrAwards, type RecentQrAward } from '@/lib/points/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  SALON_READ_ROLES,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { segmentScopeFromFilter } from './branch-scope'
import { serviceDayEndIso, serviceDayStartIso } from './operativo'
import {
  listScheduledEventsForDate,
  listTimelineForDate,
  type ScheduledEventWithTemplate,
} from './queries'
import { getDaySegmentCaps } from './segment-queries'
import { dayRequestSchema, isoDaySchema } from './segment-schemas'
import type { DaySegmentCaps } from './segments'
import type { ReservationWithJoins } from './types'

const operativoExtrasInputSchema = z.object({
  date: isoDaySchema,
  customerIds: z.array(z.string().uuid()).max(200),
})

/** El filtro que manda el navegador: `null` = todo el bar; si no, ids de sucursal. */
const branchFilterSchema = z
  .object({ ids: z.array(z.uuid()).max(50).nullable() })
  .nullable()
  .optional()

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

/**
 * El filtro pedido, recortado a las sucursales de la persona (vale igual para el panel y el salón: lo que se recorta
 * son SUS sucursales, no lo que mira). `undefined` (un llamador que no sabe de sucursales) se trata como «lo que puede
 * ver»: nunca se cuela una sucursal ajena.
 */
async function readBranch(slug: string, requested: unknown) {
  const parsed = branchFilterSchema.safeParse(requested)
  if (!parsed.success) return null
  const scope = await getBranchScope(slug)
  return { filter: clampBranchFilter(parsed.data ?? null, scope), branches: scope.branches }
}

export async function fetchScheduledEventsForDate(
  slug: string,
  date: string,
  branch?: BranchFilter | null,
): Promise<{ ok: true; events: ScheduledEventWithTemplate[] } | { ok: false; message: string }> {
  const parsed = dayRequestSchema.safeParse({ date })
  if (!parsed.success) return { ok: false, message: INVALID_DATE }
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  try {
    const scoped = await readBranch(slug, branch)
    if (!scoped) return { ok: false, message: 'Pedido inválido.' }
    const events = await listScheduledEventsForDate({
      tenantId: access.tenant.id,
      date: parsed.data.date,
      branch: scoped.filter,
    })
    return { ok: true, events }
  } catch {
    return { ok: false, message: 'No pudimos leer los eventos.' }
  }
}

export async function fetchReservationsForDate(
  slug: string,
  date: string,
  branch?: BranchFilter | null,
): Promise<{ ok: true; reservations: ReservationWithJoins[] } | { ok: false; message: string }> {
  const parsed = dayRequestSchema.safeParse({ date })
  if (!parsed.success) return { ok: false, message: INVALID_DATE }
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  try {
    const scoped = await readBranch(slug, branch)
    if (!scoped) return { ok: false, message: 'Pedido inválido.' }
    const reservations = await listTimelineForDate({
      tenantId: access.tenant.id,
      date: parsed.data.date,
      branch: scoped.filter,
    })
    return { ok: true, reservations }
  } catch {
    return { ok: false, message: 'No pudimos leer las reservas del día.' }
  }
}

/**
 * Eventos + cupos por servicio del día en UNA server action: la timeline del
 * salón los refresca cada 30 s y dos invocaciones por tick por dispositivo eran
 * de más.
 *
 * `caps` son los cupos RESUELTOS (almuerzo/merienda/cena) de la sucursal del
 * dispositivo: la cuenta por servicio corre en el cliente sobre las reservas que
 * ya llegan por Realtime, así queda en vivo con la misma función que el
 * calendario. La gente de cada evento sale de esa misma cuenta (`eventUsedById`):
 * ya no se pide `evaluate_day_capacity`, que no sabe de sucursales.
 */
export async function fetchDayExtras(
  slug: string,
  date: string,
  branch?: BranchFilter | null,
): Promise<
  | {
      ok: true
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
    const scoped = await readBranch(slug, branch)
    if (!scoped) return { ok: false, message: 'Pedido inválido.' }
    const segmentScope = segmentScopeFromFilter(scoped.filter, scoped.branches)
    const [events, caps] = await Promise.all([
      listScheduledEventsForDate({ tenantId, date: parsed.data.date, branch: scoped.filter }),
      getDaySegmentCaps({ tenantId, date: parsed.data.date, scope: segmentScope }),
    ])
    return { ok: true, events, caps }
  } catch {
    return { ok: false, message: 'No pudimos leer el día.' }
  }
}

/**
 * Todo lo que el tablero operativo refresca junto a las reservas: eventos, cupos
 * por servicio y las acreditaciones de puntos del día de los socios con reserva.
 * Una sola invocación por tick, como `fetchDayExtras`.
 */
export async function fetchOperativoExtras(
  slug: string,
  date: string,
  customerIds: ReadonlyArray<string>,
  branch?: BranchFilter | null,
): Promise<
  | {
      ok: true
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
    const scoped = await readBranch(slug, branch)
    if (!scoped) return { ok: false, message: 'Pedido inválido.' }
    const segmentScope = segmentScopeFromFilter(scoped.filter, scoped.branches)
    const [events, awards, caps] = await Promise.all([
      listScheduledEventsForDate({
        tenantId: access.tenant.id,
        date: parsed.data.date,
        branch: scoped.filter,
      }),
      listRecentQrAwards({
        tenantId: access.tenant.id,
        customerIds: parsed.data.customerIds,
        sinceIso: serviceDayStartIso(parsed.data.date),
        untilIso: serviceDayEndIso(parsed.data.date),
      }),
      getDaySegmentCaps({
        tenantId: access.tenant.id,
        date: parsed.data.date,
        scope: segmentScope,
      }),
    ])
    return { ok: true, events, awards, caps }
  } catch {
    return { ok: false, message: 'No pudimos leer el día.' }
  }
}
