import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { exportFilename, reservationsToCsv } from '@/lib/salon/export'
import { listSalonReservationsForExport } from '@/lib/salon/queries'
import { mealTypeEnum, salonStatusEnum, salonZoneEnum } from '@/lib/salon/schemas'
import {
  RESERVATION_STAFF_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Descarga el listado de reservas como planilla (CSV para Excel/Sheets).
 *
 * Recibe los MISMOS parámetros que la página de reservas (día o rango, y los
 * filtros activos) y devuelve todo lo que cumple, sin paginar, ordenado por
 * fecha, hora y nombre. Es un GET con `Content-Disposition: attachment` para
 * que el botón sea un link común y funcione igual en el celular.
 *
 * Es PII (nombres y teléfonos): solo dueño, caja y anfitrión, y queda en
 * audit_log con el período y la cantidad (nunca con los datos).
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const slug = url.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'missing_slug' }, { status: 400 })

  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, RESERVATION_STAFF_ROLES)

    const p = url.searchParams
    const day = p.get('day')
    const from = p.get('from')
    const to = p.get('to')
    const rangeMode = Boolean(from || to)
    const dateFrom = rangeMode ? from : day
    const dateTo = rangeMode ? to : day
    if ((dateFrom && !DATE_RE.test(dateFrom)) || (dateTo && !DATE_RE.test(dateTo))) {
      return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
    }

    const status = salonStatusEnum.safeParse(p.get('status'))
    const zone = salonZoneEnum.safeParse(p.get('zone'))
    const mealType = mealTypeEnum.safeParse(p.get('servicio'))
    const managerRaw = p.get('manager')
    const managerId = managerRaw && UUID_RE.test(managerRaw) ? managerRaw : undefined
    const q = p.get('q')?.trim() || undefined

    const { rows, truncated } = await listSalonReservationsForExport({
      tenantId: access.tenant.id,
      dateFrom: dateFrom ?? undefined,
      dateTo: dateTo ?? undefined,
      status: status.success ? status.data : undefined,
      zone: zone.success ? zone.data : undefined,
      mealType: mealType.success ? mealType.data : undefined,
      managerId,
      q,
    })

    const csv = reservationsToCsv(rows)
    const filename = exportFilename(access.tenant.slug, {
      from: dateFrom ?? undefined,
      to: dateTo ?? undefined,
    })

    await logAudit({
      tenantId: access.tenant.id,
      userId: access.user.id,
      action: 'salon_reservations.exported',
      entity: 'salon_reservation',
      payload: {
        from: dateFrom ?? null,
        to: dateTo ?? null,
        status: status.success ? status.data : null,
        zone: zone.success ? zone.data : null,
        meal_type: mealType.success ? mealType.data : null,
        manager_id: managerId ?? null,
        with_query: Boolean(q),
        rows: rows.length,
        truncated,
      },
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        ...(truncated ? { 'X-Export-Truncated': 'true' } : {}),
      },
    })
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    console.error('[reservas.export] falló la exportación', {
      slug,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'export_failed' }, { status: 500 })
  }
}
