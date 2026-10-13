import { describe, expect, it } from 'vitest'
import { recurringMonthStatus } from '@/lib/accounting/queries/documents'
import {
  installmentLabel,
  needsAction,
  type RecurringDocument,
  type RecurringRowFacts,
  recurringInstallment,
  recurringLine,
  recurringTotals,
} from '@/lib/accounting/recurring-status'

// Lo que pidieron los socios de HUB el 12/10/2026: los gastos fijos como en su
// planilla (qué cuota es, cuánto había que pagar, cuánto se pagó, cuánto falta
// y si está pago), con tres totales: falta pagar, ya pagaste y vencido.

const TODAY = '2026-10-12'

describe('«Salteado» solo cuando se salteó', () => {
  const base = { frequency: 'monthly' as const, dueDay: 10, today: TODAY }

  it('recién creado el 12/10 con el primer vencimiento el 10/11: no es «salteado»', () => {
    // Los 31 gastos fijos de HUB: nadie los salteó, el primero vence el mes que viene.
    expect(
      recurringMonthStatus({ ...base, nextDueDate: '2026-11-10', lastDocumentDate: null }),
    ).toBe('upcoming')
    expect(
      recurringMonthStatus({
        ...base,
        nextDueDate: '2026-11-10',
        lastDocumentDate: null,
        loadedDue: null,
        skippedDue: null,
      }),
    ).toBe('upcoming')
  })

  it('se salteó el de este mes con «Saltear» → «salteado»', () => {
    expect(
      recurringMonthStatus({
        ...base,
        nextDueDate: '2026-11-10',
        lastDocumentDate: null,
        skippedDue: '2026-10-10',
      }),
    ).toBe('skipped')
  })

  it('un salteo de un mes anterior no marca este mes', () => {
    expect(
      recurringMonthStatus({
        ...base,
        nextDueDate: '2026-11-10',
        lastDocumentDate: null,
        skippedDue: '2026-09-10',
      }),
    ).toBe('upcoming')
    // Se salteó septiembre y octubre sigue pendiente.
    expect(
      recurringMonthStatus({
        ...base,
        nextDueDate: '2026-10-10',
        lastDocumentDate: null,
        skippedDue: '2026-09-10',
      }),
    ).toBe('pending')
  })

  it('cargado por adelantado: el comprobante cubre el vencimiento del mes que viene', () => {
    // Vencía el 10/11, se cargó el 12/10 (con cualquier fecha): el próximo pasa al 10/12.
    expect(
      recurringMonthStatus({
        ...base,
        nextDueDate: '2026-12-10',
        lastDocumentDate: '2026-10-02',
        loadedDue: '2026-11-10',
      }),
    ).toBe('loaded')
  })
})

describe('la columna «Cuota»', () => {
  it('con el total: «2 de 6»; la cuota actual es total − las que faltan + 1', () => {
    const cuota = recurringInstallment({ remainingDues: 5, installmentsTotal: 6 })
    expect(cuota).toEqual({ current: 2, total: 6, remaining: 5 })
    expect(installmentLabel(cuota)).toBe('2 de 6')
    expect(installmentLabel(cuota, 'long')).toBe('Cuota 2 de 6')
    expect(installmentLabel(recurringInstallment({ remainingDues: 1, installmentsTotal: 6 }))).toBe(
      '6 de 6',
    )
  })

  it('sin el total: «Quedan 3» o «Última»', () => {
    const cuota = recurringInstallment({ remainingDues: 3, installmentsTotal: null })
    expect(installmentLabel(cuota)).toBe('Quedan 3')
    expect(installmentLabel(cuota, 'long')).toBe('Quedan 3 cuotas')
    const last = recurringInstallment({ remainingDues: 1, installmentsTotal: null })
    expect(installmentLabel(last)).toBe('Última')
    expect(installmentLabel(last, 'long')).toBe('Última cuota')
  })

  it('no termina, o ya no queda ninguna: sin cuota («—»)', () => {
    expect(recurringInstallment({ remainingDues: null, installmentsTotal: null })).toBeNull()
    expect(recurringInstallment({ remainingDues: 0, installmentsTotal: 6 })).toBeNull()
    expect(installmentLabel(null)).toBeNull()
  })

  it('el renglón del vencimiento ya cargado es la cuota anterior a la próxima', () => {
    // Faltan 4 contando la próxima (la 3 de 6): la que se cargó este mes es la 2.
    expect(
      installmentLabel(recurringInstallment({ remainingDues: 4, installmentsTotal: 6 }, 'loaded')),
    ).toBe('2 de 6')
    // Se cargó la última: ya no falta ninguna más.
    expect(
      installmentLabel(recurringInstallment({ remainingDues: 0, installmentsTotal: 6 }, 'loaded')),
    ).toBe('6 de 6')
  })

  it('un total más chico que las que faltan no sirve: se dice cuántas quedan', () => {
    expect(installmentLabel(recurringInstallment({ remainingDues: 8, installmentsTotal: 6 }))).toBe(
      'Quedan 8',
    )
  })
})

