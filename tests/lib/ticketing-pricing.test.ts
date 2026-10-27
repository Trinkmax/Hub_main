import { describe, expect, it } from 'vitest'
import {
  cashPrice,
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

  it('con precio en efectivo (27/10): seña para 2, hoy $10.000 y $50.000 en el bar', () => {
    // En efectivo sale $30.000 por persona: seña $5.000 + $25.000 en el bar.
    const q = quote({
      priceCents: PRICE,
      depositCents: DEPOSIT,
      cashPriceCents: 3_000_000,
      partySize: 2,
      option: 'deposit',
    })
    expect(q.totalCents).toBe(1_000_000)
    expect(q.balancePerPersonCents).toBe(2_500_000)
    expect(q.balanceCents).toBe(5_000_000)
    // Todo con Mercado Pago sigue siendo $35.000 por persona.
    const full = quote({
      priceCents: PRICE,
      depositCents: DEPOSIT,
      cashPriceCents: 3_000_000,
      partySize: 2,
      option: 'full',
    })
    expect(full.totalCents).toBe(7_000_000)
    expect(full.balanceCents).toBe(0)
    expect(cashPrice(PRICE, 3_000_000)).toBe(3_000_000)
    expect(cashPrice(PRICE, null)).toBe(PRICE)
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
