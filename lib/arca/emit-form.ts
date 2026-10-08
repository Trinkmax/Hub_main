/**
 * Emitir con CAE desde «Ventas › Factura de venta» (diseño §3.2.2, §3.2.3 y
 * §3.2.5): lo que comparten el formulario (navegador) y las acciones (servidor).
 *
 * - `arcaEmitSchema`: el esquema de la factura de venta de siempre
 *   (`salesInvoiceSchema`: centavos, alícuotas, «Ya la cobraste»…) más el bloque
 *   `arca` (número que vio la persona, condición frente al IVA del cliente,
 *   concepto, fechas del servicio, detalle impreso y la factura que corrige una
 *   NC o ND). El número que vio la persona entra al hash de la vista previa: si
 *   ARCA dice otro, la acción devuelve la vista nueva (`preview_stale`).
 * - Las reglas que se ven al tipear: la letra según la condición del cliente
 *   (`arcaLetterFor`, RG 5003/2021), la ventana de fechas (`arcaDateWindow`), el
 *   documento del cliente y el tope de la Factura B sin identificar
 *   (`arcaReceiverIssue`).
 * - Lo que se guarda en `acc_arca_vouchers.form` (`ArcaStoredForm`): los valores
 *   para «Cargarla ahora», el hash que aprobó la persona y el detalle impreso.
 * - Los tipos de lo que devuelven `emit-actions.ts` y `emit-queries.ts`.
 *
 * Puro: sin `server-only`. Los textos, en rioplatense y sin jerga.
 */

import { z } from 'zod'
import type { WarningCopy } from '@/lib/accounting/errors'
import { PREVIEW_HASH_RE } from '@/lib/accounting/preview'
import {
  optionalCuitField,
  optionalIsoDay,
  salesInvoiceSchema,
  uuidField,
  voucherNumberField,
} from '@/lib/accounting/schemas'
import {
  type EntryPreview,
  type IsoDate,
  type TaxIdType,
  WARNING_KEYS,
  type WarningKey,
} from '@/lib/accounting/types'
import { addDays, isRealIsoDay } from '@/lib/dates'
import { parseCuit } from '@/lib/fiscal'
import { formatCents } from '@/lib/money'
import type { ArcaEnvironment } from './endpoints'
import {
  type ArcaVoucherType,
  CBTE_TIPO,
  type CbteTipo,
  CONDICION_IVA_RECEPTOR_IDS,
  FINAL_CONSUMER_ID_THRESHOLD_CENTS,
  isCbteTipo,
  letterForCondicion,
} from './vouchers'

const DATA_MESSAGE = 'Revisá los datos.'

function obj<T extends z.core.$ZodLooseShape>(shape: T) {
  return z.object(shape, { message: DATA_MESSAGE })
}

// ─── Tipos de comprobante y letra ────────────────────────────────────────────

export const ARCA_EMIT_DOC_KINDS = [
  'sales_invoice',
  'sales_credit_note',
  'sales_debit_note',
] as const
export type ArcaEmitDocKind = (typeof ARCA_EMIT_DOC_KINDS)[number]

export type ArcaLetter = 'A' | 'B'

const VOUCHER_BY_KIND: Readonly<
  Record<ArcaEmitDocKind, Readonly<Record<ArcaLetter, ArcaVoucherType>>>
> = {
  sales_invoice: { A: 'factura_a', B: 'factura_b' },
  sales_credit_note: { A: 'nota_credito_a', B: 'nota_credito_b' },
  sales_debit_note: { A: 'nota_debito_a', B: 'nota_debito_b' },
}

/** `('sales_invoice', 'B')` → `'factura_b'`. */
export function arcaVoucherTypeFor(kind: ArcaEmitDocKind, letter: ArcaLetter): ArcaVoucherType {
  return VOUCHER_BY_KIND[kind][letter]
}

/** `('sales_invoice', 'B')` → `6`. */
export function arcaCbteFor(kind: ArcaEmitDocKind, letter: ArcaLetter): CbteTipo {
  return CBTE_TIPO[arcaVoucherTypeFor(kind, letter)]
}

