/**
 * Validación con zod de cada entrada de las acciones de Administración
 * (Sprint 1, G.2). Sin `'use server'`: el mismo esquema corre en el cliente
 * (errores al tipear) y en el servidor (la verdad).
 *
 * **Pesos en el campo, centavos en el borde.** El `MoneyField` del kit muestra
 * y pide pesos y convierte a centavos sin flotantes con `parseMoneyToCents`; el
 * estado del formulario y el motor trabajan en centavos enteros. Las acciones
 * contables reciben objetos (no FormData) y validan los importes con
 * `centsInt`. Los formularios simples de Ajustes llegan como FormData: sus
 * números y tildes pasan por `formInt`/`formBool` (aceptan el número o su
 * texto) y la plata por `centsFromForm` del kit.
 *
 * Mensajes escritos a mano en rioplatense: zod no tiene locale global y sin
 * mensaje propio contesta en inglés (el test lo vigila).
 */

import { z } from 'zod'
import { addDays, isRealIsoDay } from '@/lib/dates'
import { parseCuit } from '@/lib/fiscal'
import { centsFromForm, formatCents } from '@/lib/money'
import { VAT_RATES_BP } from './iva'
import { RECURRING_BREAKDOWN_KINDS } from './party-profile'
import { PREVIEW_HASH_RE } from './preview'
import { SYSTEM_ACCOUNT_KEYS } from './system-keys'
import {
  ACCOUNT_TYPES,
  CHANNELS,
  CLOSE_WARNING_KEYS,
  COMMISSION_VAT_MODES,
  IVA_CONDITIONS,
  PARTY_KINDS,
  SALES_METHOD_KINDS,
  SAS_IVA_CONDITIONS,
  SIDES,
  TAX_ID_TYPES,
  TREASURY_KINDS,
  type VatRateBp,
  VOUCHER_TYPE_KEYS,
  type VoucherType,
  WARNING_KEYS,
} from './types'
import { MAX_AMOUNT_CENTS, MAX_WRITE_OFF_CENTS } from './validate'
import { SALES_CLOSE_VOUCHERS, VOUCHER_CATALOG } from './voucher-types'

export { CLOSE_WARNING_KEYS, WARNING_KEYS } from './types'

// ─── Listas y objetos con mensaje propio ─────────────────────────────────────

/** Sin mensaje propio, zod 4 contesta «Invalid input: expected array…» en inglés. */
const LIST_MESSAGE = 'Revisá la lista.'
const DATA_MESSAGE = 'Revisá los datos.'

/** `z.object` con el mensaje de la casa para cuando no llega un objeto. */
function obj<T extends z.core.$ZodLooseShape>(shape: T) {
  return z.object(shape, { message: DATA_MESSAGE })
}

/** `z.array` con el mensaje de la casa para cuando no llega una lista. */
function list<T extends z.ZodType>(item: T) {
  return z.array(item, { message: LIST_MESSAGE })
}

// ─── Campos base ─────────────────────────────────────────────────────────────

/** $ 9.999.999.999,99: tope de un importe en un formulario contable (el mismo que usa el motor). */
export const MAX_CENTS = MAX_AMOUNT_CENTS

/** Centavos enteros (> 0, o ≥ 0 con `allowZero`), hasta `MAX_CENTS`. */
export const centsInt = (o: { allowZero?: boolean } = {}) =>
  z
    .number({ message: 'Falta el importe.' })
    .int('El importe tiene que estar en centavos enteros.')
    .min(
      o.allowZero ? 0 : 1,
      o.allowZero ? 'El importe va sin signo menos.' : 'Tiene que ser mayor a cero.',
    )
    .max(MAX_CENTS, 'Ese importe es demasiado grande. Revisalo.')

/** Centavos con signo: un saldo de banco o de billetera puede ser negativo. */
export const signedCentsInt = () =>
  z
    .number({ message: 'Falta el importe.' })
    .int('El importe tiene que estar en centavos enteros.')
    .min(-MAX_CENTS, 'Ese importe es demasiado grande. Revisalo.')
    .max(MAX_CENTS, 'Ese importe es demasiado grande. Revisalo.')

/** `'yyyy-MM-dd'` que existe (no `2026-02-31`), año 1900–2199. */
export const isoDay = z.string({ message: 'Elegí una fecha.' }).superRefine((v, ctx) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) ctx.addIssue({ code: 'custom', message: 'Elegí una fecha.' })
  else if (!isRealIsoDay(v)) ctx.addIssue({ code: 'custom', message: 'Esa fecha no existe.' })
})

/** Fecha opcional: vacío o ausente → `null`. */
export const optionalIsoDay = z.preprocess(
  (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
  isoDay.nullable(),
)

/** Un mes: `'2026-09'` o cualquier día de ese mes → `'2026-09-01'` (lo que esperan las RPC). */
export const isoMonth = z
  .string({ message: 'Elegí un mes.' })
  .superRefine((v, ctx) => {
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(v))
      ctx.addIssue({ code: 'custom', message: 'Elegí un mes.' })
    else if (!isRealIsoDay(v.length === 7 ? `${v}-01` : v)) {
      ctx.addIssue({ code: 'custom', message: 'Ese mes no existe.' })
    }
  })
  .transform((v) => `${v.slice(0, 7)}-01`)

export const uuidField = (msg = 'Falta elegir una opción.') => z.uuid(msg)

export const posField = z
  .number({ message: 'Revisá el punto de venta.' })
  .int('Revisá el punto de venta.')
  .min(0, 'Revisá el punto de venta.')
  .max(99999, 'Revisá el punto de venta.')

export const voucherNumberField = z
  .number({ message: 'Revisá el número.' })
  .int('Revisá el número.')
  .min(1, 'Revisá el número.')
  .max(99_999_999, 'Revisá el número.')

/** Puntos básicos (2100 = 21 %), de 0 a 10.000. */
export const bpField = (msg = 'Revisá el porcentaje.') =>
  z.number({ message: msg }).int(msg).min(0, msg).max(10_000, msg)

/** Alícuota de IVA admitida. */
export const vatRateField = z
  .number({ message: 'Elegí la alícuota.' })
  .refine(
    (v): v is VatRateBp => (VAT_RATES_BP as readonly number[]).includes(v),
    'Elegí la alícuota.',
  )
  .transform((v) => v as VatRateBp)

/** Motivo de una reapertura, anulación u override: de 5 a 300 caracteres. */
export const reasonField = z
  .string({ message: 'Contá brevemente el motivo (al menos 5 letras).' })
  .trim()
  .min(5, 'Contá brevemente el motivo (al menos 5 letras).')
  .max(300, 'El motivo puede tener hasta 300 caracteres.')

/** Texto opcional: vacío o ausente → `null`; recortado. */
export const optionalText = (max: number, msg = `Puede tener hasta ${max} caracteres.`) =>
  z.preprocess(
    (v) =>
      v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
        ? null
        : typeof v === 'string'
          ? v.trim()
          : v,
    z.string({ message: 'Revisá este texto.' }).max(max, msg).nullable(),
  )

/** CUIT obligatorio con dígito verificador; devuelve los 11 dígitos. */
export const cuitField = z.string({ message: 'Falta el CUIT.' }).transform((v, ctx) => {
  const parsed = parseCuit(v)
  if (!parsed.ok) {
    ctx.addIssue({
      code: 'custom',
      message:
        parsed.reason === 'vacio'
          ? 'Falta el CUIT.'
          : 'El CUIT no es válido: revisá el último número.',
    })
    return z.NEVER
  }
  return parsed.cuit
})

/** CUIT opcional: vacío → `null`. */
export const optionalCuitField = z.preprocess(
  (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
  cuitField.nullable(),
)

/** Token de concurrencia (`updated_at` que vio el formulario). */
export const updatedAtField = z
  .string({ message: 'Recargá la página y probá de nuevo.' })
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/, 'Recargá la página y probá de nuevo.')
  .max(64, 'Recargá la página y probá de nuevo.')

/**
 * Entero que llega como número (objeto) o como texto (FormData). Vacío →
 * `null` si es opcional. Nunca `z.coerce` (convierte `''` en 0: el bug del
 * «AGOTADO fantasma», ver optional-number-schemas.test.ts).
 */
export function formInt(o: {
  min: number
  max: number
  message: string
  optional: true
}): z.ZodType<number | null>
export function formInt(o: {
  min: number
  max: number
  message: string
  optional?: false
}): z.ZodType<number>
export function formInt(o: {
  min: number
  max: number
  message: string
  optional?: boolean
}): z.ZodType<number | null> {
  const base = z
    .number({ message: o.message })
    .int(o.message)
    .min(o.min, o.message)
    .max(o.max, o.message)
  return z.preprocess(
    (v) => {
      if (v === undefined || v === null) return o.optional ? null : v
      if (typeof v === 'string') {
        const t = v.trim()
        if (t === '') return o.optional ? null : undefined
        return /^-?\d+$/.test(t) ? Number(t) : v
      }
      return v
    },
    o.optional ? base.nullable() : base,
  )
}

/** Tilde de FormData (`'on'`, `'true'`, `'1'`) u objeto (`true`). Ausente → `false`. */
export const formBool = z.preprocess(
  (v) => {
    if (typeof v === 'boolean') return v
    if (v === undefined || v === null) return false
    if (typeof v === 'string')
      return ['on', 'true', '1', 'si', 'sí'].includes(v.trim().toLowerCase())
    return v
  },
  z.boolean({ message: 'Revisá esta opción.' }),
)

/** `formBool` con un valor por defecto cuando falta la clave. */
export const formBoolDefault = (def: boolean) =>
  z.preprocess((v) => (v === undefined || v === null ? def : v), formBool)

// ─── CBU / CVU ───────────────────────────────────────────────────────────────

const CBU_BLOCK1_WEIGHTS = [7, 1, 3, 9, 7, 1, 3] as const
const CBU_BLOCK2_WEIGHTS = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3] as const

function cbuCheck(digits: string, weights: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < weights.length; i++) sum += Number(digits[i]) * (weights[i] ?? 0)
  return (10 - (sum % 10)) % 10
}

/**
 * CBU o CVU: 22 dígitos con sus dos verificadores (banco y sucursal en el
 * primer bloque de 8, cuenta en el segundo de 14). Los CVU de las billeteras
 * usan la misma cuenta.
 */
export function isValidCbu(input: string): boolean {
  const digits = input.replace(/[\s-]/g, '')
  if (!/^\d{22}$/.test(digits)) return false
  const block1 = digits.slice(0, 8)
  const block2 = digits.slice(8)
  return (
    cbuCheck(block1, CBU_BLOCK1_WEIGHTS) === Number(block1[7]) &&
    cbuCheck(block2, CBU_BLOCK2_WEIGHTS) === Number(block2[13])
  )
}

