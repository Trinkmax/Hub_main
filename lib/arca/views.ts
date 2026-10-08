/**
 * Lo que ve la pantalla de ARCA (diseño §2.2, §2.6, §3.1 y §5.1), en objetos simples
 * que se pueden mandar al navegador:
 *
 * - la conexión de cada ambiente **sin secretos** (ni clave, ni certificado, ni
 *   pedido, ni ticket: solo estados, fechas y datos de la SAS);
 * - la última «Probar conexión», con cada chequeo en palabras simples, su tono y el
 *   paso de la guía que lo arregla (`arcaTestView`);
 * - el resultado de «Completar con ARCA» (`PadronLookupResult`).
 *
 * Los textos de ARCA salen de `errors.ts` (`describeArcaErrorKey`); acá solo se
 * agregan los casos que dependen del detalle del chequeo (punto de venta sin
 * guardar, dado de baja, SAS inactiva…).
 *
 * Puro: lo arman `queries.ts` y `actions.ts` en el servidor, y los componentes de
 * cliente pueden importar los tipos y los textos.
 */

import type { IvaCondition } from '@/lib/accounting/types'
import { IVA_CONDITIONS } from '@/lib/accounting/types'
import { voucherDisplay } from '@/lib/accounting/voucher-types'
import { formatDate } from '@/lib/dates'
import { formatVoucherNumber, padPv } from '@/lib/fiscal'
import type { ArcaEnvironment } from './endpoints'
import { type ArcaErrorKey, type ArcaRetry, describeArcaErrorKey, isArcaErrorKey } from './errors'
import {
  ARCA_CHECK_KEYS,
  ARCA_CHECKS,
  ARCA_GUIDE_REASONS,
  type ArcaCheckKey,
  type ArcaConnectionStatus,
  type ArcaGuideReason,
  type ArcaGuideStepId,
  type ArcaStepState,
  type ArcaTestCheck,
  type ArcaTestResult,
  arcaTestStatus,
  isArcaCheckKey,
  stepForFailedCheck,
} from './guide'
import { type CbteTipo, isCbteTipo, voucherTypeForCbte } from './vouchers'

// ─── Etiquetas ───────────────────────────────────────────────────────────────

export const ARCA_ENVIRONMENT_LABELS: Readonly<Record<ArcaEnvironment, string>> = {
  produccion: 'Producción',
  homologacion: 'Homologación (pruebas)',
}

export const ARCA_STATUS_LABELS: Readonly<Record<ArcaConnectionStatus, string>> = {
  draft: 'Sin empezar',
  key_ready: 'Pedido generado',
  cert_ready: 'Certificado cargado: falta probar',
  connected: 'Conectado',
  error: 'Con un problema',
  disconnected: 'Desconectado',
}

const IVA_LABELS: Readonly<Record<IvaCondition, string>> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
  no_alcanzado: 'No alcanzado',
  sin_datos: 'Sin datos de IVA',
}

export function ivaConditionText(value: unknown): string | null {
  return typeof value === 'string' && (IVA_CONDITIONS as readonly string[]).includes(value)
    ? IVA_LABELS[value as IvaCondition]
    : null
}

/** El nombre del archivo del pedido: `arca-<alias>.csr`. */
export function csrFileName(alias: string): string {
  return `arca-${alias}.csr`
}

// ─── Conexión ────────────────────────────────────────────────────────────────

export type ArcaCertificateView = {
  readonly serial: string | null
  readonly issuer: string | null
  /** ISO. */
  readonly notBefore: string | null
  /** ISO. */
  readonly notAfter: string | null
  /** Días enteros hasta el vencimiento (negativo si ya venció). */
  readonly daysLeft: number | null
  readonly expired: boolean
  /** Faltan menos de 30 días: aviso de renovar (§2.2). */
  readonly renewSoon: boolean
}

/** Un problema para mostrar en un `Callout` con «Cómo se arregla». */
export type ArcaProblemView = {
  readonly key: string
  readonly title: string
  readonly body: string
  readonly step: ArcaGuideStepId | null
  readonly retry: ArcaRetry | null
}

