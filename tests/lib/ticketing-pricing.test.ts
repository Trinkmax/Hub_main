import { describe, expect, it } from 'vitest'
import {
  centsToMercadoPagoAmount,
  centsToPesos,
  formatPesos,
  hasDepositOption,
  mercadoPagoAmountToCents,
  pesosToCents,
  quote,
} from '@/lib/ticketing/pricing'

// Los números del pedido de los socios (23/10/2026): seña $5.000 por persona
// o todo junto $35.000 por persona.
const PRICE = 3_500_000
const DEPOSIT = 500_000

describe('quote', () => {
  it('seña para 2: hoy $10.000, el resto $60.000 en el bar', () => {
    expect(
      quote({ priceCents: PRICE, depositCents: DEPOSIT, partySize: 2, option: 'deposit' }),
    ).toEqual({
      option: 'deposit',
      partySize: 2,
      unitCents: 500_000,
      totalCents: 1_000_000,
      balancePerPersonCents: 3_000_000,
      balanceCents: 6_000_000,
    })
  })

  it('todo junto para 2: hoy $70.000 y nada más', () => {
    const q = quote({ priceCents: PRICE, depositCents: DEPOSIT, partySize: 2, option: 'full' })
    expect(q.totalCents).toBe(7_000_000)
    expect(q.balanceCents).toBe(0)
  })

  it('sin seña configurada, pedir seña cae en el total', () => {
    const q = quote({ priceCents: PRICE, depositCents: 0, partySize: 3, option: 'deposit' })
    expect(q.option).toBe('full')
    expect(q.totalCents).toBe(10_500_000)
  })

  it('personas raras se normalizan a un entero ≥ 1', () => {
    expect(
      quote({ priceCents: PRICE, depositCents: DEPOSIT, partySize: 0, option: 'full' }).partySize,
    ).toBe(1)
    expect(
      quote({ priceCents: PRICE, depositCents: DEPOSIT, partySize: 2.7, option: 'full' }).partySize,
    ).toBe(2)
  })
})

describe('hasDepositOption', () => {
  it('solo si la seña es positiva y menor que el precio', () => {
    expect(hasDepositOption(DEPOSIT, PRICE)).toBe(true)
    expect(hasDepositOption(0, PRICE)).toBe(false)
    expect(hasDepositOption(PRICE, PRICE)).toBe(false)
  })
})

describe('plata en pesos y centavos', () => {
  it('formatea sin decimales con punto de miles', () => {
    expect(formatPesos(3_500_000).replace(/\s/g, ' ')).toBe('$ 35.000')
  })

  it('el panel trabaja en pesos, la base en centavos', () => {
    expect(pesosToCents(35000)).toBe(3_500_000)
    expect(centsToPesos(3_500_000)).toBe(35000)
  })

  it('Mercado Pago recibe y devuelve pesos', () => {
    expect(centsToMercadoPagoAmount(500_000)).toBe(5000)
    expect(mercadoPagoAmountToCents(10000)).toBe(1_000_000)
    expect(mercadoPagoAmountToCents(99.99)).toBe(9999)
    expect(mercadoPagoAmountToCents(null)).toBeNull()
    expect(mercadoPagoAmountToCents(Number.NaN)).toBeNull()
  })
})
