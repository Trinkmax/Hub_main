/**
 * Lo que se leyó de la foto de un comprobante — PURO.
 *
 * Hay dos maneras de leerlo. El QR de ARCA es exacto y gratis, pero solo lo traen las facturas
 * electrónicas y en una foto de celular muchas veces no se llega a leer (reclamo de los socios del
 * 16/11/2026: «raras veces detecta»). Cuando el QR no aparece, la foto la lee la IA: entiende
 * cualquier papel (también un tique o una factura de talonario), pero puede equivocarse o no llegar
 * a leer un dato.
 *
 * Por eso lo leído es siempre una PROPUESTA: cada dato puede faltar (`null`), nada se guarda solo y
 * la pantalla pide revisar. Acá se pasa de cualquiera de las dos lecturas a una misma forma, sin
 * confiar en lo que devolvió la IA: lo que no tiene sentido (un CUIT que no valida, una fecha del
 * futuro, un número fuera de rango) se descarta en vez de completarse mal.
 */
import { isRealIsoDay } from '@/lib/dates'
import { parseCuit } from '@/lib/fiscal'
import type { ArcaQrData } from './arca-qr'
import type { VoucherType } from './types'

export type InvoiceReadSource = 'qr' | 'ai'

export type InvoiceRead = {
  source: InvoiceReadSource
  /** `yyyy-MM-dd`. */
  date: string | null
  /** De quien emitió el comprobante: 11 números, sin guiones, ya validado. */
  cuit: string | null
  /** Quién lo emite, como figura en el papel. Solo lo trae la IA. */
  issuerName: string | null
  /** Van los dos o ninguno. */
  pointOfSale: number | null
  number: number | null
  /** `null`: un papel que no se carga en compras, o que no se supo cuál es. */
  voucherType: VoucherType | null
  totalCents: number | null
  /** Lo que la IA avisó que no leyó bien, para decírselo a quien carga. */
  doubts: string | null
}

/** Lo que devuelve la IA (el esquema de `lib/tex/read-attachment.ts`), sin confiar en su forma. */
export type AiReadingLike = {
  es_comprobante?: unknown
  papel?: unknown
  emisor?: unknown
  cuit_emisor?: unknown
  punto_de_venta?: unknown
  numero?: unknown
  fecha?: unknown
  total?: unknown
  dudas?: unknown
}

export function readFromQr(qr: ArcaQrData): InvoiceRead {
  return {
    source: 'qr',
    date: qr.date,
    cuit: qr.cuit,
    issuerName: null,
    pointOfSale: qr.pointOfSale,
    number: qr.number,
    voucherType: qr.voucherType,
    totalCents: qr.totalCents,
    doubts: null,
  }
}

/** El papel que dice la IA, como tipo de comprobante de compra. Lo que no se carga así va `null`. */
const AI_PAPER: Readonly<Record<string, VoucherType>> = {
  factura_a: 'factura_a',
  factura_b: 'factura_b',
  factura_c: 'factura_c',
  tique: 'tique',
  remito: 'sin_comprobante',
}

const MAX_POINT_OF_SALE = 99_999
const MAX_NUMBER = 99_999_999
/** El tope de un importe de formulario (el mismo de `validate.ts`). */
const MAX_TOTAL_CENTS = 999_999_999_999
const MAX_NAME = 120
const MAX_DOUBTS = 240

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean === '' ? null : clean.slice(0, max)
}

/** Un entero escrito como texto («0003», «00001290») o como número, dentro de `1..max`. */
function integer(value: unknown, min: number, max: number): number | null {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''
  const digits = raw.replace(/[\s.\-–]/g, '')
  if (!/^\d{1,12}$/.test(digits)) return null
  const n = Number(digits)
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null
}

/**
 * Lo que leyó la IA, llevado a la forma común. `null` si no es un comprobante o no se rescató nada
 * que sirva (ni quién, ni cuánto, ni el número): en ese caso es lo mismo que no haber leído.
 *
 * `today` (`yyyy-MM-dd`): una fecha posterior no es de un comprobante real, se descarta.
 */
export function readFromAi(
  reading: AiReadingLike | null | undefined,
  today: string,
): InvoiceRead | null {
  if (!reading || reading.es_comprobante !== true) return null

  const cuitParse = parseCuit(typeof reading.cuit_emisor === 'string' ? reading.cuit_emisor : null)
  const cuit = cuitParse.ok ? cuitParse.cuit : null

  const pos = integer(reading.punto_de_venta, 0, MAX_POINT_OF_SALE)
  const num = integer(reading.numero, 1, MAX_NUMBER)
  // El número va entero o no va: medio número completaría mal el formulario.
  const hasNumber = pos !== null && num !== null

  const rawDate = typeof reading.fecha === 'string' ? reading.fecha.trim() : ''
  const date = isRealIsoDay(rawDate) && rawDate <= today ? rawDate : null

  const total =
    typeof reading.total === 'number' && Number.isFinite(reading.total) && reading.total > 0
      ? Math.round(reading.total * 100)
      : null
  const totalCents = total !== null && total <= MAX_TOTAL_CENTS ? total : null

  const paper = typeof reading.papel === 'string' ? reading.papel : ''
  const voucherType = AI_PAPER[paper] ?? null
  const issuerName = text(reading.emisor, MAX_NAME)

  if (cuit === null && issuerName === null && totalCents === null && !hasNumber) return null
  return {
    source: 'ai',
    date,
    cuit,
    issuerName,
    pointOfSale: hasNumber ? pos : null,
    number: hasNumber ? num : null,
    voucherType,
    totalCents,
    doubts: text(reading.dudas, MAX_DOUBTS),
  }
}

/** Qué se completó, en palabras, para avisar («Leímos el proveedor, el número y el total»). */
export function readSummary(read: InvoiceRead): string {
  const parts = [
    read.cuit !== null || read.issuerName !== null ? 'el proveedor' : null,
    read.number !== null ? 'el número' : null,
    read.date !== null ? 'la fecha' : null,
    read.totalCents !== null ? 'el total' : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return ''
  const last = parts[parts.length - 1]
  return parts.length === 1 ? (last ?? '') : `${parts.slice(0, -1).join(', ')} y ${last}`
}
