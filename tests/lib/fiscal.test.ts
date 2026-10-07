import { describe, expect, it } from 'vitest'
import {
  CUIT_MESSAGES,
  CUIT_PREFIXES,
  cuitCheckDigit,
  formatCuit,
  formatVoucherNumber,
  formatVoucherRange,
  isValidCuit,
  normalizeCuit,
  padDocNumber,
  padPv,
  parseCuit,
  parseDocNumber,
  parsePointOfSale,
  parseVoucherNumber,
  parseVoucherRange,
  VOUCHER_RANGE_MESSAGES,
} from '@/lib/fiscal'
import * as comprobante from '@/lib/fiscal/comprobante'

/** PRNG con semilla (mulberry32): mismos casos en cada corrida. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Traducción literal de `public.acc_cuit_is_valid` (Sprint 1, A.1): el regex
 * del prefijo, la suma con los pesos y el CASE (11 → 0, 10 → −1, nunca igual).
 */
function sqlCuitIsValid(p: string): boolean {
  if (!/^(20|23|24|25|26|27|30|33|34)[0-9]{9}$/.test(p)) return false
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  let s = 0
  for (let i = 1; i <= 10; i++) s += Number(p.substring(i - 1, i)) * (weights[i - 1] ?? 0)
  const r = 11 - (s % 11)
  const expected = r === 11 ? 0 : r === 10 ? -1 : r
  return expected === Number(p.substring(10, 11))
}

// ─── CUIT ────────────────────────────────────────────────────────────────────

describe('CUIT', () => {
  it('los verificados con la base y el ejemplo del kit', () => {
    for (const cuit of [
      '30718765435',
      '30-71876543-5',
      '33-69345023-9',
      '30-70308853-4',
      '20-12345678-6',
      ' 20 12345678 6 ',
      '20.12345678.6',
    ]) {
      expect(isValidCuit(cuit)).toBe(true)
    }
    expect(parseCuit('20-12345678-6')).toEqual({ ok: true, cuit: '20123456786' })
  })

  it('por qué no sirve', () => {
    expect(parseCuit('20-12345678-5')).toEqual({ ok: false, reason: 'digito' })
    expect(parseCuit('2012345678')).toEqual({ ok: false, reason: 'largo' })
    expect(parseCuit('201234567861')).toEqual({ ok: false, reason: 'largo' })
    expect(parseCuit('20-1234567A-6')).toEqual({ ok: false, reason: 'largo' })
    expect(parseCuit('21123456786')).toEqual({ ok: false, reason: 'prefijo' })
    expect(parseCuit('')).toEqual({ ok: false, reason: 'vacio' })
    expect(parseCuit(null)).toEqual({ ok: false, reason: 'vacio' })
    expect(CUIT_MESSAGES.digito).toBe('El CUIT no es válido: revisá el último número')
  })

  it('verificador 11 → 0 y verificador 10 → no existe ningún CUIT con ese comienzo', () => {
    let zero: string | null = null
    let impossible: string | null = null
    for (let dni = 10_000_000; (zero === null || impossible === null) && dni < 10_001_000; dni++) {
      const firstTen = `20${dni}`
      const check = cuitCheckDigit(firstTen)
      if (check === 0 && zero === null) zero = firstTen
      if (check === null && impossible === null) impossible = firstTen
    }
    if (zero === null || impossible === null) throw new Error('no se encontraron los dos casos')
    expect(isValidCuit(`${zero}0`)).toBe(true)
    for (let d = 0; d <= 9; d++) expect(isValidCuit(`${impossible}${d}`)).toBe(false)
    expect(cuitCheckDigit('123')).toBeNull()
  })

  it('da exactamente lo mismo que acc_cuit_is_valid (20.000 números al azar)', () => {
    const rand = prng(30718765)
    const prefixes = [...CUIT_PREFIXES, '21', '22', '28', '31', '35', '00', '99']
    for (let i = 0; i < 20_000; i++) {
      const prefix = prefixes[Math.floor(rand() * prefixes.length)] ?? '20'
      const body = String(Math.floor(rand() * 1e9)).padStart(9, '0')
      const cuit = `${prefix}${body}`
      expect(isValidCuit(cuit)).toBe(sqlCuitIsValid(cuit))
    }
  })

  it('formato y normalización', () => {
    expect(formatCuit('20123456786')).toBe('20-12345678-6')
    expect(formatCuit(' 20-12345678-6 ')).toBe('20-12345678-6')
    expect(formatCuit('2012')).toBe('2012')
    expect(formatCuit(null)).toBe('')
    expect(normalizeCuit('20-12345678-6')).toBe('20123456786')
    expect(normalizeCuit(undefined)).toBe('')
  })
})

// ─── Punto de venta y número ─────────────────────────────────────────────────

