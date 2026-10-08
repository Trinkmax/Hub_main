'use server'

/**
 * Acciones de ARCA (diseño §2.3, §2.6 y §3.1): generar la clave y el pedido del
 * certificado, subir el certificado, guardar el punto de venta y los datos de la
 * conexión, «Probar conexión», desconectar, marcar pasos de la guía y «Completar
 * con ARCA». La emisión con CAE es otro paquete (`emit.ts`).
 *
 * Todas: `authorizeAccounting(slug, 'write')` (lecturas: `'read'`) → zod → la
 * sesión de la persona (nunca `service_role`: las RPC vuelven a exigir escritor,
 * toman el lock del bar y auditan adentro) → errores del catálogo (`mapAccError`
 * para la base, `lib/arca/errors.ts` para ARCA) → revalidación de Administración.
 * Reciben un objeto o el `FormData` del formulario.
 *
 * **Secretos.** La clave privada se genera acá y va directo a la RPC (cifrada en la
 * base con la clave del servidor, `secretsKey()`); al navegador vuelven solo el
 * pedido (.csr) y el nombre del archivo. Nada de esto devuelve ni loguea la clave,
 * el certificado, el ticket ni la clave del servidor: los logs llevan la operación,
 * la clave del error y el código.
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import {
  type AccFailureState,
  type AccSimpleState,
  invalidState,
} from '@/lib/accounting/action-state'
import {
  accFailure,
  fieldFailure,
  formInput,
  revalidateAccounting,
  rpcFailure,
} from '@/lib/accounting/actions/support'
import { mapAccError } from '@/lib/accounting/errors'
import { AccQueryError, type QueryOutcome, settleQuery } from '@/lib/accounting/queries/shared'
import { formatDate, formatDateTime } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { type CertificateInfo, parseCertificate } from './cert'
import { CONNECTION_TEST_BUDGET_MS, runConnectionTest } from './connection-test'
import { generateKeyAndCsr, type KeyAndCsr } from './csr'
import { ArcaCryptoError } from './der'
import type { ArcaEnvironment } from './endpoints'
import { lookupPadron, PADRON_MESSAGES } from './lookup'
import { classifyUpload } from './pem'
import {
  connectionView,
  getArcaLookupStatus,
  getArcaOverview,
  isArcaConnectionStatus,
  loadArcaConnectionRow,
  loadArcaCsr,
  loadSalesPointByNumber,
  loadSasIdentity,
  parseConnectionRow,
} from './queries'
import {
  ALIAS_MESSAGE,
  arcaSettingsSchema,
  csrDownloadSchema,
  decodeUploadedFile,
  disconnectSchema,
  environmentSchema,
  guideMarkSchema,
  lookupCuitSchema,
  pointOfSaleSchema,
  startCertificateSchema,
  UNREADABLE_CERT_MESSAGE,
  uploadCertificateSchema,
} from './schemas'
import { isArcaSecretsKeyError, secretsKey } from './secrets'
import { openArcaSession } from './session'
import { asRec, dateOf, isArcaStoreError, textOf } from './store'
import {
  ARCA_ENVIRONMENT_LABELS,
  type ArcaCertificateResult,
  type ArcaConnectionView,
  type ArcaCsrDownload,
  type ArcaCsrResult,
  type ArcaLookupStatus,
  type ArcaOverview,
  type ArcaPointOfSaleResult,
  type ArcaTestView,
  arcaTestView,
  csrFileName,
  type PadronLookupResult,
} from './views'

// ─── Piezas comunes ──────────────────────────────────────────────────────────

const SECRETS_MISSING: AccFailureState = {
  ok: false,
  code: 'error',
  message:
    'Falta configurar la clave de la plataforma para guardar las credenciales de ARCA. Avisanos y lo arreglamos.',
  detail: { key: 'secrets_key_missing', bug: true },
}

const UNEXPECTED: AccFailureState = {
  ok: false,
  code: 'error',
  message: 'No pudimos completar la operación con ARCA. Probá de nuevo; si sigue, avisanos.',
}

/** Lo que no es un error de carga → estado de la acción, con un log sin datos de nadie. */
function failureState(op: string, e: unknown): AccFailureState {
  if (isArcaSecretsKeyError(e)) {
    console.error(`[arca.${op}] secrets_key_missing`)
    return SECRETS_MISSING
  }
  if (isArcaStoreError(e)) {
    if (e.state.detail?.bug === true || e.state.code === 'error') {
      console.error(`[arca.${op}]`, e.op, e.key ?? e.pgCode ?? 'error')
    }
    return e.state
  }
  if (e instanceof AccQueryError) return { ok: false, code: e.code, message: e.message }
  // Solo el nombre: el texto de una excepción podría traer un dato.
  console.error(`[arca.${op}] inesperado`, e instanceof Error ? e.name : 'unknown')
  return UNEXPECTED
}