/** ¿La plataforma emite este tipo por ARCA? (Factura, ND y NC, A o B; los tiques no). */
export function isArcaVoucherType(type: unknown): type is ArcaVoucherType {
  return typeof type === 'string' && Object.hasOwn(CBTE_TIPO, type)
}

/** La letra de un tipo de comprobante de venta (`'factura_b'` → `'B'`). */
export function letterOfVoucherType(type: string): ArcaLetter | null {
  if (type.endsWith('_a')) return 'A'
  if (type.endsWith('_b')) return 'B'
  return null
}

export type ArcaLetterChoice =
  | { readonly ok: true; readonly letter: ArcaLetter }
  | { readonly ok: false; readonly reason: 'condition_missing'; readonly letter: null }
  | { readonly ok: false; readonly reason: 'class_a_not_enabled'; readonly letter: 'A' }

/**
 * La letra según la condición frente al IVA del cliente (RG 5616) y lo que ARCA
 * le habilitó a la SAS (`allowed_classes`): A a 1, 6, 13 y 16 (responsable
 * inscripto y las tres de monotributo, RG 5003/2021) y B al resto. Si le
 * corresponde A y la SAS no tiene la Factura A habilitada, no se puede emitir:
 * a un monotributista o a un inscripto no se le hace B (ARCA la rechaza, 10243).
 */
export function arcaLetterFor(
  condicionId: number | null | undefined,
  allowedClasses: readonly string[],
): ArcaLetterChoice {
  const letter = condicionId == null ? null : letterForCondicion(condicionId)
  if (letter === null) return { ok: false, reason: 'condition_missing', letter: null }
  if (letter === 'A' && !allowedClasses.includes('A')) {
    return { ok: false, reason: 'class_a_not_enabled', letter: 'A' }
  }
  return { ok: true, letter }
}

// ─── Concepto y fechas ───────────────────────────────────────────────────────

export type ArcaConcepto = 1 | 2 | 3

export const ARCA_CONCEPTO_LABELS: Readonly<Record<ArcaConcepto, string>> = {
  1: 'Productos',
  2: 'Servicios',
  3: 'Productos y servicios',
}

/**
 * Cuántos días para atrás acepta ARCA la fecha del comprobante (manual WSFEv1
 * v4.7): 5 con productos, 10 con servicios. Para adelante la plataforma no deja
 * pasar de hoy (más conservador que ARCA).
 */
export const ARCA_DAYS_BACK: Readonly<Record<ArcaConcepto, number>> = { 1: 5, 2: 10, 3: 10 }

export type ArcaDateWindow = {
  /** La primera fecha que se puede elegir. */
  readonly min: IsoDate
  /** Hoy (en Córdoba). */
  readonly max: IsoDate
  /** Por qué el mínimo es ese (para el texto de ayuda). */
  readonly limitedBy: 'arca' | 'last_voucher' | 'closed_month' | 'books_start'
}

/**
 * Las fechas que acepta ARCA para el comprobante: desde
 * `max(hoy − 5 o 10, la del último del mismo tipo, el primer día abierto, el
 * inicio de los libros)` hasta hoy. ARCA rechaza una fecha anterior a la del
 * último comprobante del mismo tipo y punto de venta (10016).
 */
export function arcaDateWindow(o: {
  readonly today: IsoDate
  readonly concepto: ArcaConcepto
  readonly lastIssueDate?: IsoDate | null
  readonly firstOpenDate?: IsoDate | null
  readonly booksStartDate?: IsoDate | null
}): ArcaDateWindow {
  let min: IsoDate = addDays(o.today, -ARCA_DAYS_BACK[o.concepto])
  let limitedBy: ArcaDateWindow['limitedBy'] = 'arca'
  const candidates: Array<[IsoDate | null | undefined, ArcaDateWindow['limitedBy']]> = [
    [o.lastIssueDate, 'last_voucher'],
    [o.firstOpenDate, 'closed_month'],
    [o.booksStartDate, 'books_start'],
  ]
  for (const [day, reason] of candidates) {
    if (day && isRealIsoDay(day) && day > min) {
      min = day
      limitedBy = reason
    }
  }
  // Un último comprobante «de mañana» (reloj de ARCA adelantado): no hay ventana.
  return { min: min > o.today ? o.today : min, max: o.today, limitedBy }
}

