import { describe, expect, it } from 'vitest'
import {
  cleanInstallments,
  INSTALLMENT_CHOICES,
  installmentAmountCents,
  installmentsLabel,
  installmentsWords,
  isCreditCard,
  MAX_INSTALLMENTS,
} from '@/lib/accounting/installments'

describe('las cuotas de un pago con tarjeta', () => {
  it('lo que se escribe queda en un número que la base acepta', () => {
    expect(cleanInstallments('3')).toBe(3)
    expect(cleanInstallments(' 12 ')).toBe(12)
    expect(cleanInstallments(6)).toBe(6)
    // Vacío, letras o cero: un solo pago.
    expect(cleanInstallments('')).toBe(1)
    expect(cleanInstallments('tres')).toBe(1)
    expect(cleanInstallments(0)).toBe(1)
    expect(cleanInstallments(-4)).toBe(1)
    expect(cleanInstallments(null)).toBe(1)
    expect(cleanInstallments(Number.NaN)).toBe(1)
    // Con decimales se queda con la parte entera; por encima del tope, el tope.
    expect(cleanInstallments('3.9')).toBe(3)
    expect(cleanInstallments(99)).toBe(MAX_INSTALLMENTS)
  })

  it('las que se ofrecen de un toque arrancan en un solo pago y no pasan el tope', () => {
    expect(INSTALLMENT_CHOICES[0]).toBe(1)
    expect([...INSTALLMENT_CHOICES]).toEqual([...INSTALLMENT_CHOICES].sort((a, b) => a - b))
    expect(Math.max(...INSTALLMENT_CHOICES)).toBeLessThanOrEqual(MAX_INSTALLMENTS)
  })

  it('se dicen en palabras', () => {
    expect(installmentsLabel(1)).toBe('1 pago')
    expect(installmentsLabel(3)).toBe('3 cuotas')
    expect(installmentsWords(3)).toBe('en 3 cuotas')
    // Un solo pago, o sin dato: no hay nada que decir.
    expect(installmentsWords(1)).toBe('')
    expect(installmentsWords(null)).toBe('')
    expect(installmentsWords(undefined)).toBe('')
  })

  it('solo una tarjeta de crédito pregunta por las cuotas', () => {
    expect(isCreditCard({ kind: 'credit_card' })).toBe(true)
    expect(isCreditCard({ kind: 'bank' })).toBe(false)
    expect(isCreditCard({ kind: 'cash' })).toBe(false)
    expect(isCreditCard({ kind: 'wallet' })).toBe(false)
    expect(isCreditCard(null)).toBe(false)
    expect(isCreditCard(undefined)).toBe(false)
  })

  it('lo que vale cada cuota', () => {
    expect(installmentAmountCents(900_000, 3)).toBe(300_000)
    expect(installmentAmountCents(1_000_000, 3)).toBe(333_333)
    // Un solo pago, sin importe o en cero: no se dice nada.
    expect(installmentAmountCents(900_000, 1)).toBeNull()
    expect(installmentAmountCents(null, 3)).toBeNull()
    expect(installmentAmountCents(0, 3)).toBeNull()
  })
})
