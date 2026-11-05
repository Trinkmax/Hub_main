import { describe, expect, it } from 'vitest'
import { STANDARD_CHART } from '@/lib/accounting/chart'
import {
  ENTRY_MODELS,
  entryModel,
  entryModelConcept,
  entryModelLines,
} from '@/lib/accounting/entry-models'

/**
 * Los modelos del asiento manual. Luciano, reunión del 29/10: «banco cuenta corriente a deudas
 * bancarias; y cuando vas pagando en cuotas, deuda bancaria y intereses perdidos, a caja».
 */

const accounts = STANDARD_CHART.map((a) => ({
  id: `id-${a.code}`,
  systemKey: a.systemKey,
  postable: a.postable,
  active: true,
}))
const idOf = (key: string) => accounts.find((a) => a.systemKey === key)?.id
const treasuries = [
  { accountId: 'caja', kind: 'cash', active: true },
  { accountId: 'bbva', kind: 'bank', active: true },
] as const

function lines(key: string) {
  const model = entryModel(key)
  if (!model) throw new Error(`no existe el modelo ${key}`)
  return entryModelLines(model, { accounts, treasuries })
}

describe('los modelos', () => {
  it('son los pedidos, con los nombres de siempre', () => {
    expect(ENTRY_MODELS.map((m) => m.name)).toEqual([
      'Préstamo recibido',
      'Cuota de préstamo con intereses',
      'Aporte de socios',
      'Retiro de socios',
      'Amortización del mes',
      'Sueldos del mes',
    ])
  })

  it('un asiento que tiene líneas, las tiene de los dos lados', () => {
    for (const model of ENTRY_MODELS) {
      if (model.lines.length === 0) continue
      const sides = new Set(model.lines.map((l) => l.side))
      expect(sides, model.name).toEqual(new Set(['debit', 'credit']))
      // Primero el Debe, como se escribe un asiento.
      expect(model.lines[0]?.side, model.name).toBe('debit')
    }
  })

  it('toda clave del sistema que usan existe en el plan estándar y es imputable', () => {
    for (const model of ENTRY_MODELS) {
      for (const line of model.lines) {
        if (line.account.kind !== 'system') continue
        const key = line.account.key
        const seed = STANDARD_CHART.find((a) => a.systemKey === key)
        expect(seed?.postable, `${model.name} ${key}`).toBe(true)
      }
    }
  })
})

describe('las cuentas de cada modelo', () => {
  it('Préstamo recibido: entra al banco, queda la deuda', () => {
    expect(lines('prestamo')).toEqual([
      { accountId: 'bbva', side: 'debit', missing: false },
      { accountId: idOf('bank_loans'), side: 'credit', missing: false },
    ])
  })

  it('Cuota con intereses: el ejemplo de Luciano', () => {
    expect(lines('cuota')).toEqual([
      { accountId: idOf('bank_loans'), side: 'debit', missing: false },
      { accountId: idOf('interest_expense'), side: 'debit', missing: false },
      { accountId: 'bbva', side: 'credit', missing: false },
    ])
  })

  it('Aporte y retiro de socios son el mismo asiento al revés', () => {
    expect(lines('aporte')).toEqual([
      { accountId: 'caja', side: 'debit', missing: false },
      { accountId: idOf('partners_current'), side: 'credit', missing: false },
    ])
    expect(lines('retiro')).toEqual([
      { accountId: idOf('partners_current'), side: 'debit', missing: false },
      { accountId: 'caja', side: 'credit', missing: false },
    ])
  })

  it('Amortización del mes: la pérdida contra la regularizadora, como ajuste', () => {
    expect(lines('amortizacion')).toEqual([
      { accountId: idOf('depreciation'), side: 'debit', missing: false },
      { accountId: idOf('accumulated_depreciation'), side: 'credit', missing: false },
    ])
    expect(entryModel('amortizacion')?.entryKind).toBe('adjustment')
  })

  it('Sueldos del mes es la otra cara del formulario, con su aclaración', () => {
    const model = entryModel('sueldos')
    expect(model?.entryKind).toBe('payroll')
    expect(model?.lines).toEqual([])
    expect(model?.note).toBe('Si ya devengaste en Sueldos, cargá solo las cargas sociales.')
    expect(lines('sueldos')).toEqual([])
  })
})

describe('qué caja se propone', () => {
  const model = entryModel('prestamo')
  if (!model) throw new Error('falta el modelo')

  it('sin banco, la primera caja activa; la tarjeta de la empresa nunca', () => {
    const [first] = entryModelLines(model, {
      accounts,
      treasuries: [
        { accountId: 'tarjeta', kind: 'credit_card', active: true },
        { accountId: 'mp', kind: 'wallet', active: true },
      ],
    })
    expect(first?.accountId).toBe('mp')
  })

  it('una caja desactivada no se propone', () => {
    const [first] = entryModelLines(model, {
      accounts,
      treasuries: [
        { accountId: 'viejo', kind: 'bank', active: false },
        { accountId: 'caja', kind: 'cash', active: true },
      ],
    })
    expect(first?.accountId).toBe('caja')
  })

  it('sin ninguna caja, o sin la cuenta, el renglón queda para elegir', () => {
    const empty = entryModelLines(model, { accounts: [], treasuries: [] })
    expect(empty).toEqual([
      { accountId: null, side: 'debit', missing: true },
      { accountId: null, side: 'credit', missing: true },
    ])
  })

  it('una cuenta del sistema desactivada no se propone', () => {
    const [, second] = entryModelLines(model, {
      accounts: accounts.map((a) => (a.systemKey === 'bank_loans' ? { ...a, active: false } : a)),
      treasuries,
    })
    expect(second).toEqual({ accountId: null, side: 'credit', missing: true })
  })
})

describe('el concepto que se propone', () => {
  it('sigue a la fecha en la amortización', () => {
    const model = entryModel('amortizacion')
    if (!model) throw new Error('falta el modelo')
    expect(entryModelConcept(model, '2026-11-30')).toBe('Amortización de noviembre')
    expect(entryModelConcept(model, null)).toBe('Amortización del mes')
  })

  it('un modelo que no existe no rompe nada', () => {
    expect(entryModel('otro')).toBeNull()
    expect(entryModel(null)).toBeNull()
  })
})