function badSlug(slug: unknown): AccFailureState | null {
  return typeof slug === 'string' && slug !== '' ? null : accFailure('forbidden')
}

const RATE_LIMITED: AccFailureState = {
  ok: false,
  code: 'error',
  message: 'Probaste muchas veces seguidas. Esperá un minuto y volvé a probar.',
  detail: { key: 'rate_limited' },
}

// ─── Paso 5: clave y pedido del certificado ──────────────────────────────────

const PROD_CERT_CUIT_MESSAGE =
  'En producción el certificado es de la SAS: la CUIT tiene que ser la de Ajustes › Datos de la SAS.'
const HOMO_CERT_CUIT_MESSAGE =
  'Poné tu CUIT personal: en homologación (WSASS) el certificado sale a nombre de quien lo genera.'

/**
 * La razón social para el `O` del pedido: sin caracteres de control y hasta 64
 * caracteres (RFC 5280). ARCA reescribe el sujeto del certificado (deja solo la CUIT
 * y el alias), así que recortarla no cambia nada del certificado.
 */
function csrOrganization(legalName: string | null): string {
  let clean = ''
  for (const ch of (legalName ?? '').normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 0
    clean += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch
  }
  const cut = Array.from(clean.replace(/\s+/g, ' ').trim()).slice(0, 64).join('').trim()
  return cut === '' ? 'SAS' : cut
}

/**
 * «Generar pedido» (paso 5): clave RSA 2048 nueva + pedido (.csr) con la CUIT del
 * certificado, la razón social y el alias. La clave va cifrada a la base
 * (`acc_arca_store_keypair`) y nunca vuelve: al navegador vuelven el pedido y el
 * nombre del archivo.
 *
 * Entrada (`startCertificateSchema`): `{ environment, alias, certCuit?, mode? }`.
 * Si ya hay un certificado y `mode` es `new`, la base contesta
 * `arca_key_replace_requires_confirm`: la pantalla confirma y reenvía con `replace`.
 */
