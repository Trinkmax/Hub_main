/**
 * Comprobantes que emite la plataforma por WSFE y sus tablas (diseño §2.4.1 y
 * §3.2; `arca-tecnico.md` §4.6, §4.9 y §4.12).
 *
 * - `CBTE_TIPO`: la v1 emite Factura, Nota de débito y Nota de crédito A y B
 *   (1, 2, 3, 6, 7, 8). Las «A con leyenda» (51–53) y la FCE MiPyME quedan afuera.
 * - `CONDICION_IVA_RECEPTOR`: las 11 condiciones frente al IVA del receptor de la
 *   RG 5616 y la clase de comprobante que admite cada una (anexo del manual
 *   v4.7). `CondicionIVAReceptorId` se manda **siempre**: desde el 01/12/2026 su
 *   falta se rechaza (10246).
 * - Para un emisor responsable inscripto: Factura **A** a 1, 6, 13 y 16 (RG
 *   5003/2021: también al monotributista) y **B** a 4, 5, 7, 8, 9, 10 y 15.
 * - `qrPayload` / `qrUrl`: el QR de la factura impresa (RG 4892, especificación
 *   versión 1).
 *
 * Puro: sirve en el navegador y en el servidor.
 */

import type {
  AfipDocType,
  Cents,
  IvaCondition,
  TaxIdType,
  VoucherType,
} from '@/lib/accounting/types'
import { afipDocType } from '@/lib/accounting/voucher-types'
import { isRealIsoDay } from '@/lib/dates'
import { parseCuit } from '@/lib/fiscal'

// ─── Tipos de comprobante ────────────────────────────────────────────────────

export const CBTE_TIPO = {
  factura_a: 1,
  nota_debito_a: 2,
  nota_credito_a: 3,
  factura_b: 6,
  nota_debito_b: 7,
  nota_credito_b: 8,
} as const

/** Los tipos de comprobante (de `VOUCHER_CATALOG`) que la plataforma emite por WSFE. */
export type ArcaVoucherType = keyof typeof CBTE_TIPO
export type CbteTipo = (typeof CBTE_TIPO)[ArcaVoucherType]

export const CBTE_TIPOS: readonly CbteTipo[] = [1, 2, 3, 6, 7, 8]

const VOUCHER_BY_CBTE: Readonly<Record<CbteTipo, ArcaVoucherType>> = {
  1: 'factura_a',
  2: 'nota_debito_a',
  3: 'nota_credito_a',
  6: 'factura_b',
  7: 'nota_debito_b',
  8: 'nota_credito_b',
}

export function isCbteTipo(value: unknown): value is CbteTipo {
  return typeof value === 'number' && (CBTE_TIPOS as readonly number[]).includes(value)
}

/** `6` → `'factura_b'`. */
export function voucherTypeForCbte(cbteTipo: CbteTipo): ArcaVoucherType {
  return VOUCHER_BY_CBTE[cbteTipo]
}

/** `'factura_b'` → `6`; `null` si la plataforma no lo emite por WSFE. */
export function cbteForVoucherType(type: VoucherType): CbteTipo | null {
  return Object.hasOwn(CBTE_TIPO, type) ? CBTE_TIPO[type as ArcaVoucherType] : null
}

export function letterForCbte(cbteTipo: CbteTipo): 'A' | 'B' {
  return cbteTipo <= 3 ? 'A' : 'B'
}

export function isCreditNoteCbte(cbteTipo: CbteTipo): boolean {
  return cbteTipo === 3 || cbteTipo === 8
}

export function isDebitNoteCbte(cbteTipo: CbteTipo): boolean {
  return cbteTipo === 2 || cbteTipo === 7
}

/** NC y ND: tienen que asociar un comprobante o un período (10197). */
export function isNoteCbte(cbteTipo: CbteTipo): boolean {
  return isCreditNoteCbte(cbteTipo) || isDebitNoteCbte(cbteTipo)
}

/**
 * Qué tipos se pueden asociar a una NC o ND (validación 10040). A una factura no se
 * le asocia nada en la v1.
 */
export function associableCbteTipos(cbteTipo: CbteTipo): readonly number[] {
  if (cbteTipo === 2 || cbteTipo === 3) return [1, 2, 3, 4, 5, 34, 39, 60, 63, 88, 991]
  if (cbteTipo === 7 || cbteTipo === 8) return [6, 7, 8, 9, 10, 35, 40, 61, 64, 88, 991]
  return []
}

// ─── Documento del receptor ──────────────────────────────────────────────────

