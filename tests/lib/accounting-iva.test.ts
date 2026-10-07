import { describe, expect, it } from 'vitest'
import {
  AFIP_ALIQUOT_ID,
  checkVat,
  distributeProportionally,
  netFromGross,
  percentOf,
  RANGE_VAT_TOLERANCE_CAP,
  rangeVatTolerance,
  splitGross,
  VAT_RATES_BP,
  vatFromNet,
  vatRateLabel,
  vatWarnLimit,
} from '@/lib/accounting/iva'

/** PRNG con semilla (mulberry32): la propiedad corre igual en cada máquina, sin dependencias. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Un total entre 1 y ~1e15: un tercio chicos, el resto repartidos en todas las magnitudes. */
function randomTotal(rand: () => number, i: number): number {
  if (i % 3 === 0) return Math.floor(rand() * 100_000) + 1
  const hi = Math.floor(rand() * 10_000_000)
  const lo = Math.floor(rand() * 100_000_000)
  return hi * 100_000_000 + lo + 1
}

describe('vatFromNet: round_half_up(base × tasa) con BigInt', () => {
  it('los números de los ejemplos de E', () => {
    // E1: 71.074.380 × 21 % = 14.925.619,8 → 14.925.620
    expect(vatFromNet(71_074_380, 2100)).toBe(14_925_620)
    // E2: 20.000.000 × 10,5 % = 2.100.000
    expect(vatFromNet(20_000_000, 1050)).toBe(2_100_000)
    // E5: 1.000.000 × 21 % = 210.000; E12: 800.000 × 21 % = 168.000
    expect(vatFromNet(1_000_000, 2100)).toBe(210_000)
    expect(vatFromNet(800_000, 2100)).toBe(168_000)
    // E9: IVA de la comisión de 594.000
    expect(vatFromNet(594_000, 2100)).toBe(124_740)
  })

  it('la mitad redondea hacia arriba (no al par, no hacia cero)', () => {
    expect(vatFromNet(50, 2100)).toBe(11) // 10,5 → 11
    expect(vatFromNet(100, 1050)).toBe(11) // 10,5 → 11
    expect(vatFromNet(50, 1050)).toBe(5) // 5,25 → 5
    expect(vatFromNet(2, 2700)).toBe(1) // 0,54 → 1
    expect(vatFromNet(1, 2700)).toBe(0) // 0,27 → 0
    expect(vatFromNet(0, 2100)).toBe(0)
    expect(vatFromNet(123_456, 0)).toBe(0)
  })

  it('no pierde precisión con importes grandes (base × tasa > 2^53)', () => {
    expect(vatFromNet(1_000_000_000_000_000, 2700)).toBe(270_000_000_000_000)
    expect(vatFromNet(999_999_999_999_999, 2100)).toBe(210_000_000_000_000) // 209.999.999.999.999,79 → …000
  })

  it('rechaza negativos y centavos con decimales', () => {
    expect(() => vatFromNet(-1, 2100)).toThrow(RangeError)
    expect(() => vatFromNet(10.5, 2100)).toThrow(RangeError)
  })
})