const optionalCbuField = z.preprocess(
  (v) =>
    v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
      ? null
      : typeof v === 'string'
        ? v.replace(/[\s-]/g, '')
        : v,
  z
    .string({ message: 'El CBU tiene 22 números.' })
    .regex(/^\d{22}$/, 'El CBU tiene 22 números.')
    .refine(isValidCbu, 'El CBU no es válido: revisá los números.')
    .nullable(),
)

// ─── Piezas comunes de los comprobantes ──────────────────────────────────────

const warningKeyField = z.enum(WARNING_KEYS, { message: 'Aviso desconocido. Recargá la página.' })

/** Lo que manda todo formulario de comprobante además de sus datos (E.7). */
export const postingMeta = {
  clientRef: uuidField('Falta la referencia del formulario. Recargá la página.'),
  previewHash: z
    .string({ message: 'Falta la vista previa. Recargá la página.' })
    .regex(PREVIEW_HASH_RE, 'Falta la vista previa. Recargá la página.'),
  warningsAck: list(warningKeyField).max(12, 'Demasiados avisos.').default([]),
}

/** Proveedor nuevo en línea (H.5): nombre + condición (RI por defecto) + CUIT opcional. */
export const newPartySchema = obj({
  name: z
    .string({ message: 'Escribí el nombre.' })
    .trim()
    .min(2, 'Escribí el nombre.')
    .max(120, 'El nombre puede tener hasta 120 caracteres.'),
  kind: z.enum(PARTY_KINDS, { message: 'Elegí el tipo.' }).default('supplier'),
  ivaCondition: z
    .enum(IVA_CONDITIONS, { message: 'Elegí la condición frente al IVA.' })
    .default('responsable_inscripto'),
  taxId: optionalCuitField.default(null),
  paymentTermDays: z
    .number({ message: 'Revisá el plazo.' })
    .int('Revisá el plazo.')
    .min(0, 'Revisá el plazo.')
    .max(365, 'El plazo va hasta 365 días.')
    .default(0),
  defaultAccountId: uuidField().nullable().default(null),
})
export type NewPartyInput = z.infer<typeof newPartySchema>

/** Una partida a cancelar (o un saldo a favor a usar) con el importe que se aplica. */
export const appliedItemSchema = obj({
  lineId: uuidField('Elegí el comprobante.'),
  amountCents: centsInt(),
})

/** Una imputación del formulario de compra: cuenta, rol y (si es neto) alícuota. */
const purchaseLineSchema = obj({
  role: z.enum(['net', 'gross', 'non_taxed', 'exempt', 'internal_tax'], {
    message: 'Revisá el tipo de importe.',
  }),
  accountId: uuidField('Elegí la cuenta.'),
  amountCents: centsInt(),
  vatRateBp: vatRateField.nullable().default(null),
}).superRefine((v, ctx) => {
  if (v.role === 'net' && v.vatRateBp === null) {
    ctx.addIssue({ code: 'custom', path: ['vatRateBp'], message: 'Elegí la alícuota.' })
  }
  if (v.role !== 'net' && v.vatRateBp !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['vatRateBp'],
      message: 'Solo el neto gravado lleva alícuota.',
    })
  }
})

/** El IVA de una alícuota: ±1¢ silencioso o «Usar el IVA de la factura». */
const vatOverrideSchema = obj({
  vatRateBp: vatRateField,
  adjustCents: z
    .number({ message: 'Revisá el ajuste.' })
    .int('Revisá el ajuste.')
    .min(-100, 'El ajuste va hasta $ 1.')
    .max(100, 'El ajuste va hasta $ 1.')
    .default(0),
  givenCents: centsInt({ allowZero: true }).nullable().default(null),
})

const perceptionSchema = obj({
  taxKind: z.enum(['iva', 'iibb', 'ganancias', 'municipal'], {
    message: 'Elegí el tipo de percepción.',
  }),
  amountCents: centsInt(),
  jurisdictionCode: z
    .number({ message: 'Elegí la jurisdicción.' })
    .int('Elegí la jurisdicción.')
    .min(901, 'Elegí la jurisdicción.')
    .max(924, 'Elegí la jurisdicción.')
    .nullable()
    .default(null),
}).superRefine((v, ctx) => {
  if (v.taxKind === 'iibb' && v.jurisdictionCode === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['jurisdictionCode'],
      message: 'Elegí la jurisdicción.',
    })
  }
})

const otherTaxSchema = obj({
  accountId: uuidField('Elegí la cuenta.'),
  amountCents: centsInt(),
})

/** Pagar en el mismo envío («Guardar y pagar», «Nuevo gasto» con factura). */
const payNowSchema = obj({
  treasuryAccountId: uuidField('Elegí con qué pagás.'),
  /** `null` = el total del comprobante. */
  amountCents: centsInt().nullable().default(null),
  date: optionalIsoDay.default(null),
  reference: optionalText(60).default(null),
})

/** «¿Con qué pagaste?»: una caja con su importe y referencia. */
const treasuryAmountSchema = obj({
  treasuryAccountId: uuidField('Elegí la caja o cuenta.'),
  amountCents: centsInt(),
  reference: optionalText(60).default(null),
})

const vatAdjustField = z
  .number({ message: 'Revisá el ajuste del IVA.' })
  .int('Revisá el ajuste del IVA.')
  .min(-100, 'El ajuste va hasta $ 1.')
  .max(100, 'El ajuste va hasta $ 1.')
  .default(0)

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length
}

const PURCHASE_VOUCHER_TYPES = VOUCHER_TYPE_KEYS.filter((t) => VOUCHER_CATALOG[t].purchases) as [
  VoucherType,
  ...VoucherType[],
]

function voucherNeedsNumber(type: VoucherType): boolean {
  return VOUCHER_CATALOG[type].numbered
}

// ─── Nuevo gasto (H.5) ───────────────────────────────────────────────────────

export const quickExpenseSchema = obj({
  ...postingMeta,
  amountCents: centsInt(),
  target: z.discriminatedUnion(
    'type',
    [
      obj({ type: z.literal('account'), accountId: uuidField('Elegí en qué gastaste.') }),
      obj({
        type: z.literal('party'),
        partyId: uuidField('Elegí el proveedor.'),
        accountId: uuidField('Elegí en qué gastaste.'),
      }),
    ],
    { message: 'Elegí en qué gastaste.' },
  ),
  newParty: newPartySchema.nullable().default(null),
  treasuryAccountId: uuidField('Elegí con qué pagaste.'),
  voucher: z.enum(['none', 'ticket', 'a', 'bc'], { message: 'Elegí el comprobante.' }),
  vatRateBp: z
    .union([z.literal(2100), z.literal(1050), z.literal(2700)], { message: 'Elegí la alícuota.' })
    .default(2100),
  vatAdjustCents: vatAdjustField,
  pointOfSale: posField.nullable().default(null),
  number: voucherNumberField.nullable().default(null),
  date: isoDay,
  detail: optionalText(280).default(null),
  /** El gasto fijo que se paga con este gasto (queda «Cargado» y avanza su vencimiento). */
  recurringExpenseId: uuidField().nullable().default(null),
}).superRefine((v, ctx) => {
  const hasParty = v.target.type === 'party' || v.newParty !== null
  const invoice = v.voucher === 'a' || v.voucher === 'bc'
  if (invoice && !hasParty) {
    ctx.addIssue({
      code: 'custom',
      path: ['target'],
      message: 'Elegí el proveedor de la factura.',
    })
  }
  if (invoice && (v.pointOfSale === null || v.number === null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['number'],
      message: 'Con factura, cargá el punto de venta y el número.',
    })
  }
  // Proveedor nuevo con factura: el CUIT es obligatorio para el Libro IVA (H.5).
  if (invoice && v.newParty !== null && v.newParty.taxId === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['newParty', 'taxId'],
      message: 'Con factura, cargá el CUIT del proveedor.',
    })
  }
  if (v.target.type === 'party' && v.newParty !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['newParty'],
      message: 'Elegí un proveedor o creá uno, no los dos.',
    })
  }
})
export type QuickExpenseInput = z.infer<typeof quickExpenseSchema>

// ─── Comprobante de compra (H.6) ─────────────────────────────────────────────

export const purchaseSchema = obj({
  ...postingMeta,
  docKind: z
    .enum(['purchase', 'purchase_debit_note', 'purchase_credit_note'], {
      message: 'Elegí el tipo de comprobante.',
    })
    .default('purchase'),
  partyId: uuidField('Elegí el proveedor.').nullable().default(null),
  newParty: newPartySchema.nullable().default(null),
  voucherType: z.enum(PURCHASE_VOUCHER_TYPES, { message: 'Elegí el tipo de comprobante.' }),
  pointOfSale: posField.nullable().default(null),
  number: voucherNumberField.nullable().default(null),
  issueDate: isoDay,
  /** Solo si el mes de la emisión está cerrado (el primer día abierto). */
  accountingDate: optionalIsoDay.default(null),
  dueDate: optionalIsoDay.default(null),
  /** «Total»: un importe y una alícuota (neto e IVA salen del total). «Detalle»: las filas. */
  amountMode: z
    .enum(['total', 'detail'], { message: 'Elegí cómo cargás los importes.' })
    .default('detail'),
  total: obj({
    totalCents: centsInt(),
    /** `null` en los tipos que no discriminan IVA (B, C, tiques). */
    vatRateBp: vatRateField.nullable().default(null),
    accountId: uuidField('Elegí la imputación.'),
    vatAdjustCents: vatAdjustField,
  })
    .nullable()
    .default(null),
  lines: list(purchaseLineSchema).max(100, 'Demasiadas filas.').default([]),
  vat: list(vatOverrideSchema).max(6, 'Demasiadas alícuotas.').default([]),
  perceptions: list(perceptionSchema).max(20, 'Demasiadas percepciones.').default([]),
  otherTaxes: list(otherTaxSchema).max(20, 'Demasiados tributos.').default([]),
  /** «Total según la factura» (opcional): si no coincide, `total_mismatch`. */
  controlTotalCents: centsInt().nullable().default(null),
  /** DDJJ: la cuenta del impuesto a pagar del organismo. */
  controlAccountId: uuidField('Elegí el impuesto.').nullable().default(null),
  relatedDocumentId: uuidField('Elegí la factura que corrige.').nullable().default(null),
  settlesCommissions: z.boolean({ message: 'Revisá esta opción.' }).default(false),
  recurringExpenseId: uuidField().nullable().default(null),
  payNow: payNowSchema.nullable().default(null),
  notes: optionalText(1000).default(null),
}).superRefine((v, ctx) => {
  const info = VOUCHER_CATALOG[v.voucherType]
  if ((v.partyId === null) === (v.newParty === null)) {
    ctx.addIssue({ code: 'custom', path: ['partyId'], message: 'Elegí el proveedor.' })
  }
  if (voucherNeedsNumber(v.voucherType) && (v.pointOfSale === null || v.number === null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['number'],
      message: 'Cargá el punto de venta y el número.',
    })
  }
  if ((v.docKind === 'purchase_credit_note') !== info.isCreditNote) {
    ctx.addIssue({
      code: 'custom',
      path: ['voucherType'],
      message: 'Ese tipo de comprobante no corresponde acá.',
    })
  }
  if (v.amountMode === 'total') {
    if (v.total === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['total', 'totalCents'],
        message: 'Falta el total de la factura.',
      })
    } else if (info.purchaseVat !== 'no' && v.total.vatRateBp === null && !v.settlesCommissions) {
      ctx.addIssue({
        code: 'custom',
        path: ['total', 'vatRateBp'],
        message: 'Elegí la alícuota.',
      })
    }
  } else if (v.lines.length === 0 && v.perceptions.length === 0 && v.otherTaxes.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Cargá al menos un importe.' })
  }
  if (info.purchaseVat === 'no' && v.lines.some((l) => l.role === 'net')) {
    ctx.addIssue({
      code: 'custom',
      path: ['lines'],
      message: 'Las facturas B y C no discriminan IVA: cargá solo el total.',
    })
  }
  if (v.settlesCommissions && v.docKind !== 'purchase') {
    ctx.addIssue({
      code: 'custom',
      path: ['settlesCommissions'],
      message: 'Solo una factura puede ser la de comisiones.',
    })
  }
  if (v.payNow !== null && v.docKind === 'purchase_credit_note') {
    ctx.addIssue({ code: 'custom', path: ['payNow'], message: 'Una nota de crédito no se paga.' })
  }
  if (v.accountingDate !== null && v.accountingDate < v.issueDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['accountingDate'],
      message: 'La fecha contable no puede ser anterior a la fecha del comprobante.',
    })
  }
  if (v.dueDate !== null && v.dueDate < v.issueDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['dueDate'],
      message: 'El vencimiento no puede ser anterior a la fecha del comprobante.',
    })
  }
  if (hasDuplicates(v.vat.map((x) => String(x.vatRateBp)))) {
    ctx.addIssue({ code: 'custom', path: ['vat'], message: 'Esa alícuota está dos veces.' })
  }
})
export type PurchaseInput = z.infer<typeof purchaseSchema>

