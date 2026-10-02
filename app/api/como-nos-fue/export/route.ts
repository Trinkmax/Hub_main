import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { getMonthBirthdayReport } from '@/lib/salon/birthday-queries'
import { monthBirthdaysToCsv } from '@/lib/salon/birthdays-report'
import { isRealIsoDay, todayInCordoba } from '@/lib/salon/date-presets'
import { eventProfitabilityToCsv } from '@/lib/salon/event-consolidated'
import { eventConversionToCsv } from '@/lib/salon/event-conversion'
import { parseCuadro } from '@/lib/salon/event-cuadros'
import { monthMarketingToCsv } from '@/lib/salon/event-marketing'
import { dayReportToCsv, reportExportFilename } from '@/lib/salon/events-report'
import { privateEditionsNote } from '@/lib/salon/private-groups'
import { getDayReport, getMonthMarketingReport, getTemplateReport } from '@/lib/salon/queries'
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
/** Copiado de la page de Señas: un mes que Postgres no puede convertir en rango no pasa. */
const YM_RE = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/

/**
 * Descarga "Cómo nos fue" como planilla, con el MISMO corte que la pantalla:
 * una noche partida en bloques, UNO de los dos cuadros de un evento
 * (`cuadro=rentabilidad|conversion`, 02/10), la pauta de un mes o sus
 * cumpleaños.
 *
 * No lleva PII (son conteos por bloque y la plata de la pauta), pero es un
 * tablero de dueño: guard de rol explícito, porque la RLS de
 * `salon_reservations` deja leer a cualquier miembro del tenant. La pauta ya es
 * solo de dueño en la RLS; el guard igual va primero.
 *
 * La planilla del día lleva las columnas de pauta siempre: son las mismas que
 * ve el dueño en la ficha, y una planilla que las omite según desde dónde se
 * bajó sería otra planilla. Las del evento son exactamente su cuadro.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const slug = url.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'missing_slug' }, { status: 400 })

  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])

    const tenantId = access.tenant.id
    const vistaParam = url.searchParams.get('vista')
    const vista =
      vistaParam === 'evento'
        ? 'evento'
        : vistaParam === 'pauta'
          ? 'pauta'
          : vistaParam === 'cumples'
            ? 'cumples'
            : 'dia'

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
      return csvResponse(
        dayReportToCsv(report, report.marketing),
        reportExportFilename(access.tenant.slug, dia),
      )
    }

    if (vista === 'pauta') {
      const mes = url.searchParams.get('mes')
      if (!mes || !YM_RE.test(mes)) {
        return NextResponse.json({ error: 'invalid_month' }, { status: 400 })
      }
      const report = await getMonthMarketingReport({ tenantId, ym: mes, today: todayInCordoba() })
      await logAudit({
        tenantId,
        userId: access.user.id,
        action: 'salon_events_report.exported',
        entity: 'scheduled_event',
        payload: {
          vista,
          mes,
          fechas: report.editions.length,
          grupos_privados: report.privateGroups.length,
        },
      })
      // `como-nos-fue-hub-pauta-2026-09.csv`.
      return csvResponse(
        monthMarketingToCsv(report),
        reportExportFilename(access.tenant.slug, `pauta-${mes}`),
      )
    }

    if (vista === 'cumples') {
      const mes = url.searchParams.get('mes')
      if (!mes || !YM_RE.test(mes)) {
        return NextResponse.json({ error: 'invalid_month' }, { status: 400 })
      }
      const report = await getMonthBirthdayReport({ tenantId, ym: mes, today: todayInCordoba() })
      await logAudit({
        tenantId,
        userId: access.user.id,
        action: 'salon_events_report.exported',
        entity: 'salon_reservation',
        payload: {
          vista,
          mes,
          cumples: report.totals.birthdays,
          personas: report.totals.guests,
          truncated: report.truncated,
        },
      })
      // `como-nos-fue-hub-cumpleanos-2026-09.csv`.
      return csvResponse(
        monthBirthdaysToCsv(report),
        reportExportFilename(access.tenant.slug, `cumpleanos-${mes}`),
      )
    }

    const evento = url.searchParams.get('evento')
    if (!evento || !UUID_RE.test(evento)) {
      return NextResponse.json({ error: 'invalid_event' }, { status: 400 })
    }
    // Por evento baja UNO de sus dos cuadros (02/10): la planilla mezclada de
    // antes ya no existe. Sin `cuadro` (un link viejo) no se adivina.
    const cuadro = parseCuadro(url.searchParams.get('cuadro'))
    if (!cuadro) return NextResponse.json({ error: 'invalid_cuadro' }, { status: 400 })
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
        cuadro,
        template_id: evento,
        ediciones: report.editions.length,
        grupos_privados: report.privateEditions,
        truncated: report.truncated,
      },
    })
    // `como-nos-fue-hub-2x1-burger-martes-rentabilidad.csv` / `…-conversion.csv`.
    const csv =
      cuadro === 'rentabilidad'
        ? eventProfitabilityToCsv({
            templateName: report.templateName,
            editions: report.editions,
            marketing: report.marketing,
            privateNote: privateEditionsNote(report.privateEditions),
          })
        : eventConversionToCsv(report, report.marketing)
    return csvResponse(
      csv,
      reportExportFilename(access.tenant.slug, `${report.templateName}-${cuadro}`),
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
