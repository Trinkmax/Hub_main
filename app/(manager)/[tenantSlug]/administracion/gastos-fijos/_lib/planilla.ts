/**
 * Arma la planilla de gastos fijos de un mes a partir de lo que ya se lee hoy
 * (`listRecurringExpenses` + `listRecurringPayments`): los renglones colgados
 * del día en que vencen, lo que no vence ese mes, lo pausado, el número de
 * arriba y lo que alimenta a los tres dibujos. Corre en el server (usa
 * `recurringMonthStatus`, que vive con las lecturas); las palabras y los tipos
 * están en `planilla-words.ts`, que también usan las islas cliente.
 *
 * No inventa ninguna cuenta: cada renglón es `recurringLine` y el número de
 * arriba es `fixedProgress`, el MISMO del Resumen. Para mirar el mes que viene
 * no se vuelve a leer nada: a cada gasto se le re-deriva «este mes» parado en
 * el día 1 de ese mes, con la regla de siempre; «vencido» se sigue midiendo
 * contra el hoy real. Lo prueba `administracion-gastos-fijos-planilla.test.ts`.
 */

import { fixedProgress, type RecurringPayments } from '@/lib/accounting/home'
import { type RecurringExpenseRow, recurringMonthStatus } from '@/lib/accounting/queries/documents'
import { type RecurringPaymentFacts, recurringLine } from '@/lib/accounting/recurring-status'
import { addMonthsToYearMonth, eachIsoDay, endOfMonth, isRealYearMonth, monthOf } from '@/lib/dates'
import {
  type CategoryBar,
  type DueDay,
  invoiceBucket,
  type PaperSplit,
  rowActions,
  type Sheet,
  type SheetGroup,
  type SheetItem,
  sheetCarry,
} from './planilla-words'

function factsOf(
  payments: RecurringPayments | null | undefined,
  id: string,
): RecurringPaymentFacts | null {
  if (!payments) return null
  if (payments instanceof Map) return payments.get(id) ?? null
  return (payments as Readonly<Record<string, RecurringPaymentFacts>>)[id] ?? null
}

const byName = (a: SheetItem, b: SheetItem) =>
  a.row.name.localeCompare(b.row.name, 'es') || (a.row.id < b.row.id ? -1 : 1)
const byDayThenName = (a: SheetItem, b: SheetItem) =>
  a.day < b.day ? -1 : a.day > b.day ? 1 : byName(a, b)

/**
 * `?mes=`: solo el mes de hoy o el que viene. Cualquier otra cosa (un mes
 * pasado, un texto) es `null` y la pantalla abre el de por defecto.
 */
export function parseSheetMonth(raw: string | null | undefined, today: string): string | null {
  if (!raw || !isRealYearMonth(raw)) return null
  const current = monthOf(today)
  return raw === current || raw === addMonthsToYearMonth(current, 1) ? raw : null
}

/**
 * El mes que se abre sin `?mes=`: el de hoy, salvo que su hoja no tenga ningún
 * renglón y la del mes que viene sí (un bar que recién cargó su lista: todo
 * vence el mes próximo). `auto` avisa que se abrió sola, para decirlo.
 */
export function defaultSheetMonth(
  current: Pick<Sheet, 'month' | 'items'>,
  next: Pick<Sheet, 'month' | 'items'>,
): { month: string; auto: boolean } {
  return current.items.length === 0 && next.items.length > 0
    ? { month: next.month, auto: true }
    : { month: current.month, auto: false }
}

/**
 * La hoja de un mes.
 *
 * - `rows`: todos los gastos fijos (`includeInactive: true`), con el «este mes» de hoy.
 * - `month`: el de hoy o el siguiente.
 * - `miscAccountId`: la cuenta «Gastos varios», para avisar cuáles quedaron ahí.
 * - `canWrite`: solo quien carga recibe `setup` (los pasos para arrancar).
 */