/** La conexión de un ambiente, sin secretos (`acc_arca_connections`). */
export type ArcaConnectionView = {
  readonly id: string
  readonly environment: ArcaEnvironment
  readonly environmentLabel: string
  readonly status: ArcaConnectionStatus
  readonly statusLabel: string
  /** La SAS: `Auth.Cuit` de WSFE y `cuitRepresentada` del padrón (11 dígitos). */
  readonly representedCuit: string
  /** La CUIT del certificado (producción: la SAS; homologación: la persona de WSASS). */
  readonly certCuit: string
  readonly alias: string
  /** Hay clave y pedido (.csr) generados. El pedido se baja con `downloadArcaCsr`. */
  readonly hasCsr: boolean
  readonly csrFileName: string
  /** Hay una renovación en curso: una clave nueva espera su certificado. */
  readonly renewalPending: boolean
  readonly certificate: ArcaCertificateView | null
  readonly pointOfSale: number | null
  /** `B` siempre; `A` (común), `A51` (sujeta a retención) o `ACBU` (pago en CBU informada). */
  readonly allowedClasses: readonly string[]
  readonly defaultConcepto: 1 | 2 | 3
  readonly emissionEnabled: boolean
  /** Cómo dio cada servicio en la última prueba: `ok` o la clave del error. */
  readonly services: { readonly wsfe: string | null; readonly padron: string | null }
  readonly lastTestAt: string | null
  readonly lastTest: ArcaTestView | null
  /** El problema de la última prueba (estado `error`). */
  readonly lastError: ArcaProblemView | null
  /** Token de concurrencia (`expectedUpdatedAt` de las acciones que la editan). */
  readonly updatedAt: string
}

/** Un paso de la guía con su problema ya en palabras simples (si está en «Revisar» o «No anduvo»). */
export type ArcaGuideStepView = ArcaStepState & { readonly problem: ArcaProblemView | null }

export type ArcaGuideView = {
  readonly steps: readonly ArcaGuideStepView[]
  readonly summary: {
    readonly done: number
    readonly total: number
    readonly next: ArcaGuideStepId | null
  }
}

/** Un paso marcado a mano (`acc_guide_progress`). */
export type ArcaGuideMark = {
  readonly step: string
  readonly doneAt: string
  readonly doneByName: string | null
}

/** Con qué ambiente se puede consultar el padrón (`null`: no hay ARCA para eso). */
export type ArcaLookupStatus = {
  readonly environment: ArcaEnvironment | null
  /** Solo hay homologación: los datos son de prueba. */
  readonly testData: boolean
}

/** Un comprobante de ARCA que necesita atención (emisión de WP9). */
export type ArcaVoucherAttention = {
  readonly id: string
  readonly environment: ArcaEnvironment
  readonly status: 'needs_reconcile' | 'authorized'
  /** «Factura B 0005-00000105». */
  readonly label: string
  readonly cae: string | null
  readonly totalCents: number
  readonly issueDate: string | null
  readonly createdAt: string
}

export type ArcaOverview = {
  readonly sas: { readonly legalName: string | null; readonly cuit: string | null }
  readonly connections: Readonly<Record<ArcaEnvironment, ArcaConnectionView | null>>
  /** El estado de cada paso de la guía «Conectar ARCA», por ambiente. */
  readonly guide: Readonly<Record<ArcaEnvironment, ArcaGuideView>>
  readonly progress: readonly ArcaGuideMark[]
  readonly lookup: ArcaLookupStatus
  readonly attention: readonly ArcaVoucherAttention[]
}

/** «Factura B 0005-00000105» de un comprobante de WSFE. */
export function arcaVoucherLabel(
  cbteTipo: number,
  pointOfSale: number,
  number: number | null,
): string {
  if (!isCbteTipo(cbteTipo)) return `Comprobante ${formatVoucherNumber(pointOfSale, number ?? 0)}`
  return voucherDisplay(voucherTypeForCbte(cbteTipo as CbteTipo), pointOfSale, number)
}

// ─── «Probar conexión» ───────────────────────────────────────────────────────

/** `ok` ✓ · `warning` aviso que no frena · `error` ✗. */
export type ArcaCheckTone = 'ok' | 'warning' | 'error'

