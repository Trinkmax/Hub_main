'use server'

/**
 * Acciones "thin" para uso desde Client Components: envuelven los queries
 * read-only para invocarlos desde useEffect/useTransition sin exponer la
 * capa supabase al cliente.
 */

import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  getDayCapacitySnapshot,
  listScheduledEventsForDate,
  type ScheduledEventWithTemplate,
} from './queries'
import type { DayCapacityBucket } from './types'

async function authorizeRead(slug: string) {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner', 'cashier', 'waiter'])
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
