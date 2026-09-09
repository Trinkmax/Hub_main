import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { isRealIsoDay } from '@/lib/salon/date-presets'
import { type DepositBasis, depositsExportFilename, depositsToCsv } from '@/lib/salon/deposits'
import { getDepositsByDay } from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Descarga el reporte de señas como planilla (CSV para Excel/Sheets).
 *
 * Recibe el MISMO rango y criterio que la pantalla, así que la planilla y los
 * totales de arriba dicen siempre lo mismo. Es un GET con
 * `Content-Disposition: attachment` para que el botón sea un link común y
 * funcione igual en el celular.
 *
 * No lleva PII (es una serie de días con montos), pero es plata: solo dueño, y
 * queda en `audit_log` con el período y el total.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const slug = url.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'missing_slug' }, { status: 400 })

  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])

    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    // `isRealIsoDay` además del regex: `2026-02-31` tiene la forma correcta pero
    // no existe, y sin este chequeo termina en un 500 (Postgres 22008 con el
    // criterio de reserva, `Invalid Date` con el de carga) en vez de un 400.
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
    }
    if (!isRealIsoDay(from) || !isRealIsoDay(to)) {
      return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
    }
    if (from > to) return NextResponse.json({ error: 'invalid_range' }, { status: 400 })

    const basis: DepositBasis =
      url.searchParams.get('fecha') === 'carga' ? 'created' : 'reservation'

    const report = await getDepositsByDay({ tenantId: access.tenant.id, basis, from, to })
    const csv = depositsToCsv(report)
    const filename = depositsExportFilename(access.tenant.slug, report)

    await logAudit({
      tenantId: access.tenant.id,
      userId: access.user.id,
      action: 'salon_deposits.exported',
      entity: 'salon_reservation',
      payload: {
        from,
        to,
        basis,
        days: report.days.length,
        total_cents: report.totals.total_cents,
        truncated: report.truncated,
      },
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        ...(report.truncated ? { 'X-Export-Truncated': 'true' } : {}),
      },
    })
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    console.error('[senas.export] falló la exportación', {
      slug,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'export_failed' }, { status: 500 })
  }
}