export type ArcaCheckView = {
  readonly key: ArcaCheckKey
  /** Orden en pantalla (1 a 7). */
  readonly n: number
  readonly label: string
  readonly ok: boolean
  /** Hace falta para quedar conectado. */
  readonly required: boolean
  readonly tone: ArcaCheckTone
  /** Título del problema (`null` si dio bien). */
  readonly title: string | null
  /** El texto en palabras simples (siempre). */
  readonly message: string
  readonly errorKey: ArcaErrorKey | null
  /** El paso de la guía que lo arregla. */
  readonly step: ArcaGuideStepId | null
  readonly retry: ArcaRetry | null
  /** El código técnico para soporte (`coe.notAuthorized`, `11002`…). */
  readonly code: string | null
}

/** Un chequeo que no se corrió porque la prueba se cortó antes. */
export type ArcaPendingCheckView = {
  readonly key: ArcaCheckKey
  readonly n: number
  readonly label: string
  readonly required: boolean
}

export type ArcaTestView = {
  /** ISO. */
  readonly at: string
  readonly environment: ArcaEnvironment
  readonly status: 'connected' | 'error'
  readonly checks: readonly ArcaCheckView[]
  readonly notRun: readonly ArcaPendingCheckView[]
  /** El primer problema (para el aviso de arriba y «Cómo se arregla»). */
  readonly firstProblem: ArcaCheckView | null
}

/** Datos del bar para completar los textos. */
export type ArcaViewContext = {
  readonly alias?: string | null
  readonly pointOfSale?: number | null
  /** Razón social de la SAS. */
  readonly sasName?: string | null
  readonly environment?: ArcaEnvironment | null
}

type Rec = Record<string, unknown>

function asRec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function int(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^-?\d{1,15}$/.test(value.trim())) return Number(value.trim())
  return null
}

/**
 * `acc_arca_connections.last_test` (jsonb) → la prueba, o `null` si no se puede
 * leer. Los chequeos que no tienen la forma esperada se descartan.
 */
export function readLastTest(raw: unknown): ArcaTestResult | null {
  const rec = asRec(raw)
  const at = text(rec?.at)
  if (!rec || !at || !Array.isArray(rec.checks)) return null
  const checks: ArcaTestCheck[] = []
  for (const item of rec.checks) {
    const check = asRec(item)
    if (!check || typeof check.key !== 'string' || typeof check.ok !== 'boolean') continue
    checks.push({
      key: check.key,
      ok: check.ok,
      detail: asRec(check.detail),
      error: typeof check.error === 'string' ? check.error : null,
    })
  }
  const status =
    rec.status === 'connected' || rec.status === 'error' ? rec.status : arcaTestStatus(checks)
  return { at, environment: text(rec.environment) ?? '', status, checks }
}

type Override = { title: string; message: string; step?: ArcaGuideStepId | null }

function pvText(detail: Rec, ctx: ArcaViewContext): string {
  const nro = int(detail.nro) ?? ctx.pointOfSale ?? null
  return nro !== null && nro > 0 ? padPv(nro, 4) : 'de la plataforma'
}