/** `DocTipo` de WSFE según la identificación del partícipe: 80 CUIT · 86 CUIL · 96 DNI · 99 ninguna. */
export function docTipoFor(taxIdType: TaxIdType): AfipDocType {
  return afipDocType(taxIdType)
}

/**
 * `DocNro` para WSFE: solo dígitos, validado según el tipo (CUIT o CUIL con su
 * dígito verificador; DNI de 1 a 8 dígitos; con 99, `'0'`). `null` si no sirve.
 */
export function docNroFor(docTipo: AfipDocType, taxId: string | null | undefined): string | null {
  if (docTipo === 99) return '0'
  const digits = (taxId ?? '').replace(/\D/g, '')
  if (docTipo === 80 || docTipo === 86) {
    const parsed = parseCuit(digits)
    return parsed.ok ? parsed.cuit : null
  }
  return /^\d{1,8}$/.test(digits) && Number(digits) > 0 ? String(Number(digits)) : null
}

// ─── Condición frente al IVA del receptor (RG 5616) ──────────────────────────

/** Clases de comprobante de `FEParamGetCondicionIvaReceptor` (`ALEY` = A con leyenda). */
export type ArcaVoucherClass = 'A' | 'ALEY' | 'B' | 'C' | '49'

export type CondicionIvaReceptor = {
  readonly id: number
  /** La descripción de ARCA. */
  readonly label: string
  /** Para listas: más corta, como la usa el panel. */
  readonly short: string
  readonly classes: readonly ArcaVoucherClass[]
}

export const CONDICION_IVA_RECEPTOR: readonly CondicionIvaReceptor[] = [
  {
    id: 1,
    label: 'IVA Responsable Inscripto',
    short: 'Responsable inscripto',
    classes: ['A', 'ALEY', 'C'],
  },
  { id: 4, label: 'IVA Sujeto Exento', short: 'Exento', classes: ['B', 'C'] },
  { id: 5, label: 'Consumidor Final', short: 'Consumidor final', classes: ['B', 'C', '49'] },
  { id: 6, label: 'Responsable Monotributo', short: 'Monotributo', classes: ['A', 'ALEY', 'C'] },
  { id: 7, label: 'Sujeto No Categorizado', short: 'No categorizado', classes: ['B', 'C'] },
  { id: 8, label: 'Proveedor del Exterior', short: 'Proveedor del exterior', classes: ['B', 'C'] },
  { id: 9, label: 'Cliente del Exterior', short: 'Cliente del exterior', classes: ['B', 'C'] },
  {
    id: 10,
    label: 'IVA Liberado – Ley N° 19.640',
    short: 'IVA liberado (Ley 19.640)',
    classes: ['B', 'C'],
  },
  {
    id: 13,
    label: 'Monotributista Social',
    short: 'Monotributo social',
    classes: ['A', 'ALEY', 'C'],
  },
  { id: 15, label: 'IVA No Alcanzado', short: 'IVA no alcanzado', classes: ['B', 'C'] },
  {
    id: 16,
    label: 'Monotributo Trabajador Independiente Promovido',
    short: 'Monotributo promovido',
    classes: ['A', 'ALEY', 'C'],
  },
]

export const CONDICION_IVA_RECEPTOR_IDS: ReadonlySet<number> = new Set(
  CONDICION_IVA_RECEPTOR.map((c) => c.id),
)

export function condicionIvaReceptor(id: number): CondicionIvaReceptor | null {
  return CONDICION_IVA_RECEPTOR.find((c) => c.id === id) ?? null
}

/**
 * La condición de WSFE que corresponde a la del partícipe (`acc_parties.iva_condition`).
 * `sin_datos` no tiene una: hay que elegirla al emitir. Monotributo social y
 * promovido (13 y 16) se eligen a mano: el partícipe guarda solo «monotributo».
 */
export function condicionFromIvaCondition(condition: IvaCondition): number | null {
  switch (condition) {
    case 'responsable_inscripto':
      return 1
    case 'monotributo':
      return 6
    case 'exento':
      return 4
    case 'consumidor_final':
      return 5
    case 'no_alcanzado':
      return 15
    case 'sin_datos':
      return null
  }
}

/**
 * La letra que le corresponde emitir a un responsable inscripto según la
 * condición del receptor: A para 1, 6, 13 y 16; B para el resto. `null` si el id
 * no existe.
 */
export function letterForCondicion(id: number): 'A' | 'B' | null {
  const condicion = condicionIvaReceptor(id)
  if (!condicion) return null
  return condicion.classes.includes('A') ? 'A' : 'B'
}

/** ¿La condición va con la letra? (10243). */
export function isCondicionValidForLetter(id: number, letter: 'A' | 'B'): boolean {
  return letterForCondicion(id) === letter
}

