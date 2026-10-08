import 'server-only'
import { formatIsoDay, MONTH_NAMES } from '@/lib/dates'
import { addDays, daysBetween, endOfMonth, isRealIsoDay, startOfMonth } from '@/lib/dates/civil'
import { isoDayInCordoba, todayInCordoba } from '@/lib/dates/zone'
import {
  asRecord,
  asRecords,
  bool,
  dayOrNull,
  instantOrNull,
  intOrNull,
  queryError,
  readerClient,
  str,
  strOrNull,
} from './shared'

/**
 * Estado de las integraciones (ARCA, Mercado Pago, banco y Mis Comprobantes)
 * para el Resumen (diseño §5.2.4): la segunda fuente de «Para atender», sin
 * tocar `acc_report_summary`.
 *
 * Lee por la RLS de lectores (la contadora también lo ve) con el bar
 * explícito. Nunca un secreto: de las conexiones, solo estado, fechas y claves
 * de error. Mientras las migraciones de ARCA e importadores no estén aplicadas
 * las tablas no existen: devuelve `available: false` y ningún aviso (el
 * Resumen no se rompe).
 */

export type IntegrationTone = 'danger' | 'warning' | 'info'

export type IntegrationAttentionKind =
  | 'arca_error'
  | 'arca_cert_expired'
  | 'arca_cert_expiring'
  | 'arca_vouchers'
  | 'mp_reconnect'
  | 'import_review'
  | 'mc_prev_month'

export type IntegrationAttentionItem = {
  kind: IntegrationAttentionKind
  tone: IntegrationTone
  label: string
  /** Ruta relativa a `/<bar>/administracion`. */
  href: string
  actionLabel: string
  count: number | null
  /** Fecha de referencia (vencimiento del certificado), si aplica. */
  date: string | null
}

export type ArcaEnvironmentStatus = {
  environment: 'produccion' | 'homologacion'
  status: string
  pointOfSale: number | null
  certNotAfter: string | null
  /** Días hasta el vencimiento del certificado (negativo si ya venció). */
  certDaysLeft: number | null
  lastTestAt: string | null
  lastErrorKey: string | null
  emissionEnabled: boolean
}

export type ImportSourceStatus = {
  lastBatchAt: string | null
  /** Lotes con algo para revisar o cargar. */
  pendingBatches: number
  /** El lote pendiente más nuevo (para el botón). */
  pendingBatchId: string | null
}

export type IntegrationsStatus = {
  /** `false` mientras las tablas de ARCA e importadores no existen en la base. */
  available: boolean
  today: string
  arca: {
    produccion: ArcaEnvironmentStatus | null
    homologacion: ArcaEnvironmentStatus | null
    /** Facturas de producción emitidas en `needs_reconcile` o autorizadas sin asiento. */
    vouchersAttention: number
  }
  mercadoPago: ImportSourceStatus & {
    status: 'not_configured' | 'csv_only' | 'connected' | 'reconnect' | 'disconnected'
    lastSyncAt: string | null
    lastErrorKey: string | null
  }
  bank: ImportSourceStatus
  arcaImports: ImportSourceStatus & {
    used: boolean
    /** Un lote de Mis Comprobantes cubre todo el mes anterior. */
    prevMonthCovered: boolean
  }
}

/** La tabla o la función todavía no existe (migración sin aplicar). */
function missingRelation(error: { code?: string | null } | null): boolean {
  const code = error?.code ?? ''
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST202' || code === '42883'
}

const MP_STATUSES = ['csv_only', 'connected', 'reconnect', 'disconnected'] as const

function emptySource(): ImportSourceStatus {
  return { lastBatchAt: null, pendingBatches: 0, pendingBatchId: null }
}

function unavailable(today: string): IntegrationsStatus {
  return {
    available: false,
    today,
    arca: { produccion: null, homologacion: null, vouchersAttention: 0 },
    mercadoPago: {
      ...emptySource(),
      status: 'not_configured',
      lastSyncAt: null,
      lastErrorKey: null,
    },
    bank: emptySource(),
    arcaImports: { ...emptySource(), used: false, prevMonthCovered: false },
  }
}