export function buildSheet(
  rows: readonly RecurringExpenseRow[],
  payments: RecurringPayments | null | undefined,
  opts: { month: string; today: string; miscAccountId?: string | null; canWrite?: boolean },
): Sheet {
  const { month, today } = opts
  const isCurrent = month === monthOf(today)
  // Mirar el mes que viene = «cómo se va a ver esta pantalla el día 1».
  const viewDay = isCurrent ? today : `${month}-01`

  const viewed = rows.map((row) =>
    isCurrent
      ? row
      : {
          ...row,
          monthStatus: recurringMonthStatus({
            nextDueDate: row.nextDueDate,
            frequency: row.frequency,
            dueDay: row.dueDay,
            lastDocumentDate: row.lastDocumentDate,
            loadedDue: row.loadedDue,
            skippedDue: row.skippedDue,
            today: viewDay,
          }),
        },
  )

  const all: SheetItem[] = viewed.map((row, index) => {
    const facts = factsOf(payments, row.id)
    // «Vencido» es siempre contra el hoy real.
    const line = recurringLine(row, facts, today)
    const document = facts?.document ?? null
    const doc = document !== null && document.id === line.documentId ? document : null
    const day =
      line.state === 'skipped'
        ? (row.skippedDue ?? line.dueDate ?? row.nextDueDate)
        : (line.dueDate ?? row.nextDueDate)
    return { row, line, doc, realStatus: rows[index]?.monthStatus ?? row.monthStatus, day }
  })

  const items: SheetItem[] = []
  const later: SheetItem[] = []
  const off: SheetItem[] = []
  for (const item of all) {
    const { state } = item.line
    if (state === 'paused' || state === 'ended') off.push(item)
    else if (state === 'upcoming') later.push(item)
    else items.push(item)
  }
  // Orden estable: pagar, cambiar el monto o marcar «este mes no se paga» no mueve el renglón.
  items.sort(byDayThenName)
  later.sort(byDayThenName)
  off.sort(byName)

  const groups: SheetGroup[] = []
  for (const item of items) {
    let group = groups[groups.length - 1]
    if (!group || group.day !== item.day) {
      const itemMonth = monthOf(item.day)
      group = {
        day: item.day,
        place: itemMonth < month ? 'before' : itemMonth > month ? 'ahead' : 'month',
        items: [],
        remainingCents: 0,
        dueCents: 0,
      }
      groups.push(group)
    }
    group.items.push(item)
    group.remainingCents += item.line.remainingCents ?? 0
    if (item.line.remainingCents !== null) group.dueCents += item.line.dueCents ?? 0
  }

  const progress = fixedProgress(viewed, payments, today)

  const overdue = (item: SheetItem) =>
    item.line.state === 'overdue' || (item.line.state === 'no_amount' && item.line.pastDue)
  const dueSoon = (item: SheetItem) =>
    item.line.state === 'unpaid' ||
    item.line.state === 'partial' ||
    (item.line.state === 'no_amount' && !item.line.pastDue)
  const vencido = items.filter(overdue).length
  const porVencer = items.filter(dueSoon).length

  // Lo que sigue: solo lo que se puede pagar (nunca uno con el comprobante ya saldado).
  const payable = items
    .filter((item) => rowActions(item, { canWrite: true }).payInRow)
    .sort((a, b) => Number(overdue(b)) - Number(overdue(a)) || byDayThenName(a, b))

  const live = rows.filter((row) => row.active && !row.ended)
  const firstDay = live[0]?.dueDay ?? null
  const sameDay =
    firstDay !== null && live.length >= 5 && live.every((row) => row.dueDay === firstDay)
      ? firstDay
      : null

  return {
    month,
    isCurrent,
    today,
    items,
    groups,
    later,
    off,
    progress,
    counts: {
      todo: items.length,
      vencido,
      porVencer,
      falta: vencido + porVencer,
      pagado: items.filter((item) => item.line.state === 'paid').length,
      sinMonto: progress.missingAmount,
      enCuotas: [...items, ...later].filter((item) => item.line.installment !== null).length,
    },
    next: payable[0] ?? null,
    afterNext: payable.slice(1, 3),
    setup: opts.canWrite
      ? {
          missing: live.filter((row) => row.amountCents === null).length,
          total: live.length,
          misc: opts.miscAccountId
            ? live.filter((row) => row.accountId === opts.miscAccountId).length
            : 0,
          sameDay,
          everPaid: rows.some((row) => row.lastDocumentId !== null),
        }
      : null,
    // Se anuló el último pago y la base dejó el vencimiento corrido (nada lo devuelve sola).
    // Si después se marcó «este mes no se paga», el corrimiento es ese y no hay nada que avisar.
    voided: all.filter(
      ({ row }) =>
        row.lastDocumentId !== null &&
        row.lastDocumentDate === null &&
        row.loadedDue !== null &&
        row.loadedDue < row.nextDueDate &&
        !(row.skippedDue !== null && row.skippedDue >= row.loadedDue),
    ),
  }
}

// ─── Los dibujos ─────────────────────────────────────────────────────────────

/**
 * Lo que entra a los dibujos: los renglones del mes que se mira. Mirando el mes
 * que viene, lo que quedó de antes sin pagar no es «lo fijo de noviembre»:
 * queda afuera (la cabecera lo dice aparte, con su link a la hoja de hoy).
 */