export async function startArcaCertificate(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ArcaCsrResult>> {
  const op = 'startCertificate'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = startCertificateSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const { environment, alias, mode } = parsed.data

    const [sas, conn] = await Promise.all([
      loadSasIdentity(auth.tenantId),
      loadArcaConnectionRow(auth.tenantId, environment),
    ])
    if (!sas?.cuit) return accFailure('sas_cuit_missing')

    let certCuit: string
    if (environment === 'produccion') {
      if (parsed.data.certCuit !== null && parsed.data.certCuit !== sas.cuit) {
        return fieldFailure('certCuit', PROD_CERT_CUIT_MESSAGE)
      }
      certCuit = sas.cuit
    } else {
      // Homologación: la persona de WSASS; si no la manda, la del pedido anterior.
      const previous = conn && conn.publicKeySha256 !== null ? conn.certCuit : null
      const chosen = parsed.data.certCuit ?? previous
      if (!chosen) return fieldFailure('certCuit', HOMO_CERT_CUIT_MESSAGE)
      certCuit = chosen
    }

    const secretKey = secretsKey()
    let generated: KeyAndCsr
    try {
      generated = generateKeyAndCsr({
        cuit: certCuit,
        organization: csrOrganization(sas.legalName),
        commonName: alias,
      })
    } catch (e) {
      if (e instanceof ArcaCryptoError && e.code === 'invalid_cuit') {
        return fieldFailure('certCuit', 'La CUIT del certificado no es válida.')
      }
      if (e instanceof ArcaCryptoError && e.code === 'invalid_subject') {
        return fieldFailure('alias', ALIAS_MESSAGE)
      }
      throw e
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_arca_store_keypair', {
      p_tenant_id: auth.tenantId,
      p_environment: environment,
      p_alias: alias,
      p_cert_cuit: certCuit,
      p_private_key_pem: generated.privateKeyPem,
      p_csr_pem: generated.csrPem,
      p_public_key_sha256: generated.publicKeySha256,
      p_secret_key: secretKey,
      p_mode: mode,
    })
    if (error) return rpcFailure(`arca.${op}`, error)

    revalidateAccounting(slug)
    const saved = asRec(data)
    const status = textOf(saved?.status)
    return {
      ok: true,
      data: {
        environment,
        alias,
        csrPem: generated.csrPem,
        fileName: csrFileName(alias),
        mode,
        status: isArcaConnectionStatus(status) ? status : null,
        updatedAt: textOf(saved?.updated_at),
      },
      message:
        mode === 'renew'
          ? 'Listo: generamos el pedido para renovar. Subilo a ARCA con «Agregar certificado» sobre el mismo alias; mientras tanto, la conexión sigue andando.'
          : 'Listo: generamos el pedido. Bajalo y subilo a ARCA en el paso 6.',
    }
  } catch (e) {
    return failureState(op, e)
  }
}

/** «Descargar de nuevo» el pedido (.csr) guardado (es el mismo; no es secreto). */
export async function downloadArcaCsr(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ArcaCsrDownload>> {
  const op = 'downloadCsr'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = csrDownloadSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const csr = await loadArcaCsr(auth.tenantId, parsed.data.environment, parsed.data.pending)
    if (!csr) return accFailure('arca_key_missing')
    return {
      ok: true,
      data: { alias: csr.alias, csrPem: csr.csrPem, fileName: csrFileName(csr.alias) },
      message: 'Listo: es el mismo pedido de antes.',
    }
  } catch (e) {
    return failureState(op, e)
  }
}

// ─── Paso 6: el certificado ──────────────────────────────────────────────────

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const UPLOAD_KIND_MESSAGES = {
  csr: 'Subiste el pedido (.csr), no el certificado. El certificado lo bajás de ARCA en el paso 6, con el ícono de «Descargar».',
  private_key:
    'Eso es una clave privada: no la subas a ningún lado. La plataforma ya tiene la suya.',
  pkcs12: 'Ese archivo trae clave y certificado juntos. Bajá de ARCA solo el certificado (.crt).',
  unknown: UNREADABLE_CERT_MESSAGE,
} as const

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text
}

function cuitMismatchMessage(
  subjectCuit: string | null,
  certCuit: string,
  environment: ArcaEnvironment,
): string {
  if (!subjectCuit) {
    return 'El certificado no trae una CUIT: subí el .crt que bajaste de ARCA para este pedido.'
  }
  return environment === 'produccion'
    ? `El certificado es de la CUIT ${formatCuit(subjectCuit)}, no de la SAS. En el paso 6, en «¿En nombre de quién?», elegí la SAS.`
    : `El certificado es de la CUIT ${formatCuit(subjectCuit)} y el pedido era para la ${formatCuit(certCuit)}. Subí el certificado de este pedido.`
}

