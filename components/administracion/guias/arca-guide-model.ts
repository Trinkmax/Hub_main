/**
 * Lo que la pantalla necesita decidir de la guía «Conectar ARCA» y de la pestaña ARCA de
 * Ajustes, en funciones puras (sin React ni red): textos de estado, el estado de la tarjeta
 * (A · B · C · D), el aviso del certificado, la Factura A elegida, el alias que proponemos,
 * los anclajes `#paso-N` y el chequeo del archivo antes de subirlo.
 *
 * El estado de cada paso lo calcula `lib/arca/guide.ts` (servidor y cliente); acá solo se lo
 * traduce a lo que ve la persona. Lo usan la guía (`ajustes/arca`), la pestaña y los tests.
 */

import type { ArcaEnvironment } from '@/lib/arca/endpoints'
import {
  ARCA_GUIDE_STEPS,
  type ArcaGuideStep,
  type ArcaGuideStepId,
  type ArcaStepStatus,
  isArcaGuideStepId,
} from '@/lib/arca/guide'
import { CERT_FILE_MAX_BYTES, UNREADABLE_CERT_MESSAGE } from '@/lib/arca/schemas'
import type { ArcaCertificateView, ArcaConnectionView } from '@/lib/arca/views'
import { formatDate } from '@/lib/dates'
import { formatCuit, normalizeCuit } from '@/lib/fiscal'

// ─── Estado de un paso ───────────────────────────────────────────────────────

/** Los estados de un paso de cualquier guía (los mismos que calcula `lib/arca/guide.ts`). */
export type GuideStepStatus = ArcaStepStatus

export const GUIDE_STATUS_TEXT: Readonly<Record<GuideStepStatus, string>> = {
  done: 'Hecho',
  todo: 'Te toca',
  pending: 'Pendiente',
  check: 'Revisar',
  failed: 'No anduvo',
}

/** «Hecho», «Te toca»… Un paso opcional sin hacer dice «Opcional» en vez de «Pendiente». */
export function guideStatusText(status: GuideStepStatus, optional = false): string {
  if (optional && status === 'pending') return 'Opcional'
  return GUIDE_STATUS_TEXT[status]
}

/** Lo que hace falta del estado de un paso para escribir cómo quedó hecho. */
export type StepDoneInfo = {
  readonly status: GuideStepStatus
  readonly source: 'manual' | 'auto' | 'test' | null
  readonly doneAt: string | null
  readonly doneBy: string | null
}

/**
 * El resumen de un paso hecho (la línea gris del encabezado):
 * «Hecho el 08/10 por Ana» si lo marcó alguien, «Hecho: lo vimos solo» si la plataforma lo
 * vio, «Hecho: lo confirmó la prueba» si lo confirmó «Probar conexión». `null` si no está hecho.
 */
export function doneNote(state: StepDoneInfo): string | null {
  if (state.status !== 'done') return null
  if (state.source === 'manual') {
    const day = formatDate(state.doneAt).slice(0, 5)
    const by = state.doneBy?.trim()
    if (day && by) return `Hecho el ${day} por ${by}`
    if (day) return `Hecho el ${day}`
    return 'Lo marcaron como hecho'
  }
  if (state.source === 'test') return 'Hecho: lo confirmó la prueba'
  return 'Hecho: lo vimos solo'
}

// ─── Anclajes y orden ────────────────────────────────────────────────────────

/** `paso-6`: el `id` de la sección del paso 6 (y el `#paso-6` de los links). */
export function stepAnchor(n: number): string {
  return `paso-${n}`
}

/** El paso de un `#paso-N` (o `paso-N`); `null` si no es un paso de la guía. */
export function stepIdForHash(hash: string | null | undefined): ArcaGuideStepId | null {
  const match = /^#?paso-(\d{1,2})$/.exec((hash ?? '').trim())
  if (!match) return null
  const n = Number(match[1])
  return ARCA_GUIDE_STEPS.find((s) => s.n === n)?.id ?? null
}

/** El paso de un id (o `null` si no existe). */
export function guideStepById(id: string): ArcaGuideStep | null {
  return isArcaGuideStepId(id) ? (ARCA_GUIDE_STEPS.find((s) => s.id === id) ?? null) : null
}

/** El paso que sigue (en el orden de la guía, opcionales incluidos); `null` después del último. */
export function nextGuideStep(id: ArcaGuideStepId): ArcaGuideStep | null {
  const index = ARCA_GUIDE_STEPS.findIndex((s) => s.id === id)
  return index >= 0 ? (ARCA_GUIDE_STEPS[index + 1] ?? null) : null
}

/** «5 de 9 pasos listos». */
export function progressText(summary: { readonly done: number; readonly total: number }): string {
  return `${summary.done} de ${summary.total} ${summary.total === 1 ? 'paso listo' : 'pasos listos'}`
}

/** El porcentaje de la barra (0 a 100, entero). */
export function progressPercent(summary: {
  readonly done: number
  readonly total: number
}): number {
  if (summary.total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((summary.done / summary.total) * 100)))
}

