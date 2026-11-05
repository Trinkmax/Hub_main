/**
 * Arma la planilla de gastos fijos de un mes a partir de lo que ya se lee hoy
 * (`listRecurringExpenses` + `listRecurringPayments`): los renglones en orden de
 * vencimiento, lo que no vence ese mes, lo pausado y el número del Resumen. Corre
 * en el server (usa `recurringMonthStatus`, que vive con las lecturas); las
 * palabras y los tipos están en `planilla-words.ts`, que también usan las islas
 * cliente.
 *
 * No inventa ninguna cuenta: cada renglón es `recurringLine` y el total es
 * `fixedProgress`, el MISMO del Resumen. Para mirar el mes que viene no se vuelve
 * a leer nada: a cada gasto se le re-deriva «este mes» parado en el día 1 de ese
 * mes, con la regla de siempre; «vencido» se sigue midiendo contra el hoy real.
 * Lo prueba `administracion-gastos-fijos-planilla.test.ts`.
 */

import { fixedProgress, type RecurringPayments } from '@/lib/accounting/home'
import { type RecurringExpenseRow, recurringMonthStatus } from '@/lib/accounting/queries/documents'
import { type RecurringPaymentFacts, recurringLine } from '@/lib/accounting/recurring-status'
import { addMonthsToYearMonth, isRealYearMonth, monthOf } from '@/lib/dates'
import type { Sheet, SheetItem, SheetStretch } from './planilla-words'

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
 */
export function buildSheet(
  rows: readonly RecurringExpenseRow[],
  payments: RecurringPayments | null | undefined,
  opts: { month: string; today: string },
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

  const stretches: SheetStretch[] = []
  for (const item of items) {
    const itemMonth = monthOf(item.day)
    const place = itemMonth < month ? 'before' : itemMonth > month ? 'ahead' : 'month'
    const stretch = stretches[stretches.length - 1]
    if (stretch?.place === place) stretch.items.push(item)
    else stretches.push({ place, items: [item] })
  }

  return {
    month,
    isCurrent,
    today,
    items,
    stretches,
    later,
    off,
    progress: fixedProgress(viewed, payments, today),
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