/**
 * «Subir certificado» (paso 6, §2.4.2): qué archivo es → que sea de la clave de la
 * plataforma (la vigente o la de la renovación) → de la CUIT del pedido → vigente.
 * Si el alias no es el del pedido, es un aviso, no un error. Después
 * `acc_arca_save_certificate` (que vuelve a chequear todo y deja la conexión en
 * `cert_ready`). Un archivo con una clave privada no se guarda ni se loguea.
 *
 * Entrada (`uploadCertificateSchema`): `{ environment, fileBase64 (base64 o data URL, ≤ 16 KB), expectedUpdatedAt? }`.
 */
export async function uploadArcaCertificate(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ArcaCertificateResult>> {
  const op = 'uploadCertificate'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = uploadCertificateSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const { environment, expectedUpdatedAt } = parsed.data

    const bytes = decodeUploadedFile(parsed.data.fileBase64)
    if (!bytes) return fieldFailure('fileBase64', UNREADABLE_CERT_MESSAGE)
    const kind = classifyUpload(bytes)
    if (kind !== 'certificate') return fieldFailure('fileBase64', UPLOAD_KIND_MESSAGES[kind])
    let info: CertificateInfo
    try {
      info = parseCertificate(bytes)
    } catch {
      return fieldFailure('fileBase64', UNREADABLE_CERT_MESSAGE)
    }

    const conn = await loadArcaConnectionRow(auth.tenantId, environment)
    if (
      !conn ||
      conn.status === 'disconnected' ||
      (conn.publicKeySha256 === null && conn.pendingPublicKeySha256 === null)
    ) {
      return accFailure('arca_key_missing')
    }
    const current = info.publicKeySha256 === conn.publicKeySha256
    const renewal = !current && info.publicKeySha256 === conn.pendingPublicKeySha256
    if (!current && !renewal) {
      return fieldFailure(
        'fileBase64',
        `Este certificado es de otro pedido. Volvé a ARCA y subí el .csr de este paso (alias «${conn.alias}»).`,
      )
    }
    if (info.subjectCuit !== conn.certCuit) {
      return fieldFailure(
        'fileBase64',
        cuitMismatchMessage(info.subjectCuit, conn.certCuit, environment),
      )
    }
    const now = new Date()
    if (info.notAfter.getTime() <= now.getTime()) {
      return fieldFailure(
        'fileBase64',
        `El certificado venció el ${formatDate(info.notAfter)}: generá uno nuevo con «Renovar certificado».`,
      )
    }
    // Mismo margen que la base: ARCA y nosotros pueden tener la hora un poco corrida.
    if (info.notBefore.getTime() > now.getTime() + HOUR_MS) {
      return fieldFailure(
        'fileBase64',
        `El certificado empieza a valer el ${formatDateTime(info.notBefore)}. Subilo de nuevo a partir de esa hora.`,
      )
    }
    const warnings: string[] = []
    if (info.subjectCn && info.subjectCn !== conn.alias) {
      warnings.push(
        `El certificado es del alias «${info.subjectCn}» y el pedido era «${conn.alias}». Si en ARCA lo creaste así, seguí; si no, revisá el paso 6.`,
      )
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_arca_save_certificate', {
      p_tenant_id: auth.tenantId,
      p_environment: environment,
      p_certificate_pem: info.pem,
      // La lista exacta que acepta la base (una clave de más → invalid_payload).
      p_meta: {
        serial_hex: info.serialHex,
        subject_cuit: info.subjectCuit,
        subject_cn: info.subjectCn,
        issuer: clip(info.issuer, 300),
        not_before: info.notBefore.toISOString(),
        not_after: info.notAfter.toISOString(),
        public_key_sha256: info.publicKeySha256,
      },
      p_expected_updated_at: expectedUpdatedAt,
    })
    if (error) return rpcFailure(`arca.${op}`, error)

    revalidateAccounting(slug)
    const row = parseConnectionRow(data)
    return {
      ok: true,
      data: {
        environment,
        serial: info.serialHex,
        subjectCn: info.subjectCn,
        subjectCuit: info.subjectCuit,
        notBefore: info.notBefore.toISOString(),
        notAfter: info.notAfter.toISOString(),
        daysLeft: Math.floor((info.notAfter.getTime() - now.getTime()) / DAY_MS),
        renewal,
        warnings,
        connection: row ? connectionView(row, { now, sasName: null }) : null,
      },
      message: `Listo: certificado válido hasta el ${formatDate(info.notAfter)}.${renewal ? ' La renovación quedó hecha.' : ''}`,
    }
  } catch (e) {
    return failureState(op, e)
  }
}