describe('punto de venta y número', () => {
  it('ceros a la izquierda (CodeField)', () => {
    expect(padPv(3)).toBe('00003')
    expect(padPv('3', 4)).toBe('0003')
    expect(padPv(' 7 ')).toBe('00007')
    expect(padPv(12345)).toBe('12345')
    expect(padPv('abc')).toBe('abc')
    expect(padDocNumber(1290)).toBe('00001290')
    expect(padDocNumber('1290')).toBe('00001290')
  })

  it('lectura con los rangos de la base (PV 0–99.999, número 1–99.999.999)', () => {
    expect(parsePointOfSale('00003')).toBe(3)
    expect(parsePointOfSale('0')).toBe(0)
    expect(parsePointOfSale(99999)).toBe(99999)
    expect(parsePointOfSale('100000')).toBeNull()
    expect(parsePointOfSale('3a')).toBeNull()
    expect(parsePointOfSale('')).toBeNull()
    expect(parseDocNumber('00001290')).toBe(1290)
    expect(parseDocNumber(99_999_999)).toBe(99_999_999)
    expect(parseDocNumber('0')).toBeNull()
    expect(parseDocNumber('123456789')).toBeNull()
  })

  it('formato «0003-00001290», o el de ARCA con 5 dígitos', () => {
    expect(formatVoucherNumber(3, 1290)).toBe('0003-00001290')
    expect(formatVoucherNumber(12345, 1)).toBe('12345-00000001')
    expect(formatVoucherNumber(3, 1290, { posWidth: 5 })).toBe('00003-00001290')
  })

  it('parseVoucherNumber lee lo que se pega', () => {
    const expected = { pointOfSale: 3, number: 1290 }
    for (const text of [
      '0003-00001290',
      '00003-00001290',
      '3-1290',
      '0003 00001290',
      '0003 - 00001290',
      '0003–00001290',
      '0003/00001290',
      'Factura A 0003-00001290',
      'FA 0003-00001290',
      '000300001290',
      '0000300001290',
      '  0003-00001290  ',
    ]) {
      expect(parseVoucherNumber(text)).toEqual(expected)
    }
    for (const text of [
      '0003-00000000',
      '123456-1',
      '0003-123456789',
      '00001290',
      '0003-00001290-1',
      '',
      'abc',
      null,
    ]) {
      expect(parseVoucherNumber(text)).toBeNull()
    }
  })
})

describe('rangos de comprobantes', () => {
  const RANGE = { ok: true, pointOfSale: 3, from: 14501, to: 14662, count: 162 }

  it('el pegado de Thinkeon y sus variantes', () => {
    for (const text of [
      '0003-00014501 a 0003-00014662',
      '0003-00014501 al 0003-00014662',
      '0003-00014501 hasta 0003-00014662',
      '0003-00014501..0003-00014662',
      '0003-00014501 - 0003-00014662',
      '0003-00014501 – 0003-00014662',
      '0003-00014501–0003-00014662',
      '0003-00014501 a 00014662',
      'Facturas B 0003-00014501 a 0003-00014662',
      // La «A» del comprobante no es el separador.
      'Factura A 0003-00014501 a 0003-00014662',
      '00003-00014501 A 00003-00014662',
    ]) {
      expect(parseVoucherRange(text)).toEqual(RANGE)
    }
    expect(parseVoucherRange('0003-00000088 a 0003-00000088')).toEqual({
      ok: true,
      pointOfSale: 3,
      from: 88,
      to: 88,
      count: 1,
    })
  })

  it('por qué no sirve', () => {
    expect(parseVoucherRange('0003-00014501 a 0004-00014662')).toEqual({
      ok: false,
      reason: 'puntos-distintos',
    })
    expect(parseVoucherRange('0003-00014662 a 0003-00014501')).toEqual({
      ok: false,
      reason: 'invertido',
    })
    for (const text of ['0003-00014501', '0003-00014501 a', 'desde el 1 al 2', '', null]) {
      expect(parseVoucherRange(text)).toEqual({ ok: false, reason: 'ilegible' })
    }
    expect(VOUCHER_RANGE_MESSAGES.invertido).toBe('El «hasta» no puede ser menor que el «desde».')
  })

  it('formato e ida y vuelta', () => {
    expect(formatVoucherRange(3, 14501, 14662)).toBe('0003-00014501 a 0003-00014662')
    const rand = prng(14501)
    for (let i = 0; i < 2000; i++) {
      const pos = Math.floor(rand() * 100_000)
      const from = 1 + Math.floor(rand() * 99_999_998)
      const to = from + Math.floor(rand() * (99_999_999 - from + 1))
      expect(parseVoucherRange(formatVoucherRange(pos, from, to))).toEqual({
        ok: true,
        pointOfSale: pos,
        from,
        to,
        count: to - from + 1,
      })
      expect(parseVoucherNumber(formatVoucherNumber(pos, from))).toEqual({
        pointOfSale: pos,
        number: from,
      })
    }
  })

  it('lib/fiscal/comprobante (el nombre del kit) es el mismo módulo', () => {
    expect(comprobante.padPv).toBe(padPv)
    expect(comprobante.padDocNumber).toBe(padDocNumber)
    expect(comprobante.parseVoucherRange).toBe(parseVoucherRange)
  })
})