/** La NC de proveedor es la misma carga con `docKind = purchase_credit_note`. */
export const purchaseCreditNoteSchema = purchaseSchema.refine(
  (v) => v.docKind === 'purchase_credit_note',
  { path: ['docKind'], message: 'Elegí una nota de crédito.' },
)

// ─── Pagar (H.8) ─────────────────────────────────────────────────────────────

const paymentMethodSchema = z.discriminatedUnion(
  'type',
  [
    obj({
      type: z.literal('treasury'),
      treasuryAccountId: uuidField('Elegí con qué pagás.'),
      amountCents: centsInt(),
      reference: optionalText(60).default(null),
    }),
    obj({
      type: z.literal('compensation'),
      accountId: uuidField('Elegí el saldo a favor.'),
      amountCents: centsInt(),
    }),
  ],
  { message: 'Elegí con qué pagás.' },
)

export const paymentSchema = obj({
  ...postingMeta,
  partyId: uuidField('Elegí a quién le pagás.'),
  date: isoDay,
  applications: list(appliedItemSchema).max(100, 'Demasiados comprobantes.').default([]),
  creditsUsed: list(appliedItemSchema).max(50, 'Demasiados saldos a favor.').default([]),
  methods: list(paymentMethodSchema).max(10, 'Demasiados medios.').default([]),
  writeOffCents: centsInt({ allowZero: true })
    .max(MAX_WRITE_OFF_CENTS, 'Hasta $ 1.000 se puede dar por cancelado.')
    .default(0),
  notes: optionalText(1000).default(null),
}).superRefine((v, ctx) => {
  const methods = v.methods.reduce((acc, m) => acc + m.amountCents, 0)
  const applied = v.applications.reduce((acc, a) => acc + a.amountCents, 0)
  const credits = v.creditsUsed.reduce((acc, a) => acc + a.amountCents, 0)
  if (methods + v.writeOffCents <= 0) {
    ctx.addIssue({ code: 'custom', path: ['methods'], message: 'Elegí con qué pagás.' })
  }
  if (v.creditsUsed.length > 0 && v.applications.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['creditsUsed'],
      message: 'Para usar un saldo a favor, elegí qué comprobante cancela.',
    })
  }
  if (credits > applied) {
    ctx.addIssue({
      code: 'custom',
      path: ['creditsUsed'],
      message: 'Los saldos a favor no pueden superar lo que cancelás.',
    })
  }
  if (hasDuplicates([...v.applications, ...v.creditsUsed].map((a) => a.lineId))) {
    ctx.addIssue({
      code: 'custom',
      path: ['applications'],
      message: 'Ese comprobante está dos veces.',
    })
  }
})
export type PaymentInput = z.infer<typeof paymentSchema>

// ─── Cobrar / acreditación (H.10) ────────────────────────────────────────────

export const DEDUCTION_KINDS = [
  'comision',
  'iva_comision',
  'percepcion_iva_comision',
  'ret_iva',
  'ret_iibb',
  'sircupa',
  'ret_ganancias',
  'otro',
  'diferencia',
] as const

const deductionSchema = obj({
  taxKind: z.enum(DEDUCTION_KINDS, { message: 'Elegí el tipo de descuento.' }),
  amountCents: centsInt(),
  /** Solo en «otro»: la cuenta del cargo. */
  accountId: uuidField('Elegí la cuenta.').nullable().default(null),
  certificateNumber: optionalText(40).default(null),
  /** El medio al que se atribuye (QR, transferencia) en «Ajustar saldo de Mercado Pago». */
  salesMethodId: uuidField().nullable().default(null),
}).superRefine((v, ctx) => {
  if (v.taxKind === 'otro' && v.accountId === null) {
    ctx.addIssue({ code: 'custom', path: ['accountId'], message: 'Elegí la cuenta.' })
  }
  if (v.taxKind === 'ret_ganancias' && v.certificateNumber === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['certificateNumber'],
      message: 'Cargá el número de certificado de la retención.',
    })
  }
})

/** «¿Tenés la factura de la comisión?» viene en la liquidación · llega después · no factura. */
const commissionVoucherSchema = z.discriminatedUnion(
  'mode',
  [
    obj({
      mode: z.literal('included'),
      voucherType: z.enum(['liquidacion', 'factura_a', 'factura_b', 'otro_comprobante'], {
        message: 'Elegí el tipo de comprobante.',
      }),
      pointOfSale: posField,
      number: voucherNumberField,
      issueDate: isoDay,
    }),
    obj({ mode: z.literal('later') }),
    obj({ mode: z.literal('none') }),
  ],
  { message: 'Elegí si tenés la factura de la comisión.' },
)

const collectionFields = {
  partyId: uuidField('Elegí quién te pagó.'),
  date: isoDay,
  applications: list(appliedItemSchema).max(200, 'Demasiadas ventas.').default([]),
  creditsUsed: list(appliedItemSchema).max(50, 'Demasiados saldos a favor.').default([]),
  /** «Lo liquidado (bruto)»: opcional, para controlar que lo cargado dé eso. */
  grossCents: centsInt().nullable().default(null),
  deductions: list(deductionSchema).max(30, 'Demasiados descuentos.').default([]),
  received: list(treasuryAmountSchema).max(10, 'Demasiadas cuentas.').default([]),
  writeOffCents: centsInt({ allowZero: true }).default(0),
  commissionVoucher: commissionVoucherSchema.default({ mode: 'none' }),
  notes: optionalText(1000).default(null),
}

type CollectionShape = {
  applications: Array<{ lineId: string; amountCents: number }>
  creditsUsed: Array<{ lineId: string; amountCents: number }>
  grossCents: number | null
  deductions: Array<{ amountCents: number }>
  received: Array<{ amountCents: number }>
  writeOffCents: number
}

function refineCollection(v: CollectionShape, ctx: z.RefinementCtx): void {
  const received = v.received.reduce((acc, r) => acc + r.amountCents, 0)
  const deductions = v.deductions.reduce((acc, d) => acc + d.amountCents, 0)
  const gross = received + deductions + v.writeOffCents
  const applied = v.applications.reduce((acc, a) => acc + a.amountCents, 0)
  const credits = v.creditsUsed.reduce((acc, a) => acc + a.amountCents, 0)
  if (gross <= 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['received'],
      message: 'Cargá lo que entró o los descuentos.',
    })
  }
  if (gross + credits < applied) {
    ctx.addIssue({
      code: 'custom',
      path: ['applications'],
      message: 'Estás aplicando más de lo que se cobró. Revisá los importes.',
    })
  }
  if (v.grossCents !== null && v.grossCents !== gross) {
    ctx.addIssue({
      code: 'custom',
      path: ['grossCents'],
      message: `Lo que entró más los descuentos suma ${formatCents(gross)}, no el bruto liquidado.`,
    })
  }
  if (v.creditsUsed.length > 0 && v.applications.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['creditsUsed'],
      message: 'Para usar un saldo a favor, elegí qué comprobante cancela.',
    })
  }
  if (hasDuplicates([...v.applications, ...v.creditsUsed].map((a) => a.lineId))) {
    ctx.addIssue({
      code: 'custom',
      path: ['applications'],
      message: 'Ese comprobante está dos veces.',
    })
  }
}

export const collectionSchema = obj({ ...postingMeta, ...collectionFields }).superRefine(
  refineCollection,
)
export type CollectionInput = z.infer<typeof collectionSchema>

/** «Ajustar saldo de Mercado Pago» (E.5.8): saldo de la app contra libro y partidas a acreditar. */
export const walletCheckSchema = obj({
  ...postingMeta,
  treasuryAccountId: uuidField('Elegí la billetera.'),
  /** La billetera como partícipe (Mercado Pago); sin él se toma el de la caja. */
  partyId: uuidField('Falta la billetera.').nullable().default(null),
  date: isoDay,
  /** «¿Cuánto hay en Mercado Pago ahora?» (puede ser negativo). */
  countedCents: signedCentsInt(),
  /** El saldo de libro que vio la persona (`stale_balance` si cambió). */
  expectedBookCents: signedCentsInt(),
  items: list(appliedItemSchema).max(200, 'Demasiadas partidas.').default([]),
  breakdown: list(deductionSchema).max(30, 'Demasiados descuentos.').default([]),
}).superRefine((v, ctx) => {
  if (v.items.length === 0 && v.countedCents === v.expectedBookCents) {
    ctx.addIssue({
      code: 'custom',
      path: ['countedCents'],
      message: 'No hay diferencia ni partidas para acreditar.',
    })
  }
  if (hasDuplicates(v.items.map((i) => i.lineId))) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'Esa partida está dos veces.' })
  }
})
export type WalletCheckInput = z.infer<typeof walletCheckSchema>