// ─── Paso 2 y datos de la conexión ───────────────────────────────────────────

/** Cómo queda el punto de venta de la plataforma en Ajustes › Puntos de venta. */
const PLATFORM_SALES_POINT_LABEL = 'Plataforma (ARCA)'

async function ensurePlatformSalesPoint(
  tenantId: string,
  number: number,
): Promise<NonNullable<ArcaPointOfSaleResult['salesPoint']>> {
  try {
    const existing = await loadSalesPointByNumber(tenantId, number)
    if (existing) return { status: 'existing', number, label: existing.label }
    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_save_sales_point', {
      p_tenant_id: tenantId,
      p_point: { number, label: PLATFORM_SALES_POINT_LABEL, default_channel: 'events' },
      p_expected_updated_at: null,
    })
    if (!error) return { status: 'created', number, label: PLATFORM_SALES_POINT_LABEL }
    const key = mapAccError(error).detail?.key
    // Otro lo creó entre la lectura y el alta: ya está.
    if (key === 'sales_point_taken') return { status: 'existing', number, label: null }
    console.error('[arca.savePointOfSale] sales_point', key ?? error.code ?? 'error')
    return { status: 'failed', number, label: null }
  } catch (e) {
    console.error('[arca.savePointOfSale] sales_point', e instanceof Error ? e.name : 'unknown')
    return { status: 'failed', number, label: null }
  }
}

/**
 * Guarda el punto de venta de la plataforma (paso 2) en la conexión. En producción,
 * además, lo da de alta en Ajustes › Puntos de venta como «Plataforma (ARCA)», canal
 * Eventos, si no existe (así aparece en los formularios de venta). Cambiar el punto
 * de una conexión probada la vuelve a `cert_ready`: hay que probar de nuevo.
 *
 * Entrada (`pointOfSaleSchema`): `{ environment, pointOfSale (1–99998), expectedUpdatedAt? }`.
 * Sin `expectedUpdatedAt` se usa el de la base (es un solo campo).
 */
export async function saveArcaPointOfSale(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ArcaPointOfSaleResult>> {
  const op = 'savePointOfSale'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = pointOfSaleSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const { environment, pointOfSale } = parsed.data

    const before = await loadArcaConnectionRow(auth.tenantId, environment)
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_arca_save_connection', {
      p_tenant_id: auth.tenantId,
      p_environment: environment,
      p_patch: { point_of_sale: pointOfSale },
      p_expected_updated_at: parsed.data.expectedUpdatedAt ?? (before?.updatedAt || null),
    })
    if (error) return rpcFailure(`arca.${op}`, error)
    const row = parseConnectionRow(data)

    const warnings: string[] = []
    let salesPoint: ArcaPointOfSaleResult['salesPoint'] = null
    if (environment === 'produccion') {
      salesPoint = await ensurePlatformSalesPoint(auth.tenantId, pointOfSale)
      if (
        salesPoint.status === 'existing' &&
        salesPoint.label &&
        salesPoint.label !== PLATFORM_SALES_POINT_LABEL
      ) {
        warnings.push(
          `El ${pointOfSale} ya está en Ajustes › Puntos de venta como «${salesPoint.label}». Si es el de Thinkeon, elegí otro: la plataforma necesita uno propio para no chocar la numeración.`,
        )
      }
    }

    revalidateAccounting(slug)
    const retest = before?.status === 'connected' && row?.status === 'cert_ready'
    return {
      ok: true,
      data: {
        connection: row ? connectionView(row, { now: new Date(), sasName: null }) : null,
        salesPoint,
        warnings,
      },
      message: retest
        ? 'Listo: punto de venta guardado. Volvé a probar la conexión.'
        : 'Listo: punto de venta guardado.',
    }
  } catch (e) {
    return failureState(op, e)
  }
}

