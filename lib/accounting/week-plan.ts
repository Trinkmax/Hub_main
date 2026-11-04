/**
 * El Plan de la semana: la planilla «Pagos Proveedores» de Tomi (reunión del 29/10/2026, min. 33).
 * Cada lunes se presupuesta cuánto pagarle a cada proveedor esa semana y se controla contra lo que se
 * compró y se pagó de verdad. Puro: lo usan la página, la planilla (cliente), la hoja «Pago» y los
 * tests. La plata va en centavos; la pantalla muestra y pide pesos.
 *
 * Es un presupuesto, no contabilidad: no mueve ningún saldo (`acc_payment_budgets`).
 */

import { z } from 'zod'
import {
  addDays,
  endOfWeek,
  formatDayMonth,
  isRealIsoDay,
  isRealYearMonth,
  monthOf,
  monthRange,
  startOfWeek,
  weekdayOf,
} from '@/lib/dates'
import { MONEY_MAX_CENTS, moneyParseMessage, parseMoneyToCents } from '@/lib/money'

// ─── Lo que devuelve la base ─────────────────────────────────────────────────

/** Una fila de `acc_report_week_plan`. */
export type WeekPlanRow = {
  partyId: string
  partyName: string
  partyKind: string
  defaultVoucherType: string | null
  debtCents: number
  overdueCents: number
  /** Compras y notas de débito menos notas de crédito, más lo pagado en el momento. */
  purchasedCents: number
  /** Pagos, más lo pagado en el momento. */
  paidCents: number
  budgetCents: number
}

/** Un proveedor para «+ Agregar proveedor». */
export type PlanParty = {
  id: string
  name: string
  tradeName: string | null
  taxId: string | null
}

/** Una celda que se guarda. */
export type BudgetItem = { partyId: string; amountCents: number }

// ─── La semana (arranca el lunes) ────────────────────────────────────────────

export function isMonday(value: unknown): value is string {
  return isRealIsoDay(value) && weekdayOf(value) === 1
}

/** El lunes de una fecha. */
export function mondayOf(iso: string): string {
  return startOfWeek(iso)
}

export function addWeeks(monday: string, weeks: number): string {
  return addDays(monday, weeks * 7)
}

/** `?semana=` → el lunes de esa fecha. Una fecha que no existe vuelve a la semana de hoy. */
export function parseWeekParam(raw: string | null | undefined, today: string): string {
  return mondayOf(isRealIsoDay(raw) ? raw : today)
}

/** «Semana del 02/11 al 08/11». */
export function weekLabel(monday: string): string {
  return `Semana del ${formatDayMonth(monday)} al ${formatDayMonth(endOfWeek(monday))}`
}

/** `?mes=` → `yyyy-MM`. Sin un mes que exista, el de `fallbackDay`. */
export function parseMonthParam(raw: string | null | undefined, fallbackDay: string): string {
  return isRealYearMonth(raw) ? raw : monthOf(fallbackDay)
}

/**
 * Las semanas de un mes: las que ARRANCAN (su lunes) en ese mes. Así cada semana es de un solo mes
 * y sumar los meses da lo mismo que sumar las semanas; la que cruza de mes va con el del lunes.
 */
export function weeksOfMonth(month: string): string[] {
  if (!isRealYearMonth(month)) return []
  const { from, to } = monthRange(month)
  const first = weekdayOf(from) === 1 ? from : addDays(startOfWeek(from), 7)
  const weeks: string[] = []
  for (let monday = first; monday <= to; monday = addDays(monday, 7)) weeks.push(monday)
  return weeks
}

// ─── La celda ────────────────────────────────────────────────────────────────

/**
 * Lo que se escribe en una celda, en pesos → centavos. Vacía es cero: es como se saca un presupuesto
 * de una fila. Lo que no se lee vuelve con su mensaje y no se guarda.
 */
export function parseBudgetCell(
  text: string,
): { ok: true; cents: number } | { ok: false; message: string } {
  if (text.trim() === '') return { ok: true, cents: 0 }
  const parsed = parseMoneyToCents(text, { maxCents: MONEY_MAX_CENTS })
  return parsed.ok
    ? { ok: true, cents: parsed.cents }
    : { ok: false, message: moneyParseMessage(parsed, text) }
}

// ─── Lo que falta ────────────────────────────────────────────────────────────