// ─── Cierre del día (H.9) ────────────────────────────────────────────────────

const methodAmountSchema = obj({
  salesMethodId: uuidField('Falta el medio de cobro.'),
  amountCents: centsInt({ allowZero: true }),
  /** Cuenta corriente: lo de cada cliente (suma el importe del medio). */
  customers: list(obj({ partyId: uuidField('Elegí el cliente.'), amountCents: centsInt() }))
    .max(50, 'Demasiados clientes.')
    .default([]),
})

const aliquotRowSchema = obj({
  vatRateBp: vatRateField,
  netCents: centsInt({ allowZero: true }),
  /** `null` = calculado; un valor = el del comprobante (con la tolerancia del rango). */
  vatCents: centsInt({ allowZero: true }).nullable().default(null),
})

const invoicedRowSchema = obj({
  voucherType: z.enum(SALES_CLOSE_VOUCHERS as [string, ...string[]], {
    message: 'Elegí el tipo de comprobante.',
  }),
  pointOfSale: posField,
  numberFrom: voucherNumberField,
  numberTo: voucherNumberField,
  channel: z.enum(CHANNELS, { message: 'Elegí el canal.' }),
  /** Cliente con CUIT: obligatorio en las A. */
  partyId: uuidField('Elegí el cliente.').nullable().default(null),
  amountMode: z
    .enum(['total', 'detail'], { message: 'Elegí cómo cargás los importes.' })
    .default('total'),
  totalCents: centsInt().nullable().default(null),
  vatRateBp: vatRateField.default(2100),
  aliquots: list(aliquotRowSchema).max(6, 'Demasiadas alícuotas.').default([]),
  nonTaxedCents: centsInt({ allowZero: true }).default(0),
  exemptCents: centsInt({ allowZero: true }).default(0),
}).superRefine((v, ctx) => {
  if (v.numberTo < v.numberFrom) {
    ctx.addIssue({
      code: 'custom',
      path: ['numberTo'],
      message: 'El «hasta» no puede ser menor que el «desde».',
    })
  }
  const type = v.voucherType as VoucherType
  if (VOUCHER_CATALOG[type].letter === 'A' && v.partyId === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['partyId'],
      message: 'Una factura A necesita el cliente con su CUIT.',
    })
  }
  if (v.amountMode === 'total' && v.totalCents === null) {
    ctx.addIssue({ code: 'custom', path: ['totalCents'], message: 'Falta el total facturado.' })
  }
  if (
    v.amountMode === 'detail' &&
    v.aliquots.length === 0 &&
    v.nonTaxedCents === 0 &&
    v.exemptCents === 0
  ) {
    ctx.addIssue({ code: 'custom', path: ['aliquots'], message: 'Cargá al menos un importe.' })
  }
})

export const salesCloseSchema = obj({
  ...postingMeta,
  date: isoDay,
  shift: optionalText(20, 'El turno puede tener hasta 20 caracteres.').default(null),
  methods: list(methodAmountSchema).max(40, 'Demasiados medios.'),
  invoiced: list(invoicedRowSchema).max(50, 'Demasiadas filas facturadas.').default([]),
  /** Efectivo contado si no coincide con lo vendido (la diferencia va a faltante o sobrante). */
  cashCountedCents: z
    .number({ message: 'Falta el importe.' })
    .int('El importe tiene que estar en centavos enteros.')
    .min(0, 'El efectivo contado no puede ser negativo.')
    .max(MAX_CENTS, 'Ese importe es demasiado grande. Revisalo.')
    .nullable()
    .default(null),
  /** «Total según Thinkeon» (opcional). */
  controlTotalCents: centsInt({ allowZero: true }).nullable().default(null),
  /** Con `invoiced_exceeds_sold` aceptado: por qué (factura de otro día). */
  overrideReason: optionalText(300, 'El motivo puede tener hasta 300 caracteres.').default(null),
  /** Acreditaciones en el acto (opcional, plegado): cobranzas que van en el mismo envío. */
  instantSettlements: list(obj(collectionFields).superRefine(refineCollection))
    .max(9, 'Demasiadas acreditaciones.')
    .default([]),
}).superRefine((v, ctx) => {
  if (!v.methods.some((m) => m.amountCents > 0)) {
    ctx.addIssue({
      code: 'custom',
      path: ['methods'],
      message: 'Cargá al menos un medio con ventas.',
    })
  }
  if (hasDuplicates(v.methods.map((m) => m.salesMethodId))) {
    ctx.addIssue({
      code: 'custom',
      path: ['methods'],
      message: 'Ese medio de cobro está dos veces.',
    })
  }
  v.methods.forEach((m, i) => {
    if (m.customers.length > 0) {
      const sum = m.customers.reduce((acc, c) => acc + c.amountCents, 0)
      if (sum !== m.amountCents) {
        ctx.addIssue({
          code: 'custom',
          path: ['methods', i, 'customers'],
          message: 'Lo de cada cliente tiene que sumar el total de la cuenta corriente.',
        })
      }
    }
  })
  if (v.warningsAck.includes('invoiced_exceeds_sold')) {
    const reason = v.overrideReason ?? ''
    if (reason.length < 5) {
      ctx.addIssue({
        code: 'custom',
        path: ['overrideReason'],
        message: 'Contá brevemente el motivo (al menos 5 letras).',
      })
    }
  }
})
export type SalesCloseInput = z.infer<typeof salesCloseSchema>

// ─── Factura de venta suelta (E.5.9) ─────────────────────────────────────────

export const salesInvoiceSchema = obj({
  ...postingMeta,
  docKind: z
    .enum(['sales_invoice', 'sales_debit_note', 'sales_credit_note'], {
      message: 'Elegí el tipo de comprobante.',
    })
    .default('sales_invoice'),
  partyId: uuidField('Elegí el cliente.'),
  voucherType: z.enum(
    [
      'factura_a',
      'factura_b',
      'nota_debito_a',
      'nota_debito_b',
      'nota_credito_a',
      'nota_credito_b',
      'tique_factura_a',
      'tique_factura_b',
    ],
    { message: 'Elegí el tipo de comprobante.' },
  ),
  pointOfSale: posField,
  number: voucherNumberField,
  issueDate: isoDay,
  dueDate: optionalIsoDay.default(null),
  channel: z.enum(CHANNELS, { message: 'Elegí el canal.' }).default('events'),
  aliquots: list(
    obj({
      vatRateBp: vatRateField,
      netCents: centsInt({ allowZero: true }),
      vatAdjustCents: vatAdjustField,
    }),
  )
    .max(6, 'Demasiadas alícuotas.')
    .default([]),
  nonTaxedCents: centsInt({ allowZero: true }).default(0),
  exemptCents: centsInt({ allowZero: true }).default(0),
  relatedDocumentId: uuidField('Elegí la factura que corrige.').nullable().default(null),
  collectNow: payNowSchema.nullable().default(null),
  notes: optionalText(1000).default(null),
}).superRefine((v, ctx) => {
  const info = VOUCHER_CATALOG[v.voucherType]
  const expectsCredit = v.docKind === 'sales_credit_note'
  const expectsDebit = v.docKind === 'sales_debit_note'
  if (info.isCreditNote !== expectsCredit || (expectsDebit && !info.isDebitNote)) {
    ctx.addIssue({
      code: 'custom',
      path: ['voucherType'],
      message: 'Ese tipo de comprobante no corresponde acá.',
    })
  }
  const total = v.aliquots.reduce((acc, a) => acc + a.netCents, 0) + v.nonTaxedCents + v.exemptCents
  if (total <= 0)
    ctx.addIssue({ code: 'custom', path: ['aliquots'], message: 'Cargá al menos un importe.' })
  if (hasDuplicates(v.aliquots.map((a) => String(a.vatRateBp)))) {
    ctx.addIssue({ code: 'custom', path: ['aliquots'], message: 'Esa alícuota está dos veces.' })
  }
  if (v.collectNow !== null && expectsCredit) {
    ctx.addIssue({
      code: 'custom',
      path: ['collectNow'],
      message: 'Una nota de crédito no se cobra.',
    })
  }
  if (v.dueDate !== null && v.dueDate < v.issueDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['dueDate'],
      message: 'El vencimiento no puede ser anterior a la fecha del comprobante.',
    })
  }
})
export type SalesInvoiceInput = z.infer<typeof salesInvoiceSchema>

// ─── Cajas y bancos (H.11) ───────────────────────────────────────────────────

export const transferSchema = obj({
  ...postingMeta,
  fromTreasuryId: uuidField('Elegí de dónde sale la plata.'),
  toTreasuryId: uuidField('Elegí adónde va la plata.'),
  amountCents: centsInt(),
  date: isoDay,
  reference: optionalText(60).default(null),
  notes: optionalText(1000).default(null),
}).refine((v) => v.fromTreasuryId !== v.toTreasuryId, {
  path: ['toTreasuryId'],
  message: 'Elegí dos cuentas distintas.',
})
export type TransferInput = z.infer<typeof transferSchema>

export const bankExpenseSchema = obj({
  ...postingMeta,
  treasuryAccountId: uuidField('Elegí el banco.'),
  date: isoDay,
  /** «Incluir en el libro IVA» (banco con CUIT y comprobante). */
  includeInIvaBook: z.boolean({ message: 'Revisá esta opción.' }).default(false),
  voucher: obj({
    voucherType: z.enum(['resumen_bancario', 'factura_a', 'otro_comprobante'], {
      message: 'Elegí el comprobante.',
    }),
    pointOfSale: posField,
    number: voucherNumberField,
  })
    .nullable()
    .default(null),
  /** Comisiones con IVA (neto). */
  feesNetCents: centsInt({ allowZero: true }).default(0),
  vatRateBp: vatRateField.default(2100),
  vatAdjustCents: vatAdjustField,
  vatPerceptionCents: centsInt({ allowZero: true }).default(0),
  /** Comisiones sin IVA. */
  feesNoVatCents: centsInt({ allowZero: true }).default(0),
  ley25413CreditCents: centsInt({ allowZero: true }).default(0),
  ley25413DebitCents: centsInt({ allowZero: true }).default(0),
  sircrebCents: centsInt({ allowZero: true }).default(0),
  interestCents: centsInt({ allowZero: true }).default(0),
  others: list(obj({ accountId: uuidField('Elegí la cuenta.'), amountCents: centsInt() }))
    .max(10, 'Demasiados conceptos.')
    .default([]),
  notes: optionalText(1000).default(null),
}).superRefine((v, ctx) => {
  const total =
    v.feesNetCents +
    v.vatPerceptionCents +
    v.feesNoVatCents +
    v.ley25413CreditCents +
    v.ley25413DebitCents +
    v.sircrebCents +
    v.interestCents +
    v.others.reduce((acc, o) => acc + o.amountCents, 0)
  if (total <= 0)
    ctx.addIssue({
      code: 'custom',
      path: ['feesNetCents'],
      message: 'Cargá al menos un importe.',
    })
  if (v.includeInIvaBook && v.voucher === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['voucher'],
      message: 'Para que entre al Libro IVA, cargá el comprobante del banco.',
    })
  }
})
export type BankExpenseInput = z.infer<typeof bankExpenseSchema>

