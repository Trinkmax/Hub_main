import 'server-only'

import { queryError } from '@/lib/accounting/queries/shared'
import { createClient } from '@/lib/supabase/server'
import { ARCA_ENVIRONMENTS, type ArcaEnvironment, isArcaEnvironment } from './endpoints'
import {
  ARCA_CONNECTION_STATUSES,
  type ArcaConnectionStatus,
  type ArcaTestResult,
  arcaGuideState,
  type GuideConnection,
  type GuideProgressRow,
  guideProgressSummary,
} from './guide'
import { asRec, dateOf, intOf, isUuidText, type Rec, textOf } from './store'
import {
  ARCA_ENVIRONMENT_LABELS,
  ARCA_STATUS_LABELS,
  type ArcaConnectionView,
  type ArcaGuideMark,
  type ArcaGuideView,
  type ArcaLookupStatus,
  type ArcaOverview,
  type ArcaVoucherAttention,
  arcaProblemView,
  arcaStepProblem,
  arcaTestView,
  arcaVoucherLabel,
  csrFileName,
  readLastTest,
} from './views'

/**
 * Lecturas de ARCA para las pantallas (diseño §2.2, §2.4.1 y §5.1). Corren con la
 * sesión de la persona (RLS de lectores: dueños con acceso y la contadora); las
 * páginas llaman antes `requireAccountingAccess(slug, 'read')`. Cada `select` filtra
 * `tenant_id` explícito.
 *
 * Lo que devuelven las funciones `get*` son objetos simples para mandar al
 * navegador: **nunca** el certificado, el pedido, la clave, el hash de la clave ni
 * el ticket (esos dos últimos ni siquiera se pueden leer: `acc_secrets` y
 * `acc_arca_tickets` no tienen ningún privilegio). Las `load*` son para las acciones
 * del servidor.
 */

const DAY_MS = 86_400_000

// ─── La fila de la conexión ──────────────────────────────────────────────────

/** Las columnas que se leen: nada de PEM (el pedido se baja aparte, con `loadArcaCsr`). */
const CONNECTION_COLUMNS = [
  'id',
  'environment',
  'status',
  'represented_cuit',
  'cert_cuit',
  'alias',
  'public_key_sha256',
  'pending_public_key_sha256',
  'cert_serial',
  'cert_issuer',
  'cert_not_before',
  'cert_not_after',
  'point_of_sale',
  'allowed_classes',
  'default_concepto',
  'emission_enabled',
  'services',
  'last_test_at',
  'last_test',
  'last_error_key',
  'updated_at',
].join(', ')

/** `acc_arca_connections` para el servidor (incluye los hashes de la clave, que no son secretos). */
export type ArcaConnectionRow = {
  readonly id: string
  readonly environment: ArcaEnvironment
  readonly status: ArcaConnectionStatus
  readonly representedCuit: string
  readonly certCuit: string
  readonly alias: string
  readonly publicKeySha256: string | null
  readonly pendingPublicKeySha256: string | null
  readonly certSerial: string | null
  readonly certIssuer: string | null
  readonly certNotBefore: string | null
  readonly certNotAfter: string | null
  readonly pointOfSale: number | null
  readonly allowedClasses: readonly string[]
  readonly defaultConcepto: 1 | 2 | 3
  readonly emissionEnabled: boolean
  readonly services: { readonly wsfe: string | null; readonly padron: string | null }
  readonly lastTestAt: string | null
  readonly lastTest: ArcaTestResult | null
  readonly lastErrorKey: string | null
  readonly updatedAt: string
}

export function isArcaConnectionStatus(value: unknown): value is ArcaConnectionStatus {
  return (
    typeof value === 'string' && (ARCA_CONNECTION_STATUSES as readonly string[]).includes(value)
  )
}

function instant(value: unknown): string | null {
  const date = dateOf(value)
  return date ? date.toISOString() : null
}

/**
 * Una fila (de un `select` o del `to_jsonb` que devuelven las RPC) → la conexión.
 * `null` si no tiene la forma de la tabla.
 */