/**
 * Datos de la conexión: alias (antes de generar el pedido), qué Factura A autorizó
 * ARCA (`allowedClasses`, siempre con B), concepto por defecto y el interruptor de
 * emisión (solo producción; la base exige la conexión probada). Solo viajan las
 * claves que mandó la pantalla. Sin fila, la crea con la CUIT de la SAS.
 *
 * Entrada (`arcaSettingsSchema`): `{ environment, alias?, allowedClasses?, defaultConcepto?, emissionEnabled?, expectedUpdatedAt? }`.
 */
export async function saveArcaSettings(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ArcaConnectionView>> {
  const op = 'saveSettings'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = arcaSettingsSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const v = parsed.data

    const patch: Record<string, unknown> = {}
    if (v.alias !== undefined) patch.alias = v.alias
    if (v.allowedClasses !== undefined) patch.allowed_classes = v.allowedClasses
    if (v.defaultConcepto !== undefined) patch.default_concepto = v.defaultConcepto
    if (v.emissionEnabled !== undefined) patch.emission_enabled = v.emissionEnabled

    const [before, sas] = await Promise.all([
      loadArcaConnectionRow(auth.tenantId, v.environment),
      loadSasIdentity(auth.tenantId),
    ])
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_arca_save_connection', {
      p_tenant_id: auth.tenantId,
      p_environment: v.environment,
      p_patch: patch,
      p_expected_updated_at: v.expectedUpdatedAt ?? (before?.updatedAt || null),
    })
    if (error) return rpcFailure(`arca.${op}`, error)
    const row = parseConnectionRow(data)
    if (!row) return failureState(op, new Error('respuesta sin la conexión'))

    revalidateAccounting(slug)
    return {
      ok: true,
      data: connectionView(row, { now: new Date(), sasName: sas?.legalName ?? null }),
      message:
        v.emissionEnabled === true
          ? 'Listo: ya podés emitir facturas con ARCA desde Ventas › Factura de venta.'
          : v.emissionEnabled === false
            ? 'Listo: la emisión con ARCA quedó apagada.'
            : 'Listo, quedó guardado.',
    }
  } catch (e) {
    return failureState(op, e)
  }
}

// ─── Paso 9: «Probar conexión» ───────────────────────────────────────────────

/** Topes de cada llamada durante la prueba (más cortos que el de todos los días). */
const TEST_CALL_TIMEOUT_MS = 12_000
const TEST_LOGIN_TIMEOUT_MS = 15_000
/** Estados con certificado: los únicos que se pueden probar (igual que la base). */
const TESTABLE = new Set(['cert_ready', 'connected', 'error'])

function testMessage(view: ArcaTestView): string {
  if (view.status === 'connected') {
    return view.checks.some((c) => c.tone === 'warning')
      ? '¡Listo! ARCA quedó conectado. Revisá los avisos.'
      : '¡Listo! ARCA quedó conectado.'
  }
  const problem = view.firstProblem
  return problem?.title
    ? `La prueba encontró un problema: ${problem.title}.`
    : 'La prueba encontró un problema: revisá los chequeos.'
}

