/**
 * El QR de las facturas electrónicas de ARCA (RG 4892/2020): del texto del QR a los datos del
 * comprobante. Puro: sin red y sin navegador; lo usan el panel de la foto y los tests.
 *
 * El QR es una URL de ARCA con los datos en base64, en el parámetro `p`:
 *
 *   https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyMC0xMC0xMyIs…
 *
 *   { ver, fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda, ctz, tipoDocRec, nroDocRec,
 *     tipoCodAut, codAut }
 *
 * Es lo único exacto y gratis para leer una factura: un QR que no es de ARCA, o que no se puede
 * leer, vuelve `null` y la factura se tipea.
 */

import { z } from 'zod'
import { isRealIsoDay } from '@/lib/dates'
import type { VoucherType } from './types'
import { VOUCHER_CATALOG } from './voucher-types'

export type ArcaQrData = {
  /** `yyyy-MM-dd`. */
  date: string
  /** De quien emitió el comprobante: 11 números, sin guiones. */
  cuit: string
  pointOfSale: number
  /** `null`: un código que no se carga en compras. El resto de los datos sirve igual. */
  voucherType: VoucherType | null
  number: number
  /** En pesos: un comprobante en otra moneda se pasa con la cotización que trae. */
  totalCents: number | null
}

/** Dominios de ARCA, de antes y de ahora. */
const ARCA_HOST = /(^|\.)(afip\.gob\.ar|arca\.gob\.ar)$/i

/** Lo que algunos sistemas de facturación mandan como número y otros como texto. */
const numeric = z.union([
  z.number().finite(),
  z
    .string()
    .trim()
    .regex(/^\d+([.,]\d+)?$/)
    .transform((text) => Number(text.replace(',', '.'))),
])

const payloadSchema = z.object({
  fecha: z.string().trim(),
  cuit: z.union([z.number(), z.string()]),
  ptoVta: numeric,
  tipoCmp: numeric,
  nroCmp: numeric,
  importe: numeric,
  moneda: z.string().trim().optional(),
  ctz: numeric.optional(),
})

function decodeBase64(raw: string): string | null {
  // `URLSearchParams` lee «+» como espacio. Algunos sistemas lo mandan como base64url y sin relleno.
  const clean = raw.replace(/\s/g, '+').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const padded = clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), '=')
  try {
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** El parámetro `p` de una URL de ARCA. `null`: es otra cosa. */
function payloadFromUrl(text: string): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!ARCA_HOST.test(url.hostname)) return null
  return url.searchParams.get('p')
}

/** «2026-11-04», también «20261104» y «2026-11-04T00:00:00», que hay sistemas que lo mandan así. */
function dayOf(text: string): string | null {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(text)
  if (!match) return null
  const day = `${match[1]}-${match[2]}-${match[3]}`
  return isRealIsoDay(day) ? day : null
}

function cuitOf(raw: number | string): string | null {
  const digits = (typeof raw === 'number' ? String(Math.trunc(raw)) : raw).replace(/\D/g, '')
  return digits.length === 11 ? digits : null
}

function positiveInt(value: number, max: number): number | null {
  return Number.isSafeInteger(value) && value > 0 && value <= max ? value : null
}

/** El tipo de comprobante por su código de ARCA, entre los que se cargan en compras. */
export function voucherTypeFromArcaCode(code: number): VoucherType | null {
  for (const info of Object.values(VOUCHER_CATALOG)) {
    if (info.afipCode === code && info.purchases) return info.type
  }
  return null
}

function totalInPesos(importe: number, moneda: string | undefined, ctz: number | undefined) {
  if (!Number.isFinite(importe) || importe <= 0) return null
  const cents = Math.round(importe * 100)
  if (!moneda || moneda.toUpperCase() === 'PES') return cents
  if (ctz === undefined || !Number.isFinite(ctz) || ctz <= 0) return null
  const pesos = Math.round(cents * ctz)
  return Number.isSafeInteger(pesos) ? pesos : null
}

/**
 * El texto de un QR → los datos del comprobante. `null` si no es un QR de ARCA o le falta lo que lo
 * identifica (fecha, CUIT, punto de venta o número).
 */
export function parseArcaQr(text: unknown): ArcaQrData | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > 4096) return null
  const encoded = payloadFromUrl(text)
  if (!encoded) return null
  const json = decodeBase64(encoded)
  if (json === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  const parsed = payloadSchema.safeParse(raw)
  if (!parsed.success) return null
  const { fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda, ctz } = parsed.data

  const date = dayOf(fecha)
  const issuer = cuitOf(cuit)
  const pointOfSale = positiveInt(ptoVta, 99_999)
  const number = positiveInt(nroCmp, 99_999_999)
  if (date === null || issuer === null || pointOfSale === null || number === null) return null

  return {
    date,
    cuit: issuer,
    pointOfSale,
    voucherType: voucherTypeFromArcaCode(tipoCmp),
    number,
    totalCents: totalInPesos(importe, moneda, ctz),
  }
}
