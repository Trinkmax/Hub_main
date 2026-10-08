import { describe, expect, it } from 'vitest'
import type { VatRateBp } from '@/lib/accounting/types'
import {
  aliquotsFromGross,
  checkWsfeAmounts,
  formatCents2,
  type GrossLine,
  netFromGrossHalfEven,
  parseAmountToCents,
  roundHalfEvenDiv,
  splitGrossHalfEven,
  vatFromNetHalfEven,
  vatWithinMargin,
  type WsfeAmounts,
  wsfeAmounts,
} from '@/lib/arca/importes'

/** PRNG determinístico (mulberry32): los «al azar» son siempre los mismos. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** WsfeAmounts desde alícuotas ya separadas (lo que manda `FECAESolicitar`). */
function amountsOf(aliquots: ReturnType<typeof aliquotsFromGross>): WsfeAmounts {
  const iva = aliquots.map((a) => ({
    id: { 0: 3, 250: 9, 500: 8, 1050: 4, 2100: 5, 2700: 6 }[a.rateBp],
    rateBp: a.rateBp,
    baseCents: a.netCents,
    vatCents: a.vatCents,
  }))
  const net = iva.reduce((s, x) => s + x.baseCents, 0)
  const vat = iva.reduce((s, x) => s + x.vatCents, 0)
  return {
    totalCents: net + vat,
    nonTaxedCents: 0,
    netCents: net,
    exemptCents: 0,
    tributesCents: 0,
    vatCents: vat,
    unsupportedCents: 0,
    iva,
  }
}

describe('redondeo «mitad al par» (Round Half Even, como ARCA)', () => {
  it('roundHalfEvenDiv', () => {
    const cases: Array<[bigint, bigint, bigint]> = [
      [5n, 2n, 2n],
      [7n, 2n, 4n],
      [3n, 2n, 2n],
      [1n, 2n, 0n],
      [-5n, 2n, -2n],
      [-7n, 2n, -4n],
      [1n, 3n, 0n],
      [2n, 3n, 1n],
      [10n, 5n, 2n],
      [0n, 7n, 0n],
      [25n, 10n, 2n],
      [35n, 10n, 4n],
      [251n, 100n, 3n],
    ]
    for (const [num, den, want] of cases)
      expect(roundHalfEvenDiv(num, den), `${num}/${den}`).toBe(want)
    expect(() => roundHalfEvenDiv(1n, 0n)).toThrow(RangeError)
  })

  it('IVA desde el neto y neto desde el total', () => {
    expect(vatFromNetHalfEven(10_000, 2100)).toBe(2_100)
    expect(vatFromNetHalfEven(50, 2100)).toBe(10) // 10,5 → 10 (al par)
    expect(vatFromNetHalfEven(150, 2100)).toBe(32) // 31,5 → 32 (al par)
    expect(vatFromNetHalfEven(1_000, 1050)).toBe(105)
    expect(netFromGrossHalfEven(12_100, 2100)).toBe(10_000)
    expect(splitGrossHalfEven(121, 2100)).toEqual({ net: 100, vat: 21 })
    expect(splitGrossHalfEven(0, 2100)).toEqual({ net: 0, vat: 0 })
    expect(splitGrossHalfEven(1_000, 0)).toEqual({ net: 1_000, vat: 0 })
    expect(() => splitGrossHalfEven(-1, 2100)).toThrow(RangeError)
    expect(() => splitGrossHalfEven(1.5, 2100)).toThrow(RangeError)
  })
})

describe('formato de importes (sin float)', () => {
  it('formatCents2', () => {
    expect(formatCents2(1_234_567)).toBe('12345.67')
    expect(formatCents2(5)).toBe('0.05')
    expect(formatCents2(0)).toBe('0.00')
    expect(formatCents2(100)).toBe('1.00')
    expect(formatCents2(-150)).toBe('-1.50')
    expect(formatCents2(1_000_000_000_000_000)).toBe('10000000000000.00')
    expect(formatCents2(10n ** 17n + 1n)).toBe('1000000000000000.01')
    expect(() => formatCents2(1.5)).toThrow(RangeError)
    expect(() => formatCents2(2 ** 60)).toThrow(RangeError)
  })

  it('parseAmountToCents (lo que devuelve ARCA)', () => {
    const cases: Array<[string | null, number | null]> = [
      ['184.05', 18_405],
      ['150', 15_000],
      ['7.8', 780],
      ['0', 0],
      ['12100', 1_210_000],
      ['1.005', 100], // 100,5 → 100 (al par)
      ['1.015', 102], // 101,5 → 102 (al par)
      ['1.0051', 101],
      ['-3.5', -350],
      [' 26.25 ', 2_625],
      ['1e5', null],
      ['12,5', null],
      ['', null],
      [null, null],
      ['NULL', null],
    ]
    for (const [text, want] of cases) expect(parseAmountToCents(text), String(text)).toBe(want)
  })
})