/** El texto de ayuda de la fecha según qué la limita. */
export function arcaDateHint(window: ArcaDateWindow): string {
  switch (window.limitedBy) {
    case 'last_voucher':
      return 'No puede ser anterior a la del último comprobante de este tipo: ARCA lo rechaza.'
    case 'closed_month':
      return 'El mes anterior está cerrado en los libros: la fecha tiene que ser de un mes abierto.'
    case 'books_start':
      return 'No puede ser anterior al inicio de los libros.'
    default:
      return 'ARCA acepta hasta unos días para atrás y nunca una fecha futura.'
  }
}

// ─── El cliente ──────────────────────────────────────────────────────────────

export type ArcaReceiver = {
  readonly taxIdType: TaxIdType
  readonly taxId: string | null
}

export type ArcaReceiverIssue = {
  readonly key: 'a_needs_cuit' | 'anonymous_over_cap' | 'receiver_document'
  readonly field: 'partyId'
  readonly message: string
}

/** El tope de la Factura B sin identificar, en texto (`$ 10.000.000`). */
export function finalConsumerCapText(): string {
  return formatCents(FINAL_CONSUMER_ID_THRESHOLD_CENTS, { decimals: 0 })
}

/**
 * Lo que ARCA exige del documento del cliente:
 * - Factura A: CUIT válida (documento 80, error 10013).
 * - Factura B sin documento (consumidor final sin identificar): por debajo del
 *   monto que obliga a identificarlo (RG 5700/2025, $ 10.000.000; el valor exacto
 *   que valida ARCA está a confirmar: si lo rechaza, el error lo dice).
 */
export function arcaReceiverIssue(o: {
  readonly letter: ArcaLetter
  readonly receiver: ArcaReceiver
  readonly totalCents: number
}): ArcaReceiverIssue | null {
  const { receiver } = o
  if (o.letter === 'A') {
    if (receiver.taxIdType !== 'cuit' || !parseCuit(receiver.taxId).ok) {
      return {
        key: 'a_needs_cuit',
        field: 'partyId',
        message:
          'Para una Factura A el cliente tiene que tener cargada su CUIT. Completala en su ficha y volvé.',
      }
    }
    return null
  }
  if (receiver.taxIdType === 'none') {
    if (o.totalCents >= FINAL_CONSUMER_ID_THRESHOLD_CENTS) {
      return {
        key: 'anonymous_over_cap',
        field: 'partyId',
        message: `Desde ${finalConsumerCapText()} ARCA pide identificar a quien compra: elegí un cliente con DNI, CUIL o CUIT.`,
      }
    }
    return null
  }
  const digits = (receiver.taxId ?? '').replace(/\D/g, '')
  const valid =
    receiver.taxIdType === 'dni' ? /^\d{7,8}$/.test(digits) : parseCuit(receiver.taxId).ok
  return valid
    ? null
    : {
        key: 'receiver_document',
        field: 'partyId',
        message: 'El documento del cliente no es válido. Corregilo en su ficha y volvé.',
      }
}

// ─── El esquema de la acción ─────────────────────────────────────────────────

export const ARCA_DETAIL_MIN = 3
export const ARCA_DETAIL_MAX = 500

const CONDICION_MESSAGE = 'Elegí la condición frente al IVA del cliente.'
const DETAIL_MESSAGE = `Escribí qué se factura (de ${ARCA_DETAIL_MIN} a ${ARCA_DETAIL_MAX} letras): va impreso en la factura.`
const CONCEPTO_MESSAGE = 'Elegí si facturás productos, servicios o los dos.'

export const arcaConceptoField = z.union([z.literal(1), z.literal(2), z.literal(3)], {
  message: CONCEPTO_MESSAGE,
})