/**
 * «Probar conexión» (§2.6): los chequeos en orden (ARCA responde, ticket de
 * Facturación Electrónica, la SAS en el permiso, punto de venta, numeración,
 * padrón y vencimiento del certificado), cortando en el primero fatal. Borra el
 * cooldown manual del ticket (es la acción explícita después de arreglar algo).
 * Guarda el resultado con `acc_arca_record_test`, que decide `connected` o `error`.
 *
 * Entrada: `{ environment }`. Devuelve la prueba en palabras simples
 * (`ArcaTestView`): `ok: true` quiere decir que la prueba corrió, aunque haya dado
 * `status: 'error'`.
 */
export async function testArcaConnection(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ArcaTestView>> {
  const op = 'testConnection'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = environmentSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const { environment } = parsed.data
    try {
      rateLimit({ key: `arca-test:${auth.tenantId}:${environment}`, limit: 10, windowMs: 60_000 })
    } catch (e) {
      if (e instanceof RateLimitedError) return RATE_LIMITED
      throw e
    }

    const [conn, sas] = await Promise.all([
      loadArcaConnectionRow(auth.tenantId, environment),
      loadSasIdentity(auth.tenantId),
    ])
    if (!conn || !TESTABLE.has(conn.status) || conn.certNotAfter === null) {
      return accFailure('arca_not_ready')
    }

    const session = await openArcaSession({
      tenantId: auth.tenantId,
      environment,
      representedCuit: conn.representedCuit,
      clearManualCooldown: true,
      timeoutMs: TEST_CALL_TIMEOUT_MS,
      loginTimeoutMs: TEST_LOGIN_TIMEOUT_MS,
    })
    const run = await runConnectionTest({
      session,
      environment,
      representedCuit: conn.representedCuit,
      pointOfSale: conn.pointOfSale,
      allowedClasses: conn.allowedClasses,
      certNotAfter: dateOf(conn.certNotAfter),
      sasLegalName: sas?.legalName ?? null,
      budgetMs: CONNECTION_TEST_BUDGET_MS,
    })

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_arca_record_test', {
      p_tenant_id: auth.tenantId,
      p_environment: environment,
      p_result: { checks: run.checks },
    })
    if (error) return rpcFailure(`arca.${op}`, error)

    revalidateAccounting(slug)
    const saved = parseConnectionRow(data)
    const test = saved?.lastTest ?? {
      at: new Date().toISOString(),
      environment,
      status: run.status,
      checks: run.checks,
    }
    const view = arcaTestView(test, {
      alias: conn.alias,
      pointOfSale: conn.pointOfSale,
      sasName: sas?.legalName ?? null,
      environment,
    })
    return { ok: true, data: view, message: testMessage(view) }
  } catch (e) {
    return failureState(op, e)
  }
}

// ─── Desconectar y guía ──────────────────────────────────────────────────────

/**
 * Desconecta ARCA de un ambiente: la base borra la clave, el certificado y los
 * tickets, y deja la fila como historia. Exige escribir DESCONECTAR y que no haya
 * emisiones en curso.
 *
 * Entrada (`disconnectSchema`): `{ environment, confirm: 'DESCONECTAR' }`.
 */
export async function disconnectArca(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<{ environment: ArcaEnvironment }>> {
  const op = 'disconnect'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = disconnectSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const { environment, confirm } = parsed.data

    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_arca_disconnect', {
      p_tenant_id: auth.tenantId,
      p_environment: environment,
      p_confirm: confirm,
    })
    if (error) return rpcFailure(`arca.${op}`, error)

    revalidateAccounting(slug)
    return {
      ok: true,
      data: { environment },
      message:
        environment === 'produccion'
          ? 'Listo: ARCA quedó desconectado. Para volver a facturar vas a tener que repetir los pasos 5 a 9.'
          : `Listo: ARCA quedó desconectado en ${ARCA_ENVIRONMENT_LABELS[environment].toLowerCase()}.`,
    }
  } catch (e) {
    return failureState(op, e)
  }
}

/**
 * «Ya lo hice» de un paso manual de una guía (`acc_guide_progress`).
 *
 * Entrada (`guideMarkSchema`): `{ guide: 'arca' | 'arranque', step, done }`. En la
 * guía `arca`, `step` es uno de `ARCA_GUIDE_STEP_IDS`.
 */