export type PlanLeft =
  /** Sin presupuesto: no hay contra qué medir. */
  | { kind: 'none' }
  | { kind: 'left'; cents: number }
  /** «Listo»: llegó justo. */
  | { kind: 'done' }
  /** «Te pasaste $ X». */
  | { kind: 'over'; cents: number }

/** Lo que dice la columna «Falta» de una fila. */
export function planLeft(budgetCents: number, paidCents: number): PlanLeft {
  if (budgetCents <= 0) return { kind: 'none' }
  const left = budgetCents - paidCents
  if (left > 0) return { kind: 'left', cents: left }
  return left === 0 ? { kind: 'done' } : { kind: 'over', cents: -left }
}

export type WeekPlanTotals = {
  debtCents: number
  overdueCents: number
  purchasedCents: number
  budgetCents: number
  paidCents: number
  /** Lo que falta pagar de la semana: nunca menos que cero. */
  remainingCents: number
  /** Cuánto se pasó de lo presupuestado (`0` sin presupuesto o sin pasarse). */
  overCents: number
  /** Cuánto del presupuesto ya se pagó, de 0 a 100. */
  percent: number
}

/**
 * La suma de la planilla, con los mismos números que el totalizador y la fila de total. Lo que se
 * pagó cuenta aunque no tuviera presupuesto: es plata que salió esa semana.
 */
export function weekPlanTotals(rows: readonly WeekPlanRow[]): WeekPlanTotals {
  let debtCents = 0
  let overdueCents = 0
  let purchasedCents = 0
  let budgetCents = 0
  let paidCents = 0
  for (const row of rows) {
    debtCents += row.debtCents
    overdueCents += row.overdueCents
    purchasedCents += row.purchasedCents
    budgetCents += row.budgetCents
    paidCents += row.paidCents
  }
  const hasBudget = budgetCents > 0
  return {
    debtCents,
    overdueCents,
    purchasedCents,
    budgetCents,
    paidCents,
    remainingCents: Math.max(0, budgetCents - paidCents),
    overCents: hasBudget ? Math.max(0, paidCents - budgetCents) : 0,
    percent: hasBudget
      ? Math.min(100, Math.max(0, Math.round((paidCents / budgetCents) * 100)))
      : 0,
  }
}

/**
 * «Paga al recibir»: los que no quedan debiendo, como la gaseosa, que viene una vez por semana y se
 * paga en el momento. Sin deuda y con un presupuesto para esa compra, o con lo comprado ya pagado.
 * Quien solo terminó de pagar una deuda vieja (pagó sin comprar) no es de estos.
 */
export function paysOnReceipt(
  row: Pick<WeekPlanRow, 'debtCents' | 'purchasedCents' | 'paidCents' | 'budgetCents'>,
): boolean {
  if (row.debtCents > 0) return false
  if (row.purchasedCents > 0) return row.paidCents >= row.purchasedCents
  return row.budgetCents > 0 && row.paidCents === 0
}

// ─── Lo que cambian los botones del pie ──────────────────────────────────────

/** «Traer lo vencido»: el presupuesto pasa a ser lo vencido en las filas donde lo vencido es mayor. */
export function overdueBudgetItems(rows: readonly WeekPlanRow[]): BudgetItem[] {
  return rows
    .filter((row) => row.overdueCents > row.budgetCents)
    .map((row) => ({ partyId: row.partyId, amountCents: row.overdueCents }))
}

/**
 * «Copiar la semana pasada»: lo presupuestado la semana pasada, en las filas de esta semana que
 * todavía están en cero. Lo que ya se escribió en esta semana no se pisa.
 */
export function copyBudgetItems(
  current: readonly Pick<WeekPlanRow, 'partyId' | 'budgetCents'>[],
  previous: readonly Pick<WeekPlanRow, 'partyId' | 'budgetCents'>[],
): BudgetItem[] {
  const already = new Map(current.map((row) => [row.partyId, row.budgetCents]))
  return previous
    .filter((row) => row.budgetCents > 0 && (already.get(row.partyId) ?? 0) === 0)
    .map((row) => ({ partyId: row.partyId, amountCents: row.budgetCents }))
}