/** Atajos de «Otro ingreso o egreso» (E.5.12). */
export const CASH_MOVEMENT_SHORTCUTS = [
  'partner_withdrawal',
  'partner_contribution',
  'mp_yield',
  'loan_received',
  'deposit_received',
  'other',
] as const

export const cashMovementSchema = obj({
  ...postingMeta,
  treasuryAccountId: uuidField('Elegí la caja.'),
  direction: z.enum(['in', 'out'], { message: 'Elegí si entra o sale plata.' }),
  counterpartAccountId: uuidField('Elegí la contrapartida.'),
  partyId: uuidField('Elegí el socio, cliente o proveedor.').nullable().default(null),
  amountCents: centsInt(),
  date: isoDay,
  shortcut: z
    .enum(CASH_MOVEMENT_SHORTCUTS, { message: 'Elegí qué movimiento es.' })
    .default('other'),
  detail: optionalText(280).default(null),
})
export type CashMovementInput = z.infer<typeof cashMovementSchema>

export const treasuryAdjustmentSchema = obj({
  ...postingMeta,
  treasuryAccountId: uuidField('Elegí la caja o cuenta.'),
  date: isoDay,
  /** «¿Cuánto hay ahora?». */
  countedCents: signedCentsInt(),
  expectedBookCents: signedCentsInt(),
  /** Cómo se explica la diferencia (banco o billetera); en efectivo va sola a faltante o sobrante. */
  splits: list(
    obj({
      accountId: uuidField('Elegí la cuenta.'),
      amountCents: centsInt(),
      taxKind: z
        .enum(['diferencia', 'rendimiento', 'comision', 'iva_comision', 'sircupa', 'otro'], {
          message: 'Elegí el concepto.',
        })
        .default('diferencia'),
      partyId: uuidField().nullable().default(null),
    }),
  )
    .max(10, 'Demasiados conceptos.')
    .default([]),
  notes: optionalText(1000).default(null),
}).superRefine((v, ctx) => {
  const diff = v.countedCents - v.expectedBookCents
  if (diff === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['countedCents'],
      message: 'No hay diferencia: marcala como ajustada sin cargar nada.',
    })
  }
  if (
    v.splits.length > 0 &&
    v.splits.reduce((acc, s) => acc + s.amountCents, 0) !== Math.abs(diff)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['splits'],
      message: 'El reparto tiene que sumar la diferencia.',
    })
  }
})
export type TreasuryAdjustmentInput = z.infer<typeof treasuryAdjustmentSchema>

/** «Ajustar saldo» sin diferencia: solo marca la caja como verificada (C.2). */
export const markTreasuryCheckedSchema = obj({
  treasuryAccountId: uuidField('Elegí la caja o cuenta.'),
  countedCents: signedCentsInt(),
  expectedBookCents: signedCentsInt(),
  asOf: isoDay,
}).refine((v) => v.countedCents === v.expectedBookCents, {
  path: ['countedCents'],
  message: 'Hay diferencia: registrala con «Ajustar saldo».',
})

// ─── Asiento manual y plantilla de sueldos (H.13, E.5.14) ────────────────────

const manualLineSchema = obj({
  accountId: uuidField('Elegí la cuenta.'),
  debitCents: centsInt({ allowZero: true }).nullable().default(null),
  creditCents: centsInt({ allowZero: true }).nullable().default(null),
  partyId: uuidField('Elegí el partícipe.').nullable().default(null),
  dueDate: optionalIsoDay.default(null),
  memo: optionalText(200).default(null),
}).superRefine((v, ctx) => {
  const debit = v.debitCents ?? 0
  const credit = v.creditCents ?? 0
  if (debit > 0 && credit > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['creditCents'],
      message: 'Cada línea va en el Debe o en el Haber, no en los dos.',
    })
  } else if (debit === 0 && credit === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['debitCents'],
      message: 'Falta el importe de la línea.',
    })
  }
  if (v.dueDate !== null && v.partyId === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['dueDate'],
      message: 'El vencimiento va solo con un partícipe.',
    })
  }
})

export const manualEntrySchema = obj({
  ...postingMeta,
  entryKind: z
    .enum(['manual', 'adjustment', 'payroll', 'fy_adjustment'], {
      message: 'Elegí el tipo de asiento.',
    })
    .default('manual'),
  date: isoDay,
  description: z
    .string({ message: 'Escribí el concepto del asiento.' })
    .trim()
    .min(1, 'Escribí el concepto del asiento.')
    .max(200, 'El concepto puede tener hasta 200 caracteres.'),
  lines: list(manualLineSchema)
    .min(2, 'Un asiento necesita al menos dos líneas.')
    .max(500, 'Demasiadas líneas.'),
  correctsDocumentId: uuidField().nullable().default(null),
}).superRefine((v, ctx) => {
  let debit = 0n
  let credit = 0n
  for (const l of v.lines) {
    debit += BigInt(l.debitCents ?? 0)
    credit += BigInt(l.creditCents ?? 0)
  }
  if (debit !== credit) {
    const gap = debit > credit ? debit - credit : credit - debit
    ctx.addIssue({
      code: 'custom',
      path: ['lines'],
      message: `El asiento no cuadra: falta ${formatCents(gap)} en el ${debit > credit ? 'Haber' : 'Debe'}.`,
    })
  }
})
export type ManualEntryInput = z.infer<typeof manualEntrySchema>

/** «Sueldos del mes» (E13): los tres números del resumen de la contadora. */
export const payrollTemplateSchema = obj({
  grossSalariesCents: centsInt(),
  employerContributionsCents: centsInt({ allowZero: true }),
  withheldContributionsCents: centsInt({ allowZero: true }),
  unionDuesCents: centsInt({ allowZero: true }).default(0),
  date: isoDay,
  salariesDueDate: optionalIsoDay.default(null),
  socialSecurityDueDate: optionalIsoDay.default(null),
}).refine((v) => v.withheldContributionsCents + v.unionDuesCents <= v.grossSalariesCents, {
  path: ['withheldContributionsCents'],
  message: 'Los aportes no pueden superar los sueldos brutos.',
})
export type PayrollTemplateInput = z.infer<typeof payrollTemplateSchema>

// ─── Saldos iniciales (H.3, E.5.16) ──────────────────────────────────────────

const openingItemSchema = (partyMsg: string) =>
  obj({
    partyId: uuidField(partyMsg),
    /** La cuenta de control; `null` = la habitual del partícipe. */
    accountId: uuidField('Elegí la cuenta.').nullable().default(null),
    amountCents: centsInt(),
    dueDate: optionalIsoDay.default(null),
    /** «Factura A 0003-00001234». */
    reference: optionalText(60).default(null),
  })

export const openingSchema = obj({
  ...postingMeta,
  treasuries: list(
    obj({
      treasuryAccountId: uuidField('Elegí la caja.'),
      balanceCents: centsInt({ allowZero: true }),
    }),
  )
    .max(20, 'Demasiadas cajas.')
    .default([]),
  payables: list(openingItemSchema('Elegí el proveedor.'))
    .max(200, 'Demasiadas deudas.')
    .default([]),
  receivables: list(openingItemSchema('Elegí quién te debe.'))
    .max(200, 'Demasiados créditos.')
    .default([]),
  others: list(
    obj({
      accountId: uuidField('Elegí la cuenta.'),
      side: z.enum(SIDES, { message: 'Elegí Debe o Haber.' }),
      amountCents: centsInt(),
      partyId: uuidField('Elegí el partícipe.').nullable().default(null),
      dueDate: optionalIsoDay.default(null),
      reference: optionalText(60).default(null),
    }),
  )
    .max(100, 'Demasiados saldos.')
    .default([]),
  shareCapitalCents: centsInt({ allowZero: true }).nullable().default(null),
}).superRefine((v, ctx) => {
  const any =
    v.treasuries.some((t) => t.balanceCents > 0) ||
    v.payables.length > 0 ||
    v.receivables.length > 0 ||
    v.others.length > 0 ||
    (v.shareCapitalCents ?? 0) > 0
  if (!any) {
    ctx.addIssue({
      code: 'custom',
      path: ['treasuries'],
      message: 'Cargá al menos un saldo o elegí «Arrancar en cero».',
    })
  }
})
export type OpeningInput = z.infer<typeof openingSchema>

// ─── Correcciones e imputaciones (C.4) ───────────────────────────────────────

export const voidDocumentSchema = obj({
  documentId: uuidField('Falta el comprobante.'),
  reason: reasonField,
  withBundle: z.boolean({ message: 'Revisá esta opción.' }).default(false),
  unallocate: z.boolean({ message: 'Revisá esta opción.' }).default(false),
})

export const undoDocumentSchema = obj({ documentId: uuidField('Falta el comprobante.') })

/** «Anular con fecha de hoy» (comprobante de un mes cerrado). */
export const reverseSchema = obj({
  clientRef: uuidField('Falta la referencia del formulario. Recargá la página.'),
  documentId: uuidField('Falta el comprobante.'),
  reason: reasonField,
  reversalDate: isoDay,
  unallocate: z.boolean({ message: 'Revisá esta opción.' }).default(false),
})

export const allocateSchema = obj({
  pairs: list(
    obj({
      debitLineId: uuidField('Elegí el comprobante.'),
      creditLineId: uuidField('Elegí el comprobante.'),
      amountCents: centsInt(),
    }).refine((p) => p.debitLineId !== p.creditLineId, {
      path: ['creditLineId'],
      message: 'Elegí dos comprobantes distintos.',
    }),
  )
    .min(1, 'Elegí qué imputar.')
    .max(100, 'Demasiadas imputaciones.'),
  date: isoDay,
})

export const unallocateSchema = obj({
  allocationId: uuidField('Falta la imputación.'),
  reason: reasonField,
})

// ─── Ajustes (FormData) ──────────────────────────────────────────────────────

