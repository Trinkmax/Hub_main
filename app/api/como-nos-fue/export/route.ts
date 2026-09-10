import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { isRealIsoDay, todayInCordoba } from '@/lib/salon/date-presets'
import {
  dayReportToCsv,
  reportExportFilename,
  templateReportToCsv,
} from '@/lib/salon/events-report'
import { getDayReport, getTemplateReport } from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Descarga "Cómo nos fue" como planilla, con el MISMO corte que la pantalla:
 * una noche partida en bloques, o todas las fechas de un evento.
 *
 * No lleva PII (son conteos por bloque), pero es un tablero de dueño: guard de
 * rol explícito, porque la RLS de `salon_reservations` deja leer a cualquier
 * miembro del tenant.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const slug = url.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'missing_slug' }, { status: 400 })

  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])

    const tenantId = access.tenant.id
    const vista = url.searchParams.get('vista') === 'evento' ? 'evento' : 'dia'

    if (vista === 'dia') {
      const dia = url.searchParams.get('dia')
      if (!dia || !isRealIsoDay(dia)) {
        return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
      }
      const report = await getDayReport({ tenantId, day: dia })
      await logAudit({
        tenantId,
        userId: access.user.id,
        action: 'salon_events_report.exported',
        entity: 'salon_reservation',
        payload: {
          vista,
          dia,
          bloques: report.blocks.length,
          personas: report.totals.guests,
          reservas: report.totals.reservations,
          truncated: report.truncated,
        },
      })
      return csvResponse(dayReportToCsv(report), reportExportFilename(access.tenant.slug, dia))
    }

    const evento = url.searchParams.get('evento')
    if (!evento || !UUID_RE.test(evento)) {
      return NextResponse.json({ error: 'invalid_event' }, { status: 400 })
    }
    const report = await getTemplateReport({
      tenantId,
      templateId: evento,
      today: todayInCordoba(),
    })
    if (!report) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    await logAudit({
      tenantId,
      userId: access.user.id,
      action: 'salon_events_report.exported',
      entity: 'scheduled_event',
      payload: {
        vista,
        template_id: evento,
        ediciones: report.editions.length,
        truncated: report.truncated,
      },
    })
    return csvResponse(
      templateReportToCsv(report),
      reportExportFilename(access.tenant.slug, report.templateName),
    )
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    console.error('[como-nos-fue.export] falló la exportación', {
      slug,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'export_failed' }, { status: 500 })
  }
}

function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