// ─── Topes ───────────────────────────────────────────────────────────────────

/**
 * Monto desde el que hay que identificar al consumidor final en una Factura B
 * (RG 5700/2025: $ 10.000.000). El valor exacto que valida el WS está A CONFIRMAR
 * (P-T12): si ARCA rechaza, el error lo dice (10015).
 */
export const FINAL_CONSUMER_ID_THRESHOLD_CENTS: Cents = 1_000_000_000

// ─── QR (RG 4892) ────────────────────────────────────────────────────────────

/**
 * Base del QR. La especificación dice `www.arca.gob.ar/fe/qr/` y su ejemplo usa
 * `www.afip.gob.ar/fe/qr/` (A CONFIRMAR, P-T11): por eso es un parámetro.
 */
export const ARCA_QR_BASE_URL = 'https://www.arca.gob.ar/fe/qr/'

export type QrData = {
  /** Fecha de emisión, `'yyyy-MM-dd'`. */
  readonly fecha: string
  /** CUIT del emisor (11 dígitos). */
  readonly cuit: string
  readonly ptoVta: number
  readonly tipoCmp: number
  readonly nroCmp: number
  readonly importeCents: Cents
  /** `'PES'` por defecto. */
  readonly moneda?: string
  /** Cotización, decimal en texto; `'1'` en pesos. */
  readonly ctz?: string
  readonly docTipo?: number | null
  readonly docNro?: string | null
  /** El CAE (14 dígitos). */
  readonly codAut: string
  /** `'E'` CAE (por defecto) · `'A'` CAEA. */
  readonly tipoCodAut?: 'E' | 'A'
}

/** Importe del QR: entero si no tiene centavos (`12100`), si no `121.5` / `121.55`. */
function qrAmount(cents: Cents): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('Importe del QR inválido')
  const whole = Math.trunc(cents / 100)
  const frac = cents % 100
  if (frac === 0) return String(whole)
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`
}

/**
 * El JSON versión 1 del QR, con las claves en el orden de la especificación. Con
 * documento 99 (consumidor final anónimo) no van `tipoDocRec` ni `nroDocRec`
 * («de corresponder»).
 */
export function qrJson(data: QrData): string {
  if (!isRealIsoDay(data.fecha)) throw new RangeError('Fecha del QR inválida')
  if (!/^\d{11}$/.test(data.cuit)) throw new RangeError('CUIT del QR inválida')
  if (!/^\d{14}$/.test(data.codAut)) throw new RangeError('Código de autorización del QR inválido')
  const moneda = data.moneda ?? 'PES'
  const ctz = data.ctz ?? '1'
  if (!/^[A-Z0-9]{3}$/.test(moneda)) throw new RangeError('Moneda del QR inválida')
  if (!/^\d{1,13}(\.\d{1,6})?$/.test(ctz)) throw new RangeError('Cotización del QR inválida')
  for (const [n, max] of [
    [data.ptoVta, 99_999],
    [data.tipoCmp, 999],
    [data.nroCmp, 99_999_999],
  ] as const) {
    if (!Number.isInteger(n) || n < 1 || n > max) throw new RangeError('Número del QR inválido')
  }
  const parts = [
    '"ver":1',
    `"fecha":"${data.fecha}"`,
    `"cuit":${data.cuit}`,
    `"ptoVta":${data.ptoVta}`,
    `"tipoCmp":${data.tipoCmp}`,
    `"nroCmp":${data.nroCmp}`,
    `"importe":${qrAmount(data.importeCents)}`,
    `"moneda":"${moneda}"`,
    `"ctz":${ctz}`,
  ]
  const docNro = (data.docNro ?? '').replace(/\D/g, '')
  if (data.docTipo != null && data.docTipo !== 99 && /^\d{1,20}$/.test(docNro)) {
    parts.push(`"tipoDocRec":${data.docTipo}`, `"nroDocRec":${jsonDigits(docNro)}`)
  }
  parts.push(`"tipoCodAut":"${data.tipoCodAut ?? 'E'}"`, `"codAut":${jsonDigits(data.codAut)}`)
  return `{${parts.join(',')}}`
}

/** Dígitos como número de JSON (sin ceros a la izquierda y sin pasar por `float`). */
function jsonDigits(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '')
}

/** El JSON del QR en base64 (es todo ASCII). */
export function qrPayload(data: QrData): string {
  return btoa(qrJson(data))
}

/** El texto que va en el QR: `{base}?p={JSON en base64}`. */
export function qrUrl(data: QrData, base: string = ARCA_QR_BASE_URL): string {
  return `${base}?p=${qrPayload(data)}`
}