export function parseConnectionRow(raw: unknown): ArcaConnectionRow | null {
  const row = asRec(raw)
  const id = row?.id
  const environment = row?.environment
  const status = row?.status
  if (
    !row ||
    !isUuidText(id) ||
    !isArcaEnvironment(environment) ||
    !isArcaConnectionStatus(status)
  ) {
    return null
  }
  const services = asRec(row.services)
  const concepto = intOf(row.default_concepto)
  const pos = intOf(row.point_of_sale)
  return {
    id,
    environment,
    status,
    representedCuit: textOf(row.represented_cuit) ?? '',
    certCuit: textOf(row.cert_cuit) ?? '',
    alias: textOf(row.alias) ?? '',
    publicKeySha256: textOf(row.public_key_sha256),
    pendingPublicKeySha256: textOf(row.pending_public_key_sha256),
    certSerial: textOf(row.cert_serial),
    certIssuer: textOf(row.cert_issuer),
    certNotBefore: instant(row.cert_not_before),
    certNotAfter: instant(row.cert_not_after),
    pointOfSale: pos !== null && pos > 0 ? pos : null,
    allowedClasses: Array.isArray(row.allowed_classes)
      ? row.allowed_classes.filter((c): c is string => typeof c === 'string')
      : ['B'],
    defaultConcepto: concepto === 2 || concepto === 3 ? concepto : 1,
    emissionEnabled: row.emission_enabled === true,
    services: {
      wsfe: textOf(services?.wsfe),
      padron: textOf(services?.ws_sr_constancia_inscripcion),
    },
    lastTestAt: instant(row.last_test_at),
    lastTest: readLastTest(row.last_test),
    lastErrorKey: textOf(row.last_error_key),
    updatedAt: textOf(row.updated_at) ?? '',
  }
}

/** La conexión para la pantalla, sin secretos ni PEM. */
export function connectionView(
  row: ArcaConnectionRow,
  ctx: { readonly now: Date; readonly sasName: string | null },
): ArcaConnectionView {
  const viewCtx = {
    alias: row.alias,
    pointOfSale: row.pointOfSale,
    sasName: ctx.sasName,
    environment: row.environment,
  }
  const notAfter = dateOf(row.certNotAfter)
  const hasCertificate = notAfter !== null && row.status !== 'disconnected'
  const daysLeft = notAfter ? Math.floor((notAfter.getTime() - ctx.now.getTime()) / DAY_MS) : null
  const expired = notAfter !== null && notAfter.getTime() <= ctx.now.getTime()
  // La prueba solo vale con la conexión probada (`connected`/`error`): un certificado o un
  // punto de venta nuevos la dejan vieja (`cert_ready`).
  const testIsCurrent = row.status === 'connected' || row.status === 'error'
  return {
    id: row.id,
    environment: row.environment,
    environmentLabel: ARCA_ENVIRONMENT_LABELS[row.environment],
    status: row.status,
    statusLabel: ARCA_STATUS_LABELS[row.status],
    representedCuit: row.representedCuit,
    certCuit: row.certCuit,
    alias: row.alias,
    hasCsr: row.publicKeySha256 !== null,
    csrFileName: csrFileName(row.alias),
    renewalPending: row.pendingPublicKeySha256 !== null,
    certificate: hasCertificate
      ? {
          serial: row.certSerial ? row.certSerial.toUpperCase() : null,
          issuer: row.certIssuer,
          notBefore: row.certNotBefore,
          notAfter: row.certNotAfter,
          daysLeft,
          expired,
          renewSoon: !expired && daysLeft !== null && daysLeft < 30,
        }
      : null,
    pointOfSale: row.pointOfSale,
    allowedClasses: row.allowedClasses,
    defaultConcepto: row.defaultConcepto,
    emissionEnabled: row.emissionEnabled,
    services: row.services,
    lastTestAt: row.lastTestAt,
    lastTest: testIsCurrent && row.lastTest ? arcaTestView(row.lastTest, viewCtx) : null,
    lastError: row.status === 'error' ? arcaProblemView(row.lastErrorKey, viewCtx) : null,
    updatedAt: row.updatedAt,
  }
}

async function client() {
  return createClient()
}