/** El estado de ARCA, Mercado Pago, el banco y Mis Comprobantes del bar. */
export async function getIntegrationsStatus(tenantId: string): Promise<IntegrationsStatus> {
  const today = todayInCordoba()
  const supabase = await readerClient()
  const [conns, vouchers, mp, batches] = await Promise.all([
    supabase
      .from('acc_arca_connections')
      .select(
        'environment, status, point_of_sale, cert_not_after, last_test_at, last_error_key, emission_enabled',
      )
      .eq('tenant_id', tenantId),
    supabase
      .from('acc_arca_vouchers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      // Solo producción: las de prueba (homologación) quedan «authorized» para siempre porque
      // nunca van a los libros (aavo_homo_no_books); no son algo para atender.
      .eq('environment', 'produccion')
      .in('status', ['needs_reconcile', 'authorized']),
    supabase
      .from('acc_mp_connections')
      .select('status, last_sync_at, last_error_key')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('acc_import_batches')
      .select('id, source, status, created_at, period_from, period_to, counts')
      .eq('tenant_id', tenantId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  for (const r of [conns, vouchers, mp, batches]) {
    if (r.error && missingRelation(r.error)) return unavailable(today)
  }
  if (conns.error) throw queryError('acc_arca_connections', conns.error)
  if (vouchers.error) throw queryError('acc_arca_vouchers', vouchers.error)
  if (mp.error) throw queryError('acc_mp_connections', mp.error)
  if (batches.error) throw queryError('acc_import_batches', batches.error)

  const arca: IntegrationsStatus['arca'] = {
    produccion: null,
    homologacion: null,
    vouchersAttention: vouchers.count ?? 0,
  }
  for (const row of asRecords(conns.data)) {
    const environment = row.environment === 'homologacion' ? 'homologacion' : 'produccion'
    const certNotAfter = instantOrNull(row.cert_not_after)
    const certDay = certNotAfter ? isoDayInCordoba(certNotAfter) : null
    arca[environment] = {
      environment,
      status: str(row.status, 'draft'),
      pointOfSale: intOrNull(row.point_of_sale),
      certNotAfter,
      certDaysLeft: certDay ? daysBetween(today, certDay) : null,
      lastTestAt: instantOrNull(row.last_test_at),
      lastErrorKey: strOrNull(row.last_error_key),
      emissionEnabled: bool(row.emission_enabled),
    }
  }

  const mpRow = mp.data ? asRecord(mp.data) : null
  const mpStatus = mpRow
    ? (MP_STATUSES.find((s) => s === mpRow.status) ?? 'csv_only')
    : ('not_configured' as const)

  const sources = {
    arca_recibidos: emptySource(),
    mp_release: emptySource(),
    bank_statement: emptySource(),
  }
  const prevStart = startOfMonth(addDays(startOfMonth(today), -1))
  const prevEnd = endOfMonth(prevStart)
  let prevMonthCovered = false
  let arcaUsed = false
  for (const b of asRecords(batches.data)) {
    const source = b.source
    if (source !== 'arca_recibidos' && source !== 'mp_release' && source !== 'bank_statement') {
      continue
    }
    const s = sources[source]
    const createdAt = instantOrNull(b.created_at)
    if (!s.lastBatchAt && createdAt) s.lastBatchAt = createdAt
    const counts = asRecord(b.counts)
    const pending =
      (intOrNull(counts.needs_input) ?? 0) +
      (intOrNull(counts.ready) ?? 0) +
      (intOrNull(counts.stale) ?? 0) +
      (intOrNull(counts.error) ?? 0) +
      (intOrNull(counts.posting) ?? 0)
    const open = b.status === 'staging' || b.status === 'review' || b.status === 'posting'
    if (open && pending > 0) {
      s.pendingBatches++
      if (!s.pendingBatchId) s.pendingBatchId = str(b.id) || null
    }
    if (source === 'arca_recibidos') {
      arcaUsed = true
      const from = dayOrNull(b.period_from)
      const to = dayOrNull(b.period_to)
      if (from && to && from <= prevStart && to >= prevEnd) prevMonthCovered = true
    }
  }

  return {
    available: true,
    today,
    arca,
    mercadoPago: {
      ...sources.mp_release,
      status: mpStatus,
      lastSyncAt: mpRow ? instantOrNull(mpRow.last_sync_at) : null,
      lastErrorKey: mpRow ? strOrNull(mpRow.last_error_key) : null,
    },
    bank: sources.bank_statement,
    arcaImports: { ...sources.arca_recibidos, used: arcaUsed, prevMonthCovered },
  }
}

const TONE_ORDER: Readonly<Record<IntegrationTone, number>> = { danger: 0, warning: 1, info: 2 }

/**
 * «Para atender» de las integraciones (puro, con el estado ya leído):
 * ARCA en error, el certificado que vence (o venció), facturas de ARCA para
 * verificar, lotes esperando revisión, «Reconectá Mercado Pago» y, desde el
 * día 11, «Bajá Mis Comprobantes de <mes anterior>» si ningún lote lo cubre.
 */
export function integrationAttention(status: IntegrationsStatus): IntegrationAttentionItem[] {
  if (!status.available) return []
  const out: IntegrationAttentionItem[] = []
  const prod = status.arca.produccion
  if (prod && prod.status === 'error') {
    out.push({
      kind: 'arca_error',
      tone: 'danger',
      label: 'ARCA dio error en la última prueba de conexión.',
      href: '/ajustes?tab=arca',
      actionLabel: 'Cómo se arregla',
      count: null,
      date: null,
    })
  }
  if (
    prod &&
    prod.certDaysLeft !== null &&
    prod.certNotAfter &&
    !['draft', 'disconnected'].includes(prod.status)
  ) {
    const day = isoDayInCordoba(prod.certNotAfter)
    const when = day ? formatIsoDay(day) : ''
    if (prod.certDaysLeft < 0) {
      out.push({
        kind: 'arca_cert_expired',
        tone: 'danger',
        label: when
          ? `El certificado de ARCA venció el ${when}.`
          : 'El certificado de ARCA venció.',
        href: '/ajustes/arca#renovar',
        actionLabel: 'Renovar',
        count: null,
        date: day,
      })
    } else if (prod.certDaysLeft <= 30) {
      out.push({
        kind: 'arca_cert_expiring',
        tone: 'warning',
        label: when
          ? `El certificado de ARCA vence el ${when}.`
          : 'El certificado de ARCA vence pronto.',
        href: '/ajustes/arca#renovar',
        actionLabel: 'Renovar',
        count: null,
        date: day,
      })
    }
  }
  if (status.arca.vouchersAttention > 0) {
    const n = status.arca.vouchersAttention
    out.push({
      kind: 'arca_vouchers',
      tone: 'danger',
      label:
        n === 1
          ? 'Hay 1 factura de ARCA para verificar o cargar en los libros.'
          : `Hay ${n} facturas de ARCA para verificar o cargar en los libros.`,
      // La verificación automática y «Cargarla ahora» viven en Ventas › Factura de venta.
      href: '/ventas/nueva-factura',
      actionLabel: 'Ver',
      count: n,
      date: null,
    })
  }
  if (status.mercadoPago.status === 'reconnect') {
    out.push({
      kind: 'mp_reconnect',
      tone: 'warning',
      label: 'Reconectá Mercado Pago: la sincronización dejó de andar.',
      href: '/importar/mercado-pago',
      actionLabel: 'Reconectar',
      count: null,
      date: null,
    })
  }
  const pending: Array<[ImportSourceStatus, string, string]> = [
    [status.arcaImports, 'Compras de ARCA para revisar y cargar', 'compras de ARCA'],
    [status.mercadoPago, 'Mercado Pago para revisar y cargar', 'reportes de Mercado Pago'],
    [status.bank, 'Movimientos del banco para revisar y cargar', 'extractos del banco'],
  ]
  for (const [s, one, many] of pending) {
    if (s.pendingBatches === 0) continue
    out.push({
      kind: 'import_review',
      tone: 'warning',
      label: s.pendingBatches === 1 ? `${one}.` : `Hay ${s.pendingBatches} ${many} para revisar.`,
      href:
        s.pendingBatchId && s.pendingBatches === 1 ? `/importar/${s.pendingBatchId}` : '/importar',
      actionLabel: 'Revisar',
      count: s.pendingBatches,
      date: null,
    })
  }
  const day = Number(status.today.slice(8, 10))
  const usesArca = status.arcaImports.used || prod?.status === 'connected'
  if (usesArca && day >= 11 && !status.arcaImports.prevMonthCovered && isRealIsoDay(status.today)) {
    const prevMonth = startOfMonth(addDays(startOfMonth(status.today), -1))
    const name = MONTH_NAMES[Number(prevMonth.slice(5, 7)) - 1] ?? ''
    out.push({
      kind: 'mc_prev_month',
      tone: 'info',
      label: `Bajá Mis Comprobantes de ${name} y subilo: ya están casi todas las facturas.`,
      href: '/importar/arca',
      actionLabel: 'Importar de ARCA',
      count: null,
      date: null,
    })
  }
  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone])
}

/** «Para atender» de las integraciones, para sumar al del Resumen. */
export async function getIntegrationAttention(
  tenantId: string,
): Promise<IntegrationAttentionItem[]> {
  return integrationAttention(await getIntegrationsStatus(tenantId))
}