describe('netFromGross: neto desde un total con IVA incluido', () => {
  it('los ejemplos de E.4 y E5', () => {
    expect(netFromGross(1_210_000, 2100)).toBe(1_000_000) // E5
    expect(splitGross(1_210_000, 2100)).toEqual({ net: 1_000_000, vat: 210_000 })
    // $ 3.600 → neto 297.521, IVA 62.479 y vatFromNet(297.521) = 62.479
    expect(splitGross(360_000, 2100)).toEqual({ net: 297_521, vat: 62_479 })
    expect(vatFromNet(297_521, 2100)).toBe(62_479)
    // $ 10,00 → neto 826, IVA 174; vatFromNet(826) = 173: 1 centavo, pasa sin aviso
    expect(splitGross(1_000, 2100)).toEqual({ net: 826, vat: 174 })
    expect(vatFromNet(826, 2100)).toBe(173)
    expect(checkVat(826, 2100, 174)).toBe('ok')
    // E1 desde el total: $ 860.000 → neto 710.743,80, IVA 149.256,20
    expect(splitGross(86_000_000, 2100)).toEqual({ net: 71_074_380, vat: 14_925_620 })
  })

  it('alícuota 0: todo es neto', () => {
    expect(splitGross(12_345, 0)).toEqual({ net: 12_345, vat: 0 })
  })

  it('propiedad: 10.000 totales con semilla × 6 alícuotas → neto + IVA = total e IVA a ≤ 0,5 ¢ del exacto', () => {
    const rand = mulberry32(20_261_001)
    for (let i = 0; i < 10_000; i++) {
      const total = randomTotal(rand, i)
      for (const rate of VAT_RATES_BP) {
        const { net, vat } = splitGross(total, rate)
        expect(net + vat).toBe(total)
        expect(net).toBeGreaterThanOrEqual(0)
        expect(vat).toBeGreaterThanOrEqual(0)
        // IVA exacto = total × tasa / (10000 + tasa). |vat − exacto| ≤ 1/2 ⇔ |2·vat·den − 2·total·tasa| ≤ den.
        const den = 10_000n + BigInt(rate)
        const gap = 2n * BigInt(vat) * den - 2n * BigInt(total) * BigInt(rate)
        expect(gap <= den && gap >= -den).toBe(true)
        // Y lo que daría el IVA calculado sobre ese neto difiere a lo sumo en 1 centavo.
        expect(Math.abs(vatFromNet(net, rate) - vat)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('E.4 regla 3: para todo total de 1 a 200.000 y cada alícuota, |vatFromNet(neto) − IVA| ≤ 1', () => {
    let worst = 0
    for (const rate of VAT_RATES_BP) {
      for (let total = 1; total <= 200_000; total++) {
        const net = netFromGross(total, rate)
        const diff = Math.abs(vatFromNet(net, rate) - (total - net))
        if (diff > worst) worst = diff
      }
    }
    expect(worst).toBeLessThanOrEqual(1)
  })
})

describe('checkVat: tolerancia silenciosa, aviso vat_diff y error', () => {
  it('con la tolerancia por defecto (1 centavo)', () => {
    // E1: calculado 14.925.620; ±1 pasa; hasta max($ 1; 1 % = 149.257) avisa; más, error.
    expect(checkVat(71_074_380, 2100, 14_925_620)).toBe('ok')
    expect(checkVat(71_074_380, 2100, 14_925_621)).toBe('ok')
    expect(checkVat(71_074_380, 2100, 14_925_619)).toBe('ok')
    expect(checkVat(71_074_380, 2100, 14_925_622)).toBe('warn')
    expect(vatWarnLimit(14_925_620)).toBe(149_257)
    expect(checkVat(71_074_380, 2100, 14_925_620 + 149_257)).toBe('warn')
    expect(checkVat(71_074_380, 2100, 14_925_620 + 149_258)).toBe('error')
  })

  it('en importes chicos el margen del aviso es $ 1,00', () => {
    // 1.000 × 21 % = 210 → hasta 100 centavos de diferencia avisa
    expect(checkVat(1_000, 2100, 211)).toBe('ok')
    expect(checkVat(1_000, 2100, 260)).toBe('warn')
    expect(checkVat(1_000, 2100, 310)).toBe('warn')
    expect(checkVat(1_000, 2100, 311)).toBe('error')
    expect(checkVat(1_000, 2100, 109)).toBe('error')
  })

  it('el «Usar el IVA de la factura» de $ 0,37 avisa (E.4 regla 4)', () => {
    expect(checkVat(71_074_380, 2100, 14_925_620 + 37)).toBe('warn')
  })

  it('rangos de N tiques: tolerancia N centavos, con tope 50', () => {
    expect(rangeVatTolerance(14_501, 14_662)).toBe(RANGE_VAT_TOLERANCE_CAP) // 162 tiques → 50
    expect(rangeVatTolerance(2_101, 2_130)).toBe(30)
    expect(rangeVatTolerance(45, 45)).toBe(1)
    expect(() => rangeVatTolerance(10, 9)).toThrow(RangeError)
    // E8: PV 4 neto 15.000.000 → IVA 3.150.000; 30 centavos de diferencia en 30 tiques pasan.
    expect(checkVat(15_000_000, 2100, 3_150_030, rangeVatTolerance(2_101, 2_130))).toBe('ok')
    expect(checkVat(15_000_000, 2100, 3_150_031, rangeVatTolerance(2_101, 2_130))).toBe('warn')
  })
})

describe('distributeProportionally: resto mayor, suma exacta', () => {
  it('reparte con desempate por orden de entrada', () => {
    expect(distributeProportionally(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(distributeProportionally(2, [1, 1, 1])).toEqual([1, 1, 0])
    expect(distributeProportionally(10, [3, 7])).toEqual([3, 7])
    expect(distributeProportionally(7, [0, 5])).toEqual([0, 7])
    // 1.800.000 de descuentos entre 18.000.000 y 22.000.000 de partidas
    expect(distributeProportionally(1_800_000, [18_000_000, 22_000_000])).toEqual([
      810_000, 990_000,
    ])
  })

  it('el centavo que sobra va al de mayor resto', () => {
    // 100 en 3 partes con pesos 1, 2, 4: exactos 14,28 · 28,57 · 57,14 → pisos 14, 28, 57 (99); el centavo al de resto 0,57
    expect(distributeProportionally(100, [1, 2, 4])).toEqual([14, 29, 57])
  })

  it('con todos los pesos en cero reparte en partes iguales', () => {
    expect(distributeProportionally(10, [0, 0, 0])).toEqual([4, 3, 3])
    expect(distributeProportionally(0, [0, 0])).toEqual([0, 0])
  })

  it('casos borde', () => {
    expect(distributeProportionally(0, [])).toEqual([])
    expect(() => distributeProportionally(5, [])).toThrow(RangeError)
    expect(() => distributeProportionally(-5, [1])).toThrow(RangeError)
    expect(() => distributeProportionally(5, [1, -1])).toThrow(RangeError)
    expect(distributeProportionally(1_000_000_000_000_000, [1_000_000_000_000_000, 1, 1])).toEqual([
      999_999_999_999_998, 1, 1,
    ])
  })

  it('propiedad: Σ partes = total y cada parte entre el piso y el techo de su cuota exacta', () => {
    const rand = mulberry32(42)
    for (let i = 0; i < 2_000; i++) {
      const n = 1 + Math.floor(rand() * 8)
      const weights = Array.from({ length: n }, () => Math.floor(rand() * 50_000_000))
      const total = Math.floor(rand() * 900_000_000)
      const parts = distributeProportionally(total, weights)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
      const sum = weights.reduce((a, b) => a + b, 0)
      parts.forEach((p, j) => {
        const w = weights[j] ?? 0
        const exactTimesSum = BigInt(total) * BigInt(sum === 0 ? 1 : w)
        const den = BigInt(sum === 0 ? n : sum)
        const floor = exactTimesSum / den
        expect(BigInt(p) === floor || BigInt(p) === floor + 1n).toBe(true)
      })
    }
  })

  it('es determinista', () => {
    const w = [5, 5, 5, 7]
    expect(distributeProportionally(97, w)).toEqual(distributeProportionally(97, w))
  })
})

describe('percentOf: puntos básicos con la mitad hacia arriba', () => {
  it('las precargas de E9, E12 y E17', () => {
    expect(percentOf(33_000_000, 180)).toBe(594_000) // arancel 1,8 %
    expect(percentOf(33_000_000, 120)).toBe(396_000) // retención IIBB 1,2 %
    expect(percentOf(33_000_000, 100)).toBe(330_000) // retención de Ganancias 1 %
    expect(33_000_000 - 594_000 - vatFromNet(594_000, 2100) - 396_000 - 330_000).toBe(31_555_260)
    expect(percentOf(180_000, 3300)).toBe(59_400) // Ley 25.413 créditos, 33 %
    expect(percentOf(120_000, 3300)).toBe(39_600) // Ley 25.413 débitos, 33 %
    expect(percentOf(22_000_000, 150)).toBe(330_000) // comisión QR 1,5 %
    expect(vatFromNet(330_000, 2100)).toBe(69_300)
    expect(percentOf(18_000_000, 350)).toBe(630_000) // SIRCUPA 3,5 %
    expect(percentOf(22_000_000, 350)).toBe(770_000)
    expect(percentOf(100_000_000, 2500)).toBe(25_000_000) // comisión PedidosYa 25 %
  })

  it('redondeo y bordes', () => {
    expect(percentOf(1, 5_000)).toBe(1) // 0,5 → 1
    expect(percentOf(1, 4_999)).toBe(0)
    expect(percentOf(0, 2_100)).toBe(0)
    expect(() => percentOf(10, -1)).toThrow(RangeError)
    expect(() => percentOf(10, 1.5)).toThrow(RangeError)
  })
})

describe('catálogo de alícuotas', () => {
  it('ids de AFIP del Libro IVA Digital', () => {
    expect(AFIP_ALIQUOT_ID).toEqual({ 0: 3, 250: 9, 500: 8, 1050: 4, 2100: 5, 2700: 6 })
    expect([...VAT_RATES_BP]).toEqual([0, 250, 500, 1050, 2100, 2700])
  })

  it('etiquetas con espacio duro', () => {
    expect(vatRateLabel(2100)).toBe('21 %')
    expect(vatRateLabel(1050)).toBe('10,5 %')
    expect(vatRateLabel(250)).toBe('2,5 %')
    expect(vatRateLabel(0)).toBe('0 %')
  })
})