/** Lo que agrega la emisión con ARCA al formulario de siempre. */
export const arcaBlockSchema = obj({
  /** El número que vio la persona (`getArcaNextNumber`); tiene que ser igual a `number`. */
  predictedNumber: voucherNumberField,
  /** RG 5616: se manda siempre. */
  condicionIvaReceptorId: z
    .number({ message: CONDICION_MESSAGE })
    .int(CONDICION_MESSAGE)
    .refine((id) => CONDICION_IVA_RECEPTOR_IDS.has(id), CONDICION_MESSAGE),
  concepto: arcaConceptoField.default(1),
  serviceFrom: optionalIsoDay.default(null),
  serviceTo: optionalIsoDay.default(null),
  /** Vence el pago (servicios). Si falta, se usa el «Vence» de la factura. */
  paymentDue: optionalIsoDay.default(null),
  /** Lo que se factura, como sale impreso (WSFEv1 no lleva renglones). */
  detail: z
    .string({ message: DETAIL_MESSAGE })
    .trim()
    .min(ARCA_DETAIL_MIN, DETAIL_MESSAGE)
    .max(ARCA_DETAIL_MAX, DETAIL_MESSAGE),
  /** NC y ND: la factura emitida por la plataforma que corrigen (`acc_arca_vouchers.id`). */
  relatedVoucherId: uuidField('Elegí la factura que corrige.').nullable().default(null),
})

/**
 * La entrada de `emitArcaSalesVoucher`: la factura de venta de siempre más el
 * bloque `arca`, con las reglas que pide ARCA.
 */
export const arcaEmitSchema = salesInvoiceSchema
  .safeExtend({ arca: arcaBlockSchema })
  .superRefine((v, ctx) => {
    if (!isArcaVoucherType(v.voucherType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['voucherType'],
        message: 'Con ARCA se emiten facturas y notas A o B (los tiques no).',
      })
    }
    if (v.number !== v.arca.predictedNumber) {
      ctx.addIssue({
        code: 'custom',
        path: ['number'],
        message: 'El número cambió: recargá el próximo número de ARCA.',
      })
    }
    const letter = letterOfVoucherType(v.voucherType)
    if (letter !== null && letterForCondicion(v.arca.condicionIvaReceptorId) !== letter) {
      ctx.addIssue({
        code: 'custom',
        path: ['arca', 'condicionIvaReceptorId'],
        message:
          'La condición del cliente no va con la letra: a un responsable inscripto o a un monotributista le corresponde A; al resto, B.',
      })
    }
    const { concepto, serviceFrom, serviceTo } = v.arca
    const paymentDue = v.arca.paymentDue ?? v.dueDate
    if (concepto === 1) {
      if (serviceFrom !== null || serviceTo !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['arca', 'serviceFrom'],
          message: 'Con productos no van fechas de servicio.',
        })
      }
    } else {
      if (serviceFrom === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['arca', 'serviceFrom'],
          message: 'Para servicios, ARCA pide desde cuándo se prestó.',
        })
      }
      if (serviceTo === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['arca', 'serviceTo'],
          message: 'Para servicios, ARCA pide hasta cuándo se prestó.',
        })
      }
      if (serviceFrom !== null && serviceTo !== null && serviceFrom > serviceTo) {
        ctx.addIssue({
          code: 'custom',
          path: ['arca', 'serviceTo'],
          message: 'El final del servicio no puede ser anterior al comienzo.',
        })
      }
      if (paymentDue === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['dueDate'],
          message: 'Para servicios, ARCA pide cuándo vence el pago.',
        })
      } else if (paymentDue < v.issueDate) {
        ctx.addIssue({
          code: 'custom',
          path: ['dueDate'],
          message: 'El vencimiento del pago no puede ser anterior a la fecha de la factura.',
        })
      }
    }
    const isNote = v.docKind === 'sales_credit_note' || v.docKind === 'sales_debit_note'
    if (isNote && v.arca.relatedVoucherId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['arca', 'relatedVoucherId'],
        message:
          v.docKind === 'sales_credit_note'
            ? 'Elegí la factura que corrige: con ARCA, la nota de crédito va asociada a una factura emitida desde acá.'
            : 'Elegí la factura sobre la que va la nota de débito.',
      })
    }
    if (!isNote && v.arca.relatedVoucherId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['arca', 'relatedVoucherId'],
        message: 'Una factura no va asociada a otra.',
      })
    }
  })