/**
 * La línea del celular y del riel con lo próximo: «Te toca: 6. Creá el certificado…», «Revisá:
 * 7. …» o «No anduvo: 9. …». `null` si no queda nada obligatorio por hacer.
 */
export function nextStepLine(
  summary: { readonly next: ArcaGuideStepId | null },
  statuses: ReadonlyArray<{ readonly id: ArcaGuideStepId; readonly status: GuideStepStatus }>,
): {
  readonly prefix: string
  readonly step: ArcaGuideStep
  readonly status: GuideStepStatus
} | null {
  if (!summary.next) return null
  const step = guideStepById(summary.next)
  if (!step) return null
  const status = statuses.find((s) => s.id === summary.next)?.status ?? 'todo'
  const prefix = status === 'check' ? 'Revisá' : status === 'failed' ? 'No anduvo' : 'Te toca'
  return { prefix, step, status }
}

// ─── Tarjeta de la pestaña ARCA (diseño §2.2) ────────────────────────────────

/** A · sin empezar · B · en curso · C · conectado · D · con un problema. */
export type ArcaCardState = 'not_started' | 'in_progress' | 'connected' | 'error'

/**
 * Qué tarjeta va en Ajustes › ARCA para producción. Sin fila (o en borrador, o desconectada)
 * y sin ningún paso hecho es «sin empezar»; con algún paso hecho, un pedido o un certificado,
 * «en curso». La prueba manda en los otros dos.
 */
export function arcaCardState(
  connection: Pick<ArcaConnectionView, 'status'> | null,
  summary: { readonly done: number },
): ArcaCardState {
  const status = connection?.status ?? null
  if (status === 'connected') return 'connected'
  if (status === 'error') return 'error'
  if (status === 'key_ready' || status === 'cert_ready') return 'in_progress'
  return summary.done > 0 ? 'in_progress' : 'not_started'
}

/** El tono y el texto del vencimiento del certificado (§2.2: aviso con menos de 30 días). */
export function certificateNote(
  certificate: ArcaCertificateView | null,
): { readonly tone: 'ok' | 'warning' | 'error'; readonly text: string } | null {
  if (!certificate) return null
  const until = formatDate(certificate.notAfter)
  if (certificate.expired) {
    return {
      tone: 'error',
      text: until ? `El certificado venció el ${until}.` : 'El certificado venció.',
    }
  }
  if (certificate.renewSoon) {
    const days = certificate.daysLeft
    const left =
      days === null
        ? 'en menos de 30 días'
        : days <= 0
          ? 'hoy'
          : `en ${days} ${days === 1 ? 'día' : 'días'}`
    return {
      tone: 'warning',
      text: until
        ? `El certificado vence ${left} (el ${until}): renovalo antes.`
        : `El certificado vence ${left}: renovalo antes.`,
    }
  }
  return {
    tone: 'ok',
    text: until ? `Certificado hasta el ${until}.` : 'El certificado está vigente.',
  }
}

// ─── ¿Qué Factura A te autorizó ARCA? ────────────────────────────────────────

export type ArcaClassChoice = 'none' | 'A' | 'A51' | 'ACBU'

export const ARCA_CLASS_CHOICES: ReadonlyArray<{
  readonly value: ArcaClassChoice
  readonly label: string
  readonly hint: string
}> = [
  {
    value: 'none',
    label: 'Todavía no tengo Factura A',
    hint: 'Solo vas a poder emitir Factura B (a consumidores finales).',
  },
  {
    value: 'A',
    label: 'A común',
    hint: 'La Factura A de siempre, para empresas y responsables inscriptos.',
  },
  {
    value: 'A51',
    label: 'A con «Operación sujeta a retención»',
    hint: 'Al cliente le retienen el IVA y parte de Ganancias: a las empresas no les conviene.',
  },
  {
    value: 'ACBU',
    label: 'A con «Pago en CBU informada»',
    hint: 'El cliente te paga por transferencia a la cuenta que informaste en ARCA.',
  },
]

/** La opción que corresponde a las clases guardadas (la B va siempre y no cuenta). */
export function classChoiceFor(allowed: readonly string[] | null | undefined): ArcaClassChoice {
  const list = allowed ?? []
  for (const choice of ['A', 'A51', 'ACBU'] as const) if (list.includes(choice)) return choice
  return 'none'
}

/** Lo que se guarda para una opción: siempre la B, más la Factura A que corresponda. */
export function allowedClassesFor(choice: ArcaClassChoice): Array<'A' | 'B' | 'A51' | 'ACBU'> {
  return choice === 'none' ? ['B'] : [choice, 'B']
}

// ─── Alias del certificado ───────────────────────────────────────────────────

const ALIAS_MAX = 30

/**
 * El alias que proponemos (solo letras y números, de 3 a 30): el nombre corto del bar más
 * «plataforma» (o «test» en homologación). `mibar` → `mibarplataforma`.
 */
export function suggestArcaAlias(
  seed: string | null | undefined,
  environment: ArcaEnvironment,
): string {
  const suffix = environment === 'produccion' ? 'plataforma' : 'test'
  const base = (seed ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, ALIAS_MAX - suffix.length)
  const alias = `${base}${suffix}`
  return alias.length >= 3 ? alias : suffix
}