export const settingsSchema = obj({
  expectedUpdatedAt: updatedAtField,
  legalName: z
    .string({ message: 'Escribí la razón social.' })
    .trim()
    .min(2, 'Escribí la razón social.')
    .max(160, 'La razón social puede tener hasta 160 caracteres.'),
  cuit: optionalCuitField.default(null),
  ivaCondition: z.enum(SAS_IVA_CONDITIONS, { message: 'Elegí la condición frente al IVA.' }),
  iibbRegime: z.enum(['local', 'convenio_multilateral', 'exento', 'no_inscripto'], {
    message: 'Elegí el régimen de Ingresos Brutos.',
  }),
  iibbNumber: optionalText(30).default(null),
  iibbJurisdictionCode: formInt({
    min: 901,
    max: 924,
    message: 'Elegí la jurisdicción de IIBB.',
  }),
  activityStartDate: optionalIsoDay.default(null),
  fiscalAddress: optionalText(200).default(null),
  booksStartDate: isoDay,
  fiscalYearEndMonth: formInt({
    min: 1,
    max: 12,
    message: 'Elegí el mes de cierre del ejercicio.',
  }),
  ivaSettlementMode: z.enum(['on_close', 'manual'], { message: 'Elegí cómo se liquida el IVA.' }),
  ivaDueDay: formInt({ min: 1, max: 28, message: 'El vencimiento va del 1 al 28.' }),
  iibbDueDay: formInt({ min: 1, max: 28, message: 'El vencimiento va del 1 al 28.' }),
  vatToleranceCents: formInt({ min: 0, max: 100, message: 'La tolerancia va de $ 0 a $ 1.' }),
  bankTaxCreditComputableBp: formInt({
    min: 0,
    max: 10_000,
    message: 'El porcentaje va de 0 a 100.',
  }),
  bankTaxDebitComputableBp: formInt({
    min: 0,
    max: 10_000,
    message: 'El porcentaje va de 0 a 100.',
  }),
  uninvoicedSalesMode: z.enum(['separate_accounts', 'single_account'], {
    message: 'Elegí cómo van las ventas sin factura.',
  }),
  closedPeriodVoidIvaMode: z.enum(['adjustment_only', 'negative_row'], {
    message: 'Elegí cómo se anula en un mes cerrado.',
  }),
  dueSoonDays: formInt({ min: 1, max: 30, message: 'Va de 1 a 30 días.' }),
}).superRefine((v, ctx) => {
  if (v.activityStartDate !== null && v.booksStartDate < v.activityStartDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['booksStartDate'],
      message: 'Los libros no pueden arrancar antes del inicio de actividades.',
    })
  }
})
export type SettingsInput = z.infer<typeof settingsSchema>

// ─── Plan de cuentas (#16: código libre, raíces, tipos mixtos, mover, importar) ───

/** Formato de `acc_accounts.code` (aac_code_fmt): una etiqueta libre de números y puntos. */
const ACCOUNT_CODE_FIELD = z
  .string({ message: 'Revisá el código.' })
  .trim()
  .regex(
    /^[0-9]+(\.[0-9]+)*$/,
    'El código va con números separados por puntos (por ejemplo, 1.1.01.01.001).',
  )
  .max(24, 'El código puede tener hasta 24 caracteres.')

const accountNameField = z
  .string({ message: 'Escribí el nombre de la cuenta.' })
  .trim()
  .min(2, 'Escribí el nombre de la cuenta.')
  .max(80, 'El nombre puede tener hasta 80 caracteres.')

const accountTypeField = z.enum(ACCOUNT_TYPES, { message: 'Elegí el tipo de cuenta.' })

/** Vacío, `null` o ausente → `null`. */
const emptyToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v

export const accountCreateSchema = obj({
  mode: z.literal('create'),
  /** El grupo donde va; `null` = cuenta principal (un grupo raíz, con su tipo y su código). */
  parentId: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    uuidField('Elegí el grupo.').nullable(),
  ),
  /**
   * `null` = el de su grupo. Bajo un grupo de ingresos o egresos se puede pedir el otro; una cuenta
   * principal lo necesita.
   */
  type: z.preprocess(emptyToNull, accountTypeField.nullable()),
  /** Vacío = el siguiente código libre del grupo, con su estilo (lo elige la base). */
  code: z.preprocess(emptyToNull, ACCOUNT_CODE_FIELD.nullable()),
  name: accountNameField,
  postable: formBoolDefault(true),
  /** «Regularizadora»: invierte el lado normal de su tipo. */
  contra: formBoolDefault(false),
  requiresParty: formBoolDefault(false),
  purchaseSelectable: formBoolDefault(false),
  manualSelectable: formBoolDefault(true),
  description: optionalText(280).default(null),
}).superRefine((v, ctx) => {
  if (v.parentId === null) {
    if (v.type === null) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: 'Elegí el tipo de la cuenta.' })
    }
    if (v.code === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'Escribí el código de la cuenta principal (por ejemplo, 6.0.00.00.000).',
      })
    }
    if (v.postable) {
      ctx.addIssue({
        code: 'custom',
        path: ['postable'],
        message: 'Una cuenta principal es siempre un grupo.',
      })
    }
  }
  if (v.requiresParty && !v.postable) {
    ctx.addIssue({
      code: 'custom',
      path: ['requiresParty'],
      message: 'Solo una cuenta imputable puede llevar proveedor o cliente.',
    })
  }
})

export const accountUpdateSchema = obj({
  mode: z.literal('update'),
  id: uuidField('Falta la cuenta.'),
  expectedUpdatedAt: updatedAtField,
  name: accountNameField.optional(),
  code: ACCOUNT_CODE_FIELD.optional(),
  /** Solo bajo un grupo de resultados (ingreso ↔ egreso) o en una cuenta principal. */
  type: accountTypeField.optional(),
  active: formBool.optional(),
  requiresParty: formBool.optional(),
  purchaseSelectable: formBool.optional(),
  manualSelectable: formBool.optional(),
  description: optionalText(280).optional(),
  /** Mover (con todo lo que tiene adentro): otro grupo, o `null` para que quede como principal. */
  parentId: uuidField('Elegí el grupo.').nullable().optional(),
})

export const accountSchema = z.discriminatedUnion(
  'mode',
  [accountCreateSchema, accountUpdateSchema],
  {
    message: 'Recargá la página y probá de nuevo.',
  },
)
export type AccountInput = z.infer<typeof accountSchema>

/** Tope de `acc_import_accounts` por tanda. */
export const CHART_IMPORT_MAX_ROWS = 2000

/**
 * Una línea de «Importar plan». Acá solo la forma: el formato del código y el largo del nombre los
 * revisa la base línea por línea (salen como error de ESA fila en la vista previa, no frenan todo).
 */
export const chartImportRowSchema = obj({
  code: z
    .string({ message: 'Revisá el código.' })
    .trim()
    .min(1, 'Falta el código.')
    .max(40, 'El código es demasiado largo.'),
  name: z.string({ message: 'Revisá el nombre.' }).trim().max(200, 'El nombre es demasiado largo.'),
  type: accountTypeField.optional(),
  postable: z.boolean({ message: 'Revisá esta opción.' }).optional(),
  contra: z.boolean({ message: 'Revisá esta opción.' }).optional(),
  parentCode: z
    .string({ message: 'Revisá el código del grupo.' })
    .trim()
    .max(40, 'El código del grupo es demasiado largo.')
    .optional(),
  description: z
    .string({ message: 'Revisá «Para qué se usa».' })
    .trim()
    .max(280, '«Para qué se usa» puede tener hasta 280 caracteres.')
    .nullable()
    .optional(),
})

export const chartImportSchema = obj({
  rows: list(chartImportRowSchema)
    .min(1, 'Pegá al menos una cuenta con su código y su nombre.')
    .max(
      CHART_IMPORT_MAX_ROWS,
      'Se pueden importar hasta 2000 cuentas por vez: partí la lista en tandas.',
    ),
  /** `true` = solo la vista previa (no escribe nada). */
  dryRun: z.boolean({ message: 'Recargá la página y probá de nuevo.' }),
})
export type ChartImportInput = z.infer<typeof chartImportSchema>

/** «Usar otra cuenta» para una clave del sistema (`acc_remap_system_account`). */
export const systemRemapSchema = obj({
  systemKey: z.enum(SYSTEM_ACCOUNT_KEYS, { message: 'Recargá la página y probá de nuevo.' }),
  accountId: uuidField('Elegí la cuenta.'),
})
export type SystemRemapInput = z.infer<typeof systemRemapSchema>

const optionalBp = z.preprocess(
  (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
  formInt({ min: 0, max: 10_000, message: 'El porcentaje va de 0 a 100.', optional: true }),
)

const optionalUuid = (msg?: string) =>
  z.preprocess(
    (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
    uuidField(msg).nullable(),
  )

/** Un contacto del proveedor: alcanza con el nombre, el teléfono o el email. */
export const partyContactSchema = obj({
  name: optionalText(60, 'El nombre puede tener hasta 60 caracteres.').default(null),
  role: optionalText(40, 'Puede tener hasta 40 caracteres.').default(null),
  phone: optionalText(30, 'El teléfono puede tener hasta 30 caracteres.').default(null),
  email: z.preprocess(
    (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
    z
      .string({ message: 'Revisá el email.' })
      .trim()
      .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Revisá el email.')
      .max(160, 'Revisá el email.')
      .nullable(),
  ),
})
export type PartyContactInput = z.infer<typeof partyContactSchema>

export const partySchema = obj({
  id: optionalUuid(),
  expectedUpdatedAt: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? null : v),
    updatedAtField.nullable(),
  ),
  kind: z.enum(PARTY_KINDS, { message: 'Elegí el tipo.' }),
  name: z
    .string({ message: 'Escribí la razón social.' })
    .trim()
    .min(2, 'Escribí la razón social.')
    .max(120, 'La razón social puede tener hasta 120 caracteres.'),
  tradeName: optionalText(120).default(null),
  taxIdType: z.enum(TAX_ID_TYPES, { message: 'Elegí el tipo de documento.' }).default('none'),
  taxId: optionalText(20).default(null),
  ivaCondition: z
    .enum(IVA_CONDITIONS, { message: 'Elegí la condición frente al IVA.' })
    .default('sin_datos'),
  email: z.preprocess(
    (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
    z
      .string({ message: 'Revisá el email.' })
      .trim()
      .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Revisá el email.')
      .max(160, 'Revisá el email.')
      .nullable(),
  ),
  phone: optionalText(30).default(null),
  address: optionalText(200).default(null),
  paymentTermDays: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? 0 : v),
    formInt({ min: 0, max: 365, message: 'El plazo va de 0 a 365 días.' }),
  ),
  defaultAccountId: optionalUuid(),
  defaultVoucherType: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? null : v),
    z.enum(VOUCHER_TYPE_KEYS, { message: 'Elegí el comprobante habitual.' }).nullable(),
  ),
  payableAccountId: optionalUuid('Elegí la cuenta de proveedores.'),
  receivableAccountId: optionalUuid('Elegí la cuenta de clientes.'),
  commissionVatMode: z
    .enum(COMMISSION_VAT_MODES, { message: 'Elegí cómo factura las comisiones.' })
    .default('none'),
  commissionBp: optionalBp,
  iibbWithholdingBp: optionalBp,
  vatWithholdingBp: optionalBp,
  incomeTaxWithholdingBp: optionalBp,
  sircupaBp: optionalBp,
  notes: optionalText(500).default(null),
  active: formBoolDefault(true),
  /** Ficha del proveedor (pedido de los socios, 09/10/2026). */
  contacts: list(partyContactSchema).max(10, 'Hasta 10 contactos.').default([]),
  deliveryDays: list(
    z
      .number({ message: 'Revisá los días de entrega.' })
      .int()
      .min(1)
      .max(7, 'Revisá los días de entrega.'),
  )
    .max(7, 'Revisá los días de entrega.')
    .default([])
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  orderLeadDays: formInt({
    min: 0,
    max: 30,
    message: 'La anticipación va de 0 a 30 días.',
    optional: true,
  }).default(null),
})
  .superRefine((v, ctx) => {
    if (v.taxIdType === 'none') {
      if (v.taxId !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['taxIdType'],
          message: 'Elegí si es CUIT, CUIL o DNI.',
        })
      }
      return
    }
    if (v.taxId === null) {
      ctx.addIssue({ code: 'custom', path: ['taxId'], message: 'Falta el número.' })
      return
    }
    if (v.taxIdType === 'dni') {
      if (!/^[0-9]{7,8}$/.test(v.taxId.replace(/\D/g, ''))) {
        ctx.addIssue({ code: 'custom', path: ['taxId'], message: 'El DNI tiene 7 u 8 números.' })
      }
    } else if (!parseCuit(v.taxId).ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['taxId'],
        message: 'El CUIT no es válido: revisá el último número.',
      })
    }
  })
  .transform((v) => ({ ...v, taxId: v.taxId === null ? null : v.taxId.replace(/\D/g, '') }))
