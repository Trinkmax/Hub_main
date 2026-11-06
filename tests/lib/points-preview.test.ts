import { describe, expect, it } from 'vitest'
import type { EarnRate } from '@/lib/points/earn-rate'
import {
  centsToPesosInput,
  describeEarnRate,
  pesosToCents,
  previewPoints,
  suggestThousands,
} from '@/lib/points/preview'

// La tasa real de HUB al escribir esto: 1 punto cada $1.000.
const HUB: EarnRate = { points: 1, everyCents: 100_000 }

describe('previewPoints', () => {
  it('espeja el floor de la RPC: no regala fracciones', () => {
    expect(previewPoints(100_000, HUB)).toBe(1) // $1.000 → 1
    expect(previewPoints(199_999, HUB)).toBe(1) // $1.999,99 → 1, no 2
    expect(previewPoints(1_250_000, HUB)).toBe(12) // $12.500 → 12
  })

  it('sin tasa enunciable no promete nada (0 o 2+ reglas per_amount)', () => {
    expect(previewPoints(500_000, null)).toBeNull()
  })

  it('monto vacío o inválido es 0, no null: la tasa existe, el monto todavía no', () => {
    expect(previewPoints(0, HUB)).toBe(0)
    expect(previewPoints(Number.NaN, HUB)).toBe(0)
    expect(previewPoints(-100, HUB)).toBe(0)
  })

  it('una tasa con everyCents 0 se descarta en vez de dividir por cero', () => {
    expect(previewPoints(100_000, { points: 1, everyCents: 0 })).toBeNull()
  })

  it('respeta tasas de más de un punto por tramo', () => {
    expect(previewPoints(300_000, { points: 5, everyCents: 100_000 })).toBe(15)
  })
})

describe('describeEarnRate', () => {
  it('dice la tasa en pesos, no en centavos', () => {
    expect(describeEarnRate(HUB)).toBe('1 punto cada $1.000')
    expect(describeEarnRate({ points: 3, everyCents: 50_000 })).toBe('3 puntos cada $500')
  })

  it('sin tasa, no dice nada', () => {
    expect(describeEarnRate(null)).toBeNull()
  })
})

describe('pesosToCents', () => {
  it('convierte lo que tipea el mozo, en pesos', () => {
    expect(pesosToCents('4500')).toBe(450_000)
    expect(pesosToCents('4500,50')).toBe(450_050)
    expect(pesosToCents(' 12000 ')).toBe(1_200_000)
  })

  it('aguanta el separador de miles rioplatense', () => {
    expect(pesosToCents('12.500')).toBe(1_250_000)
    expect(pesosToCents('1.234.567')).toBe(123_456_700)
  })

  it('la coma con tres cifras separa miles: «129,000» son $129.000, no $129', () => {
    expect(pesosToCents('129,000')).toBe(12_900_000)
    expect(pesosToCents('1,234,567')).toBe(123_456_700)
    expect(pesosToCents('1.234.567,89')).toBe(123_456_789)
    expect(pesosToCents('4500.5')).toBe(450_050)
  })

  it('rechaza vacío, cero, negativo y basura', () => {
    expect(pesosToCents('')).toBeNull()
    expect(pesosToCents('0')).toBeNull()
    expect(pesosToCents('-50')).toBeNull()
    expect(pesosToCents('abc')).toBeNull()
  })
})

// En la caja de HUB se cargaron «129» por $129.000 y «84» por $84.000: sumaron 0
// puntos y la pantalla igual decía que estaba todo bien.
describe('suggestThousands', () => {
  it('debajo de $1.000 propone el mismo monto con los ceros', () => {
    expect(suggestThousands(12_900)).toBe(12_900_000) // «129» → $129.000
    expect(suggestThousands(1_000)).toBe(1_000_000) // «10» → $10.000
    expect(suggestThousands(99_900)).toBe(99_900_000) // «999» → $999.000
  })

  it('desde $1.000, con centavos o sin monto no propone nada', () => {
    expect(suggestThousands(100_000)).toBeNull()
    expect(suggestThousands(14_900_000)).toBeNull()
    expect(suggestThousands(1_250)).toBeNull() // $12,50
    expect(suggestThousands(0)).toBeNull()
    expect(suggestThousands(null)).toBeNull()
  })
})

describe('centsToPesosInput', () => {
  it('escribe el monto como lo lee el mozo y vuelve a parsear igual', () => {
    expect(centsToPesosInput(12_900_000)).toBe('129.000')
    expect(centsToPesosInput(1_000_000)).toBe('10.000')
    expect(pesosToCents(centsToPesosInput(69_800_000))).toBe(69_800_000)
  })
})
