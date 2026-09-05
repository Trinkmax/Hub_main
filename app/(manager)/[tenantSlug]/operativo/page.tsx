import type { Viewport } from 'next'
import { notFound } from 'next/navigation'
import { resolveEarnRate } from '@/lib/points/earn-rate'
import { listRecentQrAwards, listRules } from '@/lib/points/queries'
import { serviceDayEndIso, serviceDayInCordoba, serviceDayStartIso } from '@/lib/salon/operativo'
import {
  getDayCapacitySnapshot,
  listScheduledEventsForDate,
  listTimelineForDate,
} from '@/lib/salon/queries'
import {
  RESERVATION_OPERATOR_ROLES,
  RESERVATION_STAFF_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { REDEMPTION_STAFF_ROLES } from '@/lib/tenant/roles'
import { OperativoBoard } from './_components/operativo-board'

export const metadata = { title: 'Operativo' }
export const dynamic = 'force-dynamic'

// La pantalla se usa como app (acceso directo en el celular): con `cover` el
// fondo llega hasta los bordes y `env(safe-area-inset-*)` deja de valer 0.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5edd7' },
    { media: '(prefers-color-scheme: dark)', color: '#0f2a20' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

/** 'YYYY-MM-DD' que además exista en el calendario (2026-02-30 no). */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d || y < 2000 || y > 2100) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * El tablero de la noche.
 *
 * Todo lo que el server hace es autorizar y traer el primer paint; de ahí en
 * adelante el tablero vive en el cliente con Realtime (ver OperativoBoard).
 * "Hoy" es el DÍA DE SERVICIO: hasta las 5 AM sigue siendo la noche anterior.
 */
export default async function OperativoPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ tenantSlug }, sp] = await Promise.all([params, searchParams])

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, RESERVATION_STAFF_ROLES)
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const today = serviceDayInCordoba()
  const date = typeof sp.date === 'string' && isRealDate(sp.date) ? sp.date : today
  const tenantId = access.tenant.id

  const [reservations, capacity, events, rules] = await Promise.all([
    listTimelineForDate({ tenantId, date }),
    getDayCapacitySnapshot({ tenantId, date }),
    listScheduledEventsForDate({ tenantId, date }),
    listRules({ tenantId }),
  ])

  // Acreditaciones de puntos de ESTA noche para los socios que tienen reserva:
  // así la pantalla no ofrece "sumar puntos" como si nada a una mesa que ya
  // pagó. Depende de las reservas, por eso va después del Promise.all.
  const customerIds = Array.from(
    new Set(reservations.map((r) => r.customer_id).filter((id): id is string => Boolean(id))),
  )
  const awards =
    customerIds.length > 0
      ? await listRecentQrAwards({
          tenantId,
          customerIds,
          sinceIso: serviceDayStartIso(date),
          untilIso: serviceDayEndIso(date),
        })
      : []

  return (
    <OperativoBoard
      tenantSlug={tenantSlug}
      tenantId={tenantId}
      role={access.role}
      date={date}
      today={today}
      initialReservations={reservations}
      initialCapacity={capacity}
      initialEvents={events}
      initialAwards={awards}
      earnRate={resolveEarnRate(rules)}
      canOperate={(RESERVATION_OPERATOR_ROLES as ReadonlyArray<string>).includes(access.role)}
      canAward={(REDEMPTION_STAFF_ROLES as ReadonlyArray<string>).includes(access.role)}
      canLink={(RESERVATION_STAFF_ROLES as ReadonlyArray<string>).includes(access.role)}
      isOwner={access.role === 'owner'}
    />
  )
}