export type ArcaEmitInput = z.infer<typeof arcaEmitSchema>
/** Lo que manda el formulario (los campos con valor por defecto son opcionales). */
export type ArcaEmitValues = z.input<typeof arcaEmitSchema>

/** El concepto de FchVtoPago: el de servicios o, si no vino, el vencimiento de la factura. */
export function arcaPaymentDue(input: Pick<ArcaEmitInput, 'arca' | 'dueDate'>): IsoDate | null {
  return input.arca.concepto === 1 ? null : (input.arca.paymentDue ?? input.dueDate)
}

// ─── Las otras acciones ──────────────────────────────────────────────────────

const CBTE_MESSAGE = 'Elegí el tipo de comprobante.'

export const arcaNextNumberSchema = obj({
  cbteTipo: z
    .number({ message: CBTE_MESSAGE })
    .int(CBTE_MESSAGE)
    .refine((n): n is CbteTipo => isCbteTipo(n), CBTE_MESSAGE),
})

const VOUCHER_REF_MESSAGE = 'Falta la factura de ARCA. Recargá la página.'

export const arcaVoucherRefSchema = obj({ voucherId: uuidField(VOUCHER_REF_MESSAGE) })

export const arcaPostVoucherSchema = obj({
  voucherId: uuidField(VOUCHER_REF_MESSAGE),
  previewHash: z
    .string({ message: 'Falta la vista previa. Recargá la página.' })
    .regex(PREVIEW_HASH_RE, 'Falta la vista previa. Recargá la página.'),
  warningsAck: z
    .array(z.enum(WARNING_KEYS, { message: 'Aviso desconocido. Recargá la página.' }), {
      message: 'Revisá la lista.',
    })
    .max(12, 'Demasiados avisos.')
    .default([]),
})

/** Lo que se puede probar en homologación (diseño §3.2.8, paso 4). */
export const ARCA_TEST_KINDS = ['factura_b', 'factura_a', 'nota_credito_b'] as const
export type ArcaTestKind = (typeof ARCA_TEST_KINDS)[number]

export const ARCA_TEST_KIND_LABELS: Readonly<Record<ArcaTestKind, string>> = {
  factura_b: 'Factura B a consumidor final',
  factura_a: 'Factura A a una CUIT',
  nota_credito_b: 'Nota de crédito B',
}

export const arcaTestVoucherSchema = obj({
  kind: z.enum(ARCA_TEST_KINDS, { message: 'Elegí qué querés probar.' }).default('factura_b'),
  /** Solo para la Factura A: la CUIT del cliente de prueba. */
  receiverCuit: optionalCuitField.default(null),
}).superRefine((v, ctx) => {
  if (v.kind === 'factura_a' && v.receiverCuit === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['receiverCuit'],
      message: 'Para probar una Factura A, poné la CUIT de un cliente responsable inscripto.',
    })
  }
})
export type ArcaTestVoucherInput = z.infer<typeof arcaTestVoucherSchema>

// ─── Lo que se guarda en acc_arca_vouchers.form ──────────────────────────────

export const ARCA_STORED_FORM_VERSION = 1

/**
 * `acc_arca_vouchers.form`: lo necesario para volver a armar el asiento
 * («Cargarla ahora»), saber si lo que se va a guardar es lo que aprobó la persona
 * (`previewHash`) y reimprimir la factura (`detail`). Nunca lleva secretos.
 */