describe('separar el IVA de precios finales (§4.8)', () => {
  it('500 casos al azar: los totales cuadran y ARCA no los rechaza', () => {
    const random = rng(20261008)
    const ratesPool: VatRateBp[][] = [
      [2100],
      [1050],
      [2700],
      [0],
      [2100, 1050],
      [2100, 2700, 0],
      [2100, 1050, 2700, 500, 250, 0],
    ]
    let checked = 0
    for (let i = 0; i < 500; i++) {
      const rates = ratesPool[i % ratesPool.length] ?? [2100]
      const lines: GrossLine[] = []
      const count = 1 + Math.floor(random() * 6)
      for (let k = 0; k < count; k++) {
        const rate = rates[Math.floor(random() * rates.length)] ?? 2100
        // De 1 centavo a $ 10.000.000 (tope de la B anónima), con sesgo a importes chicos.
        const magnitude = 10 ** Math.floor(random() * 9)
        lines.push({ grossCents: 1 + Math.floor(random() * magnitude), rateBp: rate })
      }
      const aliquots = aliquotsFromGross(lines)
      const total = lines.reduce((s, l) => s + l.grossCents, 0)
      const a = amountsOf(aliquots)

      // ImpTotal = suma de las partes · ImpNeto = Σ BaseImp · ImpIVA = Σ Importe (exactos).
      expect(a.totalCents).toBe(total)
      expect(aliquots.reduce((s, x) => s + x.netCents + x.vatCents, 0)).toBe(total)
      // |iva − r·neto| ≤ 0,01 × n (en centavos × 10.000, sin float).
      for (const x of aliquots) {
        const diff = BigInt(x.vatCents) * 10_000n - BigInt(x.netCents) * BigInt(x.rateBp)
        const abs = diff < 0n ? -diff : diff
        expect(abs <= 10_000n * BigInt(aliquots.length)).toBe(true)
        expect(vatWithinMargin(x.netCents, x.rateBp, x.vatCents)).toBe(true)
      }
      // Lo que no pasaría la validación de ARCA: totales de 1 o 2 centavos al 21 %, donde el IVA
      // redondea a 0 (10018). Esos son los únicos rechazos esperables.
      const issues = checkWsfeAmounts(a, { cbteTipo: 6 })
      const tinyZeroVat = a.vatCents === 0 && a.iva.some((x) => x.rateBp !== 0)
      expect(issues, JSON.stringify(lines)).toEqual(tinyZeroVat ? ['10018'] : [])
      checked++
    }
    expect(checked).toBe(500)
  })

  it('suma por alícuota antes de separar (una vez por alícuota, no por renglón)', () => {
    const aliquots = aliquotsFromGross([
      { grossCents: 1_000, rateBp: 2100 },
      { grossCents: 1_000, rateBp: 2100 },
      { grossCents: 500, rateBp: 1050 },
      { grossCents: 0, rateBp: 2700 },
    ])
    expect(aliquots).toEqual([
      { rateBp: 1050, grossCents: 500, netCents: 452, vatCents: 48 },
      { rateBp: 2100, grossCents: 2_000, netCents: 1_653, vatCents: 347 },
    ])
  })
})

