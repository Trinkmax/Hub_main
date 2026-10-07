import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { exportFilename } from '@/lib/accounting/queries/csv'
import { buildExport, EXPORT_MAX_ROWS, type ExportSpec } from '@/lib/accounting/queries/exports'
import { EXPORT_BOOK_INFO, EXPORT_BOOKS, type ExportBook } from '@/lib/accounting/queries/labels'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { AccQueryError } from '@/lib/accounting/queries/shared'
import { logAudit } from '@/lib/audit'
import { EXCEL_ES_AR, writeCsvStream } from '@/lib/csv/write'
import { daysBetween, endOfMonth, isRealIsoDay, isRealYearMonth, monthOf } from '@/lib/dates/civil'
import { todayInCordoba } from '@/lib/dates/zone'
import { RoleRequiredError, TenantNotFoundError, UnauthenticatedError } from '@/lib/tenant'

/**
 * Exportes de Administración (§F.15): un CSV por libro (`;` + BOM + CRLF),
 * transmitido página por página. Los bajan los dueños con acceso y la
 * contadora (`requireAccountingAccess(slug, 'read')`; `/api` no pasa por el
 * ruteo del proxy). Antes de transmitir: parámetros (zod), CUIT de la SAS en
 * los libros de IVA (409) y conteo previo (413 si pasa de 200.000 filas).
 *
 * `GET /api/administracion/export?slug=&libro=&mes=yyyy-MM&desde=&hasta=&cuenta=&participe=&caja=&antes_refundicion=1`
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Un rango puede tener hasta 400 días (F.15 paso 2). */
const MAX_RANGE_DAYS = 400

const optionalUuid = z.uuid('El identificador no es válido.').nullable()

const paramsSchema = z
  .object({
    slug: z.string().trim().min(1, 'Falta el bar.').max(80),
    libro: z.enum(EXPORT_BOOKS, { message: 'Ese libro no existe.' }),
    mes: z
      .string()
      .refine((v) => isRealYearMonth(v.slice(0, 7)), 'Ese mes no existe.')
      .nullable(),
    desde: z.string().refine(isRealIsoDay, 'Esa fecha no existe.').nullable(),
    hasta: z.string().refine(isRealIsoDay, 'Esa fecha no existe.').nullable(),
    cuenta: optionalUuid,
    participe: optionalUuid,
    caja: optionalUuid,
    antesRefundicion: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if ((v.desde === null) !== (v.hasta === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['desde'],
        message: 'Elegí las dos fechas: desde y hasta.',
      })
    }
    if (v.desde && v.hasta) {
      if (v.desde > v.hasta) {
        ctx.addIssue({
          code: 'custom',
          path: ['hasta'],
          message: 'El «hasta» no puede ser anterior al «desde».',
        })
      } else if (daysBetween(v.desde, v.hasta) + 1 > MAX_RANGE_DAYS) {
        ctx.addIssue({
          code: 'custom',
          path: ['hasta'],
          message: `El período puede tener hasta ${MAX_RANGE_DAYS} días. Elegí uno más corto.`,
        })
      }
    }
    const info = EXPORT_BOOK_INFO[v.libro]
    if (info.requires?.includes('cuenta') && !v.cuenta) {
      ctx.addIssue({ code: 'custom', path: ['cuenta'], message: 'Elegí la cuenta.' })
    }
    if (info.requires?.includes('participe') && !v.participe) {
      ctx.addIssue({
        code: 'custom',
        path: ['participe'],
        message: 'Elegí el proveedor o cliente.',
      })
    }
  })

type Params = z.infer<typeof paramsSchema>

function param(url: URL, name: string): string | null {
  const value = url.searchParams.get(name)
  return value === null || value.trim() === '' ? null : value.trim()
}