describe('el renglón: monto, pagado, falta y estado', () => {
  const row = (over: Partial<RecurringRowFacts> = {}): RecurringRowFacts => ({
    active: true,
    ended: false,
    monthStatus: 'pending',
    nextDueDate: '2026-10-20',
    loadedDue: null,
    amountCents: 50_000_00,
    remainingDues: null,
    installmentsTotal: null,
    ...over,
  })
  const doc = (over: Partial<RecurringDocument> = {}): RecurringDocument => ({
    id: 'doc-1',
    kind: 'expense',
    accountingDate: '2026-10-08',
    dueDate: null,
    totalCents: 50_000_00,
    paidCents: 50_000_00,
    openCents: 0,
    ...over,
  })
  const loaded = (over: Partial<RecurringRowFacts> = {}) =>
    row({ monthStatus: 'loaded', nextDueDate: '2026-11-10', loadedDue: '2026-10-10', ...over })

  it('vence este mes y no se cargó: «Sin pagar», falta todo', () => {
    const line = recurringLine(row(), null, TODAY)
    expect(line).toMatchObject({
      state: 'unpaid',
      dueDate: '2026-10-20',
      dueCents: 50_000_00,
      paidCents: 0,
      remainingCents: 50_000_00,
      documentId: null,
    })
  })

  it('ya pasó el vencimiento y no se cargó: «Vencido» (hoy todavía no)', () => {
    expect(recurringLine(row({ nextDueDate: '2026-10-10' }), null, TODAY).state).toBe('overdue')
    expect(recurringLine(row({ nextDueDate: TODAY }), null, TODAY).state).toBe('unpaid')
  })

  it('monto variable y nada cargado: «Sin monto», sin importes', () => {
    const line = recurringLine(row({ amountCents: null }), null, TODAY)
    expect(line).toMatchObject({
      state: 'no_amount',
      dueCents: null,
      paidCents: null,
      remainingCents: null,
      pastDue: false,
    })
    const late = recurringLine(row({ amountCents: null, nextDueDate: '2026-10-05' }), null, TODAY)
    expect(late).toMatchObject({ state: 'no_amount', pastDue: true })
  })

  it('un gasto de contado está pago al cargarlo: «Pago»', () => {
    const line = recurringLine(loaded(), { document: doc(), priorOpenCents: 0 }, TODAY)
    expect(line).toMatchObject({
      state: 'paid',
      dueDate: '2026-10-10',
      dueCents: 50_000_00,
      paidCents: 50_000_00,
      remainingCents: 0,
      documentId: 'doc-1',
    })
  })

  it('monto variable: lo que había que pagar es el total del comprobante', () => {
    const line = recurringLine(
      loaded({ amountCents: null }),
      { document: doc({ totalCents: 83_450_00, paidCents: 83_450_00 }), priorOpenCents: 0 },
      TODAY,
    )
    expect(line).toMatchObject({ state: 'paid', dueCents: 83_450_00, remainingCents: 0 })
  })

  it('factura en cuenta corriente: sin pagar, pago parcial y paga, según lo imputado', () => {
    const invoice = (paidCents: number) =>
      doc({ kind: 'purchase', dueDate: '2026-10-25', paidCents, openCents: 50_000_00 - paidCents })
    const of = (paidCents: number) =>
      recurringLine(loaded(), { document: invoice(paidCents), priorOpenCents: 0 }, TODAY)
    expect(of(0)).toMatchObject({ state: 'unpaid', paidCents: 0, remainingCents: 50_000_00 })
    expect(of(20_000_00)).toMatchObject({
      state: 'partial',
      paidCents: 20_000_00,
      remainingCents: 30_000_00,
      dueDate: '2026-10-25',
    })
    expect(of(50_000_00)).toMatchObject({ state: 'paid', remainingCents: 0 })
  })

  it('«Vencido» le gana a «Pago parcial»: pasó el vencimiento de la factura y falta algo', () => {
    const line = recurringLine(
      loaded(),
      {
        document: doc({
          kind: 'purchase',
          dueDate: '2026-10-11',
          paidCents: 20_000_00,
          openCents: 30_000_00,
        }),
        priorOpenCents: 0,
      },
      TODAY,
    )
    expect(line).toMatchObject({
      state: 'overdue',
      paidCents: 20_000_00,
      remainingCents: 30_000_00,
    })
  })

  it('con monto fijo, falta = monto − pagado; pagar de más no deja «falta» negativa', () => {
    const partial = recurringLine(
      loaded(),
      { document: doc({ totalCents: 30_000_00, paidCents: 30_000_00 }), priorOpenCents: 0 },
      '2026-10-09',
    )
    expect(partial).toMatchObject({
      state: 'partial',
      dueCents: 50_000_00,
      remainingCents: 20_000_00,
    })
    const more = recurringLine(
      loaded(),
      { document: doc({ totalCents: 56_000_00, paidCents: 56_000_00 }), priorOpenCents: 0 },
      TODAY,
    )
    expect(more).toMatchObject({ state: 'paid', paidCents: 56_000_00, remainingCents: 0 })
  })

  it('este mes no vence (o es nuevo y vence más adelante): «Vence el…», sin sumar', () => {
    const line = recurringLine(
      row({ monthStatus: 'upcoming', nextDueDate: '2026-11-10', amountCents: null }),
      null,
      TODAY,
    )
    expect(line).toMatchObject({
      state: 'upcoming',
      dueDate: '2026-11-10',
      paidCents: null,
      remainingCents: null,
    })
  })

  it('salteado, pausado y terminado', () => {
    expect(
      recurringLine(row({ monthStatus: 'skipped', nextDueDate: '2026-11-10' }), null, TODAY).state,
    ).toBe('skipped')
    expect(recurringLine(row({ active: false }), null, TODAY)).toMatchObject({
      state: 'paused',
      dueDate: null,
      remainingCents: null,
    })
    expect(
      recurringLine(row({ active: false, ended: true, remainingDues: 0 }), null, TODAY),
    ).toMatchObject({ state: 'ended', dueDate: null, installment: null })
  })

  it('la última cuota cargada este mes se informa aunque el gasto fijo ya terminó', () => {
    const line = recurringLine(
      loaded({ active: false, ended: true, remainingDues: 0, installmentsTotal: 6 }),
      { document: doc(), priorOpenCents: 0 },
      TODAY,
    )
    expect(line.state).toBe('paid')
    expect(installmentLabel(line.installment)).toBe('6 de 6')
  })

  it('uno pausado no se informa aunque tenga algo cargado: lo sin pagar queda como «de antes»', () => {
    const line = recurringLine(
      loaded({ active: false }),
      {
        document: doc({ kind: 'purchase', paidCents: 0, openCents: 50_000_00 }),
        priorOpenCents: 0,
      },
      TODAY,
    )
    expect(line).toMatchObject({ state: 'paused', paidCents: null, priorOpenCents: 50_000_00 })
  })

  it('lo sin pagar de vencimientos anteriores va aparte', () => {
    // El último comprobante es del mes pasado y quedó a medias; este mes todavía no se cargó.
    const pending = recurringLine(
      row(),
      {
        document: doc({ kind: 'purchase', paidCents: 40_000_00, openCents: 10_000_00 }),
        priorOpenCents: 5_000_00,
      },
      TODAY,
    )
    expect(pending).toMatchObject({ state: 'unpaid', priorOpenCents: 15_000_00, documentId: null })
    // El de este mes ya está cargado: «de antes» es solo lo de los anteriores.
    const current = recurringLine(loaded(), { document: doc(), priorOpenCents: 5_000_00 }, TODAY)
    expect(current.priorOpenCents).toBe(5_000_00)
  })

  it('needsAction: lo que hay que cargar o pagar va primero', () => {
    expect(
      ['overdue', 'unpaid', 'partial', 'no_amount'].every((s) => needsAction(s as never)),
    ).toBe(true)
    expect(
      ['paid', 'upcoming', 'skipped', 'ended', 'paused'].some((s) => needsAction(s as never)),
    ).toBe(false)
  })
})