function okMessage(
  key: ArcaCheckKey,
  detail: Rec,
  ctx: ArcaViewContext,
): { message: string; tone: ArcaCheckTone } {
  // Lo que suma cada uno a su título (que ya dice qué se chequeó): repetirlo no decía nada.
  switch (key) {
    case 'service':
      return { message: 'Los servidores de ARCA contestaron bien.', tone: 'ok' }
    case 'wsfe_ticket':
      return {
        message: 'ARCA aceptó el certificado: la plataforma ya puede pedir el CAE de las facturas.',
        tone: 'ok',
      }
    case 'relations': {
      const sas = ctx.sasName?.trim()
      return {
        message: sas
          ? `El permiso es para facturar a nombre de ${sas.toLocaleUpperCase('es-AR')}.`
          : 'El permiso es para facturar a nombre de la SAS.',
        tone: 'ok',
      }
    }
    case 'point_of_sale':
      return detail.listed === false
        ? {
            message: `En homologación ARCA no lista los puntos de venta: las pruebas usan el ${pvText(detail, ctx)}.`,
            tone: 'ok',
          }
        : {
            message: `El punto de venta ${pvText(detail, ctx)} está habilitado para web services.`,
            tone: 'ok',
          }
    case 'numbering': {
      const pv = ctx.pointOfSale ?? null
      const parts: string[] = []
      for (const [tipo, label] of [
        ['6', 'Factura B'],
        ['1', 'Factura A'],
      ] as const) {
        const last = int(detail[tipo])
        if (last === null) continue
        const number = pv !== null && pv > 0 ? ` ${formatVoucherNumber(pv, last)}` : ` ${last}`
        parts.push(`Última ${label}:${number}${last === 0 ? ' (todavía ninguna)' : ''}`)
      }
      return {
        message: parts.length > 0 ? `${parts.join(' · ')}.` : 'ARCA contestó la numeración.',
        tone: 'ok',
      }
    }
    case 'padron': {
      if (detail.found === false) {
        return {
          message:
            'El padrón responde. En homologación no trae los datos de la SAS: es normal en las pruebas.',
          tone: 'ok',
        }
      }
      const name = text(detail.name)
      const iva = ivaConditionText(detail.iva)
      const base = name
        ? `ARCA reconoce a ${name}${iva ? ` · ${iva}` : ''}.`
        : 'El padrón responde y reconoce a la SAS.'
      return detail.name_matches === false
        ? {
            message: `${base} La razón social no coincide con la de Ajustes › Datos de la SAS: revisala.`,
            tone: 'warning',
          }
        : { message: base, tone: 'ok' }
    }
    case 'certificate': {
      const until = formatDate(text(detail.not_after))
      return {
        message: until ? `El certificado vale hasta el ${until}.` : 'El certificado está vigente.',
        tone: 'ok',
      }
    }
  }
}

function failureOverride(key: ArcaCheckKey, detail: Rec, ctx: ArcaViewContext): Override | null {
  // Se acababa el plazo de la prueba y este chequeo ni se empezó (no es que ARCA haya fallado).
  if (detail.timeout === true && detail.not_started === true) {
    return {
      title: 'No se llegó a probar',
      message:
        'ARCA venía lento y cortamos la prueba antes de este chequeo para no trabar la conexión. Volvé a tocar «Probar conexión».',
      step: null,
    }
  }
  if (detail.timeout === true) {
    return {
      title: 'ARCA tardó demasiado',
      message:
        'ARCA tardó demasiado en contestar y cortamos la prueba acá. Probá de nuevo en unos minutos.',
      step: null,
    }
  }
  if (key === 'point_of_sale') {
    if (detail.configured === false) {
      return {
        title: 'Falta el punto de venta',
        message:
          'Todavía no guardaste el número del punto de venta. Cargalo en el paso 2 y volvé a probar.',
        step: 's2_punto_venta',
      }
    }
    if (detail.state === 'dropped') {
      return {
        title: 'ARCA dio de baja el punto de venta',
        message: `El punto de venta ${pvText(detail, ctx)} está dado de baja en ARCA y no se puede volver a usar. Creá otro en el paso 2.`,
        step: 's2_punto_venta',
      }
    }
    if (detail.state === 'caea') {
      return {
        title: 'El punto de venta es de CAEA',
        message: `El punto de venta ${pvText(detail, ctx)} es para CAEA (contingencia), no para CAE. Creá uno «RECE para aplicativo y web services» en el paso 2.`,
        step: 's2_punto_venta',
      }
    }
  }
  if (key === 'padron') {
    if (detail.found === false) {
      return {
        title: 'ARCA no encuentra a la SAS',
        message:
          'ARCA no encontró la CUIT de la SAS en el padrón. Revisá la CUIT en Ajustes › Datos de la SAS.',
        step: 's0_prereq',
      }
    }
    if (detail.active === false) {
      return {
        title: 'La CUIT de la SAS no está activa',
        message:
          'ARCA dice que la CUIT de la SAS no está activa. Lo resuelve quien maneja la clave fiscal de la SAS, con la contadora (paso 0).',
        step: 's0_prereq',
      }
    }
  }
  return null
}

