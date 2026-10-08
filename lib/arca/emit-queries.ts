import 'server-only'

import { queryError } from '@/lib/accounting/queries/shared'
import type { IsoDate } from '@/lib/accounting/types'
import { createClient } from '@/lib/supabase/server'
import { type ArcaVoucherRow, parseVoucherRow, VOUCHER_COLUMNS } from './emit'
import {
  type ArcaAttentionVoucher,
  type ArcaEmissionSetup,
  type ArcaPlatformVoucher,
  type ArcaVoucherCard,
  arcaVoucherStatusLabel,
  readStoredForm,
} from './emit-form'
import type { ArcaEnvironment } from './endpoints'
import { readCaeRecord } from './print'
import { asRec, intOf, isUuidText, textOf } from './store'
import { arcaVoucherLabel } from './views'
import { type CbteTipo, isCbteTipo } from './vouchers'
import type { CaeRequest } from './wsfe'

/**
 * Lecturas de la emisión con CAE (diseño §3.2.2, §3.2.5 y §3.2.6). Corren con la
 * sesión de la persona (RLS de lectores de `acc_arca_vouchers`, `acc_bundles`,
 * `acc_documents`, `acc_parties` y `acc_settings`) y filtran `tenant_id` explícito.
 * Las páginas llaman antes `requireAccountingAccess(slug, 'read')`.
 *
 * **Mientras la base no tenga lo de ARCA** (tablas o columnas que todavía no
 * existen), `getArcaEmissionSetup` devuelve `state: 'unavailable'` y
 * `getArcaVoucherCard` `null`: la factura de venta sigue como siempre y el
 * comprobante se ve sin la tarjeta. Los demás errores tiran `AccQueryError`
 * (las páginas los muestran con `settleQuery`).
 */

const MISSING_CODES = new Set(['PGRST205', '42P01', 'PGRST204', '42703', 'PGRST202', '42883'])

function isMissing(error: { code?: string | null } | null | undefined): boolean {
  return MISSING_CODES.has(error?.code ?? '')
}

async function client() {
  return createClient()
}

// ─── Un comprobante ──────────────────────────────────────────────────────────