/** Lo que hay que volver a guardar para deshacer unos cambios: el valor que tenía cada celda. */
export function restoreItems(
  items: readonly BudgetItem[],
  budgetOf: (partyId: string) => number,
): BudgetItem[] {
  return items.map((item) => ({ partyId: item.partyId, amountCents: budgetOf(item.partyId) }))
}

// ─── La planilla no salta mientras se escribe ────────────────────────────────

/**
 * El orden y los nombres de las filas mientras la planilla está abierta. La base ordena por
 * presupuesto: si la fila se moviera al guardar, Enter bajaría a cualquier lado. Una fila que deja
 * de venir (se le borró el presupuesto y no debe nada) sigue a la vista, en cero.
 */
export type PlanLayout = {
  source: readonly WeekPlanRow[]
  ids: readonly string[]
  names: ReadonlyMap<string, string>
}

export function initialPlanLayout(rows: readonly WeekPlanRow[]): PlanLayout {
  return {
    source: rows,
    ids: rows.map((row) => row.partyId),
    names: new Map(rows.map((row) => [row.partyId, row.partyName])),
  }
}

/** Llegaron filas nuevas de la base: las que ya estaban no se mueven; las nuevas, al final. */
export function nextPlanLayout(layout: PlanLayout, rows: readonly WeekPlanRow[]): PlanLayout {
  const known = new Set(layout.ids)
  const names = new Map(layout.names)
  for (const row of rows) names.set(row.partyId, row.partyName)
  return {
    source: rows,
    ids: [...layout.ids, ...rows.map((row) => row.partyId).filter((id) => !known.has(id))],
    names,
  }
}

/** «+ Agregar proveedor»: una fila más, al final. Si ya estaba, queda donde está. */
export function addToPlanLayout(
  layout: PlanLayout,
  party: { partyId: string; partyName: string },
): PlanLayout {
  if (layout.ids.includes(party.partyId)) return layout
  const names = new Map(layout.names)
  names.set(party.partyId, party.partyName)
  return { ...layout, ids: [...layout.ids, party.partyId], names }
}

/** Las filas a la vista: en el orden de la planilla y con lo que se escribió encima. */
export function planRows(
  layout: PlanLayout,
  rows: readonly WeekPlanRow[],
  overrides: ReadonlyMap<string, number>,
): WeekPlanRow[] {
  const byId = new Map(rows.map((row) => [row.partyId, row]))
  return layout.ids.map((id) => {
    const row: WeekPlanRow = byId.get(id) ?? {
      partyId: id,
      partyName: layout.names.get(id) ?? 'Proveedor',
      partyKind: 'supplier',
      defaultVoucherType: null,
      debtCents: 0,
      overdueCents: 0,
      purchasedCents: 0,
      paidCents: 0,
      budgetCents: 0,
    }
    const override = overrides.get(id)
    return override === undefined ? row : { ...row, budgetCents: override }
  })
}

/** Lo escrito que la base ya confirmó no hace falta seguir pisándolo. */
export function pruneOverrides(
  overrides: ReadonlyMap<string, number>,
  rows: readonly WeekPlanRow[],
): ReadonlyMap<string, number> {
  if (overrides.size === 0) return overrides
  const byId = new Map(rows.map((row) => [row.partyId, row.budgetCents]))
  const next = new Map(overrides)
  for (const [id, cents] of overrides) {
    // Una fila que no vino está en cero en la base.
    if ((byId.get(id) ?? 0) === cents) next.delete(id)
  }
  return next.size === overrides.size ? overrides : next
}

/**
 * Un guardado que falló: esas celdas vuelven a lo que dice la base. `isLatest` deja afuera las que se
 * volvieron a escribir después: lo último que se escribió no lo pisa un guardado viejo.
 */
export function revertOverrides(
  overrides: ReadonlyMap<string, number>,
  items: readonly BudgetItem[],
  isLatest: (partyId: string) => boolean,
): ReadonlyMap<string, number> {
  const next = new Map(overrides)
  for (const item of items) if (isLatest(item.partyId)) next.delete(item.partyId)
  return next
}

// ─── El mes ──────────────────────────────────────────────────────────────────

export type MonthPlanCell = { purchasedCents: number; budgetCents: number; paidCents: number }

export type MonthPlanRow = {
  partyId: string
  partyName: string
  /** Una por semana, en el orden de `MonthPlan.weeks`. */
  cells: MonthPlanCell[]
  budgetCents: number
  paidCents: number
  /** Pagado menos presupuesto: positivo es que se pasó. */
  variationCents: number
}

