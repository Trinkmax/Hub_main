import { describe, expect, it } from 'vitest'
import {
  matchPastedAmounts,
  pasteSummary,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/paste-amounts'
import {
  buildSheet,
  defaultSheetMonth,
  parseSheetMonth,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla'
import {
  amountEditable,
  askWords,
  autoTaxPlan,
  detectInstallment,
  installmentWords,
  morePayOptionsHref,
  papelLabel,
  payrollRowStatus,
  payStripBlock,
  rowActions,
  rowMenu,
  rowStatus,
  rowSubline,
  type SheetItem,
  saveFailure,
  sheetCarry,
  sheetTotals,
  shownTotals,
  stripAsksSupplier,
  stripFromQr,
  stripSupplierFromQr,
  stripTarget,
  supplierAfterQr,
  tickState,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla-words'
import { fixedProgress } from '@/lib/accounting/home'
import { type RecurringExpenseRow, recurringMonthStatus } from '@/lib/accounting/queries/documents'
import {
  type RecurringDocument,
  type RecurringPaymentFacts,
  recurringLine,
  recurringTotals,
} from '@/lib/accounting/recurring-status'
import { daysBetween } from '@/lib/dates'

// La planilla de gastos fijos (noviembre de 2026): una hoja por mes, una fila por gasto y tildar
// paga. No inventa cuentas: cada renglón es `recurringLine` y el total es `fixedProgress` (el del
// Resumen), más la planilla de Sueldos.

/** Martes. El 10/10 fue sábado; el 15/10 es jueves; el 10/11, martes. */
const TODAY = '2026-10-13'
const OCT = '2026-10'
const NOV = '2026-11'
/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
const $ = (text: string) => `$${NB}${text}`

function mk(
  over: Partial<RecurringExpenseRow> & { id: string; name: string },
): RecurringExpenseRow {
  const row = {
    partyId: null,
    partyName: null,
    accountId: 'acc-alquiler',
    accountName: 'Alquiler',
    voucherType: null,
    vatRateBp: null,
    amountCents: null,
    frequency: 'monthly' as const,
    dueDay: 10,
    nextDueDate: '2026-11-10',
    remindDaysBefore: 5,
    treasuryAccountId: null,
    treasuryName: null,
    active: true,
    lastDocumentId: null,
    lastDocumentDate: null,
    notes: null,
    endsOn: null,
    remainingDues: null,
    installmentsTotal: null,
    skippedDue: null,
    loadedDue: null,
    ended: false,
    breakdown: [],
    updatedAt: '2026-10-12T10:00:00.000Z',
    ...over,
  }
  return {
    ...row,
    monthStatus: over.monthStatus ?? recurringMonthStatus({ ...row, today: TODAY }),
    daysToDue: daysBetween(TODAY, row.nextDueDate),
  }
}

function doc(over: Partial<RecurringDocument> & { id: string }): RecurringDocument {
  return {
    kind: 'purchase',
    accountingDate: '2026-10-08',
    dueDate: null,
    totalCents: 0,
    paidCents: 0,
    openCents: 0,
    ...over,
  }
}

const paidWith = (id: string, document: RecurringDocument) =>
  new Map<string, RecurringPaymentFacts>([[id, { document, priorOpenCents: 0 }]])

/** El bar de ejemplo al 13/10: tres gastos fijos con monto, ninguno pago. */
const ALQUILER = mk({
  id: 'gf-alquiler',
  name: 'Alquiler del local',
  amountCents: 85_000_000,
  nextDueDate: '2026-10-10',
})
const DISPENSER = mk({
  id: 'gf-dispenser',
  name: 'Dispenser Agua',
  amountCents: 3_000_000,
  nextDueDate: '2026-10-10',
  accountId: 'acc-plazos',
  accountName: 'Plazos fijos en pesos',
})
const INTERNET = mk({
  id: 'gf-internet',
  name: 'Internet y teléfono',
  amountCents: 3_500_000,
  dueDay: 15,
  nextDueDate: '2026-10-15',
  accountId: 'acc-internet',
  accountName: 'Internet',
})
const DEMO = [ALQUILER, DISPENSER, INTERNET]

/** HUB al 13/10: 31 sin monto, todos al 10/11. */
const HUB: RecurringExpenseRow[] = Array.from({ length: 31 }, (_, index) => {
  const n = index + 1
  const name =
    n === 1 ? 'Licuadora 6/6 USA cord' : n === 2 ? 'Colombraro bateas 1/3' : `Gasto fijo ${n}`
  return mk({
    id: `hub-${String(n).padStart(2, '0')}`,
    name,
    accountId: `acc-${n % 5}`,
    accountName: `Categoría ${n % 5}`,
  })
})

const sheetOf = (
  rows: readonly RecurringExpenseRow[],
  month = OCT,
  payments: ReadonlyMap<string, RecurringPaymentFacts> | null = null,
) => buildSheet(rows, payments, { month, today: TODAY })

const itemOf = (row: RecurringExpenseRow, payments = new Map<string, RecurringPaymentFacts>()) => {
  const item = sheetOf([row], OCT, payments)
  const found = [...item.items, ...item.later, ...item.off][0]
  if (!found) throw new Error('la hoja no devolvió el renglón')
  return found
}

function item0(sheet: { items: SheetItem[] }): SheetItem {
  const item = sheet.items[0]
  if (!item) throw new Error('hoja vacía')
  return item
}

const loaded = (over: Partial<RecurringExpenseRow> = {}) =>
  mk({
    ...ALQUILER,
    nextDueDate: '2026-11-10',
    loadedDue: '2026-10-10',
    lastDocumentId: 'doc-1',
    lastDocumentDate: '2026-10-08',
    monthStatus: undefined,
    ...over,
  })

describe('la hoja del mes actual', () => {
  const sheet = sheetOf(DEMO)

  it('dice lo mismo que `recurringLine`, `recurringTotals` y el número del Resumen', () => {
    const lines = DEMO.map((row) => recurringLine(row, null, TODAY))
    const totals = recurringTotals(lines)
    expect(sheet.items.map((item) => item.line)).toEqual(lines)
    expect(sheet.progress.remainingCents).toBe(totals.remainingCents)
    expect(sheet.progress.overdueCents).toBe(totals.overdueCents)
    expect(sheet.progress).toEqual(fixedProgress(DEMO, null, TODAY))
    expect(sheet.progress.remainingCents).toBe(91_500_000)
    expect(sheet.isCurrent).toBe(true)
  })

  it('los renglones van en orden de día y nombre, en un solo tramo', () => {
    expect(sheet.items.map((item) => [item.day, item.row.name])).toEqual([
      ['2026-10-10', 'Alquiler del local'],
      ['2026-10-10', 'Dispenser Agua'],
      ['2026-10-15', 'Internet y teléfono'],
    ])
    expect(sheet.stretches.map((stretch) => stretch.place)).toEqual(['month'])
    expect(sheet.later).toEqual([])
    expect(sheet.off).toEqual([])
  })
})

describe('pagar no mueve el renglón', () => {
  const paid = loaded()
  const payments = paidWith(
    'gf-alquiler',
    doc({ id: 'doc-1', totalCents: 85_000_000, paidCents: 85_000_000 }),
  )
  const before = sheetOf(DEMO)
  const after = sheetOf([paid, DISPENSER, INTERNET], OCT, payments)

  it('queda tildado en su lugar y con el sello', () => {
    expect(after.items.map((i) => i.row.id)).toEqual(before.items.map((i) => i.row.id))
    const item = item0(after)
    expect(item.day).toBe('2026-10-10')
    expect(item.line.state).toBe('paid')
    expect(item.doc?.id).toBe('doc-1')
    expect(tickState(item)).toBe('done')
    expect(rowStatus(item, TODAY)).toMatchObject({
      label: 'Pagado',
      stamp: true,
      title: 'Pagado el 08/10',
      detail: 'el 08/10',
      tone: 'ok',
    })
    expect(rowActions(item, { canWrite: true }).pay).toBeNull()
  })

  it('el total no cambia: pasa de «Por pagar» a «Pagado»', () => {
    const totals = sheetTotals(after, null)
    expect(totals).toMatchObject({
      totalCents: 91_500_000,
      paidCents: 85_000_000,
      pendingCents: 6_500_000,
    })
    expect(sheetTotals(before, null).totalCents).toBe(totals.totalCents)
  })

  it('«este mes no se paga» tampoco lo mueve: queda con raya en su día', () => {
    const skipped = mk({
      ...ALQUILER,
      nextDueDate: '2026-11-10',
      skippedDue: '2026-10-10',
      monthStatus: undefined,
    })
    const sheet = sheetOf([skipped, DISPENSER, INTERNET])
    expect(sheet.items.map((i) => i.row.id)).toEqual(before.items.map((i) => i.row.id))
    const item = item0(sheet)
    expect(item.day).toBe('2026-10-10')
    expect(tickState(item)).toBe('skip')
    expect(rowStatus(item, TODAY)).toMatchObject({ label: 'Este mes no se paga', tone: 'muted' })
    expect(rowActions(item, { canWrite: true })).toMatchObject({
      pay: null,
      skip: false,
      unskip: true,
      bill: false,
    })
  })
})

describe('el totalizador: total, pagado, por pagar y vencido', () => {
  const PAYROLL = {
    count: 2,
    salaryCents: 100_000_000,
    advancesCents: 10_000_000,
    paidCents: 20_000_000,
    owedCents: 70_000_000,
  }

  it('los gastos fijos solos: lo mismo que el Resumen', () => {
    expect(sheetTotals(sheetOf(DEMO), null)).toEqual({
      totalCents: 91_500_000,
      paidCents: 0,
      pendingCents: 91_500_000,
      overdueCents: 88_000_000,
      payrollCents: null,
      noAmount: 0,
    })
  })

  it('los sueldos suman: el total, lo adelantado y pagado, y lo que se debe', () => {
    expect(sheetTotals(sheetOf(DEMO), PAYROLL)).toEqual({
      totalCents: 191_500_000,
      paidCents: 30_000_000,
      pendingCents: 161_500_000,
      overdueCents: 88_000_000,
      payrollCents: 100_000_000,
      noAmount: 0,
    })
  })

  it('una planilla de sueldos vacía no suma ni se menciona', () => {
    const empty = { count: 3, salaryCents: 0, advancesCents: 0, paidCents: 0, owedCents: 0 }
    expect(sheetTotals(sheetOf(DEMO), empty)).toMatchObject({
      totalCents: 91_500_000,
      payrollCents: null,
    })
  })

  it('nunca «$ 0» por un dato que falta: sin montos ni sueldos no hay número', () => {
    expect(sheetTotals(sheetOf(HUB, NOV), null)).toEqual({
      totalCents: null,
      paidCents: null,
      pendingCents: null,
      overdueCents: null,
      payrollCents: null,
      noAmount: 31,
    })
    // Con los sueldos cargados, ya hay un total; los que no tienen monto siguen sin sumar.
    expect(sheetTotals(sheetOf(HUB, NOV), PAYROLL)).toMatchObject({
      totalCents: 100_000_000,
      pendingCents: 70_000_000,
      noAmount: 31,
    })
  })

  it('un gasto con monto y otro sin: el que no tiene monto no suma y se avisa', () => {
    const blank = mk({ id: 'gf-luz', name: 'Luz', nextDueDate: '2026-10-20', dueDay: 20 })
    expect(sheetTotals(sheetOf([INTERNET, blank]), null)).toMatchObject({
      totalCents: 3_500_000,
      noAmount: 1,
    })
  })
})

describe('la fila fija de los sueldos', () => {
  const sums = { count: 2, advancesCents: 0, paidCents: 0 }

  it('dice cuánto falta, y el sello cuando no falta nada', () => {
    expect(payrollRowStatus({ ...sums, salaryCents: 100, owedCents: 100 })).toEqual({
      label: `Falta ${$('1')}`,
      tone: 'muted',
      stamp: false,
    })
    expect(payrollRowStatus({ ...sums, salaryCents: 100, owedCents: 0 })).toEqual({
      label: 'Pagado',
      tone: 'ok',
      stamp: true,
    })
  })

  it('sin equipo o sin sueldos lo dice; si no se pudo leer, también', () => {
    expect(payrollRowStatus({ ...sums, count: 0, salaryCents: 0, owedCents: 0 }).label).toBe(
      'Sin cargar',
    )
    expect(payrollRowStatus({ ...sums, salaryCents: 0, owedCents: 0 }).label).toBe('Sin sueldos')
    expect(payrollRowStatus(null)).toMatchObject({ label: 'No se pudo leer', tone: 'bad' })
  })
})

describe('la hoja del mes que viene', () => {
  it('lo pagado este mes es pendiente el que viene, y no se paga dos veces', () => {
    const paid = loaded()
    const payments = paidWith(
      'gf-alquiler',
      doc({ id: 'doc-1', totalCents: 85_000_000, paidCents: 85_000_000 }),
    )
    const sheet = sheetOf([paid], NOV, payments)
    const item = item0(sheet)
    expect(sheet.isCurrent).toBe(false)
    expect(item.row.monthStatus).toBe('pending')
    expect(item.realStatus).toBe('loaded')
    expect(item.line.state).toBe('unpaid')
    expect(item.day).toBe('2026-11-10')
    // El comprobante de octubre no es el de este renglón.
    expect(item.doc).toBeNull()
    expect(rowActions(item, { canWrite: true })).toMatchObject({ pay: null, payAhead: false })
    expect(sheet.progress.remainingCents).toBe(85_000_000)
  })

  it('lo vencido de antes sigue vencido contra hoy y va arriba, en su tramo', () => {
    const upcoming = mk({ id: 'gf-luz', name: 'Luz', amountCents: 12_000_000 })
    const sheet = sheetOf([upcoming, ALQUILER], NOV)
    expect(sheet.stretches.map((s) => [s.place, s.items.map((i) => i.row.name)])).toEqual([
      ['before', ['Alquiler del local']],
      ['month', ['Luz']],
    ])
    expect(item0(sheet).line.state).toBe('overdue')
    // El total es SOLO lo de noviembre: un «Total de noviembre» con la deuda de octubre adentro
    // sería un número con el mes equivocado. La deuda se ve en «Vencido» y en su tramo.
    expect(sheetCarry(sheet)).toMatchObject({
      month: OCT,
      count: 1,
      cents: 85_000_000,
      ownTotals: { count: 1, totalCents: 12_000_000, paidCents: 0, remainingCents: 12_000_000 },
    })
    expect(sheetTotals(sheet, null)).toMatchObject({
      totalCents: 12_000_000,
      pendingCents: 12_000_000,
      overdueCents: 85_000_000,
    })
  })

  it('si lo único que hay es lo que quedó de antes: sin total, con lo vencido', () => {
    const sheet = sheetOf(DEMO, NOV)
    expect(sheet.stretches.map((s) => s.place)).toEqual(['before'])
    expect(sheetCarry(sheet)).toMatchObject({ month: OCT, count: 3, cents: 91_500_000 })
    expect(sheetTotals(sheet, null)).toMatchObject({
      totalCents: null,
      pendingCents: null,
      overdueCents: 88_000_000,
    })
  })

  it('en el mes de hoy no se separa nada: lo vencido de antes es parte de «Por pagar»', () => {
    const old = mk({ ...ALQUILER, nextDueDate: '2026-09-10', monthStatus: undefined })
    const sheet = sheetOf([old, INTERNET])
    expect(sheetCarry(sheet)).toBeNull()
    expect(sheet.stretches.map((s) => s.place)).toEqual(['before', 'month'])
    expect(sheetTotals(sheet, null)).toMatchObject({ pendingCents: 88_500_000 })
  })

  it('lo pagado por adelantado cuenta como pago de este mes y queda último', () => {
    const ahead = loaded({ nextDueDate: '2026-12-10', loadedDue: '2026-11-10' })
    const payments = paidWith(
      'gf-alquiler',
      doc({
        id: 'doc-1',
        accountingDate: '2026-10-02',
        totalCents: 85_000_000,
        paidCents: 85_000_000,
      }),
    )
    const sheet = sheetOf([ahead, DISPENSER, INTERNET], OCT, payments)
    expect(sheet.stretches.map((s) => s.place)).toEqual(['month', 'ahead'])
    expect(sheet.items.at(-1)?.line.state).toBe('paid')
  })

  it('`?mes=` solo acepta el mes de hoy o el que viene', () => {
    expect(parseSheetMonth('2026-10', TODAY)).toBe(OCT)
    expect(parseSheetMonth('2026-11', TODAY)).toBe(NOV)
    for (const bad of ['2026-09', '2026-12', '2027-10', 'octubre', '', null, undefined]) {
      expect(parseSheetMonth(bad, TODAY)).toBeNull()
    }
    // En diciembre, el que viene es enero del año siguiente.
    expect(parseSheetMonth('2027-01', '2026-12-20')).toBe('2027-01')
  })
})

describe('los 31 de HUB al 13/10 (un bar que recién cargó su lista)', () => {
  const october = sheetOf(HUB, OCT)
  const november = sheetOf(HUB, NOV)

  it('octubre está vacío: se abre noviembre sola', () => {
    expect(october.items).toHaveLength(0)
    expect(november.items).toHaveLength(31)
    expect(defaultSheetMonth(october, november)).toEqual({ month: NOV, auto: true })
    // Con algo en octubre se queda en octubre.
    expect(defaultSheetMonth(sheetOf(DEMO, OCT), sheetOf(DEMO, NOV))).toEqual({
      month: OCT,
      auto: false,
    })
  })

  it('un renglón sin monto: se dice, y se puede pagar por adelantado al ponérselo', () => {
    const item = item0(november)
    expect(rowStatus(item, TODAY)).toMatchObject({ label: 'Sin monto', tone: 'muted' })
    expect(rowActions(item, { canWrite: true })).toMatchObject({
      pay: { kind: 'gasto', recurringId: item.row.id },
      payInRow: false,
      payAhead: true,
      skip: false,
      bill: true,
      edit: true,
    })
  })
})

describe('el estado de cada renglón', () => {
  const status = (row: RecurringExpenseRow, payments?: Map<string, RecurringPaymentFacts>) =>
    rowStatus(itemOf(row, payments), TODAY)

  it('sin nada cargado: vencido, por vencer y lo que vence ya', () => {
    expect(status(ALQUILER)).toMatchObject({ label: 'Vencido', tone: 'bad', stamp: false })
    expect(status(mk({ ...ALQUILER, nextDueDate: TODAY, monthStatus: undefined }))).toMatchObject({
      label: 'Vence hoy',
      tone: 'warn',
    })
    expect(
      status(mk({ ...ALQUILER, nextDueDate: '2026-10-14', monthStatus: undefined })),
    ).toMatchObject({ label: 'Vence mañana', tone: 'warn' })
    // Dentro de los días de aviso (5): en ámbar.
    expect(status(INTERNET)).toMatchObject({ label: 'Por vencer', tone: 'warn' })
    // Más lejos, en gris.
    expect(
      status(mk({ ...ALQUILER, nextDueDate: '2026-10-28', monthStatus: undefined })),
    ).toMatchObject({ label: 'Por vencer', tone: 'muted', detail: null })
  })

  it('sin monto: en rojo solo si ya pasó', () => {
    expect(status(mk({ id: 'a', name: 'Luz', nextDueDate: '2026-10-20' }))).toMatchObject({
      label: 'Sin monto',
      tone: 'muted',
    })
    expect(status(mk({ id: 'a', name: 'Luz', nextDueDate: '2026-10-10' }))).toMatchObject({
      label: 'Sin monto',
      tone: 'bad',
    })
  })

  it('pagaste menos que el monto: lo dice y arma la pregunta «¿Era eso?»', () => {
    const row = loaded({ amountCents: 18_000_000 })
    const payments = paidWith(
      row.id,
      doc({ id: 'doc-1', totalCents: 17_000_000, paidCents: 17_000_000 }),
    )
    const item = itemOf(row, payments)
    const short = rowStatus(item, TODAY)
    expect(short).toMatchObject({
      label: `Pagaste ${$('170.000')}`,
      detail: `${$('10.000')} menos que el monto`,
      tone: 'warn',
      short: { expectedCents: 18_000_000, paidCents: 17_000_000 },
    })
    expect(askWords({ expectedCents: 18_000_000, paidCents: 17_000_000 })).toBe(
      `Calculabas ${$('180.000')}. ¿Era eso?`,
    )
    expect(tickState(item)).toBe('half')
    // Nunca paga con el comprobante saldado: otro gasto daría por cargado el mes que viene.
    expect(rowActions(item, { canWrite: true })).toMatchObject({
      pay: null,
      payInRow: false,
      ask: true,
      skip: false,
    })
  })

  it('pagaste de más: figura pago, con lo que pagaste, y se ofrece usarlo de ahora en más', () => {
    const row = loaded({ amountCents: 18_000_000 })
    const payments = paidWith(
      row.id,
      doc({ id: 'doc-1', totalCents: 19_500_000, paidCents: 19_500_000 }),
    )
    const item = itemOf(row, payments)
    // La diferencia con su palabra, como cuando pagaste de menos: nunca un importe pelado.
    expect(rowStatus(item, TODAY)).toMatchObject({
      label: 'Pagado',
      stamp: true,
      detail: `el 08/10 · ${$('15.000')} más que el monto`,
      short: null,
    })
    expect(rowActions(item, { canWrite: true })).toMatchObject({ ask: false, keepPaid: true })
  })

  it('con una factura cargada que todavía se debe: «Lo debés»', () => {
    const row = loaded()
    const owed = (over: Partial<RecurringDocument>) =>
      paidWith(row.id, doc({ id: 'doc-1', totalCents: 85_000_000, openCents: 85_000_000, ...over }))
    expect(status(row, owed({ dueDate: '2026-10-25' }))).toMatchObject({
      label: 'Lo debés',
      detail: 'vence el 25/10',
      tone: 'warn',
    })
    expect(status(row, owed({ dueDate: '2026-10-10' }))).toMatchObject({
      label: 'Lo debés',
      detail: 'venció hace 3 días',
      tone: 'bad',
    })
    expect(
      status(row, owed({ dueDate: '2026-10-25', paidCents: 30_000_000, openCents: 55_000_000 })),
    ).toMatchObject({
      label: `Pagaste ${$('300.000')}`,
      detail: `falta ${$('550.000')}`,
      tone: 'warn',
    })
    expect(
      status(row, owed({ dueDate: '2026-10-10', paidCents: 30_000_000, openCents: 55_000_000 })),
    ).toMatchObject({
      label: 'Lo debés',
      detail: `venció hace 3 días · pagaste ${$('300.000')}, falta ${$('550.000')}`,
      tone: 'bad',
    })
  })

  it('pausado, terminado, última cuota y deuda de antes', () => {
    expect(status(mk({ ...ALQUILER, active: false, monthStatus: undefined }))).toMatchObject({
      label: 'En pausa',
      tone: 'muted',
    })
    expect(
      status(
        mk({
          ...ALQUILER,
          active: false,
          ended: true,
          endsOn: '2026-09-10',
          remainingDues: 0,
          monthStatus: undefined,
        }),
      ),
    ).toMatchObject({
      label: 'Terminó',
      detail: 'la última cuota venció el 10/09',
      tone: 'muted',
    })
    // Se cargó la última cuota: se informa su pago y se avisa que no sigue.
    const last = loaded({ active: false, ended: true, endsOn: '2026-10-10', remainingDues: 0 })
    const payments = new Map<string, RecurringPaymentFacts>([
      [
        last.id,
        {
          document: doc({ id: 'doc-1', totalCents: 85_000_000, paidCents: 85_000_000 }),
          priorOpenCents: 4_000_000,
        },
      ],
    ])
    expect(status(last, payments).extras).toEqual([
      'Era la última cuota',
      `Debés ${$('40.000')} de antes`,
    ])
  })
})

describe('qué hace tildar', () => {
  it('sin nada cargado y vencido o por vencer este mes: abre la tira, con el gasto fijo', () => {
    expect(rowActions(itemOf(ALQUILER), { canWrite: true })).toMatchObject({
      pay: { kind: 'gasto', recurringId: 'gf-alquiler' },
      payInRow: true,
      payAhead: false,
      skip: true,
      unskip: false,
      bill: true,
      pause: true,
      resume: false,
      edit: true,
      remove: true,
    })
  })

  it('con la factura cargada y sin pagar: «Pagar» con su proveedor o, si no tiene, a la factura', () => {
    const base = loaded()
    const owed = paidWith(
      base.id,
      doc({ id: 'doc-1', dueDate: '2026-10-25', totalCents: 85_000_000, openCents: 85_000_000 }),
    )
    expect(rowActions(itemOf(base, owed), { canWrite: true })).toMatchObject({
      pay: { kind: 'document', documentId: 'doc-1' },
      payInRow: true,
    })
    const withParty = { ...base, partyId: 'party-1', partyName: 'Inmobiliaria' }
    expect(rowActions(itemOf(withParty, owed), { canWrite: true })).toMatchObject({
      pay: { kind: 'pagar', partyId: 'party-1' },
      payInRow: true,
    })
  })

  it('en pausa solo se reanuda; uno terminado no se edita en el lugar', () => {
    const paused = mk({ ...ALQUILER, active: false, monthStatus: undefined })
    expect(rowActions(itemOf(paused), { canWrite: true })).toMatchObject({
      pay: null,
      bill: false,
      skip: false,
      pause: false,
      resume: true,
      edit: true,
    })
    const ended = mk({ ...paused, ended: true, endsOn: '2026-09-10', remainingDues: 0 })
    expect(rowActions(itemOf(ended), { canWrite: true })).toMatchObject({
      resume: false,
      edit: false,
    })
  })

  it('«Sí se paga este mes» no reanuda por la ventana uno que estaba en pausa', () => {
    // Devolver un vencimiento manda `active: true` (lo del «Deshacer» de siempre).
    const skipped = mk({
      ...ALQUILER,
      nextDueDate: '2026-11-10',
      skippedDue: '2026-10-10',
      monthStatus: undefined,
    })
    expect(rowActions(itemOf(skipped), { canWrite: true }).unskip).toBe(true)
    // En pausa a propósito: solo «Reanudar».
    const paused = mk({ ...skipped, active: false, monthStatus: undefined })
    expect(rowActions(itemOf(paused), { canWrite: true })).toMatchObject({
      unskip: false,
      resume: true,
    })
    // Se apagó solo por no pagar la última cuota: devolverla lo vuelve a prender.
    const lastSkipped = mk({
      ...paused,
      ended: true,
      endsOn: '2026-10-10',
      remainingDues: 0,
      monthStatus: undefined,
    })
    expect(rowActions(itemOf(lastSkipped), { canWrite: true })).toMatchObject({
      unskip: true,
      resume: false,
    })
  })

  it('a quien solo mira (la contadora) no se le ofrece nada', () => {
    for (const row of [ALQUILER, INTERNET, mk({ id: 'x', name: 'Luz' })]) {
      const actions = rowActions(itemOf(row), { canWrite: false })
      expect(Object.values(actions).every((value) => value === false || value === null)).toBe(true)
    }
  })

  it('con detalle (los sueldos) no se pregunta «¿Era eso?»', () => {
    const row = loaded({
      amountCents: 18_000_000,
      breakdown: [{ label: 'Ana', kind: null, amountCents: 18_000_000 }],
    })
    const payments = paidWith(
      row.id,
      doc({ id: 'doc-1', totalCents: 17_000_000, paidCents: 17_000_000 }),
    )
    expect(rowActions(itemOf(row, payments), { canWrite: true }).ask).toBe(false)
  })
})

describe('un impuesto que se devenga solo no se paga como otro gasto', () => {
  const ACCOUNTS = [
    { id: 'acc-iibb', systemKey: 'iibb_expense' },
    { id: 'acc-comercio', systemKey: 'municipal_tax_expense' },
    { id: 'acc-alquiler', systemKey: null },
  ]
  const PARTIES = [
    { id: 'p-rentas', systemKey: 'rentas', active: true },
    { id: 'p-muni', systemKey: 'municipalidad', active: true },
    { id: 'p-otro', systemKey: null, active: true },
  ]
  const settings = { auto: true }
  const plan = autoTaxPlan({ settings, accounts: ACCOUNTS, parties: PARTIES })
  const iibb = mk({ ...ALQUILER, id: 'gf-iibb', name: 'Ingresos Brutos', accountId: 'acc-iibb' })
  const comercio = mk({ ...ALQUILER, id: 'gf-com', name: 'Comercio', accountId: 'acc-comercio' })

  it('cada cuenta con su partícipe', () => {
    expect(plan).toEqual({ 'acc-iibb': 'p-rentas', 'acc-comercio': 'p-muni' })
  })

  it('tildar abre el pago al partícipe, y no ofrece cargar otra factura', () => {
    const actions = rowActions(itemOf(iibb), { canWrite: true, autoTax: plan })
    expect(actions).toMatchObject({
      pay: { kind: 'pagar', partyId: 'p-rentas' },
      payInRow: true,
      bill: false,
      // El pago deja pagado este gasto fijo; igual se puede decir que este mes no se paga.
      skip: true,
    })
    expect(rowActions(itemOf(comercio), { canWrite: true, autoTax: plan }).pay).toEqual({
      kind: 'pagar',
      partyId: 'p-muni',
      recurringId: comercio.id,
    })
    const labels = rowMenu(itemOf(iibb), actions, { tenantSlug: 'hub', month: OCT }).map(
      (entry) => entry.label,
    )
    expect(labels).not.toContain('Me llegó la factura y la pago después')
    expect(labels).toContain('Este mes no se paga')
  })

  it('el que todavía no vence también va al partícipe', () => {
    const later = mk({ ...iibb, nextDueDate: '2026-11-10', monthStatus: undefined })
    expect(rowActions(itemOf(later), { canWrite: true, autoTax: plan })).toMatchObject({
      pay: { kind: 'pagar', partyId: 'p-rentas' },
      payInRow: false,
      payAhead: true,
    })
  })

  it('sin el partícipe activo no se ofrece pagar: nunca se carga el gasto de nuevo', () => {
    const noParty = autoTaxPlan({
      settings,
      accounts: ACCOUNTS,
      parties: PARTIES.filter((party) => party.systemKey !== 'rentas'),
    })
    expect(noParty['acc-iibb']).toBeNull()
    expect(rowActions(itemOf(iibb), { canWrite: true, autoTax: noParty })).toMatchObject({
      pay: null,
      payInRow: false,
    })
  })

  it('con los impuestos apagados, o en otra cuenta, se paga como cualquier gasto', () => {
    const off = autoTaxPlan({ settings: { auto: false }, accounts: ACCOUNTS, parties: PARTIES })
    expect(off).toEqual({})
    expect(autoTaxPlan({ settings: null, accounts: ACCOUNTS, parties: PARTIES })).toEqual({})
    expect(rowActions(itemOf(iibb), { canWrite: true, autoTax: off }).pay).toEqual({
      kind: 'gasto',
      recurringId: 'gf-iibb',
    })
    expect(rowActions(itemOf(ALQUILER), { canWrite: true, autoTax: plan }).pay).toEqual({
      kind: 'gasto',
      recurringId: 'gf-alquiler',
    })
  })

  it('una factura ya cargada se sigue pagando con su proveedor', () => {
    const billed = loaded({
      id: 'gf-iibb',
      accountId: 'acc-iibb',
      partyId: 'p-otro',
      partyName: 'Estudio',
    })
    const owed = paidWith(
      billed.id,
      doc({ id: 'doc-1', dueDate: '2026-10-25', totalCents: 85_000_000, openCents: 85_000_000 }),
    )
    expect(rowActions(itemOf(billed, owed), { canWrite: true, autoTax: plan }).pay).toEqual({
      kind: 'pagar',
      partyId: 'p-otro',
    })
  })
})

describe('el «⋯» de la fila: lo que no es de todos los días no se pierde', () => {
  const menu = (
    row: RecurringExpenseRow,
    payments?: Map<string, RecurringPaymentFacts>,
    isMisc = false,
  ) => {
    const item = itemOf(row, payments)
    return rowMenu(item, rowActions(item, { canWrite: true }), {
      tenantSlug: 'hub',
      month: OCT,
      isMisc,
    })
  }
  const labels = (...args: Parameters<typeof menu>) => menu(...args).map((entry) => entry.label)
  const entry = (list: ReturnType<typeof menu>, key: string) => {
    const found = list.find((item) => item.key === key)
    if (!found) throw new Error(`no está «${key}»`)
    return found
  }

  it('un gasto sin pagar: la factura para después, saltear, editar, pausar y eliminar', () => {
    const list = menu(ALQUILER)
    expect(list.map((item) => item.label)).toEqual([
      'Me llegó la factura y la pago después',
      'Este mes no se paga',
      'Editar',
      'Pausar',
      'Eliminar',
    ])
    const bill = entry(list, 'factura-despues')
    expect(bill.href).toContain('/hub/administracion/compras/nueva?')
    expect(bill.href).toContain('gasto-fijo=gf-alquiler')
    expect(decodeURIComponent(bill.href ?? '')).toContain(
      'volver=/hub/administracion/gastos-fijos?mes=2026-10',
    )
    expect(bill.hint).toBe('Queda como deuda con el proveedor. Cubre el vencimiento del 10/10.')
    expect(entry(list, 'skip').hint).toBe('Usalo también si ya lo cargaste por otro lado.')
    expect(entry(list, 'ficha').href).toBe('/hub/administracion/compras/gastos-fijos/gf-alquiler')
    expect(entry(list, 'remove').run).toBe('remove')
    // Las secciones van en orden: entre una y otra, una raya.
    expect(list.map((item) => item.section)).toEqual(['pay', 'pay', 'edit', 'state', 'state'])
  })

  it('uno que todavía no vence se paga por adelantado, y dice qué vencimiento cubre', () => {
    const luz = mk({ id: 'gf-luz', name: 'Luz', amountCents: 9_000_000 })
    const pay = entry(menu(luz), 'pay')
    expect(pay.label).toBe('Pagar por adelantado')
    expect(pay.hint).toBe('Paga el vencimiento del 10/11.')
    expect(pay.run).toBe('pay')
  })

  it('«no se paga», pausado y terminado', () => {
    const skipped = mk({
      ...ALQUILER,
      nextDueDate: '2026-11-10',
      skippedDue: '2026-10-10',
      monthStatus: undefined,
    })
    expect(labels(skipped)).toContain('Sí se paga este mes')
    const paused = mk({ ...ALQUILER, active: false, monthStatus: undefined })
    expect(labels(paused)).toEqual(['Editar', 'Reanudar', 'Eliminar'])
  })

  it('pagaste distinto: «¿Era eso?» y «de ahora en más», con el importe', () => {
    const row = loaded({ amountCents: 18_000_000 })
    const short = entry(
      menu(
        row,
        paidWith(row.id, doc({ id: 'doc-1', totalCents: 17_000_000, paidCents: 17_000_000 })),
      ),
      'keep',
    )
    expect(short).toMatchObject({
      label: `Sí, dejar ${$('170.000')}`,
      run: 'keep',
      cents: 17_000_000,
    })
    const over = entry(
      menu(
        row,
        paidWith(row.id, doc({ id: 'doc-1', totalCents: 19_500_000, paidCents: 19_500_000 })),
      ),
      'keep',
    )
    expect(over).toMatchObject({ label: `Usar ${$('195.000')} de ahora en más`, cents: 19_500_000 })
  })

  it('el comprobante y la factura sin proveedor', () => {
    const row = loaded()
    const paid = paidWith(
      row.id,
      doc({ id: 'doc-1', totalCents: 85_000_000, paidCents: 85_000_000 }),
    )
    expect(entry(menu(row, paid), 'comprobante').href).toBe(
      '/hub/administracion/comprobantes/doc-1',
    )
    const owed = paidWith(
      row.id,
      doc({ id: 'doc-1', totalCents: 85_000_000, openCents: 85_000_000 }),
    )
    expect(entry(menu(row, owed), 'factura').label).toBe('Ver la factura y pagarla')
  })

  it('el detalle de sueldos y «Gastos varios»', () => {
    const detailed = mk({
      ...ALQUILER,
      breakdown: [{ label: 'Ana', kind: null, amountCents: 85_000_000 }],
    })
    const list = menu(detailed)
    expect(entry(list, 'ficha').label).toBe('Editar el detalle')
    expect(entry(list, 'sueldos').href).toBe(
      '/hub/administracion/libros/asiento-manual?tipo=sueldos',
    )
    expect(labels(ALQUILER)).not.toContain('Cambiar de categoría')
    const misc = entry(menu(ALQUILER, undefined, true), 'categoria')
    expect(misc.href).toBe('/hub/administracion/gastos-fijos/completar?ver=varios&foco=gf-alquiler')
  })
})

describe('la celda del monto', () => {
  const editable = (row: RecurringExpenseRow, payments?: Map<string, RecurringPaymentFacts>) => {
    const item = itemOf(row, payments)
    return amountEditable(item, rowActions(item, { canWrite: true }))
  }

  it('se escribe mientras no haya comprobante', () => {
    expect(editable(ALQUILER)).toBe(true)
    expect(editable(mk({ id: 'a', name: 'Luz', nextDueDate: '2026-10-20' }))).toBe(true)
    const row = loaded()
    expect(
      editable(
        row,
        paidWith(row.id, doc({ id: 'doc-1', totalCents: 85_000_000, paidCents: 85_000_000 })),
      ),
    ).toBe(false)
  })

  it('con detalle es la suma; a quien solo mira, nunca', () => {
    const detailed = mk({
      ...ALQUILER,
      breakdown: [{ label: 'Ana', kind: null, amountCents: 85_000_000 }],
    })
    expect(editable(detailed)).toBe(false)
    const item = itemOf(ALQUILER)
    expect(amountEditable(item, rowActions(item, { canWrite: false }))).toBe(false)
  })
})

describe('la tira de pago', () => {
  const account = { kind: 'account' as const, accountId: 'acc-1' }
  const party = { kind: 'party' as const, partyId: 'p-1', accountId: 'acc-1' }
  const base = { amountCents: 100, target: account, voucher: 'none' as const, hasNumber: false }

  it('con monto y categoría, sin factura, se carga en la tira', () => {
    expect(payStripBlock(base)).toBeNull()
    expect(payStripBlock({ ...base, target: party, voucher: 'ticket' })).toBeNull()
  })

  it('dice qué falta', () => {
    expect(payStripBlock({ ...base, amountCents: null })).toBe(
      'Falta el monto: escribilo en la columna Monto.',
    )
    expect(payStripBlock({ ...base, target: null })).toBe(
      'Este gasto fijo no tiene proveedor ni categoría que sirvan.',
    )
    expect(payStripBlock({ ...base, target: { ...party, accountId: null } })).toBe(
      'Este gasto fijo no tiene una categoría que sirva.',
    )
  })

  it('una factura pide proveedor y número (la tira los pregunta)', () => {
    expect(payStripBlock({ ...base, voucher: 'a' })).toBe(
      'Para la factura falta el proveedor y el número.',
    )
    expect(payStripBlock({ ...base, voucher: 'bc', hasNumber: true })).toBe(
      'Para la factura falta el proveedor.',
    )
    expect(payStripBlock({ ...base, voucher: 'a', target: party })).toBe(
      'Para la factura falta el número.',
    )
    expect(payStripBlock({ ...base, voucher: 'a', target: party, hasNumber: true })).toBeNull()
  })

  describe('el proveedor de la factura de un gasto fijo que no tiene (12/11/2026)', () => {
    // Thinkion: gasto fijo con Factura A y sin proveedor (HUB, 12/11/2026).
    const thinkeon = {
      kind: 'new' as const,
      name: 'Thinkion',
      taxId: '30-71876543-5',
      ivaCondition: 'monotributo' as const,
    }
    const parties = [
      {
        id: 'p-coca',
        name: 'Coca-Cola FEMSA',
        tradeName: 'Coca',
        taxId: '33693450239',
        active: true,
        kind: 'supplier' as const,
      },
      {
        id: 'p-mp',
        name: 'Mercado Pago',
        tradeName: null,
        taxId: '30703088534',
        active: true,
        kind: 'card_processor' as const,
      },
      {
        id: 'p-viejo',
        name: 'Viejo',
        tradeName: null,
        taxId: '30718765435',
        active: false,
        kind: 'supplier' as const,
      },
    ]

    it('solo pregunta con factura y sin proveedor en el gasto fijo', () => {
      expect(stripAsksSupplier(account, 'a')).toBe(true)
      expect(stripAsksSupplier(account, 'bc')).toBe(true)
      expect(stripAsksSupplier(account, 'ticket')).toBe(false)
      expect(stripAsksSupplier(account, 'none')).toBe(false)
      expect(stripAsksSupplier(party, 'a')).toBe(false)
      expect(stripAsksSupplier(null, 'a')).toBe(false)
    })

    it('el elegido va con la categoría del gasto fijo; sin factura no cuenta', () => {
      const chosen = { kind: 'party' as const, partyId: 'p-coca' }
      expect(stripTarget({ fixed: account, voucher: 'a', supplier: chosen })).toEqual({
        kind: 'party',
        partyId: 'p-coca',
        accountId: 'acc-1',
      })
      expect(stripTarget({ fixed: account, voucher: 'none', supplier: chosen })).toBe(account)
      expect(stripTarget({ fixed: account, voucher: 'a', supplier: null })).toBe(account)
      // Con proveedor en el gasto fijo, manda el suyo.
      expect(stripTarget({ fixed: party, voucher: 'a', supplier: chosen })).toBe(party)
    })

    it('uno nuevo: la factura A la hace un inscripto; la B o C, lo que diga la letra', () => {
      expect(stripTarget({ fixed: account, voucher: 'a', supplier: thinkeon })).toEqual({
        ...thinkeon,
        ivaCondition: 'responsable_inscripto',
        accountId: 'acc-1',
      })
      expect(stripTarget({ fixed: account, voucher: 'bc', supplier: thinkeon })).toMatchObject({
        ivaCondition: 'monotributo',
      })
    })

    it('uno nuevo pide nombre, un CUIT que sirva y que no sea de otro', () => {
      const withNew = (s: typeof thinkeon) =>
        payStripBlock({
          ...base,
          voucher: 'a',
          hasNumber: true,
          target: stripTarget({ fixed: account, voucher: 'a', supplier: s }),
          parties,
        })
      expect(withNew(thinkeon)).toBeNull()
      expect(withNew({ ...thinkeon, name: ' ' })).toBe('Escribí el nombre del proveedor nuevo.')
      expect(withNew({ ...thinkeon, taxId: '' })).toBe(
        'Para la factura falta el CUIT del proveedor nuevo.',
      )
      expect(withNew({ ...thinkeon, taxId: '30-71876543-6' })).toBe(
        'El CUIT del proveedor nuevo no es válido: revisalo.',
      )
      expect(withNew({ ...thinkeon, taxId: '33-69345023-9' })).toBe(
        'Ese CUIT ya es de «Coca»: elegilo en Proveedor.',
      )
      // De alguien que no es proveedor (no está en la lista): no lo manda a elegirlo.
      expect(withNew({ ...thinkeon, taxId: '30703088534' })).toBe(
        'Ese CUIT es de «Mercado Pago», que no es un proveedor: revisalo.',
      )
      // Uno dado de baja no lo ocupa.
      expect(withNew({ ...thinkeon, taxId: '30718765435' })).toBeNull()
      expect(
        payStripBlock({
          ...base,
          voucher: 'a',
          target: stripTarget({ fixed: account, voucher: 'a', supplier: thinkeon }),
          parties,
        }),
      ).toBe('Para la factura falta el número.')
    })

    it('el CUIT del QR elige al que ya está o arma uno nuevo con el nombre del gasto fijo', () => {
      expect(
        stripSupplierFromQr({ cuit: '33693450239', voucherType: 'factura_a' }, parties, 'X'),
      ).toEqual({ kind: 'party', partyId: 'p-coca' })
      expect(
        stripSupplierFromQr({ cuit: '30718765435', voucherType: 'factura_a' }, parties, 'Thinkion'),
      ).toEqual({
        kind: 'new',
        name: 'Thinkion',
        taxId: '30-71876543-5',
        ivaCondition: 'responsable_inscripto',
      })
      expect(
        stripSupplierFromQr({ cuit: '30718765435', voucherType: 'factura_c' }, parties, 'Thinkion'),
      ).toMatchObject({ ivaCondition: 'monotributo' })
      // A un medio de cobro no se le carga un gasto; un CUIT roto no sirve.
      expect(
        stripSupplierFromQr({ cuit: '30703088534', voucherType: 'factura_a' }, parties, 'X'),
      ).toBeNull()
      expect(
        stripSupplierFromQr({ cuit: '30718765436', voucherType: 'factura_a' }, parties, 'X'),
      ).toBeNull()
    })

    it('después del QR: lo elegido de la lista queda; uno nuevo toma el CUIT o pasa al que existe', () => {
      const qrCoca = { cuit: '33693450239', voucherType: 'factura_a' }
      const qrNew = { cuit: '30718765435', voucherType: 'factura_a' }
      const chosen = { kind: 'party' as const, partyId: 'p-otro' }
      expect(supplierAfterQr(null, qrCoca, parties, 'Thinkion')).toEqual({
        kind: 'party',
        partyId: 'p-coca',
      })
      expect(supplierAfterQr(chosen, qrCoca, parties, 'Thinkion')).toBe(chosen)
      const typed = { ...thinkeon, name: 'Thinkeon SRL', taxId: '' }
      expect(supplierAfterQr(typed, qrNew, parties, 'Thinkion')).toEqual({
        ...typed,
        taxId: '30-71876543-5',
        ivaCondition: 'responsable_inscripto',
      })
      expect(supplierAfterQr(typed, qrCoca, parties, 'Thinkion')).toEqual({
        kind: 'party',
        partyId: 'p-coca',
      })
      // Con un CUIT ya escrito, el nuevo no cambia; sin CUIT que sirva, queda lo que había.
      expect(supplierAfterQr(thinkeon, qrNew, parties, 'X')).toBe(thinkeon)
      expect(supplierAfterQr(null, { cuit: '1', voucherType: null }, parties, 'X')).toBeNull()
    })
  })

  it('el QR de ARCA completa el papel, el número y el total', () => {
    expect(
      stripFromQr({
        voucherType: 'factura_a',
        pointOfSale: 3,
        number: 1290,
        totalCents: 31_240_000,
      }),
    ).toEqual({ voucher: 'a', pointOfSale: 3, number: 1290, amountCents: 31_240_000 })
    expect(
      stripFromQr({ voucherType: 'factura_c', pointOfSale: 1, number: 2, totalCents: null }),
    ).toMatchObject({ voucher: 'bc', amountCents: null })
    // Un comprobante que no se carga no cambia el papel.
    expect(
      stripFromQr({ voucherType: null, pointOfSale: 1, number: 2, totalCents: 0 }),
    ).toMatchObject({ voucher: null, amountCents: null })
  })

  it('«Más opciones» es el formulario entero, con el gasto fijo y la vuelta a la planilla', () => {
    const href = morePayOptionsHref('hub', 'gf-1', OCT)
    expect(href).toContain('/hub/administracion/compras/nueva?modo=pago&gasto-fijo=gf-1&volver=')
    expect(decodeURIComponent(href)).toContain(
      'volver=/hub/administracion/gastos-fijos?mes=2026-10',
    )
  })
})

describe('un pago anulado deja el vencimiento corrido', () => {
  const voided = mk({
    ...ALQUILER,
    nextDueDate: '2026-11-10',
    loadedDue: '2026-10-10',
    lastDocumentId: 'doc-anulado',
    lastDocumentDate: null,
    monthStatus: undefined,
  })

  it('la hoja lo detecta para avisarlo', () => {
    const sheet = sheetOf([voided, DISPENSER])
    expect(sheet.voided.map((i) => i.row.id)).toEqual(['gf-alquiler'])
    // Mientras tanto no figura en octubre: quedó para noviembre.
    expect(sheet.later.map((i) => i.row.id)).toEqual(['gf-alquiler'])
  })

  it('no avisa si el pago sigue vigente, si nunca se cargó o si después se marcó «no se paga»', () => {
    const alive = { ...voided, lastDocumentDate: '2026-10-08' }
    const skippedAfter = mk({ ...voided, skippedDue: '2026-10-10', monthStatus: undefined })
    expect(sheetOf([alive]).voided).toEqual([])
    expect(sheetOf([ALQUILER]).voided).toEqual([])
    expect(sheetOf([skippedAfter]).voided).toEqual([])
    // Ya se volvió a dejar pendiente: el vencimiento es otra vez el que cubría.
    expect(
      sheetOf([mk({ ...voided, nextDueDate: '2026-10-10', monthStatus: undefined })]).voided,
    ).toEqual([])
  })
})

describe('las palabras de un renglón', () => {
  it('las cuotas se dicen con palabras', () => {
    expect(installmentWords({ current: 2, total: 6, remaining: 5 })).toBe('cuota 2 de 6')
    expect(installmentWords({ current: null, total: null, remaining: 3 })).toBe('quedan 3')
    expect(installmentWords({ current: null, total: null, remaining: 1 })).toBe('última cuota')
    expect(installmentWords(null)).toBeNull()
  })

  it('el papel se dice como en toda la sección: «Sin factura» nunca es otra cosa', () => {
    expect(papelLabel('factura_a')).toBe('Factura A')
    expect(papelLabel('tique')).toBe('Tique')
    expect(papelLabel('sin_comprobante')).toBe('Sin factura')
    expect(papelLabel(null)).toBeNull()
  })

  it('lo que se sabe del gasto escribe solo lo que está cargado', () => {
    expect(rowSubline(ALQUILER)).toEqual(['Alquiler'])
    expect(
      rowSubline({
        ...INTERNET,
        voucherType: 'factura_a',
        partyName: 'Fibertel',
      }),
    ).toEqual(['Internet', 'Factura A', 'Fibertel'])
    expect(rowSubline({ ...ALQUILER, voucherType: 'sin_comprobante' })).toEqual([
      'Alquiler',
      'sin factura',
    ])
  })

  it('la suma de unos renglones: pagado más lo que falta, sin los que no tienen monto', () => {
    const blank = mk({ id: 'gf-luz', name: 'Luz', nextDueDate: '2026-10-20', dueDay: 20 })
    const all = sheetOf([...DEMO, blank])
    expect(shownTotals(all.items)).toEqual({
      count: 4,
      totalCents: all.progress.totalCents,
      paidCents: all.progress.paidCents,
      remainingCents: all.progress.remainingCents,
      noAmount: 1,
    })
    expect(shownTotals([])).toEqual({
      count: 0,
      totalCents: 0,
      paidCents: 0,
      remainingCents: 0,
      noAmount: 0,
    })
  })
})

describe('«¿Es la cuota 6 de 6?»: la cuota escrita en el nombre', () => {
  it('reconoce «n/m» cuando puede ser una cuota', () => {
    expect(detectInstallment('Licuadora 6/6 USA cord')).toEqual({
      current: 6,
      total: 6,
      cleanName: 'Licuadora USA cord',
    })
    expect(detectInstallment('Colombraro bateas 1/3')).toEqual({
      current: 1,
      total: 3,
      cleanName: 'Colombraro bateas',
    })
    expect(detectInstallment('TV cuota 3/12')).toMatchObject({
      current: 3,
      total: 12,
      cleanName: 'TV',
    })
    // Sin nada más que la cuota no queda un nombre.
    expect(detectInstallment('1/3')).toMatchObject({ cleanName: null })
  })

  it('«24/7», «7/3» y una fecha no son una cuota', () => {
    for (const name of [
      'Guardia 24/7',
      'Plan 7/3',
      'Seguro 10/11/2026',
      'Alquiler',
      'IVA 10,5/21',
    ]) {
      expect(detectInstallment(name), name).toBeNull()
    }
    expect(detectInstallment('Préstamo 121/200')).toBeNull()
  })
})

describe('«Pegar los montos desde mi planilla»', () => {
  const rows = DEMO.map((row) => ({ id: row.id, name: row.name }))

  it('junta cada renglón con el gasto fijo que se llama igual y toma el día de la fecha', () => {
    const text = [
      'Concepto\tMonto\tVencimiento',
      'Alquiler del local\t850.000\t10/11/2026',
      'internet y teléfono\t$ 35.000',
      'Gimnasio\t20.000',
      'Total\t905.000',
    ].join('\n')
    const result = matchPastedAmounts(text, rows)
    expect(result.matches).toEqual([
      { id: 'gf-alquiler', name: 'Alquiler del local', amountCents: 85_000_000, day: 10 },
      { id: 'gf-internet', name: 'Internet y teléfono', amountCents: 3_500_000, day: null },
    ])
    expect(result.notInPaste).toEqual(['Dispenser Agua'])
    expect(result.notInSheet).toEqual(['Gimnasio'])
    expect(pasteSummary(result, rows.length)).toEqual({
      headline: 'Encontré 2 de tus 3.',
      missing: 'No vino en lo que pegaste: Dispenser Agua.',
      extra:
        'En lo que pegaste hay 1 que no está en tu planilla: Gimnasio (se agregan con «Pegar una lista»).',
    })
  })

  it('el vencimiento como un número suelto, antes o después del monto', () => {
    const result = matchPastedAmounts(
      'Alquiler del local\t10\t850.000\nDispenser Agua\t30.000\t5\nInternet y teléfono\t35.000\t15/11',
      rows,
    )
    expect(result.matches.map((m) => [m.id, m.amountCents, m.day])).toEqual([
      ['gf-alquiler', 85_000_000, 10],
      ['gf-dispenser', 3_000_000, 5],
      ['gf-internet', 3_500_000, 15],
    ])
  })

  it('vacío, sin montos o repetido', () => {
    expect(matchPastedAmounts('', rows).matches).toEqual([])
    expect(matchPastedAmounts('Alquiler del local\nDispenser Agua', rows).matches).toEqual([])
    const twice = matchPastedAmounts('Alquiler del local\t100\nAlquiler del local\t200', rows)
    expect(twice.matches).toEqual([
      { id: 'gf-alquiler', name: 'Alquiler del local', amountCents: 10_000, day: null },
    ])
    expect(pasteSummary(matchPastedAmounts('', rows), 3).headline).toBe(
      'Todavía no encontré ninguno con monto.',
    )
  })

  it('importes de nueve cifras y nombres de 60 caracteres', () => {
    const long = 'Mantenimiento integral de cámaras, freezers y heladeras 2026'
    expect(long).toHaveLength(60)
    const result = matchPastedAmounts(`${long}\t999.999.999,50`, [{ id: 'gf-largo', name: long }])
    expect(result.matches).toEqual([
      { id: 'gf-largo', name: long, amountCents: 99_999_999_950, day: null },
    ])
  })
})

describe('por qué no se guardó un renglón', () => {
  it('alguien lo cambió, la categoría ya no sirve, el nombre está repetido u otra cosa', () => {
    expect(saveFailure({ code: 'stale', message: 'x' })).toEqual({
      kind: 'stale',
      message: 'Alguien lo cambió recién.',
    })
    expect(
      saveFailure({
        code: 'invalid',
        message: 'Esa cuenta no sirve para imputar un gasto.',
        detail: { key: 'invalid_imputation_account' },
      }),
    ).toEqual({
      kind: 'category',
      message: 'No se guardó: la categoría de este gasto ya no se puede usar.',
    })
    expect(
      saveFailure({ code: 'invalid', message: 'x', detail: { key: 'recurring_name_taken' } }),
    ).toEqual({ kind: 'name', message: 'Ya hay un gasto fijo con ese nombre.' })
    expect(saveFailure({ code: 'error', message: 'Probá de nuevo.' })).toEqual({
      kind: 'other',
      message: 'No se guardó. Probá de nuevo.',
    })
  })
})

describe('bordes', () => {
  it('sin ningún gasto fijo: hoja vacía y sin número', () => {
    const sheet = sheetOf([])
    expect(sheet.items).toEqual([])
    expect(sheet.stretches).toEqual([])
    expect(sheet.progress.state).toBe('empty')
    expect(sheetTotals(sheet, null).totalCents).toBeNull()
  })

  it('un solo gasto, de nueve cifras y con un nombre de 60 caracteres', () => {
    const name = 'Mantenimiento integral de cámaras, freezers y heladeras 2026'
    const big = mk({ id: 'gf-big', name, amountCents: 99_999_999_900, nextDueDate: '2026-10-20' })
    expect(sheetTotals(sheetOf([big]), null)).toMatchObject({ totalCents: 99_999_999_900 })
  })
})