function checkView(key: ArcaCheckKey, check: ArcaTestCheck, ctx: ArcaViewContext): ArcaCheckView {
  const def = ARCA_CHECKS[key]
  const detail = asRec(check.detail) ?? {}
  const base = { key, n: def.n, label: def.label, required: def.required }
  if (check.ok) {
    const { message, tone } = okMessage(key, detail, ctx)
    return {
      ...base,
      ok: true,
      tone,
      title: null,
      message,
      errorKey: null,
      step: null,
      retry: null,
      code: null,
    }
  }
  const errorKey = isArcaErrorKey(check.error) ? check.error : null
  const code = text(detail.code)
  if (!errorKey) {
    // Un aviso sin error: el certificado vence en menos de 30 días (§2.6, chequeo 7).
    if (key === 'certificate' && detail.renew_soon === true) {
      const until = formatDate(text(detail.not_after))
      return {
        ...base,
        ok: false,
        tone: 'warning',
        title: 'El certificado vence pronto',
        message: `Vence${until ? ` el ${until}` : ' en menos de 30 días'}: renovalo antes con «Renovar certificado» (paso 6).`,
        errorKey: null,
        step: 's6_certificado',
        retry: 'after_fix',
        code: null,
      }
    }
    return {
      ...base,
      ok: false,
      tone: def.required ? 'error' : 'warning',
      title: 'No dio bien',
      message: 'Este chequeo no dio bien. Probá de nuevo en unos minutos; si sigue, avisanos.',
      errorKey: null,
      step: null,
      retry: 'later',
      code,
    }
  }
  const described = describeArcaErrorKey(
    errorKey,
    {
      alias: ctx.alias ?? null,
      pointOfSale: ctx.pointOfSale ?? null,
      sasName: ctx.sasName ?? null,
      environment: ctx.environment ?? null,
      service: key === 'padron' ? 'padron' : null,
    },
    { code },
  )
  const override = failureOverride(key, detail, ctx)
  const message = override?.message ?? described.body
  return {
    ...base,
    ok: false,
    tone: def.required || errorKey === 'arca_cert_expired' ? 'error' : 'warning',
    title: override?.title ?? described.title,
    // ARCA rechazó el ticket guardado y la prueba ya lo descartó (`acc_arca_ticket_drop`).
    message:
      detail.ticket_dropped === true
        ? `${message} ARCA rechazó el permiso guardado y ya lo descartamos: esperá unos minutos y volvé a probar.`
        : message,
    errorKey,
    step:
      override && override.step !== undefined ? override.step : stepForFailedCheck(key, errorKey),
    retry: described.retry,
    code,
  }
}

/**
 * La prueba en palabras simples: cada chequeo que se corrió (en el orden de §2.6),
 * los que no se llegaron a correr y el primer problema.
 */
export function arcaTestView(test: ArcaTestResult, ctx: ArcaViewContext = {}): ArcaTestView {
  const byKey = new Map<ArcaCheckKey, ArcaTestCheck>()
  for (const check of test.checks) {
    if (isArcaCheckKey(check.key) && !byKey.has(check.key)) byKey.set(check.key, check)
  }
  const checks: ArcaCheckView[] = []
  const notRun: ArcaPendingCheckView[] = []
  for (const key of ARCA_CHECK_KEYS) {
    const check = byKey.get(key)
    const def = ARCA_CHECKS[key]
    if (check) checks.push(checkView(key, check, ctx))
    else notRun.push({ key, n: def.n, label: def.label, required: def.required })
  }
  const environment =
    test.environment === 'produccion' || test.environment === 'homologacion'
      ? test.environment
      : (ctx.environment ?? 'produccion')
  return {
    at: test.at,
    environment,
    status: test.status,
    checks,
    notRun,
    firstProblem:
      checks.find((c) => !c.ok && c.tone === 'error') ?? checks.find((c) => !c.ok) ?? null,
  }
}