/** La conexión de un ambiente (para las acciones). `null` si todavía no hay fila. */
export async function loadArcaConnectionRow(
  tenantId: string,
  environment: ArcaEnvironment,
): Promise<ArcaConnectionRow | null> {
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_arca_connections')
    .select(CONNECTION_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('environment', environment)
    .maybeSingle()
  if (error) throw queryError('acc_arca_connections', error)
  return parseConnectionRow(data)
}

/** Las dos conexiones del bar (la que no existe queda en `null`). */
export async function loadArcaConnectionRows(
  tenantId: string,
): Promise<Record<ArcaEnvironment, ArcaConnectionRow | null>> {
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_arca_connections')
    .select(CONNECTION_COLUMNS)
    .eq('tenant_id', tenantId)
    .limit(ARCA_ENVIRONMENTS.length)
  if (error) throw queryError('acc_arca_connections', error)
  const out: Record<ArcaEnvironment, ArcaConnectionRow | null> = {
    produccion: null,
    homologacion: null,
  }
  for (const raw of (data ?? []) as unknown[]) {
    const row = parseConnectionRow(raw)
    if (row) out[row.environment] = row
  }
  return out
}

/** La conexión de un ambiente para la pantalla. */
export async function getArcaConnection(
  tenantId: string,
  environment: ArcaEnvironment,
  opts: { readonly now?: Date } = {},
): Promise<ArcaConnectionView | null> {
  const [row, sas] = await Promise.all([
    loadArcaConnectionRow(tenantId, environment),
    loadSasIdentity(tenantId),
  ])
  return row
    ? connectionView(row, { now: opts.now ?? new Date(), sasName: sas?.legalName ?? null })
    : null
}

// ─── Datos de la SAS ─────────────────────────────────────────────────────────

export type SasIdentity = { readonly legalName: string | null; readonly cuit: string | null }

/** Razón social y CUIT de la SAS (`acc_settings`). `null` si Administración no se configuró. */
export async function loadSasIdentity(tenantId: string): Promise<SasIdentity | null> {
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_settings')
    .select('legal_name, cuit')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw queryError('acc_settings', error)
  const row = asRec(data)
  if (!row) return null
  return { legalName: textOf(row.legal_name), cuit: textOf(row.cuit) }
}

// ─── Guía ────────────────────────────────────────────────────────────────────

/** Los pasos marcados a mano de una guía (`acc_guide_progress`). */
export async function loadGuideMarks(
  tenantId: string,
  guide: 'arca' | 'arranque' = 'arca',
): Promise<ArcaGuideMark[]> {
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_guide_progress')
    .select('step, done_at, done_by_name')
    .eq('tenant_id', tenantId)
    .eq('guide', guide)
    .limit(200)
  if (error) throw queryError('acc_guide_progress', error)
  const out: ArcaGuideMark[] = []
  for (const raw of (data ?? []) as unknown[]) {
    const row = asRec(raw)
    const step = textOf(row?.step)
    const doneAt = instant(row?.done_at)
    if (step && doneAt) out.push({ step, doneAt, doneByName: textOf(row?.done_by_name) })
  }
  return out
}

/** Lo que la guía necesita de una conexión (sin secretos). */
export function guideConnection(
  row: ArcaConnectionRow | null,
  sas: SasIdentity | null,
): GuideConnection {
  return {
    status: row?.status ?? null,
    hasSasCuit: Boolean(sas?.cuit),
    hasCsr: row?.publicKeySha256 != null,
    hasCertificate: row?.certNotAfter != null,
    certNotAfter: row?.certNotAfter ?? null,
    pointOfSale: row?.pointOfSale ?? null,
    allowedClasses: row?.allowedClasses ?? ['B'],
    lastErrorKey: row?.lastErrorKey ?? null,
  }
}

/** El estado de cada paso de «Conectar ARCA» y el «5 de 9». */
export function guideView(
  row: ArcaConnectionRow | null,
  sas: SasIdentity | null,
  marks: readonly ArcaGuideMark[],
  now: Date,
): ArcaGuideView {
  const progress: GuideProgressRow[] = marks.map((m) => ({
    step: m.step,
    doneAt: m.doneAt,
    doneByName: m.doneByName,
  }))
  const states = arcaGuideState(guideConnection(row, sas), progress, row?.lastTest ?? null, now)
  const ctx = {
    alias: row?.alias ?? null,
    pointOfSale: row?.pointOfSale ?? null,
    sasName: sas?.legalName ?? null,
    environment: row?.environment ?? null,
  }
  return {
    steps: states.map((s) => ({ ...s, problem: arcaStepProblem(s.reason, ctx) })),
    summary: guideProgressSummary(states),
  }
}

// ─── Padrón ──────────────────────────────────────────────────────────────────

/**
 * Con qué conexión se consulta el padrón: producción si está conectada (o si el
 * padrón dio bien en la última prueba aunque falle otra cosa); si no, homologación
 * (datos de prueba). `null`: no hay ARCA para consultar.
 */
export function lookupConnection(
  rows: Readonly<Record<ArcaEnvironment, ArcaConnectionRow | null>>,
): ArcaConnectionRow | null {
  for (const environment of ARCA_ENVIRONMENTS) {
    const row = rows[environment]
    if (!row?.representedCuit) continue
    if (row.status === 'connected') return row
    if (row.status === 'error' && row.services.padron === 'ok') return row
  }
  return null
}

export function lookupStatus(row: ArcaConnectionRow | null): ArcaLookupStatus {
  return {
    environment: row?.environment ?? null,
    testData: row?.environment === 'homologacion',
  }
}

/** Para mostrar o esconder «Completar con ARCA» (§3.1). */
export async function getArcaLookupStatus(tenantId: string): Promise<ArcaLookupStatus> {
  return lookupStatus(lookupConnection(await loadArcaConnectionRows(tenantId)))
}

export type PadronCacheEntry = {
  readonly found: boolean
  /** La forma de `padronCacheRow` (snake_case). */
  readonly data: Rec
  /** ISO. */
  readonly fetchedAt: string
}

/** La constancia guardada de una CUIT (sin mirar la antigüedad: eso lo decide quien llama). */
export async function readPadronCache(
  tenantId: string,
  environment: ArcaEnvironment,
  cuit: string,
): Promise<PadronCacheEntry | null> {
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_arca_padron_cache')
    .select('found, data, fetched_at')
    .eq('tenant_id', tenantId)
    .eq('environment', environment)
    .eq('cuit', cuit)
    .maybeSingle()
  if (error) throw queryError('acc_arca_padron_cache', error)
  const row = asRec(data)
  const fetchedAt = instant(row?.fetched_at)
  const payload = asRec(row?.data)
  if (!row || !fetchedAt || !payload || typeof row.found !== 'boolean') return null
  return { found: row.found, data: payload, fetchedAt }
}

export type PadronVerification = {
  readonly environment: ArcaEnvironment
  /** ISO: «Verificado en ARCA el 08/10/2026». */
  readonly fetchedAt: string
  readonly found: boolean
  readonly active: boolean | null
}

/**
 * Si la CUIT se consultó en ARCA (la caché del bar), para la ficha del proveedor o
 * del cliente. Prefiere lo de producción.
 */
export async function getPadronVerification(
  tenantId: string,
  cuit: string,
): Promise<PadronVerification | null> {
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_arca_padron_cache')
    .select('environment, found, data, fetched_at')
    .eq('tenant_id', tenantId)
    .eq('cuit', cuit)
    .limit(ARCA_ENVIRONMENTS.length)
  if (error) throw queryError('acc_arca_padron_cache', error)
  let best: PadronVerification | null = null
  for (const raw of (data ?? []) as unknown[]) {
    const row = asRec(raw)
    const environment = row?.environment
    const fetchedAt = instant(row?.fetched_at)
    if (!row || !isArcaEnvironment(environment) || !fetchedAt || typeof row.found !== 'boolean') {
      continue
    }
    const active = asRec(row.data)?.active
    const entry: PadronVerification = {
      environment,
      fetchedAt,
      found: row.found,
      active: typeof active === 'boolean' ? active : null,
    }
    if (!best || environment === 'produccion') best = entry
  }
  return best
}

// ─── Pedido del certificado ──────────────────────────────────────────────────

/** El pedido (.csr) guardado: el vigente o el de la renovación en curso. Es público. */
export async function loadArcaCsr(
  tenantId: string,
  environment: ArcaEnvironment,
  pending: boolean,
): Promise<{ readonly alias: string; readonly csrPem: string } | null> {
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_arca_connections')
    .select('alias, csr_pem, pending_csr_pem, status')
    .eq('tenant_id', tenantId)
    .eq('environment', environment)
    .maybeSingle()
  if (error) throw queryError('acc_arca_connections', error)
  const row = asRec(data)
  const alias = textOf(row?.alias)
  const csrPem = textOf(pending ? row?.pending_csr_pem : row?.csr_pem)
  if (!alias || !csrPem || row?.status === 'disconnected') return null
  return { alias, csrPem }
}

// ─── Puntos de venta de Administración ───────────────────────────────────────

/** El punto de venta de `acc_sales_points` con ese número (activo o no), o `null`. */
export async function loadSalesPointByNumber(
  tenantId: string,
  number: number,
): Promise<{ readonly id: string; readonly label: string | null } | null> {
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_sales_points')
    .select('id, label')
    .eq('tenant_id', tenantId)
    .eq('number', number)
    .maybeSingle()
  if (error) throw queryError('acc_sales_points', error)
  const row = asRec(data)
  return row && isUuidText(row.id) ? { id: row.id, label: textOf(row.label) } : null
}

// ─── Comprobantes que necesitan atención ─────────────────────────────────────

async function loadVoucherAttention(tenantId: string): Promise<ArcaVoucherAttention[]> {
  const supabase = await client()
  const { data, error } = await supabase
    .from('acc_arca_vouchers')
    .select(
      'id, environment, status, point_of_sale, cbte_tipo, number, cae, total_cents, issue_date, created_at',
    )
    .eq('tenant_id', tenantId)
    .in('status', ['needs_reconcile', 'authorized'])
    .order('created_at', { ascending: true })
    .limit(50)
  if (error) throw queryError('acc_arca_vouchers', error)
  const out: ArcaVoucherAttention[] = []
  for (const raw of (data ?? []) as unknown[]) {
    const row = asRec(raw)
    const id = row?.id
    const environment = row?.environment
    const status = row?.status
    const pos = intOf(row?.point_of_sale)
    const cbte = intOf(row?.cbte_tipo)
    const createdAt = instant(row?.created_at)
    if (
      !row ||
      !isUuidText(id) ||
      !isArcaEnvironment(environment) ||
      (status !== 'needs_reconcile' && status !== 'authorized') ||
      pos === null ||
      cbte === null ||
      !createdAt
    ) {
      continue
    }
    const issueDate = textOf(row.issue_date)
    out.push({
      id,
      environment,
      status,
      label: arcaVoucherLabel(cbte, pos, intOf(row.number)),
      cae: textOf(row.cae),
      totalCents: intOf(row.total_cents) ?? 0,
      issueDate: issueDate ? issueDate.slice(0, 10) : null,
      createdAt,
    })
  }
  return out
}

// ─── Todo junto (pestaña ARCA y guía) ────────────────────────────────────────

/**
 * Lo que necesitan la pestaña «ARCA» de Ajustes y la guía «Conectar ARCA»: las dos
 * conexiones sin secretos (con la última prueba en palabras simples), el estado de
 * cada paso de la guía, los pasos marcados a mano, con qué ambiente se consulta el
 * padrón y los comprobantes con problemas.
 */
export async function getArcaOverview(
  tenantId: string,
  opts: { readonly now?: Date } = {},
): Promise<ArcaOverview> {
  const now = opts.now ?? new Date()
  const [sas, rows, marks, attention] = await Promise.all([
    loadSasIdentity(tenantId),
    loadArcaConnectionRows(tenantId),
    loadGuideMarks(tenantId, 'arca'),
    loadVoucherAttention(tenantId),
  ])
  const sasName = sas?.legalName ?? null
  const view = (row: ArcaConnectionRow | null) =>
    row ? connectionView(row, { now, sasName }) : null
  return {
    sas: { legalName: sasName, cuit: sas?.cuit ?? null },
    connections: { produccion: view(rows.produccion), homologacion: view(rows.homologacion) },
    guide: {
      produccion: guideView(rows.produccion, sas, marks, now),
      homologacion: guideView(rows.homologacion, sas, marks, now),
    },
    progress: marks,
    lookup: lookupStatus(lookupConnection(rows)),
    attention,
  }
}