export type PartyInput = z.infer<typeof partySchema>

export const treasurySchema = obj({
  id: optionalUuid(),
  expectedUpdatedAt: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? null : v),
    updatedAtField.nullable(),
  ),
  name: z
    .string({ message: 'Escribí el nombre.' })
    .trim()
    .min(2, 'Escribí el nombre.')
    .max(60, 'El nombre puede tener hasta 60 caracteres.'),
  kind: z.enum(TREASURY_KINDS, { message: 'Elegí el tipo.' }),
  bankName: optionalText(80).default(null),
  cbuCvu: optionalCbuField,
  alias: z.preprocess(
    (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
    z
      .string({ message: 'Revisá el alias.' })
      .trim()
      .regex(/^[A-Za-z0-9.-]{6,20}$/, 'El alias va de 6 a 20 letras, números, puntos o guiones.')
      .nullable(),
  ),
  accountNumber: optionalText(40).default(null),
  allowNegative: formBoolDefault(false),
  createBankParty: formBoolDefault(false),
  active: formBoolDefault(true),
})
export type TreasuryInput = z.infer<typeof treasurySchema>

export const salesMethodSchema = obj({
  id: optionalUuid(),
  expectedUpdatedAt: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? null : v),
    updatedAtField.nullable(),
  ),
  name: z
    .string({ message: 'Escribí el nombre.' })
    .trim()
    .min(2, 'Escribí el nombre.')
    .max(40, 'El nombre puede tener hasta 40 caracteres.'),
  kind: z.enum(SALES_METHOD_KINDS, { message: 'Elegí adónde va lo cobrado.' }),
  channel: z.enum(CHANNELS, { message: 'Elegí el canal.' }),
  treasuryAccountId: optionalUuid('Elegí la caja.'),
  partyId: optionalUuid('Elegí quién lo acredita.'),
  settlementDays: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? 0 : v),
    formInt({ min: 0, max: 120, message: 'Los días van de 0 a 120.' }),
  ),
  active: formBoolDefault(true),
  sort: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? 0 : v),
    formInt({ min: 0, max: 999, message: 'Revisá el orden.' }),
  ),
}).superRefine((v, ctx) => {
  // asm_kind_targets: cada tipo de medio va a una caja, a un partícipe o a los dos.
  const needsTreasury = v.kind === 'treasury' || v.kind === 'settled_now'
  const needsParty = v.kind === 'settled_now' || v.kind === 'receivable' || v.kind === 'advance'
  if (needsTreasury !== (v.treasuryAccountId !== null) || needsParty !== (v.partyId !== null)) {
    ctx.addIssue({
      code: 'custom',
      path: [needsTreasury && v.treasuryAccountId === null ? 'treasuryAccountId' : 'partyId'],
      message: 'Revisá adónde va este medio de cobro.',
    })
  }
})
export type SalesMethodInput = z.infer<typeof salesMethodSchema>

export const salesPointSchema = obj({
  id: optionalUuid(),
  /** Token de concurrencia de la edición (`acc_save_sales_point` lo exige con `id`). */
  expectedUpdatedAt: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? null : v),
    updatedAtField.nullable(),
  ),
  number: formInt({ min: 1, max: 99_998, message: 'Revisá el punto de venta.' }),
  label: z
    .string({ message: 'Escribí cómo lo llamás.' })
    .trim()
    .min(1, 'Escribí cómo lo llamás.')
    .max(60, 'Puede tener hasta 60 caracteres.'),
  defaultChannel: z.enum(CHANNELS, { message: 'Elegí el canal.' }),
  active: formBoolDefault(true),
})
export type SalesPointInput = z.infer<typeof salesPointSchema>

/** Un renglón del detalle: a quién o qué (por ejemplo el empleado), el concepto y el monto. */
export const recurringBreakdownLineSchema = obj({
  label: z
    .string({ message: 'Escribí a quién corresponde.' })
    .trim()
    .min(1, 'Escribí a quién corresponde.')
    .max(60, 'Puede tener hasta 60 caracteres.'),
  kind: z.preprocess(
    (v) => (v === undefined || v === '' ? null : v),
    z.enum(RECURRING_BREAKDOWN_KINDS, { message: 'Elegí el concepto.' }).nullable(),
  ),
  amountCents: z.preprocess(
    (v) => (v === undefined ? '' : v),
    centsFromForm({ min: 1, max: MAX_CENTS }),
  ),
})
export type RecurringBreakdownLine = z.infer<typeof recurringBreakdownLineSchema>

export const recurringSchema = obj({
  id: optionalUuid(),
  expectedUpdatedAt: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? null : v),
    updatedAtField.nullable(),
  ),
  name: z
    .string({ message: 'Escribí el nombre.' })
    .trim()
    .min(2, 'Escribí el nombre.')
    .max(80, 'El nombre puede tener hasta 80 caracteres.'),
  partyId: optionalUuid('Elegí el proveedor.'),
  accountId: uuidField('Elegí la cuenta.'),
  voucherType: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? null : v),
    z.enum(VOUCHER_TYPE_KEYS, { message: 'Elegí el comprobante habitual.' }).nullable(),
  ),
  vatRateBp: z.preprocess(
    (v) =>
      v === undefined || v === null || v === '' ? null : typeof v === 'string' ? Number(v) : v,
    vatRateField.nullable(),
  ),
  /** Monto aproximado en el hidden canónico de MoneyField; vacío = variable. */
  amountCents: z.preprocess(
    (v) => (v === undefined ? '' : v),
    centsFromForm({ optional: true, min: 1, max: MAX_CENTS }),
  ),
  frequency: z.enum(['monthly', 'bimonthly', 'quarterly', 'yearly'], {
    message: 'Elegí cada cuánto vence.',
  }),
  dueDay: formInt({ min: 1, max: 31, message: 'El día va del 1 al 31.' }),
  nextDueDate: isoDay,
  remindDaysBefore: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? 5 : v),
    formInt({ min: 0, max: 30, message: 'Va de 0 a 30 días.' }),
  ),
  treasuryAccountId: optionalUuid('Elegí con qué lo pagás.'),
  active: formBoolDefault(true),
  notes: optionalText(280).default(null),
  /** En cuotas: el último vencimiento. `null` = no termina. */
  endsOn: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? null : v),
    isoDay.nullable(),
  ),
  /** El detalle (por ejemplo los sueldos): el monto pasa a ser la suma. */
  breakdown: list(recurringBreakdownLineSchema).max(200, 'Hasta 200 renglones.').default([]),
})
export type RecurringInput = z.infer<typeof recurringSchema>

export const deleteRecurringSchema = obj({
  id: uuidField('Falta el gasto fijo.'),
  expectedUpdatedAt: updatedAtField,
})

export const deletePartySchema = obj({
  id: uuidField('Falta el proveedor.'),
  expectedUpdatedAt: updatedAtField,
})

/** «Cargar una lista»: un nombre por renglón. */
export const partiesBulkSchema = obj({
  kind: z.enum(['supplier', 'customer'], { message: 'Elegí el tipo.' }),
  names: list(
    z
      .string({ message: 'Revisá la lista.' })
      .trim()
      .min(2, 'Cada nombre tiene que tener al menos 2 letras.')
      .max(120, 'Cada nombre puede tener hasta 120 caracteres.'),
  )
    .min(1, 'Pegá al menos un nombre.')
    .max(300, 'Hasta 300 nombres por vez.'),
})

export const recurringBulkSchema = obj({
  items: list(
    obj({
      name: z
        .string({ message: 'Escribí el nombre.' })
        .trim()
        .min(2, 'Cada nombre tiene que tener al menos 2 letras.')
        .max(80, 'Cada nombre puede tener hasta 80 caracteres.'),
      accountId: uuidField('Elegí en qué es cada gasto.'),
      dueDay: formInt({ min: 1, max: 31, message: 'El día va del 1 al 31.' }),
      nextDueDate: isoDay,
    }),
  )
    .min(1, 'Pegá al menos un gasto fijo.')
    .max(100, 'Hasta 100 gastos fijos por vez.'),
})

export const skipRecurringDueSchema = obj({
  id: uuidField('Falta el gasto fijo.'),
  dueDate: isoDay,
})

// ─── Períodos y ejercicio (C.5) ──────────────────────────────────────────────