/** Un comprobante de ARCA por id (`null` si no existe o no es del bar). */
export async function loadArcaVoucher(
  tenantId: string,
  voucherId: string,
): Promise<ArcaVoucherRow | null> {
  if (!isUuidText(voucherId)) return null
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_arca_vouchers')
    .select(VOUCHER_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', voucherId)
    .maybeSingle()
  if (error) throw queryError('acc_arca_vouchers', error)
  return parseVoucherRow(data)
}

/**
 * El comprobante que ya salió de este mismo envío del formulario (la referencia
 * del formulario va en `form.emissionKey`): un reintento después de un corte no
 * emite dos veces. Solo cuenta lo que está vivo o autorizado.
 */
export async function findVoucherByEmissionKey(
  tenantId: string,
  emissionKey: string,
): Promise<ArcaVoucherRow | null> {
  if (!isUuidText(emissionKey)) return null
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_arca_vouchers')
    .select(VOUCHER_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('form->>emissionKey', emissionKey)
    .in('status', ['reserved', 'requesting', 'needs_reconcile', 'authorized', 'posted'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw queryError('acc_arca_vouchers', error)
  return parseVoucherRow(Array.isArray(data) ? data[0] : null)
}

/** El último autorizado de la plataforma para un punto de venta y tipo (número y fecha). */
export async function lastPlatformVoucher(
  tenantId: string,
  environment: ArcaEnvironment,
  pointOfSale: number,
  cbteTipo: CbteTipo,
): Promise<{ readonly number: number; readonly issueDate: IsoDate | null } | null> {
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_arca_vouchers')
    .select('number, issue_date')
    .eq('tenant_id', tenantId)
    .eq('environment', environment)
    .eq('point_of_sale', pointOfSale)
    .eq('cbte_tipo', cbteTipo)
    .in('status', ['authorized', 'posted'])
    .order('number', { ascending: false })
    .limit(1)
  if (error) throw queryError('acc_arca_vouchers', error)
  const row = asRec(Array.isArray(data) ? data[0] : null)
  const number = intOf(row?.number)
  if (!row || number === null) return null
  const issue = textOf(row.issue_date)
  return { number, issueDate: issue ? issue.slice(0, 10) : null }
}

/** La última Factura B de prueba autorizada (para probar una nota de crédito en homologación). */
export async function lastTestInvoiceB(tenantId: string): Promise<ArcaVoucherRow | null> {
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_arca_vouchers')
    .select(VOUCHER_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('environment', 'homologacion')
    .eq('cbte_tipo', 6)
    .eq('status', 'authorized')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw queryError('acc_arca_vouchers', error)
  return parseVoucherRow(Array.isArray(data) ? data[0] : null)
}

/**
 * El comprobante de ventas que guardó un envío (`acc_bundles.client_ref`): si el
 * asiento ya se guardó y lo que faltó fue vincularlo, «Cargarla ahora» solo lo
 * vincula (nunca guarda dos veces).
 */
export async function findBundleSalesDocument(
  tenantId: string,
  clientRef: string,
): Promise<{ readonly documentId: string; readonly status: string } | null> {
  const supabase = await client()
  const bundle = await supabase
    .from('acc_bundles')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('client_ref', clientRef)
    .maybeSingle()
  if (bundle.error) throw queryError('acc_bundles', bundle.error)
  const bundleId = asRec(bundle.data)?.id
  if (!isUuidText(bundleId)) return null
  const docs = await supabase
    .from('acc_documents')
    .select('id, status, kind')
    .eq('tenant_id', tenantId)
    .eq('bundle_id', bundleId)
    .in('kind', ['sales_invoice', 'sales_debit_note', 'sales_credit_note'])
    .limit(2)
  if (docs.error) throw queryError('acc_documents', docs.error)
  const doc = asRec(Array.isArray(docs.data) ? docs.data[0] : null)
  return doc && isUuidText(doc.id)
    ? { documentId: doc.id, status: textOf(doc.status) ?? 'posted' }
    : null
}

// ─── La factura de venta ─────────────────────────────────────────────────────

const PLATFORM_LIMIT = 300
const ATTENTION_LIMIT = 20

function unavailableSetup(): ArcaEmissionSetup {
  return {
    state: 'unavailable',
    offReason: null,
    pointOfSale: null,
    allowedClasses: ['B'],
    defaultConcepto: 1,
    platformVouchers: [],
    attention: [],
  }
}

/**
 * Lo que «Ventas › Factura de venta» necesita de ARCA: si se puede emitir en
 * producción (conexión probada, emisión prendida, punto de venta y la SAS
 * responsable inscripta), las facturas de la plataforma para asociar a una NC o
 * ND, y los comprobantes que necesitan atención (en verificación o sin cargar).
 */
export async function getArcaEmissionSetup(
  tenantId: string,
  opts: { readonly vatRegistered: boolean },
): Promise<ArcaEmissionSetup> {
  const supabase = await client()
  const connection = await supabase
    .from('acc_arca_connections')
    .select('status, point_of_sale, allowed_classes, default_concepto, emission_enabled')
    .eq('tenant_id', tenantId)
    .eq('environment', 'produccion')
    .maybeSingle()
  if (isMissing(connection.error)) return unavailableSetup()
  if (connection.error) throw queryError('acc_arca_connections', connection.error)
  const conn = connectionOf(connection.data)
  const [platform, attention] = await Promise.all([
    supabase
      .from('acc_arca_vouchers')
      .select(
        'id, cbte_tipo, point_of_sale, number, issue_date, total_cents, document_id, party:form->>partyId',
      )
      .eq('tenant_id', tenantId)
      .eq('environment', 'produccion')
      .in('status', ['authorized', 'posted'])
      .in('cbte_tipo', [1, 2, 6, 7])
      .order('created_at', { ascending: false })
      .limit(PLATFORM_LIMIT),
    supabase
      .from('acc_arca_vouchers')
      .select(
        'id, environment, status, point_of_sale, cbte_tipo, number, cae, total_cents, issue_date, updated_at',
      )
      .eq('tenant_id', tenantId)
      .in('status', ['requesting', 'needs_reconcile', 'authorized'])
      // Las de prueba autorizadas están bien así (homologación nunca va a los libros).
      .or('environment.eq.produccion,status.neq.authorized')
      .order('created_at', { ascending: true })
      .limit(ATTENTION_LIMIT),
  ])
  if (isMissing(platform.error) || isMissing(attention.error)) return unavailableSetup()
  if (platform.error) throw queryError('acc_arca_vouchers', platform.error)
  if (attention.error) throw queryError('acc_arca_vouchers', attention.error)

  const platformVouchers: ArcaPlatformVoucher[] = []
  for (const raw of (platform.data ?? []) as unknown[]) {
    const row = asRec(raw)
    const cbte = intOf(row?.cbte_tipo)
    const pv = intOf(row?.point_of_sale)
    const number = intOf(row?.number)
    if (!row || !isUuidText(row.id) || !isCbteTipo(cbte) || pv === null || number === null) continue
    const issue = textOf(row.issue_date)
    platformVouchers.push({
      id: row.id,
      cbteTipo: cbte,
      pointOfSale: pv,
      number,
      issueDate: issue ? issue.slice(0, 10) : null,
      totalCents: intOf(row.total_cents) ?? 0,
      documentId: isUuidText(row.document_id) ? row.document_id : null,
      partyId: isUuidText(row.party) ? row.party : null,
      label: arcaVoucherLabel(cbte, pv, number),
    })
  }

  const items: ArcaAttentionVoucher[] = []
  for (const raw of (attention.data ?? []) as unknown[]) {
    const item = attentionItem(raw)
    if (item) items.push(item)
  }

  let state: ArcaEmissionSetup['state'] = 'off'
  let offReason: ArcaEmissionSetup['offReason'] = null
  if (!conn || conn.status !== 'connected') offReason = 'not_connected'
  else if (!conn.emissionEnabled) offReason = 'emission_off'
  else if (conn.pointOfSale === null) offReason = 'no_point_of_sale'
  else if (!opts.vatRegistered) offReason = 'not_vat_registered'
  else state = 'on'

  return {
    state,
    offReason,
    pointOfSale: conn?.pointOfSale ?? null,
    allowedClasses: conn?.allowedClasses ?? ['B'],
    defaultConcepto: conn?.defaultConcepto ?? 1,
    platformVouchers,
    attention: items,
  }
}

type EmissionConnection = {
  readonly status: string
  readonly pointOfSale: number | null
  readonly allowedClasses: readonly string[]
  readonly defaultConcepto: 1 | 2 | 3
  readonly emissionEnabled: boolean
}

function connectionOf(raw: unknown): EmissionConnection | null {
  const row = asRec(raw)
  if (!row) return null
  const pv = intOf(row.point_of_sale)
  const concepto = intOf(row.default_concepto)
  return {
    status: textOf(row.status) ?? 'draft',
    pointOfSale: pv !== null && pv > 0 ? pv : null,
    allowedClasses: Array.isArray(row.allowed_classes)
      ? row.allowed_classes.filter((c): c is string => typeof c === 'string')
      : ['B'],
    defaultConcepto: concepto === 2 || concepto === 3 ? concepto : 1,
    emissionEnabled: row.emission_enabled === true,
  }
}

function attentionItem(raw: unknown): ArcaAttentionVoucher | null {
  const row = asRec(raw)
  const environment = row?.environment
  const status = row?.status
  const pv = intOf(row?.point_of_sale)
  const cbte = intOf(row?.cbte_tipo)
  const since = textOf(row?.updated_at)
  if (
    !row ||
    !isUuidText(row.id) ||
    (environment !== 'produccion' && environment !== 'homologacion') ||
    (status !== 'requesting' && status !== 'needs_reconcile' && status !== 'authorized') ||
    pv === null ||
    cbte === null ||
    !since
  ) {
    return null
  }
  // Las de prueba autorizadas están bien así: homologación nunca va a los libros.
  if (environment === 'homologacion' && status === 'authorized') return null
  const issue = textOf(row.issue_date)
  return {
    id: row.id,
    environment,
    status,
    label: arcaVoucherLabel(cbte, pv, intOf(row.number)),
    cae: textOf(row.cae),
    totalCents: intOf(row.total_cents) ?? 0,
    issueDate: issue ? issue.slice(0, 10) : null,
    since,
    canPost: environment === 'produccion' && status === 'authorized',
  }
}

// ─── La tarjeta del comprobante ──────────────────────────────────────────────

function voucherCard(row: ArcaVoucherRow): ArcaVoucherCard | null {
  if (!isCbteTipo(row.cbteTipo)) return null
  return {
    id: row.id,
    environment: row.environment,
    status: row.status,
    statusLabel: arcaVoucherStatusLabel(row.status, row.environment),
    label: arcaVoucherLabel(row.cbteTipo, row.pointOfSale, row.number),
    cbteTipo: row.cbteTipo,
    pointOfSale: row.pointOfSale,
    number: row.number,
    cae: row.cae,
    caeDue: row.caeDue,
    issueDate: row.issueDate,
    totalCents: row.totalCents,
    observations: row.observations.map((m) => m.msg).filter((m) => m.trim() !== ''),
    processedAt: row.fchProceso,
    documentId: row.documentId,
    canReconcile: row.status === 'needs_reconcile' || row.status === 'requesting',
    canPost: row.environment === 'produccion' && row.status === 'authorized',
  }
}

/**
 * La autorización de ARCA de un comprobante de los libros: la vinculada
 * (`document_id`) o, si el asiento se guardó y faltó vincularlo, la del mismo
 * envío (`client_ref` del bundle). `null` si no se emitió con la plataforma.
 */
export async function getArcaVoucherCard(
  tenantId: string,
  documentId: string,
): Promise<ArcaVoucherCard | null> {
  if (!isUuidText(documentId)) return null
  const supabase = await client()
  const linked = await supabase
    .from('acc_arca_vouchers')
    .select(VOUCHER_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('document_id', documentId)
    .maybeSingle()
  if (isMissing(linked.error)) return null
  if (linked.error) throw queryError('acc_arca_vouchers', linked.error)
  const row = parseVoucherRow(linked.data)
  if (row) return voucherCard(row)

  const doc = await supabase
    .from('acc_documents')
    .select('bundle_id, kind')
    .eq('tenant_id', tenantId)
    .eq('id', documentId)
    .maybeSingle()
  if (doc.error) throw queryError('acc_documents', doc.error)
  const docRow = asRec(doc.data)
  const kind = textOf(docRow?.kind)
  if (!docRow || !isUuidText(docRow.bundle_id) || !kind?.startsWith('sales_')) return null
  const bundle = await supabase
    .from('acc_bundles')
    .select('client_ref')
    .eq('tenant_id', tenantId)
    .eq('id', docRow.bundle_id)
    .maybeSingle()
  if (bundle.error) throw queryError('acc_bundles', bundle.error)
  const clientRef = asRec(bundle.data)?.client_ref
  if (!isUuidText(clientRef)) return null
  const byRef = await supabase
    .from('acc_arca_vouchers')
    .select(VOUCHER_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('client_ref', clientRef)
    .maybeSingle()
  if (isMissing(byRef.error)) return null
  if (byRef.error) throw queryError('acc_arca_vouchers', byRef.error)
  const unlinked = parseVoucherRow(byRef.data)
  return unlinked ? voucherCard(unlinked) : null
}

// ─── La factura impresa ──────────────────────────────────────────────────────

export type InvoicePrintData = {
  readonly voucher: ArcaVoucherRow
  readonly request: CaeRequest
  readonly cae: string
  readonly caeDue: IsoDate
  readonly detail: string
  readonly issuer: {
    readonly legalName: string
    readonly cuit: string
    readonly ivaCondition: string
    readonly iibbNumber: string | null
    readonly activityStartDate: IsoDate | null
    readonly address: string | null
  }
  readonly receiver: { readonly name: string | null; readonly address: string | null }
}

/**
 * Lo que necesita la factura impresa de `id`: el comprobante de los libros
 * (`document_id`) o directamente el de ARCA (una autorizada que todavía no está en
 * los libros, o una de prueba). Solo si tiene CAE. `null` si no hay nada para
 * imprimir.
 */
export async function getInvoicePrintData(
  tenantId: string,
  id: string,
): Promise<InvoicePrintData | null> {
  if (!isUuidText(id)) return null
  const supabase = await client()
  const byDoc = await supabase
    .from('acc_arca_vouchers')
    .select(`${VOUCHER_COLUMNS}, connection_id`)
    .eq('tenant_id', tenantId)
    .eq('document_id', id)
    .maybeSingle()
  if (isMissing(byDoc.error)) return null
  if (byDoc.error) throw queryError('acc_arca_vouchers', byDoc.error)
  let raw: unknown = byDoc.data
  if (!raw) {
    const byId = await supabase
      .from('acc_arca_vouchers')
      .select(`${VOUCHER_COLUMNS}, connection_id`)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle()
    if (byId.error) throw queryError('acc_arca_vouchers', byId.error)
    raw = byId.data
  }
  const voucher = parseVoucherRow(raw)
  if (!voucher || (voucher.status !== 'authorized' && voucher.status !== 'posted')) return null
  const request = readCaeRecord(voucher.request)
  if (!request || !voucher.cae || !voucher.caeDue) return null
  const stored = readStoredForm(voucher.form)
  const connectionId = asRec(raw)?.connection_id

  const [settings, connection, party] = await Promise.all([
    supabase
      .from('acc_settings')
      .select('legal_name, cuit, iva_condition, iibb_number, activity_start_date, fiscal_address')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    isUuidText(connectionId)
      ? supabase
          .from('acc_arca_connections')
          .select('represented_cuit')
          .eq('tenant_id', tenantId)
          .eq('id', connectionId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    stored?.partyId
      ? supabase
          .from('acc_parties')
          .select('name, address')
          .eq('tenant_id', tenantId)
          .eq('id', stored.partyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (settings.error) throw queryError('acc_settings', settings.error)
  if (connection.error) throw queryError('acc_arca_connections', connection.error)
  if (party.error) throw queryError('acc_parties', party.error)
  const s = asRec(settings.data)
  const cuit = textOf(asRec(connection.data)?.represented_cuit) ?? textOf(s?.cuit)
  if (!s || !cuit) return null
  const p = asRec(party.data)
  const activity = textOf(s.activity_start_date)
  return {
    voucher,
    request,
    cae: voucher.cae,
    caeDue: voucher.caeDue,
    detail: stored?.detail ?? '',
    issuer: {
      legalName: textOf(s.legal_name) ?? '',
      cuit,
      ivaCondition: textOf(s.iva_condition) ?? 'responsable_inscripto',
      iibbNumber: textOf(s.iibb_number),
      activityStartDate: activity ? activity.slice(0, 10) : null,
      address: textOf(s.fiscal_address),
    },
    receiver: { name: textOf(p?.name), address: textOf(p?.address) },
  }
}