export async function markGuideStep(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<{ guide: 'arca' | 'arranque'; step: string; done: boolean }>> {
  const op = 'markGuideStep'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = guideMarkSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const { guide, step, done } = parsed.data

    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_guide_mark', {
      p_tenant_id: auth.tenantId,
      p_guide: guide,
      p_step: step,
      p_done: done,
    })
    if (error) return rpcFailure(`arca.${op}`, error)

    revalidateAccounting(slug)
    return {
      ok: true,
      data: { guide, step, done },
      message: done ? 'Listo: paso marcado como hecho.' : 'Listo: el paso quedó pendiente.',
    }
  } catch (e) {
    return failureState(op, e)
  }
}

// ─── «Completar con ARCA» ────────────────────────────────────────────────────

/**
 * La constancia de inscripción de una CUIT para completar el alta de un proveedor
 * o un cliente (§3.1): caché del bar (30 días) o ARCA. Hasta 30 consultas por
 * minuto por bar.
 *
 * Entrada (`lookupCuitSchema`): `{ cuit, purpose: 'supplier' | 'customer', refresh? }`.
 * Nunca tira: `{ ok: true, data }` o `{ ok: false, code, message, step }`.
 */
export async function lookupCuit(slug: string, raw: unknown): Promise<PadronLookupResult> {
  try {
    if (badSlug(slug)) {
      return { ok: false, code: 'forbidden', message: accFailure('forbidden').message, step: null }
    }
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return { ok: false, code: 'forbidden', message: auth.state.message, step: null }
    const parsed = lookupCuitSchema.safeParse(formInput(raw))
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return {
        ok: false,
        code: first?.path[0] === 'cuit' ? 'invalid_cuit' : 'error',
        message: first?.message ?? 'Revisá la CUIT.',
        step: null,
      }
    }
    try {
      rateLimit({ key: `arca-padron:${auth.tenantId}`, limit: 30, windowMs: 60_000 })
    } catch (e) {
      if (e instanceof RateLimitedError) {
        return {
          ok: false,
          code: 'rate_limited',
          message: 'Hiciste muchas consultas seguidas. Esperá un minuto y probá de nuevo.',
          step: null,
        }
      }
      throw e
    }
    return await lookupPadron({
      tenantId: auth.tenantId,
      cuit: parsed.data.cuit,
      purpose: parsed.data.purpose,
      refresh: parsed.data.refresh,
    })
  } catch (e) {
    console.error('[arca.lookupCuit] inesperado', e instanceof Error ? e.name : 'unknown')
    return { ok: false, code: 'error', message: PADRON_MESSAGES.unexpected, step: null }
  }
}

// ─── Lecturas para componentes de cliente ────────────────────────────────────

/** Todo lo de la pestaña ARCA y la guía (para refrescar desde el cliente). Lectura. */
export async function fetchArcaOverview(slug: string): Promise<QueryOutcome<ArcaOverview>> {
  if (badSlug(slug))
    return { ok: false, code: 'forbidden', message: accFailure('forbidden').message }
  const auth = await authorizeAccounting(slug, 'read')
  if (!auth.ok) return { ok: false, code: auth.state.code, message: auth.state.message }
  return settleQuery(getArcaOverview(auth.tenantId))
}

/** Si se puede usar «Completar con ARCA» y con qué ambiente. Lectura. */
export async function fetchArcaLookupStatus(slug: string): Promise<QueryOutcome<ArcaLookupStatus>> {
  if (badSlug(slug))
    return { ok: false, code: 'forbidden', message: accFailure('forbidden').message }
  const auth = await authorizeAccounting(slug, 'read')
  if (!auth.ok) return { ok: false, code: auth.state.code, message: auth.state.message }
  return settleQuery(getArcaLookupStatus(auth.tenantId))
}