// ─── El archivo del certificado (antes de subirlo) ───────────────────────────

/**
 * Los mismos textos que da el servidor (`uploadArcaCertificate`, diseño §2.4.2). Acá se usan
 * para frenar antes de mandar: una clave privada o un .p12 no tienen que salir de la compu.
 */
export const CERT_PRECHECK_MESSAGES = {
  csr: 'Subiste el pedido (.csr), no el certificado. El certificado lo bajás de ARCA en el paso 6, con el ícono de «Descargar».',
  private_key:
    'Eso es una clave privada: no la subas a ningún lado. La plataforma ya tiene la suya.',
  pkcs12: 'Ese archivo trae clave y certificado juntos. Bajá de ARCA solo el certificado (.crt).',
  unreadable: UNREADABLE_CERT_MESSAGE,
} as const

export type CertPrecheck =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly kind: keyof typeof CERT_PRECHECK_MESSAGES
      readonly message: string
    }

function refuse(kind: keyof typeof CERT_PRECHECK_MESSAGES): CertPrecheck {
  return { ok: false, kind, message: CERT_PRECHECK_MESSAGES[kind] }
}

/**
 * Lo que se puede saber del archivo sin mandarlo: el tamaño (≤ 16 KB), la extensión y, si es
 * texto, el encabezado PEM. `headText` son los primeros bytes leídos como texto (o `null`). Lo
 * que no se reconoce acá lo decide el servidor (un DER, por ejemplo).
 */
export function precheckCertFile(file: {
  readonly name: string
  readonly size: number
  readonly headText: string | null
}): CertPrecheck {
  if (file.size <= 0 || file.size > CERT_FILE_MAX_BYTES) return refuse('unreadable')
  const name = file.name.trim().toLowerCase()
  const head = file.headText ?? ''
  if (/\.(p12|pfx)$/.test(name)) return refuse('pkcs12')
  if (/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(head)) return refuse('private_key')
  if (/-----BEGIN (?:NEW )?CERTIFICATE REQUEST-----/.test(head)) return refuse('csr')
  if (/-----BEGIN CERTIFICATE-----/.test(head)) return { ok: true }
  if (name.endsWith('.key')) return refuse('private_key')
  if (name.endsWith('.csr')) return refuse('csr')
  return { ok: true }
}

/** Texto (el PEM que se pega) → base64, sin `Buffer` (corre en el navegador). */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// ─── Datos para las maquetas ─────────────────────────────────────────────────

/** Lo que muestran las maquetas: exactamente lo que la persona tiene que ver o escribir. */
export type ArcaMockData = {
  /** Razón social en mayúsculas, como la muestra ARCA. */
  readonly sasName: string
  /** `30-71234567-1`. */
  readonly sasCuit: string
  /** `30712345671` (como va en el DN del certificado). */
  readonly sasCuitDigits: string
  readonly alias: string
  /** El número del punto de venta, o vacío si todavía no lo guardaron. */
  readonly pointOfSale: string
  readonly csrFileName: string
  /** Nunca inventamos la CUIT ni el nombre de la persona. */
  readonly personName: string
  readonly personCuit: string
}

export const DEFAULT_MOCK_DATA: ArcaMockData = {
  sasName: 'TU SAS',
  sasCuit: 'CUIT DE LA SAS',
  sasCuitDigits: 'CUIT DE LA SAS',
  alias: 'plataforma',
  pointOfSale: '',
  csrFileName: 'arca-plataforma.csr',
  personName: 'TU NOMBRE',
  personCuit: 'TU CUIT',
}

/** Los datos del bar → lo que muestran las maquetas. */
export function arcaMockData(input: {
  readonly legalName: string | null | undefined
  readonly cuit: string | null | undefined
  readonly alias: string
  readonly pointOfSale: number | null | undefined
}): ArcaMockData {
  const legal = input.legalName?.trim()
  const digits = normalizeCuit(input.cuit)
  const hasCuit = digits.length === 11
  const alias = input.alias.trim() || DEFAULT_MOCK_DATA.alias
  return {
    sasName: legal ? legal.toLocaleUpperCase('es-AR') : DEFAULT_MOCK_DATA.sasName,
    sasCuit: hasCuit ? formatCuit(digits) : DEFAULT_MOCK_DATA.sasCuit,
    sasCuitDigits: hasCuit ? digits : DEFAULT_MOCK_DATA.sasCuitDigits,
    alias,
    pointOfSale:
      input.pointOfSale && input.pointOfSale > 0
        ? String(input.pointOfSale)
        : DEFAULT_MOCK_DATA.pointOfSale,
    csrFileName: `arca-${alias}.csr`,
    personName: DEFAULT_MOCK_DATA.personName,
    personCuit: DEFAULT_MOCK_DATA.personCuit,
  }
}

/** «MI BAR SAS» (la razón social en mayúsculas) para los textos, o «la SAS» si no hay razón social. */
export function sasLabel(legalName: string | null | undefined): string {
  const legal = legalName?.trim()
  return legal ? legal.toLocaleUpperCase('es-AR') : 'la SAS'
}