/** El problema guardado en la conexión (`last_error_key`), en palabras simples. */
export function arcaProblemView(
  key: string | null | undefined,
  ctx: ArcaViewContext = {},
): ArcaProblemView | null {
  if (!isArcaErrorKey(key)) return null
  const described = describeArcaErrorKey(key, {
    alias: ctx.alias ?? null,
    pointOfSale: ctx.pointOfSale ?? null,
    sasName: ctx.sasName ?? null,
    environment: ctx.environment ?? null,
  })
  return {
    key,
    title: described.title,
    body: described.body,
    step: described.step,
    retry: described.retry,
  }
}

const GUIDE_REASON_TITLES: Readonly<Record<ArcaGuideReason, string>> = {
  sas_cuit_missing: 'Falta la CUIT de la SAS',
  cert_expired: 'El certificado venció',
}

/** El motivo de un paso de la guía (`ArcaStepState.reason`) en palabras simples. */
export function arcaStepProblem(
  reason: string | null | undefined,
  ctx: ArcaViewContext = {},
): ArcaProblemView | null {
  if (reason === 'sas_cuit_missing' || reason === 'cert_expired') {
    return {
      key: reason,
      title: GUIDE_REASON_TITLES[reason],
      body: ARCA_GUIDE_REASONS[reason],
      step: reason === 'cert_expired' ? 's6_certificado' : 's0_prereq',
      retry: 'after_fix',
    }
  }
  return arcaProblemView(reason, ctx)
}

// ─── Lo que devuelven las acciones (`lib/arca/actions.ts`) ───────────────────

/** `startArcaCertificate`: el pedido para subir a ARCA. Nunca la clave. */
export type ArcaCsrResult = {
  readonly environment: ArcaEnvironment
  readonly alias: string
  /** PEM del pedido (público: es lo que se sube a ARCA). */
  readonly csrPem: string
  /** `arca-<alias>.csr`: el navegador arma el archivo con un `Blob`. */
  readonly fileName: string
  readonly mode: 'new' | 'replace' | 'renew'
  readonly status: ArcaConnectionStatus | null
  /** Token de concurrencia de la conexión después de guardar. */
  readonly updatedAt: string | null
}

/** `uploadArcaCertificate`: los datos del certificado guardado (nunca el PEM). */
export type ArcaCertificateResult = {
  readonly environment: ArcaEnvironment
  /** Número de serie en hex (mayúsculas). */
  readonly serial: string
  readonly subjectCn: string | null
  readonly subjectCuit: string | null
  /** ISO. */
  readonly notBefore: string
  /** ISO. */
  readonly notAfter: string
  readonly daysLeft: number
  /** Era el certificado de una renovación (la clave nueva pasó a ser la vigente). */
  readonly renewal: boolean
  /** Avisos que no frenan (p. ej. el alias del certificado no es el del pedido). */
  readonly warnings: readonly string[]
  readonly connection: ArcaConnectionView | null
}

/** `saveArcaPointOfSale`: la conexión y el punto de venta en Ajustes › Puntos de venta. */
export type ArcaPointOfSaleResult = {
  readonly connection: ArcaConnectionView | null
  /** Solo en producción: `created` (lo creamos como «Plataforma (ARCA)»), `existing` o `failed`. */
  readonly salesPoint: {
    readonly status: 'created' | 'existing' | 'failed'
    readonly number: number
    readonly label: string | null
  } | null
  readonly warnings: readonly string[]
}

/** `downloadArcaCsr`: el pedido guardado, para bajarlo de nuevo. */
export type ArcaCsrDownload = {
  readonly alias: string
  readonly csrPem: string
  readonly fileName: string
}

// ─── «Completar con ARCA» (padrón) ───────────────────────────────────────────

export type PadronPurpose = 'supplier' | 'customer'

export type PadronWarning = {
  readonly key: 'inactive' | 'monotributo' | 'needs_review' | 'test_data'
  readonly message: string
}