export function chartScope(sheet: Sheet): Pick<Sheet, 'month' | 'today' | 'items' | 'groups'> {
  const carry = sheetCarry(sheet)
  if (!carry) return sheet
  const own = new Set(carry.own)
  return {
    month: sheet.month,
    today: sheet.today,
    items: carry.own,
    groups: sheet.groups.flatMap((group) => {
      const items = group.items.filter((item) => own.has(item))
      if (items.length === 0) return []
      return [
        {
          ...group,
          items,
          remainingCents: items.reduce((sum, item) => sum + (item.line.remainingCents ?? 0), 0),
          dueCents: items.reduce(
            (sum, item) =>
              sum + (item.line.remainingCents !== null ? (item.line.dueCents ?? 0) : 0),
            0,
          ),
        },
      ]
    }),
  }
}

/** Los días que tienen algo sin pagar, uno por uno y en orden (es lo que lista la tabla). */
export function dueDays(sheet: Pick<Sheet, 'today' | 'groups'>): DueDay[] {
  const days: DueDay[] = []
  for (const group of sheet.groups) {
    const pending = group.items.filter((item) => (item.line.remainingCents ?? 0) > 0)
    if (pending.length === 0) continue
    days.push({
      date: group.day,
      cents: pending.reduce((sum, item) => sum + (item.line.remainingCents ?? 0), 0),
      count: pending.length,
      overdue: group.day < sheet.today,
    })
  }
  return days.sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** Lo de otros meses, junto en UNA columna: en el eje va con palabras, no con un día suelto. */
function joinOutside(days: readonly DueDay[], outside: NonNullable<DueDay['outside']>): DueDay[] {
  const first = days[0]
  if (!first) return []
  return [
    {
      date: first.date,
      cents: days.reduce((sum, d) => sum + d.cents, 0),
      count: days.reduce((sum, d) => sum + d.count, 0),
      overdue: days.some((d) => d.overdue),
      outside,
    },
  ]
}

/**
 * Lo que falta pagar, para el dibujo: todos los días del mes y, adelante, una
 * sola columna con lo que quedó de meses anteriores («Antes»). Un «10» de
 * septiembre puesto antes del día 1 es un eje que miente.
 */
export function dueStripDays(sheet: Pick<Sheet, 'month' | 'today' | 'groups'>): DueDay[] {
  const days = dueDays(sheet)
  const byDay = new Map(days.map((d) => [d.date, d]))
  const first = `${sheet.month}-01`
  const last = endOfMonth(sheet.month)
  const inside = eachIsoDay(first, last).map(
    (date) => byDay.get(date) ?? { date, cents: 0, count: 0, overdue: date < sheet.today },
  )
  return [
    ...joinOutside(
      days.filter((d) => d.date < first),
      'before',
    ),
    ...inside,
    ...joinOutside(
      days.filter((d) => d.date > last),
      'after',
    ),
  ]
}

/** Los que entran en la cuenta del mes (con monto conocido). Lo demás no se dibuja. */
function countedItems(sheet: Pick<Sheet, 'items'>): SheetItem[] {
  return sheet.items.filter(
    (item) => item.line.remainingCents !== null && item.line.paidCents !== null,
  )
}

/** Lo que pesa cada renglón en el mes: lo pagado más lo que falta (suma el total de arriba). */
const weight = (item: SheetItem) => (item.line.paidCents ?? 0) + (item.line.remainingCents ?? 0)

/** Lo fijo del mes por categoría, de mayor a menor. */
export function categoryBars(sheet: Pick<Sheet, 'items'>): CategoryBar[] {
  const bars = new Map<string, CategoryBar>()
  for (const item of countedItems(sheet)) {
    const cents = weight(item)
    if (cents <= 0) continue
    const bar = bars.get(item.row.accountId)
    if (bar) {
      bar.cents += cents
      bar.count += 1
    } else {
      bars.set(item.row.accountId, {
        id: item.row.accountId,
        name: item.row.accountName ?? 'Sin categoría',
        cents,
        count: 1,
      })
    }
  }
  return [...bars.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name, 'es'))
}

/** Lo fijo del mes según el papel de siempre: con factura, sin factura o sin definir. */
export function paperSplit(sheet: Pick<Sheet, 'items'>): PaperSplit {
  const split: PaperSplit = { conCents: 0, sinCents: 0, noseCents: 0, defined: false }
  for (const item of countedItems(sheet)) {
    const bucket = invoiceBucket(item.row.voucherType)
    const cents = weight(item)
    if (bucket === 'con') split.conCents += cents
    else if (bucket === 'sin') split.sinCents += cents
    else split.noseCents += cents
    if (bucket !== 'nose' && cents > 0) split.defined = true
  }
  return split
}

/** Los renglones con monto del mes que no entran a los dibujos por no tener monto. */
export function missingFromCharts(sheet: Pick<Sheet, 'items'>): number {
  return sheet.items.filter((item) => item.line.state === 'no_amount').length
}