export type ArcaStoredForm = {
  readonly v: typeof ARCA_STORED_FORM_VERSION
  readonly kind: 'sale' | 'test'
  /** La referencia del formulario: un reintento del mismo envío no emite dos veces. */
  readonly emissionKey: string | null
  /** La salida de `arcaEmitSchema` sin `clientRef`, `previewHash` ni `warningsAck`. */
  readonly values: Record<string, unknown> | null
  readonly previewHash: string | null
  readonly warningsAck: readonly WarningKey[]
  /** Lo que dice la factura impresa. */
  readonly detail: string
  readonly partyId: string | null
  readonly testKind: ArcaTestKind | null
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `acc_arca_vouchers.form` → lo guardado, o `null` si no tiene la forma esperada. */
export function readStoredForm(raw: unknown): ArcaStoredForm | null {
  const rec = recordOf(raw)
  if (!rec || rec.v !== ARCA_STORED_FORM_VERSION) return null
  const kind = rec.kind === 'test' ? 'test' : rec.kind === 'sale' ? 'sale' : null
  if (!kind) return null
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value : null
  const previewHash = text(rec.previewHash)
  const acks = Array.isArray(rec.warningsAck)
    ? rec.warningsAck.filter((w): w is WarningKey =>
        (WARNING_KEYS as readonly unknown[]).includes(w),
      )
    : []
  const emissionKey = text(rec.emissionKey)
  const partyId = text(rec.partyId)
  const testKind = (ARCA_TEST_KINDS as readonly unknown[]).includes(rec.testKind)
    ? (rec.testKind as ArcaTestKind)
    : null
  return {
    v: ARCA_STORED_FORM_VERSION,
    kind,
    emissionKey: emissionKey && UUID_RE.test(emissionKey) ? emissionKey : null,
    values: recordOf(rec.values),
    previewHash: previewHash && PREVIEW_HASH_RE.test(previewHash) ? previewHash : null,
    warningsAck: acks,
    detail: text(rec.detail) ?? '',
    partyId: partyId && UUID_RE.test(partyId) ? partyId : null,
    testKind,
  }
}

// ─── Estados de un comprobante de ARCA ───────────────────────────────────────

export const ARCA_VOUCHER_STATUSES = [
  'reserved',
  'requesting',
  'needs_reconcile',
  'authorized',
  'posted',
  'rejected',
  'failed',
  'abandoned',
] as const
export type ArcaVoucherStatus = (typeof ARCA_VOUCHER_STATUSES)[number]

export function isArcaVoucherStatus(value: unknown): value is ArcaVoucherStatus {
  return typeof value === 'string' && (ARCA_VOUCHER_STATUSES as readonly string[]).includes(value)
}

/** El estado en palabras (siempre con texto: nunca solo el color). */
export function arcaVoucherStatusLabel(
  status: ArcaVoucherStatus,
  environment: ArcaEnvironment,
): string {
  switch (status) {
    case 'reserved':
      return 'Preparándose'
    case 'requesting':
      return 'Pidiendo el CAE a ARCA'
    case 'needs_reconcile':
      return 'En verificación con ARCA'
    case 'authorized':
      return environment === 'homologacion'
        ? 'Autorizada (prueba, no va a los libros)'
        : 'Autorizada · falta cargarla en los libros'
    case 'posted':
      return 'Autorizada y cargada en los libros'
    case 'rejected':
      return 'Rechazada por ARCA'
    case 'failed':
      return 'No se emitió'
    case 'abandoned':
      return 'Cancelada antes de pedir el CAE'
  }
}

// ─── Lo que devuelven las acciones y las lecturas ────────────────────────────

/** `getArcaNextNumber`: el número que va a tener el comprobante. */
export type ArcaNextNumber = {
  readonly pointOfSale: number
  readonly cbteTipo: CbteTipo
  /** El último autorizado en ARCA (0 si todavía ninguno). */
  readonly lastNumber: number
  readonly nextNumber: number
  /** La fecha del último del mismo tipo (para la ventana de fechas). */
  readonly lastIssueDate: IsoDate | null
}

/** `emitArcaSalesVoucher`: la factura emitida (y cargada en los libros). */
export type ArcaEmitResult = {
  readonly voucherId: string
  readonly documentId: string | null
  /** «Factura B 0005-00000104». */
  readonly label: string
  readonly cae: string
  readonly caeDue: IsoDate
  readonly number: number
  /** Avisos de ARCA que no frenan (observaciones con CAE). */
  readonly observations: readonly string[]
  /** El mismo envío ya estaba emitido (reintento): no se emitió de nuevo. */
  readonly replayed: boolean
}

/** `reconcileArcaVoucher`: cómo quedó después de preguntarle a ARCA. */
export type ArcaReconcileResult = {
  readonly voucherId: string
  readonly status: ArcaVoucherStatus
  readonly label: string
  readonly cae: string | null
  readonly documentId: string | null
}

/** `emitArcaTestVoucher`: la factura de prueba (homologación, nunca va a los libros). */
export type ArcaTestVoucherResult = {
  readonly voucherId: string
  readonly kind: ArcaTestKind
  readonly label: string
  readonly cae: string
  readonly caeDue: IsoDate
  readonly number: number
  readonly observations: readonly string[]
}

/** `previewArcaVoucherPosting`: el asiento de «Cargarla ahora», armado en el servidor. */
export type ArcaVoucherPostingPreview = {
  readonly voucherId: string
  readonly label: string
  readonly cae: string | null
  readonly preview: EntryPreview[]
  readonly hash: string
  readonly warnings: WarningCopy[]
  /** El mes de la factura está cerrado: el asiento va a este día (el primero abierto). */
  readonly movedTo: IsoDate | null
}

/** Una factura de la plataforma que se puede corregir con una NC o una ND. */
export type ArcaPlatformVoucher = {
  readonly id: string
  readonly cbteTipo: CbteTipo
  readonly pointOfSale: number
  readonly number: number
  readonly issueDate: IsoDate | null
  readonly totalCents: number
  readonly documentId: string | null
  readonly partyId: string | null
  readonly label: string
}

/** Un comprobante de ARCA que necesita atención (en verificación o sin cargar). */
export type ArcaAttentionVoucher = {
  readonly id: string
  readonly environment: ArcaEnvironment
  readonly status: 'requesting' | 'needs_reconcile' | 'authorized'
  readonly label: string
  readonly cae: string | null
  readonly totalCents: number
  readonly issueDate: IsoDate | null
  /** ISO: desde cuándo está en este estado. */
  readonly since: string
  /** Producción y autorizada: se puede «Cargarla ahora». */
  readonly canPost: boolean
}

/** Lo que la factura de venta necesita saber de ARCA (`getArcaEmissionSetup`). */
export type ArcaEmissionSetup = {
  /** `unavailable`: la base todavía no tiene las tablas de ARCA. */
  readonly state: 'unavailable' | 'off' | 'on'
  readonly offReason:
    | 'not_connected'
    | 'emission_off'
    | 'no_point_of_sale'
    | 'not_vat_registered'
    | null
  readonly pointOfSale: number | null
  readonly allowedClasses: readonly string[]
  readonly defaultConcepto: ArcaConcepto
  /** Facturas y ND de la plataforma (producción) para asociar a una NC o ND. */
  readonly platformVouchers: readonly ArcaPlatformVoucher[]
  readonly attention: readonly ArcaAttentionVoucher[]
}

/** La tarjeta «Autorización de ARCA» de un comprobante. */
export type ArcaVoucherCard = {
  readonly id: string
  readonly environment: ArcaEnvironment
  readonly status: ArcaVoucherStatus
  readonly statusLabel: string
  readonly label: string
  readonly cbteTipo: CbteTipo
  readonly pointOfSale: number
  readonly number: number | null
  readonly cae: string | null
  readonly caeDue: IsoDate | null
  readonly issueDate: IsoDate | null
  readonly totalCents: number
  readonly observations: readonly string[]
  readonly processedAt: string | null
  /** El comprobante de los libros ya está vinculado. */
  readonly documentId: string | null
  readonly canReconcile: boolean
  readonly canPost: boolean
}

// ─── Links ───────────────────────────────────────────────────────────────────

/** El paso de la guía «Conectar ARCA» (`#paso-N`). */
export function arcaGuideHref(slug: string, stepNumber: number | null = null): string {
  const base = `/${slug}/administracion/ajustes/arca`
  return stepNumber === null ? base : `${base}#paso-${stepNumber}`
}

/** La factura imprimible (fuera del panel, A4). */
export function arcaPrintHref(slug: string, id: string): string {
  return `/print/factura/${slug}/${id}`
}