/** Lo que trae ARCA de una CUIT, listo para completar el alta (§3.1). */
export type PadronLookupData = {
  readonly cuit: string
  readonly name: string
  readonly personKind: 'fisica' | 'juridica' | null
  readonly active: boolean
  /** Para `acc_parties.iva_condition`. */
  readonly ivaCondition: IvaCondition
  /** Para `CondicionIVAReceptorId` de WSFE (`null`: hay que elegirla). */
  readonly condicionIvaReceptorId: number | null
  /** La condición no es segura: que la persona la confirme. */
  readonly needsReview: boolean
  readonly monotributoCategory: string | null
  readonly address: string | null
  readonly locality: string | null
  readonly province: string | null
  readonly activity: { readonly code: string; readonly description: string | null } | null
  readonly source: 'arca' | 'cache'
  readonly environment: ArcaEnvironment
  /** Consultado en homologación: datos de prueba. */
  readonly testData: boolean
  /** ISO. */
  readonly fetchedAt: string
  readonly warnings: readonly PadronWarning[]
}

export type PadronLookupFailureCode =
  | 'arca_not_connected'
  | 'invalid_cuit'
  | 'not_found'
  | 'arca_unavailable'
  | 'arca_not_authorized'
  | 'rate_limited'
  | 'forbidden'
  | 'error'

export type PadronLookupResult =
  | { readonly ok: true; readonly data: PadronLookupData }
  | {
      readonly ok: false
      readonly code: PadronLookupFailureCode
      readonly message: string
      /** El paso de la guía que lo arregla (p. ej. el 8 si falta autorizar el padrón). */
      readonly step: ArcaGuideStepId | null
    }

function ivaCondition(value: unknown): IvaCondition {
  return typeof value === 'string' && (IVA_CONDITIONS as readonly string[]).includes(value)
    ? (value as IvaCondition)
    : 'sin_datos'
}

/** Los avisos de §3.1 según para qué es la consulta. */
export function padronWarnings(
  data: Pick<PadronLookupData, 'active' | 'ivaCondition' | 'needsReview' | 'testData'>,
  purpose: PadronPurpose,
): PadronWarning[] {
  const out: PadronWarning[] = []
  if (!data.active) {
    out.push({
      key: 'inactive',
      message:
        purpose === 'supplier'
          ? 'ARCA dice que esta CUIT está inactiva: no te sirve su factura para el crédito fiscal.'
          : 'ARCA dice que esta CUIT está inactiva: revisala antes de facturarle.',
    })
  }
  if (purpose === 'supplier' && data.ivaCondition === 'monotributo') {
    out.push({
      key: 'monotributo',
      message: 'Es monotributista: te va a hacer Factura C (no da crédito fiscal).',
    })
  }
  if (data.needsReview) {
    out.push({
      key: 'needs_review',
      message: 'Revisá la condición frente al IVA: lo que dice ARCA no alcanza para estar seguros.',
    })
  }
  if (data.testData) {
    out.push({ key: 'test_data', message: 'Son datos de prueba (homologación de ARCA).' })
  }
  return out
}

/**
 * Una fila de la caché (`acc_arca_padron_cache.data`, la forma de `padronCacheRow`)
 * → los datos para el alta. `null` si la fila no tiene la forma esperada.
 */
export function padronDataFromRow(input: {
  readonly cuit: string
  readonly data: unknown
  readonly environment: ArcaEnvironment
  readonly fetchedAt: string
  readonly source: 'arca' | 'cache'
  readonly purpose: PadronPurpose
}): PadronLookupData | null {
  const data = asRec(input.data)
  const name = text(data?.name)
  if (!data || !name) return null
  const activity = asRec(data.activity)
  const activityCode = text(activity?.code)
  const personKind: PadronLookupData['personKind'] =
    data.person_kind === 'fisica' ? 'fisica' : data.person_kind === 'juridica' ? 'juridica' : null
  const base = {
    cuit: input.cuit,
    name,
    personKind,
    active: data.active === true,
    ivaCondition: ivaCondition(data.iva_condition),
    condicionIvaReceptorId: int(data.condicion_iva_receptor_id),
    needsReview: data.needs_review === true,
    monotributoCategory: text(data.monotributo_category),
    address: text(data.address),
    locality: text(data.locality),
    province: text(data.province),
    activity: activityCode
      ? { code: activityCode, description: text(activity?.description) }
      : null,
    source: input.source,
    environment: input.environment,
    testData: input.environment === 'homologacion',
    fetchedAt: input.fetchedAt,
  }
  return { ...base, warnings: padronWarnings(base, input.purpose) }
}