describe('los tres totales', () => {
  const base: RecurringRowFacts = {
    active: true,
    ended: false,
    monthStatus: 'pending',
    nextDueDate: '2026-10-20',
    loadedDue: null,
    amountCents: 10_000_00,
    remainingDues: null,
    installmentsTotal: null,
  }
  const paidDoc: RecurringDocument = {
    id: 'd',
    kind: 'expense',
    accountingDate: '2026-10-03',
    dueDate: null,
    totalCents: 25_000_00,
    paidCents: 25_000_00,
    openCents: 0,
  }

  it('falta pagar, ya pagaste y vencido salen de los renglones; los sin monto se cuentan aparte', () => {
    const lines = [
      // Sin pagar, vence el 20/10: falta 10.000.
      recurringLine(base, null, TODAY),
      // Vencido el 05/10: falta 10.000 y está vencido.
      recurringLine({ ...base, nextDueDate: '2026-10-05' }, null, TODAY),
      // Pago: 25.000 (variable, de contado).
      recurringLine(
        {
          ...base,
          monthStatus: 'loaded',
          nextDueDate: '2026-11-10',
          loadedDue: '2026-10-10',
          amountCents: null,
        },
        { document: paidDoc, priorOpenCents: 0 },
        TODAY,
      ),
      // Pago parcial de una factura: pagó 4.000 de 10.000 y vence el 30/10.
      recurringLine(
        { ...base, monthStatus: 'loaded', nextDueDate: '2026-11-10', loadedDue: '2026-10-10' },
        {
          document: {
            ...paidDoc,
            kind: 'purchase',
            dueDate: '2026-10-30',
            totalCents: 10_000_00,
            paidCents: 4_000_00,
            openCents: 6_000_00,
          },
          priorOpenCents: 1_500_00,
        },
        TODAY,
      ),
      // Tres sin monto: no suman.
      ...[1, 2, 3].map(() => recurringLine({ ...base, amountCents: null }, null, TODAY)),
      // Vence el mes que viene, pausado y salteado: tampoco.
      recurringLine({ ...base, monthStatus: 'upcoming', nextDueDate: '2026-11-10' }, null, TODAY),
      recurringLine({ ...base, active: false }, null, TODAY),
      recurringLine({ ...base, monthStatus: 'skipped', nextDueDate: '2026-11-10' }, null, TODAY),
    ]
    expect(recurringTotals(lines)).toEqual({
      remainingCents: 26_000_00,
      paidCents: 29_000_00,
      overdueCents: 10_000_00,
      countedRows: 4,
      noAmountCount: 3,
      priorOpenCents: 1_500_00,
    })
  })

  it('sin renglones, todo en cero', () => {
    expect(recurringTotals([])).toEqual({
      remainingCents: 0,
      paidCents: 0,
      overdueCents: 0,
      countedRows: 0,
      noAmountCount: 0,
      priorOpenCents: 0,
    })
  })

  it('los 31 de HUB hoy (variables, vencen el 10/11): nada que sumar y ninguno «sin monto» todavía', () => {
    const lines = Array.from({ length: 31 }, () =>
      recurringLine(
        { ...base, monthStatus: 'upcoming', nextDueDate: '2026-11-10', amountCents: null },
        null,
        TODAY,
      ),
    )
    expect(lines.every((l) => l.state === 'upcoming')).toBe(true)
    expect(recurringTotals(lines)).toMatchObject({
      remainingCents: 0,
      countedRows: 0,
      noAmountCount: 0,
    })
  })
})
