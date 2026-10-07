import { describe, expect, it } from 'vitest'
import { balanceGap, balanceStatus, isBalanced, sumSides } from '@/lib/accounting/balance'

describe('sumSides / isBalanced (BigInt)', () => {
  it('líneas del motor: lado + importe', () => {
    const lines = [
      { side: 'debit' as const, amountCents: 71_074_380 },
      { side: 'debit' as const, amountCents: 14_925_620 },
      { side: 'credit' as const, amountCents: 86_000_000 },
    ]
    expect(sumSides(lines)).toEqual({ debit: 86_000_000n, credit: 86_000_000n, diff: 0n })
    expect(isBalanced(lines)).toBe(true)
  })

  it('líneas de la UI (EntryLine del kit): columnas Debe y Haber', () => {
    const lines = [
      { debitCents: 1_000 },
      { creditCents: 760n },
      { debitCents: null, creditCents: undefined },
    ]
    expect(sumSides(lines)).toEqual({ debit: 1_000n, credit: 760n, diff: 240n })
    expect(isBalanced(lines)).toBe(false)
  })

  it('no pierde precisión con importes que pasan 2^53 sumados', () => {
    const big = 1_000_000_000_000_000
    const lines = Array.from({ length: 20 }, () => ({ side: 'debit' as const, amountCents: big }))
    expect(sumSides(lines).debit).toBe(20_000_000_000_000_000n)
  })

  it('un dato a medio tipear no rompe la vista previa', () => {
    expect(sumSides([{ debitCents: Number.NaN }, { creditCents: 12.6 }])).toEqual({
      debit: 0n,
      credit: 13n,
      diff: -13n,
    })
  })
})

describe('estado para EntryPreview', () => {
  it('vacío, cuadra, no cuadra', () => {
    expect(balanceStatus([])).toBe('empty')
    expect(balanceStatus([{ debitCents: 0 }])).toBe('empty')
    expect(balanceStatus([{ debitCents: 5 }, { creditCents: 5 }])).toBe('balanced')
    expect(balanceStatus([{ debitCents: 5 }])).toBe('unbalanced')
  })

  it('«faltan $ 12,40 en el Haber»', () => {
    expect(balanceGap([{ debitCents: 2_240 }, { creditCents: 1_000 }])).toEqual({
      side: 'credit',
      cents: 1_240n,
    })
    expect(balanceGap([{ debitCents: 1_000 }, { creditCents: 2_240 }])).toEqual({
      side: 'debit',
      cents: 1_240n,
    })
    expect(balanceGap([{ debitCents: 1 }, { creditCents: 1 }])).toBeNull()
  })
})
