import { describe, expect, it } from 'vitest'
import {
  matchPastedAmounts,
  pasteSummary,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/paste-amounts'
import {
  buildSheet,
  categoryBars,
  defaultSheetMonth,
  dueStripDays,
  paperSplit,
  parseSheetMonth,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla'
import {
  categoryTitle,
  detectInstallment,
  dueTitle,
  installmentWords,
  invoiceBucket,
  matchesSheetQuery,
  nextUpView,
  papelLabel,
  paperTitle,
  parseInvoiceBucket,
  parseSheetFilter,
  rowActions,
  rowSubline,
  rowTint,
  rowWords,
  type SheetItem,
  saveFailure,
  sheetFilterPills,
  sheetSentence,
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

// La planilla de gastos fijos (rediseño de oct 2026): una hoja por mes, con los
// renglones colgados del día en que vencen. No inventa cuentas: cada renglón
// es `recurringLine` y el número de arriba es `fixedProgress` (el del Resumen).

/** Martes. El 10/10 fue sábado; el 15/10 es jueves; el 10/11, martes. */
const TODAY = '2026-10-13'
const OCT = '2026-10'
const NOV = '2026-11'
/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
const $ = (text: string) => `$${NB}${text}`

const MISC = 'acc-varios'

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

/** HUB al 13/10: 31 sin monto, todos al 10/11, seis en «Gastos varios», dos con la cuota en el nombre. */
const HUB: RecurringExpenseRow[] = Array.from({ length: 31 }, (_, index) => {
  const n = index + 1
  const name =
    n === 1 ? 'Licuadora 6/6 USA cord' : n === 2 ? 'Colombraro bateas 1/3' : `Gasto fijo ${n}`
  return mk({
    id: `hub-${String(n).padStart(2, '0')}`,
    name,
    accountId: n >= 26 ? MISC : `acc-${n % 5}`,
    accountName: n >= 26 ? 'Gastos varios' : `Categoría ${n % 5}`,
  })
})

const sheetOf = (
  rows: readonly RecurringExpenseRow[],
  month = OCT,
  payments: ReadonlyMap<string, RecurringPaymentFacts> | null = null,
  canWrite = true,
) => buildSheet(rows, payments, { month, today: TODAY, miscAccountId: MISC, canWrite })

const itemOf = (row: RecurringExpenseRow, payments = new Map<string, RecurringPaymentFacts>()) => {
  const item = sheetOf([row], OCT, payments)
  const found = [...item.items, ...item.later, ...item.off][0]
  if (!found) throw new Error('la hoja no devolvió el renglón')
  return found
}

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

  it('cuelga cada renglón de su día, en orden de día y nombre', () => {
    expect(sheet.groups.map((g) => [g.day, g.place, g.items.map((i) => i.row.name)])).toEqual([
      ['2026-10-10', 'month', ['Alquiler del local', 'Dispenser Agua']],
      ['2026-10-15', 'month', ['Internet y teléfono']],
    ])
    expect(sheet.groups[0]).toMatchObject({ dueCents: 88_000_000, remainingCents: 88_000_000 })
    expect(sheet.later).toEqual([])
    expect(sheet.off).toEqual([])
  })

  it('cuenta lo vencido, lo que está por vencer y lo pago', () => {
    expect(sheet.counts).toEqual({
      todo: 3,
      vencido: 2,
      porVencer: 1,
      falta: 3,
      pagado: 0,
      sinMonto: 0,
      enCuotas: 0,
    })
  })

  it('lo que sigue: primero lo vencido, por fecha y por nombre', () => {
    expect(sheet.next?.row.name).toBe('Alquiler del local')
    expect(sheet.afterNext.map((i) => i.row.name)).toEqual([
      'Dispenser Agua',
      'Internet y teléfono',
    ])
    expect(nextUpView(sheet, { canWrite: true })).toMatchObject({
      kind: 'pay',
      name: 'Alquiler del local',
      amountCents: 85_000_000,
      action: { kind: 'gasto', recurringId: 'gf-alquiler' },
      billed: false,
      after: 'Después: Dispenser Agua y 1 más.',
    })
  })

  it('la oración de arriba cuenta cuántos son y cuánto venció', () => {
    expect(sheetSentence(sheet)).toEqual({
      kind: 'number',
      cents: 91_500_000,
      text: `Son 3 gastos de octubre. 2 ya vencieron: suman ${$('880.000')}.`,
      allPaid: false,
      noAmount: 0,
    })
  })
})

describe('pagar no mueve el renglón', () => {
  const paid = mk({
    ...ALQUILER,
    nextDueDate: '2026-11-10',
    loadedDue: '2026-10-10',
    lastDocumentId: 'doc-1',
    lastDocumentDate: '2026-10-08',
    monthStatus: undefined,
  })
  const payments = paidWith(
    'gf-alquiler',
    doc({ id: 'doc-1', totalCents: 85_000_000, paidCents: 85_000_000 }),
  )
  const before = sheetOf(DEMO)
  const after = sheetOf([paid, DISPENSER, INTERNET], OCT, payments)

  it('queda tildado en su lugar, colgado del mismo día', () => {
    expect(after.items.map((i) => i.row.id)).toEqual(before.items.map((i) => i.row.id))
    expect(after.groups.map((g) => g.day)).toEqual(before.groups.map((g) => g.day))
    const item = after.items[0] as SheetItem
    expect(item.line.state).toBe('paid')
    expect(item.doc?.id).toBe('doc-1')
    expect(tickState(item)).toBe('done')
    expect(rowTint(item)).toBe('ok')
    expect(rowWords(item, TODAY)).toMatchObject({ label: 'Pagado el 08/10', tone: 'ok' })
  })

  it('el número baja y lo que sigue pasa al próximo', () => {
    expect(after.progress.paidCents).toBe(85_000_000)
    expect(after.progress.remainingCents).toBe(6_500_000)
    expect(after.next?.row.name).toBe('Dispenser Agua')
    expect(sheetSentence(after)).toMatchObject({
      text: `Pagaste ${$('850.000')} de ${$('915.000')}. Te faltan 2.`,
    })
    expect(rowActions(item0(after), { canWrite: true }).pay).toBeNull()
  })

  it('con todo pago, el número queda en cero y se dice «al día»', () => {
    const allPaid = sheetOf([paid], OCT, payments)
    expect(sheetSentence(allPaid)).toEqual({
      kind: 'number',
      cents: 0,
      text: `Pagaste los ${$('850.000')} de gastos fijos de octubre.`,
      allPaid: true,
      noAmount: 0,
    })
    expect(nextUpView(allPaid, { canWrite: true })).toEqual({
      kind: 'all_paid',
      text: 'No queda nada por pagar en octubre.',
      nextMonth: NOV,
    })
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
    expect(rowWords(item, TODAY)).toMatchObject({ label: 'Este mes no se paga', tone: 'muted' })
    const actions = rowActions(item, { canWrite: true })
    expect(actions).toMatchObject({ pay: null, skip: false, unskip: true, bill: false })
  })
})

function item0(sheet: { items: SheetItem[] }): SheetItem {
  const item = sheet.items[0]
  if (!item) throw new Error('hoja vacía')
  return item
}

describe('la hoja del mes que viene', () => {
  it('lo pagado este mes es pendiente el que viene, y todavía no se ofrece pagarlo', () => {
    const paid = mk({
      ...ALQUILER,
      nextDueDate: '2026-11-10',
      loadedDue: '2026-10-10',
      lastDocumentId: 'doc-1',
      lastDocumentDate: '2026-10-08',
      monthStatus: undefined,
    })
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

  it('lo vencido de antes sigue vencido contra hoy y va arriba, con su fecha vieja', () => {
    const upcoming = mk({ id: 'gf-luz', name: 'Luz', amountCents: 12_000_000 })
    const sheet = sheetOf([upcoming, ALQUILER], NOV)
    expect(sheet.groups.map((g) => [g.day, g.place])).toEqual([
      ['2026-10-10', 'before'],
      ['2026-11-10', 'month'],
    ])
    expect(item0(sheet).line.state).toBe('overdue')
    expect(sheet.counts).toMatchObject({ vencido: 1, porVencer: 1 })
    // Mirando el mes que viene no hay botón: se dice lo primero que vence de ESE mes.
    expect(nextUpView(sheet, { canWrite: true })).toEqual({
      kind: 'first_due',
      when: 'Martes 10 de noviembre',
      detail: `1 gasto · ${$('120.000')}`,
      daysText: 'Faltan 28 días.',
    })
    // Y la oración no los mezcla: uno quedó de antes, el otro es de noviembre.
    expect(sheetSentence(sheet)).toMatchObject({
      text: 'Son 2 gastos: 1 quedó de antes sin pagar y 1 vence en noviembre.',
    })
  })

  it('si lo único que hay es lo que quedó de antes, se dice y lo que sigue es pagarlo', () => {
    // El bar de ejemplo en noviembre: los tres siguen sin pagar desde octubre.
    const sheet = sheetOf(DEMO, NOV)
    expect(sheet.groups.every((g) => g.place === 'before')).toBe(true)
    expect(sheetSentence(sheet)).toMatchObject({
      kind: 'number',
      cents: 91_500_000,
      text: 'Son los 3 que quedaron de antes sin pagar. Cuando los pagues, acá vas a ver los de noviembre.',
    })
    expect(nextUpView(sheet, { canWrite: true })).toMatchObject({
      kind: 'pay',
      name: 'Alquiler del local',
      amountCents: 85_000_000,
    })
    expect(sheetSentence(sheetOf([ALQUILER], NOV))).toMatchObject({
      text: 'Es el que quedó de antes sin pagar. Cuando lo pagues, acá vas a ver el de noviembre.',
    })
  })

  it('lo pagado por adelantado cuenta como pago de este mes y queda último', () => {
    const ahead = mk({
      ...ALQUILER,
      nextDueDate: '2026-12-10',
      loadedDue: '2026-11-10',
      lastDocumentId: 'doc-2',
      lastDocumentDate: '2026-10-02',
      monthStatus: undefined,
    })
    const payments = paidWith(
      'gf-alquiler',
      doc({
        id: 'doc-2',
        accountingDate: '2026-10-02',
        totalCents: 85_000_000,
        paidCents: 85_000_000,
      }),
    )
    const sheet = sheetOf([ahead, DISPENSER, INTERNET], OCT, payments)
    expect(sheet.groups.map((g) => [g.day, g.place])).toEqual([
      ['2026-10-10', 'month'],
      ['2026-10-15', 'month'],
      ['2026-11-10', 'ahead'],
    ])
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

  it('octubre está vacío: se abre noviembre sola y se dice', () => {
    expect(october.items).toHaveLength(0)
    expect(november.items).toHaveLength(31)
    expect(defaultSheetMonth(october, november)).toEqual({ month: NOV, auto: true })
    // Con algo en octubre se queda en octubre.
    expect(defaultSheetMonth(sheetOf(DEMO, OCT), sheetOf(DEMO, NOV))).toEqual({
      month: OCT,
      auto: false,
    })
  })

  it('no hay número: «Todavía no sé cuánto te falta» (nunca «$ 0»)', () => {
    expect(november.progress.state).toBe('no_amounts')
    expect(sheetSentence(november)).toEqual({
      kind: 'no_amounts',
      title: 'Todavía no sé cuánto te falta',
      text: 'Tenés 31 gastos fijos y ninguno tiene monto. Vencen el 10 de noviembre.',
    })
    expect(sheetSentence(october)).toEqual({
      kind: 'empty',
      title: 'En octubre no vence ninguno',
      text: 'Lo próximo es el 10 de noviembre: 31 gastos, todavía sin monto.',
      nextMonth: NOV,
    })
  })

  it('un solo grupo, sin filtros que valgan la pena y sin nada para dibujar', () => {
    expect(november.groups).toHaveLength(1)
    expect(november.groups[0]).toMatchObject({
      day: '2026-11-10',
      place: 'month',
      dueCents: 0,
      remainingCents: 0,
    })
    expect(november.counts).toMatchObject({ todo: 31, vencido: 0, porVencer: 31, sinMonto: 31 })
    // Los 31 están por vencer y sin monto: ninguna píldora filtraría nada.
    expect(sheetFilterPills(november)).toEqual([])
    expect(november.progress.countedRows).toBe(0)
    expect(dueStripDays(november).every((d) => d.cents === 0)).toBe(true)
    expect(categoryBars(november)).toEqual([])
    expect(paperSplit(november).defined).toBe(false)
  })

  it('«Para arrancar»: cuántos faltan, cuántos quedaron en «Gastos varios» y que todos dicen el 10', () => {
    expect(november.setup).toEqual({
      missing: 31,
      total: 31,
      misc: 6,
      sameDay: 10,
      everPaid: false,
    })
    expect(nextUpView(november, { canWrite: true })).toEqual({
      kind: 'setup',
      setup: november.setup,
    })
    // También mirando octubre, que está vacío: es la acción del momento.
    expect(nextUpView(october, { canWrite: true }).kind).toBe('setup')
  })

  it('quien solo mira no recibe pasos ni botones', () => {
    const readOnly = sheetOf(HUB, NOV, null, false)
    expect(readOnly.setup).toBeNull()
    expect(nextUpView(readOnly, { canWrite: false })).toEqual({
      kind: 'setup_readonly',
      text: '31 gastos fijos sin monto: todavía no se sabe cuánto falta.',
    })
  })

  it('en el renglón no hay «Pagar» (todavía no vencen): queda adentro, por adelantado', () => {
    const item = item0(november)
    expect(rowWords(item, TODAY)).toMatchObject({
      label: 'Sin monto',
      detail: 'vence el 10/11',
      text: 'Sin monto · vence el 10/11',
      tone: 'muted',
    })
    expect(rowActions(item, { canWrite: true })).toMatchObject({
      pay: { kind: 'gasto', recurringId: item.row.id },
      payInRow: false,
      payAhead: true,
      skip: false,
      bill: true,
      edit: true,
    })
    expect(november.next).toBeNull()
  })
})

describe('la frase de estado de cada renglón', () => {
  const words = (row: RecurringExpenseRow, payments?: Map<string, RecurringPaymentFacts>) =>
    rowWords(itemOf(row, payments), TODAY)

  it('sin nada cargado: cuándo vence o hace cuánto venció', () => {
    expect(words(ALQUILER)).toMatchObject({ label: 'Venció hace 3 días', tone: 'late' })
    expect(
      words(mk({ ...ALQUILER, nextDueDate: '2026-10-12', monthStatus: undefined })),
    ).toMatchObject({ label: 'Venció ayer', tone: 'late' })
    expect(words(mk({ ...ALQUILER, nextDueDate: TODAY, monthStatus: undefined }))).toMatchObject({
      label: 'Vence hoy',
      tone: 'warn',
    })
    expect(
      words(mk({ ...ALQUILER, nextDueDate: '2026-10-14', monthStatus: undefined })),
    ).toMatchObject({ label: 'Vence mañana', tone: 'warn' })
    // Dentro de los días de aviso (5): en ámbar y con el día de la semana.
    expect(words(INTERNET)).toMatchObject({ label: 'Vence el jueves 15/10', tone: 'warn' })
    // Más lejos es solo una fecha: en gris, sin píldora.
    expect(
      words(mk({ ...ALQUILER, nextDueDate: '2026-10-28', monthStatus: undefined })),
    ).toMatchObject({ label: 'Vence el 28/10', tone: null, detail: null })
    // Vencido hace más de un mes y medio: la fecha dice más que contar días.
    expect(
      words(mk({ ...ALQUILER, nextDueDate: '2026-08-10', monthStatus: undefined })),
    ).toMatchObject({ label: 'Venció el 10/08', tone: 'late' })
  })

  it('sin monto: cuándo vence, y en rojo solo si ya pasó', () => {
    expect(words(mk({ id: 'a', name: 'Luz', nextDueDate: '2026-10-20' }))).toMatchObject({
      text: 'Sin monto · vence el 20/10',
      tone: 'muted',
    })
    expect(words(mk({ id: 'a', name: 'Luz', nextDueDate: '2026-10-10' }))).toMatchObject({
      text: 'Sin monto · venció el 10/10',
      tone: 'late',
    })
  })

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

  it('pagaste menos que el monto: lo dice y arma la pregunta «¿Era eso?»', () => {
    const row = loaded({ amountCents: 18_000_000 })
    const payments = paidWith(
      row.id,
      doc({ id: 'doc-1', totalCents: 17_000_000, paidCents: 17_000_000 }),
    )
    const item = itemOf(row, payments)
    expect(rowWords(item, TODAY)).toMatchObject({
      label: `Pagaste ${$('170.000')}`,
      detail: `${$('10.000')} menos que el monto`,
      tone: 'warn',
      short: { expectedCents: 18_000_000, paidCents: 17_000_000 },
    })
    expect(rowTint(item)).toBe('warn')
    expect(tickState(item)).toBe('half')
    // Nunca «Pagar» con el comprobante saldado: otro gasto daría por cargado el mes que viene.
    expect(rowActions(item, { canWrite: true })).toMatchObject({
      pay: null,
      payInRow: false,
      ask: true,
      skip: false,
    })
    // Y no es «lo que sigue».
    expect(sheetOf([row], OCT, payments).next).toBeNull()
    expect(nextUpView(sheetOf([row], OCT, payments), { canWrite: true }).kind).toBe('review')
  })

  it('pagaste de más: figura pago, con lo que pagaste, y se ofrece usarlo de ahora en más', () => {
    const row = loaded({ amountCents: 18_000_000 })
    const payments = paidWith(
      row.id,
      doc({ id: 'doc-1', totalCents: 19_500_000, paidCents: 19_500_000 }),
    )
    const item = itemOf(row, payments)
    expect(rowWords(item, TODAY)).toMatchObject({
      label: 'Pagado el 08/10',
      detail: $('195.000'),
      tone: 'ok',
      short: null,
    })
    expect(rowActions(item, { canWrite: true })).toMatchObject({ ask: false, keepPaid: true })
  })

  it('con una factura cargada que todavía se debe: «Lo debés»', () => {
    const row = loaded()
    const owed = (over: Partial<RecurringDocument>) =>
      paidWith(row.id, doc({ id: 'doc-1', totalCents: 85_000_000, openCents: 85_000_000, ...over }))
    expect(words(row, owed({ dueDate: '2026-10-25' }))).toMatchObject({
      text: 'Lo debés · vence el 25/10',
      tone: 'warn',
    })
    expect(words(row, owed({ dueDate: '2026-10-10' }))).toMatchObject({
      text: 'Lo debés · venció hace 3 días',
      tone: 'late',
    })
    expect(
      words(row, owed({ dueDate: '2026-10-25', paidCents: 30_000_000, openCents: 55_000_000 })),
    ).toMatchObject({
      text: `Pagaste ${$('300.000')} · falta ${$('550.000')}`,
      tone: 'warn',
    })
    expect(
      words(row, owed({ dueDate: '2026-10-10', paidCents: 30_000_000, openCents: 55_000_000 })),
    ).toMatchObject({
      text: `Lo debés · venció hace 3 días · pagaste ${$('300.000')}, falta ${$('550.000')}`,
      tone: 'late',
    })
  })

  it('pausado, terminado, última cuota y deuda de antes', () => {
    expect(words(mk({ ...ALQUILER, active: false, monthStatus: undefined }))).toMatchObject({
      label: 'En pausa',
      tone: 'muted',
    })
    expect(
      words(
        mk({
          ...ALQUILER,
          active: false,
          ended: true,
          endsOn: '2026-09-10',
          remainingDues: 0,
          monthStatus: undefined,
        }),
      ),
    ).toMatchObject({ text: 'Terminó · la última cuota venció el 10/09', tone: 'muted' })
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
    expect(words(last, payments).extras).toEqual([
      'Era la última cuota',
      `Debés ${$('40.000')} de antes`,
    ])
  })
})

describe('cuándo hay «Pagar» y qué hace', () => {
  it('sin nada cargado y vencido o por vencer este mes: abre «Nuevo gasto» con el gasto fijo', () => {
    const actions = rowActions(itemOf(ALQUILER), { canWrite: true })
    expect(actions).toMatchObject({
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
    const base = mk({
      ...ALQUILER,
      nextDueDate: '2026-11-10',
      loadedDue: '2026-10-10',
      lastDocumentId: 'doc-1',
      lastDocumentDate: '2026-10-08',
      monthStatus: undefined,
    })
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
    // En «Lo que sigue» se paga lo que le falta a la factura.
    const next = nextUpView(sheetOf([withParty], OCT, owed), { canWrite: true })
    expect(next).toMatchObject({ kind: 'pay', billed: true, amountCents: 85_000_000 })
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
    const row = mk({
      ...ALQUILER,
      amountCents: 18_000_000,
      nextDueDate: '2026-11-10',
      loadedDue: '2026-10-10',
      lastDocumentId: 'doc-1',
      lastDocumentDate: '2026-10-08',
      breakdown: [{ label: 'Ana', kind: null, amountCents: 18_000_000 }],
      monthStatus: undefined,
    })
    const payments = paidWith(
      row.id,
      doc({ id: 'doc-1', totalCents: 17_000_000, paidCents: 17_000_000 }),
    )
    expect(rowActions(itemOf(row, payments), { canWrite: true }).ask).toBe(false)
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

describe('filtros de la planilla', () => {
  const installments = mk({
    id: 'gf-heladera',
    name: 'Heladera',
    amountCents: 12_000_000,
    nextDueDate: '2026-11-05',
    dueDay: 5,
    endsOn: '2027-03-05',
    remainingDues: 5,
    installmentsTotal: 6,
  })
  const noAmount = mk({ id: 'gf-luz', name: 'Luz', nextDueDate: '2026-10-20', dueDay: 20 })
  const sheet = sheetOf([...DEMO, installments, noAmount])

  it('solo se ofrecen las píldoras que filtran algo, con su cuenta', () => {
    expect(sheetFilterPills(sheet)).toEqual([
      { key: 'vencido', label: 'Vencido', count: 2 },
      { key: 'por-vencer', label: 'Por vencer', count: 2 },
      { key: 'sin-monto', label: 'Sin monto', count: 1 },
      { key: 'en-cuotas', label: 'En cuotas', count: 1 },
    ])
    expect(sheet.counts).toMatchObject({ sinMonto: 1, enCuotas: 1 })
  })

  it('la URL filtra por estado, categoría y papel de siempre', () => {
    const ids = (query: Parameters<typeof matchesSheetQuery>[1]) =>
      [...sheet.items, ...sheet.later]
        .filter((item) => matchesSheetQuery(item, query))
        .map((item) => item.row.id)
    const all = { ver: null, categoria: null, factura: null }
    expect(ids({ ...all, ver: 'vencido' })).toEqual(['gf-alquiler', 'gf-dispenser'])
    expect(ids({ ...all, ver: 'en-cuotas' })).toEqual(['gf-heladera'])
    expect(ids({ ...all, ver: 'sin-monto' })).toEqual(['gf-luz'])
    expect(ids({ ...all, categoria: 'acc-internet' })).toEqual(['gf-internet'])
    expect(ids({ ...all, factura: 'nose' })).toHaveLength(5)
    expect(ids({ ...all, factura: 'con' })).toEqual([])
  })

  it('lo que no es un filtro conocido se ignora', () => {
    expect(parseSheetFilter('vencido')).toBe('vencido')
    expect(parseSheetFilter('cualquiera')).toBeNull()
    expect(parseSheetFilter(null)).toBeNull()
    expect(parseInvoiceBucket('sin')).toBe('sin')
    expect(parseInvoiceBucket('todos')).toBeNull()
  })

  it('las cuotas se dicen con palabras, al lado de los puntitos', () => {
    expect(installmentWords({ current: 2, total: 6, remaining: 5 })).toBe('cuota 2 de 6')
    expect(installmentWords({ current: null, total: null, remaining: 3 })).toBe('quedan 3')
    expect(installmentWords({ current: null, total: null, remaining: 1 })).toBe('última cuota')
    expect(installmentWords(null)).toBeNull()
  })
})

describe('el papel de siempre', () => {
  it('se dice como en toda la sección: «Sin factura» nunca es otra cosa', () => {
    expect(papelLabel('factura_a')).toBe('Factura A')
    expect(papelLabel('tique')).toBe('Tique')
    expect(papelLabel('sin_comprobante')).toBe('Sin factura')
    expect(papelLabel(null)).toBeNull()
    expect(invoiceBucket('factura_c')).toBe('con')
    expect(invoiceBucket('sin_comprobante')).toBe('sin')
    expect(invoiceBucket(null)).toBe('nose')
  })

  it('la línea gris del renglón escribe solo lo que está cargado', () => {
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
})

describe('los dibujos: cuándo aparecen y qué afirman', () => {
  const sheet = sheetOf(DEMO)

  it('qué días se te va la plata: todos los días del mes, con lo que falta', () => {
    const days = dueStripDays(sheet)
    expect(days).toHaveLength(31)
    expect(days.filter((d) => d.cents > 0)).toEqual([
      { date: '2026-10-10', cents: 88_000_000, count: 2, overdue: true },
      { date: '2026-10-15', cents: 3_500_000, count: 1, overdue: false },
    ])
    expect(dueTitle(days)).toBe(`Tenés ${$('880.000')} vencidos del 10`)
    // Sin vencidos, el día más cargado.
    expect(dueTitle(days.filter((d) => !d.overdue))).toBe(`El 15 se te van ${$('35.000')}`)
    expect(dueTitle([])).toBe('Este mes no queda nada por vencer')
  })

  it('lo vencido de un mes anterior va adelante, con su fecha', () => {
    const old = mk({ ...ALQUILER, nextDueDate: '2026-09-10', monthStatus: undefined })
    const days = dueStripDays(sheetOf([old, INTERNET]))
    expect(days[0]).toEqual({ date: '2026-09-10', cents: 85_000_000, count: 1, overdue: true })
    expect(days).toHaveLength(32)
  })

  it('en qué se va lo fijo: por categoría, de mayor a menor', () => {
    const bars = categoryBars(sheet)
    expect(bars).toEqual([
      { id: 'acc-alquiler', name: 'Alquiler', cents: 85_000_000, count: 1 },
      { id: 'acc-internet', name: 'Internet', cents: 3_500_000, count: 1 },
      { id: 'acc-plazos', name: 'Plazos fijos en pesos', cents: 3_000_000, count: 1 },
    ])
    expect(categoryTitle(bars)).toBe('Lo que más se lleva de lo fijo: Alquiler (93 %)')
    // Suma lo mismo que el total de arriba.
    expect(bars.reduce((sum, b) => sum + b.cents, 0)).toBe(sheet.progress.totalCents)
  })

  it('con qué papel pagás lo fijo: solo si alguno tiene papel de siempre', () => {
    expect(paperSplit(sheet)).toEqual({
      conCents: 0,
      sinCents: 0,
      noseCents: 91_500_000,
      defined: false,
    })
    const mixed = sheetOf([
      { ...ALQUILER, voucherType: 'sin_comprobante' },
      DISPENSER,
      { ...INTERNET, voucherType: 'factura_a' },
    ])
    const split = paperSplit(mixed)
    expect(split).toEqual({
      conCents: 3_500_000,
      sinCents: 85_000_000,
      noseCents: 3_000_000,
      defined: true,
    })
    expect(paperTitle(split)).toBe(`${$('35.000')} de lo fijo van con factura`)
    expect(paperTitle({ ...split, conCents: 0 })).toBe(`${$('850.000')} de lo fijo van sin factura`)
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
  it('sin ningún gasto fijo: hoja vacía, sin número y sin nada que hacer', () => {
    const sheet = sheetOf([])
    expect(sheet.items).toEqual([])
    expect(sheet.progress.state).toBe('empty')
    expect(sheetSentence(sheet)).toMatchObject({ kind: 'empty', nextMonth: null })
    expect(nextUpView(sheet, { canWrite: true })).toEqual({ kind: 'none' })
    expect(sheetFilterPills(sheet)).toEqual([])
  })

  it('un solo gasto, de nueve cifras y con un nombre de 60 caracteres', () => {
    const name = 'Mantenimiento integral de cámaras, freezers y heladeras 2026'
    const big = mk({ id: 'gf-big', name, amountCents: 99_999_999_900, nextDueDate: '2026-10-20' })
    const sheet = sheetOf([big])
    expect(sheetSentence(sheet)).toMatchObject({
      cents: 99_999_999_900,
      text: 'Es un solo gasto de octubre. Vence el martes 20/10.',
    })
    expect(nextUpView(sheet, { canWrite: true })).toMatchObject({
      kind: 'pay',
      name,
      amountCents: 99_999_999_900,
      after: null,
    })
    expect(categoryTitle(categoryBars(sheet))).toBe(
      'Lo que más se lleva de lo fijo: Alquiler (100 %)',
    )
  })

  it('un gasto con monto y otro sin: el que no tiene monto no suma y se avisa', () => {
    const blank = mk({ id: 'gf-luz', name: 'Luz', nextDueDate: '2026-10-20', dueDay: 20 })
    const sheet = sheetOf([INTERNET, blank])
    expect(sheetSentence(sheet)).toMatchObject({ kind: 'number', cents: 3_500_000, noAmount: 1 })
    expect(sheet.setup).toMatchObject({ missing: 1, total: 2, sameDay: null })
  })
})