/** Las cifras de la posición de IVA que vio la persona (si cambian: `preview_stale`). */
// Débito, crédito, percepciones y retenciones pueden dar negativo (un mes con
// solo notas de crédito). A pagar y el saldo técnico nuevo nunca; la libre
// disponibilidad nueva sí: con saldo técnico a favor es LD₀ + PERC + RET, y un
// mes con solo NC de percepciones la deja abajo de cero (la base la acepta igual).
export const ivaPositionExpectedSchema = obj({
  debitCents: signedCentsInt(),
  creditCents: signedCentsInt(),
  perceptionsCents: signedCentsInt(),
  withholdingsCents: signedCentsInt(),
  toPayCents: centsInt({ allowZero: true }),
  technicalBalanceNewCents: centsInt({ allowZero: true }),
  freeBalanceNewCents: signedCentsInt(),
})

export const closePeriodSchema = obj({
  month: isoMonth,
  warningsAck: list(
    z.enum(CLOSE_WARNING_KEYS, { message: 'Aviso desconocido. Recargá la página.' }),
  )
    .max(8, 'Demasiados avisos.')
    .default([]),
  ivaSettlement: obj({
    generate: z.boolean({ message: 'Revisá esta opción.' }).default(true),
    expected: ivaPositionExpectedSchema.nullable().default(null),
  }).default({ generate: true, expected: null }),
})

export const reopenSchema = obj({ month: isoMonth, reason: reasonField })

export const generateIvaSettlementSchema = obj({
  month: isoMonth,
  expected: ivaPositionExpectedSchema,
})

export const closeFiscalYearSchema = obj({
  fiscalYearId: uuidField('Falta el ejercicio.'),
  expected: obj({
    resultCents: signedCentsInt(),
    balanceSheetAccounts: z
      .number({ message: 'Recargá la página y probá de nuevo.' })
      .int('Recargá la página y probá de nuevo.')
      .min(0, 'Recargá la página y probá de nuevo.')
      .max(10_000, 'Recargá la página y probá de nuevo.'),
  }),
})

export const reopenFiscalYearSchema = obj({
  fiscalYearId: uuidField('Falta el ejercicio.'),
  reason: reasonField,
})

// ─── Accesos (B.5) ───────────────────────────────────────────────────────────

export const grantAccessSchema = obj({
  userId: uuidField('Elegí a quién le das acceso.'),
  isAdmin: formBoolDefault(false),
  /** El nombre que se ve en Administración (vacío = el de su cuenta). */
  displayName: optionalText(80, 'El nombre puede tener hasta 80 caracteres.').default(null),
})

export const revokeAccessSchema = obj({
  userId: uuidField('Elegí a quién le sacás el acceso.'),
  reason: optionalText(200).default(null),
})

// ─── Asistente de puesta en marcha (H.3, payload de acc_bootstrap) ───────────

export const BOOTSTRAP_METHODS = [
  'cash',
  'transfer',
  'qr_mp',
  'debit',
  'credit',
  'customer_account',
  'deposit_applied',
] as const
export const BOOTSTRAP_PLATFORMS = [
  'pedidosya',
  'rappi',
  'uber_eats',
  'mp_delivery',
  'pedix',
] as const
export const BOOTSTRAP_RATE_PARTIES = [
  'mercado_pago',
  'posnet_debito',
  'posnet_credito',
  'pedidosya',
  'rappi',
  'uber_eats',
  'mp_delivery',
  'pedix',
] as const

const bootstrapTreasurySchema = obj({
  key: z
    .string({ message: 'Recargá la página y probá de nuevo.' })
    .regex(/^[a-z][a-z0-9_]{1,30}$/, 'Recargá la página y probá de nuevo.'),
  name: z
    .string({ message: 'Escribí el nombre de la caja.' })
    .trim()
    .min(2, 'Escribí el nombre de la caja.')
    .max(60, 'El nombre puede tener hasta 60 caracteres.'),
  kind: z.enum(TREASURY_KINDS, { message: 'Elegí el tipo de caja.' }),
  /** Mismo formato que exige la base (`atr_alias`): si no, el asistente falla al guardar. */
  alias: z.preprocess(
    (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
    z
      .string({ message: 'Revisá el alias.' })
      .trim()
      .regex(/^[A-Za-z0-9.-]{6,20}$/, 'El alias va de 6 a 20 letras, números, puntos o guiones.')
      .nullable(),
  ),
  bankName: optionalText(80).default(null),
  cbuCvu: optionalCbuField,
  createBankParty: z.boolean({ message: 'Revisá esta opción.' }).default(false),
})

const rateSchema = obj({
  commissionBp: bpField().optional(),
  sircupaBp: bpField().optional(),
  iibbWithholdingBp: bpField().optional(),
  vatWithholdingBp: bpField().optional(),
  incomeTaxWithholdingBp: bpField().optional(),
})

export const bootstrapSchema = obj({
  displayName: z
    .string({ message: 'Escribí cómo te llamás.' })
    .trim()
    .min(1, 'Escribí cómo te llamás.')
    .max(80, 'Puede tener hasta 80 caracteres.'),
  settings: obj({
    legalName: z
      .string({ message: 'Escribí la razón social.' })
      .trim()
      .min(2, 'Escribí la razón social.')
      .max(160, 'La razón social puede tener hasta 160 caracteres.'),
    cuit: optionalCuitField.default(null),
    ivaCondition: z
      .enum(SAS_IVA_CONDITIONS, { message: 'Elegí la condición frente al IVA.' })
      .default('responsable_inscripto'),
    iibbRegime: z
      .enum(['local', 'convenio_multilateral', 'exento', 'no_inscripto'], {
        message: 'Elegí el régimen de Ingresos Brutos.',
      })
      .default('local'),
    iibbNumber: optionalText(30).default(null),
    iibbJurisdictionCode: z
      .number({ message: 'Elegí la jurisdicción de IIBB.' })
      .int('Elegí la jurisdicción de IIBB.')
      .min(901, 'Elegí la jurisdicción de IIBB.')
      .max(924, 'Elegí la jurisdicción de IIBB.')
      .default(904),
    activityStartDate: optionalIsoDay.default(null),
    fiscalAddress: optionalText(200).default(null),
    booksStartDate: isoDay,
    fiscalYearEndMonth: z
      .number({ message: 'Elegí el mes de cierre del ejercicio.' })
      .int('Elegí el mes de cierre del ejercicio.')
      .min(1, 'Elegí el mes de cierre del ejercicio.')
      .max(12, 'Elegí el mes de cierre del ejercicio.')
      .default(12),
    ivaSettlementMode: z
      .enum(['on_close', 'manual'], { message: 'Elegí cómo se liquida el IVA.' })
      .default('on_close'),
  }),
  treasuries: list(bootstrapTreasurySchema)
    .min(1, 'Agregá al menos una caja de efectivo.')
    .max(20, 'Hasta 20 cajas.'),
  sales: obj({
    transferDestination: z
      .string({ message: 'Elegí adónde entran las transferencias.' })
      .regex(/^[a-z][a-z0-9_]{1,30}$/, 'Elegí adónde entran las transferencias.')
      .nullable()
      .default(null),
    transferDeductsIibb: z.boolean({ message: 'Revisá esta opción.' }).default(true),
    enabledMethods: list(z.enum(BOOTSTRAP_METHODS, { message: 'Medio de cobro desconocido.' }))
      .max(BOOTSTRAP_METHODS.length, 'Demasiados medios.')
      .default(['cash']),
    enabledPlatforms: list(z.enum(BOOTSTRAP_PLATFORMS, { message: 'Plataforma desconocida.' }))
      .max(BOOTSTRAP_PLATFORMS.length, 'Demasiadas plataformas.')
      .default([]),
    rates: z
      .partialRecord(z.enum(BOOTSTRAP_RATE_PARTIES), rateSchema, {
        message: 'Revisá las tasas.',
      })
      .default({}),
    salesPoints: list(
      obj({
        number: z
          .number({ message: 'Revisá el punto de venta.' })
          .int('Revisá el punto de venta.')
          .min(1, 'Revisá el punto de venta.')
          .max(99_998, 'Revisá el punto de venta.'),
        label: z
          .string({ message: 'Escribí cómo lo llamás.' })
          .trim()
          .min(1, 'Escribí cómo lo llamás.')
          .max(60, 'Puede tener hasta 60 caracteres.'),
        defaultChannel: z.enum(CHANNELS, { message: 'Elegí el canal.' }).default('salon'),
      }),
    )
      .max(20, 'Hasta 20 puntos de venta.')
      .default([]),
  }),
}).superRefine((v, ctx) => {
  if (!v.treasuries.some((t) => t.kind === 'cash')) {
    ctx.addIssue({
      code: 'custom',
      path: ['treasuries'],
      message: 'Agregá al menos una caja de efectivo.',
    })
  }
  if (hasDuplicates(v.treasuries.map((t) => t.name.toLowerCase()))) {
    ctx.addIssue({
      code: 'custom',
      path: ['treasuries'],
      message: 'Ya hay una caja con ese nombre.',
    })
  }
  if (hasDuplicates(v.treasuries.map((t) => t.key))) {
    ctx.addIssue({
      code: 'custom',
      path: ['treasuries'],
      message: 'Recargá la página y probá de nuevo.',
    })
  }
  const destination = v.sales.transferDestination
  if (destination !== null && !v.treasuries.some((t) => t.key === destination)) {
    ctx.addIssue({
      code: 'custom',
      path: ['sales', 'transferDestination'],
      message: 'Elegí adónde entran las transferencias.',
    })
  }
  if (hasDuplicates(v.sales.salesPoints.map((p) => String(p.number)))) {
    ctx.addIssue({
      code: 'custom',
      path: ['sales', 'salesPoints'],
      message: 'Ese punto de venta ya está cargado.',
    })
  }
  const start = v.settings.activityStartDate
  if (start !== null && v.settings.booksStartDate < start) {
    ctx.addIssue({
      code: 'custom',
      path: ['settings', 'booksStartDate'],
      message: 'Los libros no pueden arrancar antes del inicio de actividades.',
    })
  }
})
export type BootstrapInput = z.infer<typeof bootstrapSchema>

/** Cuántos días para atrás puede arrancar Administración (`acc_bootstrap`). */
export const BOOKS_START_MAX_DAYS_BACK = 400

/**
 * El asistente con la ventana de fechas de `acc_bootstrap`: la fecha de
 * arranque no puede ser futura ni de hace más de 400 días (`invalid_start_date`).
 * `today` es el día del bar (`todayInCordoba()` en el servidor).
 */
export function bootstrapSchemaAt(today: string) {
  const earliest = addDays(today, -BOOKS_START_MAX_DAYS_BACK)
  return bootstrapSchema.superRefine((v, ctx) => {
    const date = v.settings.booksStartDate
    if (date > today || date < earliest) {
      ctx.addIssue({
        code: 'custom',
        path: ['settings', 'booksStartDate'],
        message:
          'La fecha de arranque tiene que ser de los últimos 13 meses y no puede ser futura.',
      })
    }
  })
}
