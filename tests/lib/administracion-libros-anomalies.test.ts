import { describe, expect, it } from 'vitest'
import { ANOMALY_SENTENCES, trialAnomalies, trialAnomaly } from '@/lib/accounting/anomalies'
import { STANDARD_CHART } from '@/lib/accounting/chart'
import type { AccountType, Side } from '@/lib/accounting/types'

/**
 * El ojo de auditor de Sumas y saldos. Silvia, reunión del 29/10: «cuando me tiran un sumas y saldos y
 * veo que una cuenta de pérdida me da un saldo acreedor digo acá hay un error».
 */

function row(
  accountType: AccountType,
  normalSide: Side,
  net: number,
  over: Partial<Parameters<typeof trialAnomaly>[0]> = {},
) {
  return {
    accountType,
    normalSide,
    postable: true,
    isVirtual: false,
    closingDebitCents: Math.max(net, 0),
    closingCreditCents: Math.max(-net, 0),
    ...over,
  }
}

describe('una cuenta con el saldo al revés', () => {
  it('pérdida con saldo acreedor', () => {
    expect(trialAnomaly(row('expense', 'debit', -100))).toEqual({
      kind: 'expense_credit',
      sentence: 'Una pérdida no debería dar saldo acreedor.',
    })
    expect(trialAnomaly(row('expense', 'debit', 100))).toBeNull()
  })

  it('ganancia con saldo deudor', () => {
    expect(trialAnomaly(row('income', 'credit', 100))).toEqual({
      kind: 'income_debit',
      sentence: 'Una ganancia no debería dar saldo deudor.',
    })
    expect(trialAnomaly(row('income', 'credit', -100))).toBeNull()
  })

  it('activo con saldo acreedor', () => {
    expect(trialAnomaly(row('asset', 'debit', -100))).toEqual({
      kind: 'asset_credit',
      sentence: 'Un activo con saldo acreedor: revisá el mayor.',
    })
    expect(trialAnomaly(row('asset', 'debit', 100))).toBeNull()
  })

  it('deuda con saldo deudor', () => {
    expect(trialAnomaly(row('liability', 'credit', 100))).toEqual({
      kind: 'liability_debit',
      sentence: 'Una deuda con saldo deudor: revisá el mayor.',
    })
    expect(trialAnomaly(row('liability', 'credit', -100))).toBeNull()
  })

  it('en cero no hay nada raro, de ningún lado', () => {
    for (const [type, side] of [
      ['expense', 'debit'],
      ['income', 'credit'],
      ['asset', 'debit'],
      ['liability', 'credit'],
    ] as const) {
      expect(trialAnomaly(row(type, side, 0))).toBeNull()
    }
  })

  it('el patrimonio neto puede dar para los dos lados', () => {
    expect(trialAnomaly(row('equity', 'credit', 100))).toBeNull()
    expect(trialAnomaly(row('equity', 'credit', -100))).toBeNull()
  })
})

describe('lo que parece raro y no lo es', () => {
  it('Sueldos a pagar puede estar deudor: los adelantos van antes del devengado', () => {
    const payable = row('liability', 'credit', 500_000_00)
    expect(trialAnomaly(payable)).not.toBeNull()
    expect(trialAnomaly(payable, 'payroll_payable')).toBeNull()
    // Otra deuda con clave del sistema, sí se marca.
    expect(trialAnomaly(payable, 'payable_suppliers')?.kind).toBe('liability_debit')
  })

  it('las regularizadoras van al revés a propósito, por su lado normal', () => {
    // Amortización acumulada: un activo con saldo acreedor.
    expect(trialAnomaly(row('asset', 'credit', -100))).toBeNull()
    // Descuentos: un ingreso que resta.
    expect(trialAnomaly(row('income', 'debit', 100))).toBeNull()
    expect(trialAnomaly(row('expense', 'credit', -100))).toBeNull()
    expect(trialAnomaly(row('liability', 'debit', 100))).toBeNull()
  })

  it('la amortización acumulada del plan estándar no se marca', () => {
    const seed = STANDARD_CHART.find((a) => a.systemKey === 'accumulated_depreciation')
    if (!seed) throw new Error('falta en el plan estándar')
    expect(trialAnomaly(row(seed.type, seed.normalSide, -100_00))).toBeNull()
  })

  it('un grupo no se marca: ya lo dice la cuenta de adentro', () => {
    expect(trialAnomaly(row('expense', 'debit', -100, { postable: false }))).toBeNull()
  })

  it('la línea virtual de resultados anteriores no es una cuenta', () => {
    expect(trialAnomaly(row('expense', 'debit', -100, { isVirtual: true }))).toBeNull()
  })
})

describe('todas las filas del balance', () => {
  const rows = [
    { ...row('expense', 'debit', -100), accountId: 'agua' },
    { ...row('expense', 'debit', 100), accountId: 'luz' },
    { ...row('liability', 'credit', 100), accountId: 'sueldos' },
    { ...row('asset', 'debit', -100), accountId: 'caja' },
  ]

  it('por cuenta, con la clave del sistema de cada una', () => {
    const found = trialAnomalies(rows, new Map([['sueldos', 'payroll_payable']]))
    expect([...found.keys()]).toEqual(['agua', 'caja'])
    expect(found.get('agua')?.sentence).toBe(ANOMALY_SENTENCES.expense_credit)
  })

  it('sin las claves, a lo sumo marca de más', () => {
    expect([...trialAnomalies(rows, new Map()).keys()]).toEqual(['agua', 'sueldos', 'caja'])
  })
})