describe('wsfeAmounts y checkWsfeAmounts', () => {
  it('lleva los importes del comprobante fiscal a WSFE', () => {
    const a = wsfeAmounts({
      net_21_cents: 1_000_000,
      vat_21_cents: 210_000,
      net_105_cents: 50_000,
      vat_105_cents: 5_250,
      net_0_cents: 3_000,
      non_taxed_cents: 1_000,
      exempt_cents: 2_000,
      total_cents: 1_271_250,
    })
    expect(a).toEqual({
      totalCents: 1_271_250,
      nonTaxedCents: 1_000,
      netCents: 1_053_000,
      exemptCents: 2_000,
      tributesCents: 0,
      vatCents: 215_250,
      unsupportedCents: 0,
      iva: [
        { id: 3, rateBp: 0, baseCents: 3_000, vatCents: 0 },
        { id: 4, rateBp: 1050, baseCents: 50_000, vatCents: 5_250 },
        { id: 5, rateBp: 2100, baseCents: 1_000_000, vatCents: 210_000 },
      ],
    })
    expect(checkWsfeAmounts(a)).toEqual([])
  })

  it('solo IVA 0 %: va la alícuota 3 con importe 0', () => {
    const a = wsfeAmounts({ net_0_cents: 5_000, total_cents: 5_000 })
    expect(a.iva).toEqual([{ id: 3, rateBp: 0, baseCents: 5_000, vatCents: 0 }])
    expect(checkWsfeAmounts(a)).toEqual([])
  })

  it('solo exento o no gravado: sin Iva', () => {
    const a = wsfeAmounts({ exempt_cents: 7_000, non_taxed_cents: 3_000, total_cents: 10_000 })
    expect(a.iva).toEqual([])
    expect(checkWsfeAmounts(a)).toEqual([])
  })

  it('detecta lo que ARCA rechazaría (con el código de su validación)', () => {
    const ok = wsfeAmounts({ net_21_cents: 1_000, vat_21_cents: 210, total_cents: 1_210 })
    expect(checkWsfeAmounts({ ...ok, totalCents: 1_211 })).toEqual(['10048'])
    expect(checkWsfeAmounts({ ...ok, netCents: 1_001, totalCents: 1_211 })).toEqual(['10061'])
    expect(checkWsfeAmounts({ ...ok, vatCents: 211, totalCents: 1_211 })).toEqual(['10023'])

    // 2 centavos de más en una base chica: fuera del margen (10051), salvo en NC y ND.
    const off = wsfeAmounts({ net_21_cents: 1_000, vat_21_cents: 212, total_cents: 1_212 })
    expect(checkWsfeAmounts(off, { cbteTipo: 6 })).toEqual(['10051'])
    expect(checkWsfeAmounts(off, { cbteTipo: 8 })).toEqual([])

    // ImpIVA > 0 sin Iva: no cuadra con Σ Importe (10023) y falta el array (10018).
    expect(checkWsfeAmounts({ ...ok, iva: [], netCents: 0, totalCents: 210 })).toEqual([
      '10023',
      '10018',
    ])
    expect(
      checkWsfeAmounts({
        ...ok,
        vatCents: 0,
        totalCents: 1_000,
        iva: [{ id: 5, rateBp: 2100, baseCents: 1_000, vatCents: 0 }],
      }),
    ).toEqual(['10051', '10018'])
    // ImpNeto > 0 sin Iva: no cuadra con Σ BaseImp (10061) y falta el array (10070).
    expect(checkWsfeAmounts({ ...ok, iva: [], vatCents: 0, totalCents: 1_000 })).toEqual([
      '10061',
      '10070',
    ])
    const zeroBase = {
      ...ok,
      netCents: 0,
      totalCents: 210,
      iva: [{ id: 5, rateBp: 2100 as const, baseCents: 0, vatCents: 210 }],
    }
    expect(checkWsfeAmounts(zeroBase, { cbteTipo: 6 })).toEqual(['10020', '10051'])
    const repeated = {
      ...ok,
      netCents: 2_000,
      vatCents: 420,
      totalCents: 2_420,
      iva: [
        { id: 5, rateBp: 2100 as const, baseCents: 1_000, vatCents: 210 },
        { id: 5, rateBp: 2100 as const, baseCents: 1_000, vatCents: 210 },
      ],
    }
    expect(checkWsfeAmounts(repeated)).toEqual(['10022'])
    expect(checkWsfeAmounts({ ...ok, totalCents: -1 })).toEqual(['invalid_cents'])
    expect(checkWsfeAmounts({ ...ok, totalCents: 1.5 })).toEqual(['invalid_cents'])
  })

  it('tributos e IVA no discriminado: la v1 no los emite', () => {
    const withTax = wsfeAmounts({
      net_21_cents: 1_000,
      vat_21_cents: 210,
      perc_iibb_cents: 30,
      total_cents: 1_240,
    })
    expect(withTax.tributesCents).toBe(30)
    expect(checkWsfeAmounts(withTax)).toEqual(['tributes_unsupported'])
    const undisc = wsfeAmounts({ undiscriminated_cents: 1_210, total_cents: 1_210 })
    expect(checkWsfeAmounts(undisc)).toEqual(['undiscriminated_unsupported', '10048'])
  })

  it('vatWithinMargin: 1 centavo o 0,01 %', () => {
    expect(vatWithinMargin(1_000, 2100, 211)).toBe(true) // 1 centavo
    expect(vatWithinMargin(1_000, 2100, 212)).toBe(false)
    // $ 100.000 de neto: el exacto es 2.100.000; 150 centavos son el 0,0071 %.
    expect(vatWithinMargin(10_000_000, 2100, 2_100_150)).toBe(true)
    expect(vatWithinMargin(10_000_000, 2100, 2_100_300)).toBe(false)
    expect(vatWithinMargin(0, 2100, 0)).toBe(true)
  })
})