export type MonthPlan = {
  month: string
  /** Los lunes del mes. */
  weeks: string[]
  rows: MonthPlanRow[]
  totals: {
    cells: MonthPlanCell[]
    budgetCents: number
    paidCents: number
    variationCents: number
  }
}

const EMPTY_CELL: MonthPlanCell = { purchasedCents: 0, budgetCents: 0, paidCents: 0 }

/**
 * Las semanas puestas una al lado de la otra. Solo entran los proveedores con algo en el mes: la
 * base trae también a los que solo tienen deuda, y una fila de rayas no dice nada acá.
 */
export function buildMonthPlan(
  month: string,
  perWeek: ReadonlyArray<{ weekStart: string; rows: readonly WeekPlanRow[] }>,
): MonthPlan {
  const weeks = perWeek.map((week) => week.weekStart)
  const names = new Map<string, string>()
  const cells = new Map<string, MonthPlanCell[]>()
  perWeek.forEach((week, index) => {
    for (const row of week.rows) {
      names.set(row.partyId, row.partyName)
      if (row.purchasedCents === 0 && row.budgetCents === 0 && row.paidCents === 0) continue
      const list = cells.get(row.partyId) ?? weeks.map(() => EMPTY_CELL)
      list[index] = {
        purchasedCents: row.purchasedCents,
        budgetCents: row.budgetCents,
        paidCents: row.paidCents,
      }
      cells.set(row.partyId, list)
    }
  })

  const rows: MonthPlanRow[] = [...cells.entries()]
    .map(([partyId, list]) => {
      const budgetCents = list.reduce((sum, cell) => sum + cell.budgetCents, 0)
      const paidCents = list.reduce((sum, cell) => sum + cell.paidCents, 0)
      return {
        partyId,
        partyName: names.get(partyId) ?? 'Proveedor',
        cells: list,
        budgetCents,
        paidCents,
        variationCents: paidCents - budgetCents,
      }
    })
    .sort(
      (a, b) =>
        b.budgetCents - a.budgetCents ||
        b.paidCents - a.paidCents ||
        a.partyName.localeCompare(b.partyName, 'es'),
    )

  const budgetCents = rows.reduce((sum, row) => sum + row.budgetCents, 0)
  const paidCents = rows.reduce((sum, row) => sum + row.paidCents, 0)
  return {
    month,
    weeks,
    rows,
    totals: {
      cells: weeks.map((_, index) =>
        rows.reduce<MonthPlanCell>((sum, row) => {
          const cell = row.cells[index] ?? EMPTY_CELL
          return {
            purchasedCents: sum.purchasedCents + cell.purchasedCents,
            budgetCents: sum.budgetCents + cell.budgetCents,
            paidCents: sum.paidCents + cell.paidCents,
          }
        }, EMPTY_CELL),
      ),
      budgetCents,
      paidCents,
      variationCents: paidCents - budgetCents,
    },
  }
}

// ─── Lo que entra por las acciones ───────────────────────────────────────────

const weekStartSchema = z
  .string()
  .refine((value) => isMonday(value), { message: 'Esa semana no existe. Elegila de nuevo.' })

export const saveWeekBudgetsSchema = z.object({
  weekStart: weekStartSchema,
  items: z
    .array(
      z.object({
        partyId: z.uuid({ message: 'Elegí un proveedor de la lista.' }),
        amountCents: z
          .number({ message: 'Revisá el importe.' })
          .int({ message: 'Revisá el importe.' })
          .min(0, { message: 'El presupuesto no puede ser negativo.' })
          .max(MONEY_MAX_CENTS, { message: 'Ese importe es demasiado grande.' }),
      }),
    )
    .min(1, { message: 'No hay nada para guardar.' })
    .max(500, { message: 'Son demasiadas filas de una vez.' }),
})

export const copyWeekBudgetsSchema = z.object({ weekStart: weekStartSchema })

/** Lo que recibe `acc_save_payment_budget`. */
export function budgetPayload(
  items: readonly BudgetItem[],
): Array<{ party_id: string; amount_cents: number }> {
  return items.map((item) => ({ party_id: item.partyId, amount_cents: item.amountCents }))
}