function error(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: code, message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

/** El período de cada libro: un mes, un rango, un día o nada. */
function resolveSpec(p: Params, today: string): { spec: ExportSpec; period: string } {
  const info = EXPORT_BOOK_INFO[p.libro]
  const baseMonth = p.mes ? p.mes.slice(0, 7) : p.desde ? monthOf(p.desde) : monthOf(today)
  const month = `${baseMonth}-01`
  const common = {
    libro: p.libro,
    accountId: p.cuenta,
    partyId: p.participe,
    treasuryId: p.caja,
    beforeFyResult: p.antesRefundicion,
  }
  switch (info.period) {
    case 'mes':
      return {
        spec: { ...common, from: month, to: endOfMonth(month), month, asOf: endOfMonth(month) },
        period: baseMonth,
      }
    case 'rango': {
      const from = p.desde ?? month
      const to = p.hasta ?? endOfMonth(month)
      return {
        spec: { ...common, from, to, month: `${monthOf(from)}-01`, asOf: to },
        period: p.desde || !p.mes ? `${from}_${to}` : baseMonth,
      }
    }
    case 'fecha': {
      const asOf = p.hasta ?? (p.mes ? minDay(endOfMonth(month), today) : today)
      return { spec: { ...common, from: asOf, to: asOf, month, asOf }, period: asOf }
    }
    case 'ninguno':
      return { spec: { ...common, from: today, to: today, month, asOf: today }, period: today }
  }
}

function minDay(a: string, b: string): string {
  return a <= b ? a : b
}

/** Sin sesión → 401; bar ajeno, rol o acceso → 403. `null` si no es un error de acceso. */
function accessError(e: unknown): Response | null {
  if (e instanceof UnauthenticatedError) {
    return error(401, 'unauthenticated', 'Tu sesión venció. Volvé a entrar.')
  }
  if (
    e instanceof TenantNotFoundError ||
    e instanceof RoleRequiredError ||
    e instanceof AccountingForbiddenError ||
    e instanceof AccountingDisabledError
  ) {
    return error(403, 'forbidden', 'No tenés acceso a Administración en este bar.')
  }
  return null
}

function queryFailure(e: AccQueryError): Response {
  if (e.key === 'export_too_large') return error(413, 'export_too_large', e.message)
  if (e.key === 'function_unavailable') return error(503, 'function_unavailable', e.message)
  if (e.code === 'invalid') return error(400, 'invalid_params', e.message)
  if (e.code === 'forbidden') return error(403, 'forbidden', e.message)
  return error(500, 'export_failed', 'No pudimos armar el archivo. Probá de nuevo en unos minutos.')
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const slug = param(url, 'slug')
  if (!slug || slug.length > 80) return error(400, 'invalid_params', 'Falta el bar.')

  // 1. Acceso (F.15 paso 1): dueños con acceso y la contadora. `/api` no pasa por el proxy.
  let tenantId: string
  let userId: string
  try {
    const access = await requireAccountingAccess(slug, 'read')
    tenantId = access.tenant.id
    userId = access.user.id
  } catch (e) {
    const denied = accessError(e)
    if (denied) return denied
    console.error('[acc.export] acceso', e instanceof Error ? e.name : 'desconocido')
    return error(
      500,
      'export_failed',
      'No pudimos armar el archivo. Probá de nuevo en unos minutos.',
    )
  }

  // 2. Parámetros (F.15 paso 2).
  const parsed = paramsSchema.safeParse({
    slug,
    libro: param(url, 'libro'),
    mes: param(url, 'mes'),
    desde: param(url, 'desde'),
    hasta: param(url, 'hasta'),
    cuenta: param(url, 'cuenta'),
    participe: param(url, 'participe'),
    caja: param(url, 'caja'),
    antesRefundicion: ['1', 'true', 'si', 'sí'].includes(
      (param(url, 'antes_refundicion') ?? '').toLowerCase(),
    ),
  })
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Revisá los datos del pedido.'
    return error(400, 'invalid_params', message)
  }
  const p = parsed.data
  const libro: ExportBook = p.libro

  const today = todayInCordoba()
  const { spec, period } = resolveSpec(p, today)

  try {
    if (EXPORT_BOOK_INFO[libro].needsSasCuit) {
      const settings = await getAccountingSettings(tenantId)
      if (!settings?.cuit) {
        return error(
          409,
          'sas_cuit_required',
          'Para exportar los libros de IVA falta el CUIT de la SAS (Ajustes › Datos de la SAS).',
        )
      }
    }

    const plan = await buildExport(tenantId, spec)
    const expected = await plan.count()
    if (expected > EXPORT_MAX_ROWS) {
      return error(
        413,
        'export_too_large',
        'Es demasiado para un solo archivo. Elegí un período más corto.',
      )
    }

    // La primera fila se pide ANTES de responder: un error de la base (rango que
    // cruza ejercicios, función que todavía no está) sale como un error claro y
    // no como una descarga cortada.
    const source = plan.rows()
    const first = await source.next()
    let written = 0
    async function* rows() {
      let completed = false
      try {
        let next = first
        while (!next.done) {
          written += 1
          yield next.value
          next = await source.next()
        }
        completed = true
      } finally {
        // Si el cliente corta la descarga, se cierra también la lectura.
        if (!completed) await source.return(undefined)
      }
      // Auditoría sin datos personales: qué libro, qué período y cuántas filas.
      await logAudit({
        tenantId,
        userId,
        action: 'acc_export.downloaded',
        entity: 'acc_export',
        payload: { libro, desde: spec.from, hasta: spec.to, filas: written },
      })
    }

    const stream = writeCsvStream(plan.headers, rows(), EXCEL_ES_AR)
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFilename(p.slug, libro, period)}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    if (e instanceof AccQueryError) return queryFailure(e)
    console.error('[acc.export]', libro, e instanceof Error ? e.name : 'desconocido')
    return error(
      500,
      'export_failed',
      'No pudimos armar el archivo. Probá de nuevo en unos minutos.',
    )
  }
}
