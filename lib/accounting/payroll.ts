/**
 * La planilla de Sueldos (reunión del 29/10/2026, Luciano: «lo que más me importa es saber cuánto
 * le debo a fin de mes»). Puro, sin I/O ni `server-only`: lo usan la lectura, las acciones, la
 * pantalla y los tests (`administracion-sueldos-planilla.test.ts`).
 *
 * - El sueldo de un mes es el de ese mes o el último cargado antes: lo resuelve `acc_report_payroll`.
 * - Saldo = sueldo − adelantos − pagado.
 * - Un adelanto o un pago es un `cash_movement`: D Sueldos a pagar [Personal] / H la caja, por el
 *   camino de siempre (vista previa, avisos, impuesto al cheque en el mismo envío).
 * - «Devengar» es un asiento manual: D Sueldos y jornales / H Sueldos a pagar [Personal], con fecha
 *   de fin de mes.
 *
 * Pedido de los socios del 22/11/2026:
 * - **En blanco y en negro.** El sueldo se puede partir en dos (`salaryCents` sigue siendo el total y
 *   `salaryOffBooksCents`, la parte en negro) y cada adelanto o pago dice de qué parte fue. No cambia
 *   el asiento: es una marca.
 * - **Horas extra.** Plata que se paga aparte del sueldo: `cash_movement` D Sueldos y jornales / H la
 *   caja, sin partícipe. No baja el saldo ni entra en «Devengar».
 * - **Las fechas que cubre un pago** (la quincena, la semana): opcionales.
 * - **Lo que salió de la caja del salón** para alguien (`pendingCash`) ya cuenta en sus adelantos, en lo
 *   pagado y en el saldo desde que sale, aunque todavía no tenga comprobante: «cuánto le debo» está
 *   al día sin depender de nadie. La base no lo suma: lo suma `parsePayrollReport`, una sola vez.
 */

import { z } from 'zod'
import type { CashMovementValues, ManualEntryValues } from '@/lib/accounting/server/document-types'
import type { PostingContext } from '@/lib/accounting/types'
import {
  addMonthsToYearMonth,
  capitalizeFirst,
  endOfMonth,
  formatMonthYear,
  isRealIsoDay,
  isRealYearMonth,
  MONTH_NAMES_SHORT,
  monthName,
  monthOf,
  startOfMonth,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { POS_CASH_PAYROLL_PURPOSES, type PosCashPayrollPurpose } from './pos-cash'

// ─── Lo que se lee ───────────────────────────────────────────────────────────

export const PAY_FREQUENCIES = ['monthly', 'biweekly'] as const
export type PayFrequency = (typeof PAY_FREQUENCIES)[number]

export const PAY_FREQUENCY_LABELS: Readonly<Record<PayFrequency, string>> = {
  monthly: 'Mensual',
  biweekly: 'Quincenal',
}

export const PAYROLL_KINDS = ['advance', 'payment', 'overtime'] as const
export type PayrollKind = (typeof PAYROLL_KINDS)[number]

export const PAYROLL_KIND_LABELS: Readonly<Record<PayrollKind, string>> = {
  advance: 'Adelanto',
  payment: 'Pago',
  overtime: 'Horas extra',
}

export type PayrollMovement = {
  documentId: string
  kind: PayrollKind
  date: string
  amountCents: number
  /** La caja o cuenta de la que salió. */
  treasury: string | null
  /** Fue en negro. Falta = en blanco (la base de antes no lo dice). */
  offBooks?: boolean
  /** Las fechas que cubre (la quincena, la semana). Vacío = no se dijo. */
  periodFrom?: string | null
  periodTo?: string | null
}

/** Un retiro de la caja del salón para esta persona que todavía no tiene comprobante. */
export type PayrollPendingCash = {
  id: string
  purpose: PosCashPayrollPurpose
  amountCents: number
  /** El día de servicio en que salió. */
  date: string
  branchId: string | null
  /** Quién lo anotó en la caja. */
  byName: string | null
  periodFrom: string | null
  periodTo: string | null
}

export type PayrollEmployee = {
  id: string
  name: string
  /** Dónde trabaja (`acc_report_payroll` › `branch_id`). Vacía si la base todavía no lo dice. */
  branchId?: string | null
  payFrequency: PayFrequency
  active: boolean
  notes: string | null
  /** El total del mes: la parte en blanco más la parte en negro. */
  salaryCents: number
  /** Adelantos: los que tienen comprobante y los que salieron de la caja del salón y falta pasar. */
  advancesCents: number
  /** Pagos de sueldo: igual, con y sin comprobante todavía. */
  paidCents: number
  movements: PayrollMovement[]
  /** La parte del sueldo que va en negro (adentro de `salaryCents`). Falta = nada. */
  salaryOffBooksCents?: number
  /** Horas extra pagadas en el mes (con comprobante o recién salidas de la caja). No bajan el saldo. */
  overtimeCents?: number
  /** Adelantos y pagos en negro, con comprobante. */
  settledOffBooksCents?: number
  /** Lo que salió de la caja del salón para esta persona en el mes y falta pasar a los libros. */
  pendingCash?: PayrollPendingCash[]
}

export type PayrollAccrual = { documentId: string; date: string; amountCents: number }

export type PayrollReport = {
  /** `yyyy-MM`. */
  month: string
  employees: PayrollEmployee[]
  /** El asiento de «Devengar» de ese mes; `null` si no se devengó (o se anuló). */
  accrual: PayrollAccrual | null
}

const centsField = z.coerce.number().int()

const dayOrNull = z
  .string()
  .nullish()
  .transform((value) => (value && isRealIsoDay(value) ? value : null))

// Las claves nuevas son opcionales: la app puede salir un rato antes que la base que las manda.
const rawMovementSchema = z.object({
  document_id: z.string(),
  kind: z.enum(PAYROLL_KINDS),
  date: z.string(),
  amount_cents: centsField,
  treasury: z.string().nullish(),
  off_books: z.boolean().nullish(),
  period_from: dayOrNull,
  period_to: dayOrNull,
})

const rawPendingCashSchema = z.object({
  id: z.string(),
  purpose: z.enum(POS_CASH_PAYROLL_PURPOSES),
  amount_cents: centsField,
  date: z.string(),
  branch_id: z.string().nullish(),
  by_name: z.string().nullish(),
  period_from: dayOrNull,
  period_to: dayOrNull,
})

const rawEmployeeSchema = z.object({
  id: z.string(),
  name: z.string(),
  branch_id: z.string().nullish(),
  pay_frequency: z.enum(PAY_FREQUENCIES),
  active: z.boolean(),
  notes: z.string().nullish(),
  salary_cents: centsField,
  advances_cents: centsField,
  paid_cents: centsField,
  movements: z.array(rawMovementSchema),
  salary_off_books_cents: centsField.nullish(),
  overtime_cents: centsField.nullish(),
  settled_off_books_cents: centsField.nullish(),
  pending_cash: z.array(rawPendingCashSchema).nullish(),
})

const rawReportSchema = z.object({
  employees: z.array(rawEmployeeSchema),
  accrual: z
    .object({ document_id: z.string(), date: z.string(), amount_cents: centsField })
    .nullish(),
})

/** Lo que devuelve `acc_report_payroll` → la planilla. `null` si no se puede leer. */
export function parsePayrollReport(raw: unknown, month: string): PayrollReport | null {
  const parsed = rawReportSchema.safeParse(raw)
  if (!parsed.success) return null
  const { employees, accrual } = parsed.data
  return {
    month,
    employees: employees.map((e) => {
      const pendingCash: PayrollPendingCash[] = (e.pending_cash ?? []).map((p) => ({
        id: p.id,
        purpose: p.purpose,
        amountCents: p.amount_cents,
        date: p.date,
        branchId: p.branch_id ?? null,
        byName: (p.by_name ?? '').trim() || null,
        periodFrom: p.period_from,
        periodTo: p.period_to,
      }))
      const pending = pendingCashSums(pendingCash)
      const employee: PayrollEmployee = {
        id: e.id,
        name: e.name,
        branchId: e.branch_id ?? null,
        payFrequency: e.pay_frequency,
        active: e.active,
        notes: e.notes ?? null,
        salaryCents: e.salary_cents,
        // Lo que salió de la caja del salón cuenta desde que sale (ver arriba).
        advancesCents: e.advances_cents + pending.advance,
        paidCents: e.paid_cents + pending.salary,
        movements: e.movements.map((m) => ({
          documentId: m.document_id,
          kind: m.kind,
          date: m.date,
          amountCents: m.amount_cents,
          treasury: m.treasury ?? null,
          ...(m.off_books ? { offBooks: true } : {}),
          ...(m.period_from || m.period_to
            ? { periodFrom: m.period_from, periodTo: m.period_to }
            : {}),
        })),
      }
      // Solo cuando hay algo que decir: una planilla sin partes ni horas extra queda como siempre.
      const offBooks = Math.min(e.salary_off_books_cents ?? 0, e.salary_cents)
      if (offBooks > 0) employee.salaryOffBooksCents = offBooks
      const overtime = (e.overtime_cents ?? 0) + pending.overtime
      if (overtime > 0) employee.overtimeCents = overtime
      if ((e.settled_off_books_cents ?? 0) > 0) {
        employee.settledOffBooksCents = e.settled_off_books_cents ?? 0
      }
      if (pendingCash.length > 0) employee.pendingCash = pendingCash
      return employee
    }),
    accrual: accrual
      ? {
          documentId: accrual.document_id,
          date: accrual.date,
          amountCents: accrual.amount_cents,
        }
      : null,
  }
}

// ─── Las cuentas ─────────────────────────────────────────────────────────────

/** Lo que falta pagarle (negativo: le pagaste de más). */
export function employeeBalanceCents(
  employee: Pick<PayrollEmployee, 'salaryCents' | 'advancesCents' | 'paidCents'>,
): number {
  return employee.salaryCents - employee.advancesCents - employee.paidCents
}

export type PayrollTotals = {
  count: number
  salaryCents: number
  advancesCents: number
  paidCents: number
  /** Sueldos − adelantos − pagado: lo que da la columna «Saldo». */
  balanceCents: number
  /**
   * «Le debés a fin de mes»: lo que se le debe a cada uno. Lo que uno cobró de más no le baja la
   * deuda a otro.
   */
  owedCents: number
}

export function payrollTotals(employees: readonly PayrollEmployee[]): PayrollTotals {
  const totals: PayrollTotals = {
    count: employees.length,
    salaryCents: 0,
    advancesCents: 0,
    paidCents: 0,
    balanceCents: 0,
    owedCents: 0,
  }
  for (const employee of employees) {
    const balance = employeeBalanceCents(employee)
    totals.salaryCents += employee.salaryCents
    totals.advancesCents += employee.advancesCents
    totals.paidCents += employee.paidCents
    totals.balanceCents += balance
    totals.owedCents += Math.max(0, balance)
  }
  return totals
}

// ─── Lo que salió de la caja del salón ───────────────────────────────────────

/** Cuánto salió de la caja para cada cosa. */
export function pendingCashSums(
  pending: readonly Pick<PayrollPendingCash, 'purpose' | 'amountCents'>[] | undefined,
): Record<PosCashPayrollPurpose, number> & { total: number; count: number } {
  const sums = { advance: 0, overtime: 0, salary: 0, total: 0, count: 0 }
  for (const item of pending ?? []) {
    sums[item.purpose] += item.amountCents
    sums.total += item.amountCents
    sums.count += 1
  }
  return sums
}

/**
 * El mes de sueldos al que más probablemente corresponde un retiro de la caja: el de las fechas que
 * cubre, si la caja las anotó; un pago de sueldo de los primeros diez días, el mes anterior (los
 * sueldos se pagan la primera semana del mes que sigue, `settleHint`); si no, el mes en que salió.
 * Es una propuesta: se pasa a los libros del mes que la persona esté mirando.
 */
export function pendingCashMonth(item: {
  purpose: PosCashPayrollPurpose | 'supplier'
  date: string
  periodFrom: string | null
}): string {
  if (item.periodFrom && isRealIsoDay(item.periodFrom)) return monthOf(item.periodFrom)
  const month = monthOf(item.date)
  return item.purpose === 'salary' && Number(item.date.slice(8, 10)) <= 10
    ? addMonthsToYearMonth(month, -1)
    : month
}

/** El movimiento de Sueldos que le corresponde a un retiro de la caja. */
export const PAYROLL_KIND_OF_PURPOSE: Readonly<Record<PosCashPayrollPurpose, PayrollKind>> = {
  advance: 'advance',
  salary: 'payment',
  overtime: 'overtime',
}

// ─── En blanco y en negro ────────────────────────────────────────────────────

/** Una parte del sueldo: cuánto es, cuánto ya se le pagó (con comprobante) y cuánto falta. */
export type PayrollPart = { salaryCents: number; settledCents: number; owedCents: number }

export type PayrollParts = {
  declared: PayrollPart
  offBooks: PayrollPart
  /**
   * Adelantos y pagos que salieron de la caja del salón y todavía no dicen de qué parte son (lo dicen
   * cuando se pasan a los libros). Ya bajaron el saldo.
   */
  unassignedCents: number
}

/**
 * Cuánto falta de cada parte. `null` si el sueldo no tiene parte en negro: ahí no hay nada que separar y
 * la planilla se ve como siempre (un adelanto o un pago marcado «en negro» igual se lee con su marca).
 */
export function employeeParts(
  employee: Pick<
    PayrollEmployee,
    | 'salaryCents'
    | 'advancesCents'
    | 'paidCents'
    | 'salaryOffBooksCents'
    | 'settledOffBooksCents'
    | 'pendingCash'
  >,
): PayrollParts | null {
  const offSalary = Math.min(employee.salaryOffBooksCents ?? 0, employee.salaryCents)
  const offSettled = employee.settledOffBooksCents ?? 0
  if (offSalary <= 0) return null
  const pending = pendingCashSums(employee.pendingCash)
  const unassigned = pending.advance + pending.salary
  const declaredSalary = employee.salaryCents - offSalary
  // Con comprobante: todo lo anotado menos lo de la caja, y de eso, lo que no fue en negro.
  const settled = Math.max(0, employee.advancesCents + employee.paidCents - unassigned)
  const declaredSettled = Math.max(0, settled - offSettled)
  return {
    declared: {
      salaryCents: declaredSalary,
      settledCents: declaredSettled,
      owedCents: Math.max(0, declaredSalary - declaredSettled),
    },
    offBooks: {
      salaryCents: offSalary,
      settledCents: offSettled,
      owedCents: Math.max(0, offSalary - offSettled),
    },
    unassignedCents: unassigned,
  }
}

/**
 * ¿Se propone «En negro» para lo que se está por cargar? Un adelanto o un pago, la parte a la que más
 * le falta; las horas extra, en negro solo si todo el sueldo lo es. Sin parte en negro, nunca.
 */
export function suggestOffBooks(
  employee: Parameters<typeof employeeParts>[0],
  kind: PayrollKind,
): boolean {
  const parts = employeeParts(employee)
  if (!parts || parts.offBooks.salaryCents <= 0) return false
  if (kind === 'overtime') return parts.declared.salaryCents === 0
  return parts.offBooks.owedCents > parts.declared.owedCents
}

/** Lo que se suma en la planilla además de las cuatro columnas de siempre. */
export type PayrollExtras = {
  /** Horas extra del mes (con comprobante o recién salidas de la caja). */
  overtimeCents: number
  /** La parte en negro de los sueldos del mes. */
  salaryOffBooksCents: number
  /** Lo que salió de la caja del salón y falta pasar a los libros: todo, y cuánto de cada cosa. */
  pendingCashCents: number
  pendingCashCount: number
  pendingAdvancesCents: number
  pendingPaidCents: number
}

export function payrollExtras(employees: readonly PayrollEmployee[]): PayrollExtras {
  const extras: PayrollExtras = {
    overtimeCents: 0,
    salaryOffBooksCents: 0,
    pendingCashCents: 0,
    pendingCashCount: 0,
    pendingAdvancesCents: 0,
    pendingPaidCents: 0,
  }
  for (const employee of employees) {
    const pending = pendingCashSums(employee.pendingCash)
    extras.overtimeCents += employee.overtimeCents ?? 0
    extras.salaryOffBooksCents += Math.min(employee.salaryOffBooksCents ?? 0, employee.salaryCents)
    extras.pendingCashCents += pending.total
    extras.pendingCashCount += pending.count
    extras.pendingAdvancesCents += pending.advance
    extras.pendingPaidCents += pending.salary
  }
  return extras
}

// ─── Las fechas que cubre un pago ────────────────────────────────────────────

export type PayrollPeriod = { from: string; to: string }

export const PERIOD_SHORTCUTS = ['first_half', 'second_half', 'month'] as const
export type PeriodShortcut = (typeof PERIOD_SHORTCUTS)[number]

export const PERIOD_SHORTCUT_LABELS: Readonly<Record<PeriodShortcut, string>> = {
  first_half: '1.ª quincena',
  second_half: '2.ª quincena',
  month: 'Todo el mes',
}

/** Las fechas de cada atajo en ese mes (`yyyy-MM`). */
export function periodOfShortcut(month: string, shortcut: PeriodShortcut): PayrollPeriod {
  const first = startOfMonth(month)
  const last = endOfMonth(month)
  if (shortcut === 'first_half') return { from: first, to: `${month}-15` }
  if (shortcut === 'second_half') return { from: `${month}-16`, to: last }
  return { from: first, to: last }
}

/** A qué atajo corresponden esas fechas; `null` si no son las de ninguno. */
export function shortcutOfPeriod(
  month: string,
  period: { from: string | null; to: string | null },
): PeriodShortcut | null {
  for (const shortcut of PERIOD_SHORTCUTS) {
    const range = periodOfShortcut(month, shortcut)
    if (range.from === period.from && range.to === period.to) return shortcut
  }
  return null
}

const shortDay = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MONTH_NAMES_SHORT[Number(iso.slice(5, 7)) - 1] ?? ''}`.trim()

/**
 * Las fechas que cubre, como se dicen: «1 al 15 nov», «28 oct al 3 nov», «todo noviembre», «desde el
 * 5 nov». `null` si no se dijo nada.
 */
export function periodWords(from: string | null | undefined, to: string | null | undefined) {
  const start = from && isRealIsoDay(from) ? from : null
  const end = to && isRealIsoDay(to) ? to : null
  if (!start && !end) return null
  if (start && end) {
    if (start === end) return shortDay(start)
    const month = monthOf(start)
    if (month === monthOf(end)) {
      if (start === startOfMonth(month) && end === endOfMonth(month)) {
        return `todo ${monthWord(month)}`
      }
      return `${Number(start.slice(8, 10))} al ${shortDay(end)}`
    }
    return `${shortDay(start)} al ${shortDay(end)}`
  }
  return start ? `desde el ${shortDay(start)}` : `hasta el ${shortDay(end ?? '')}`
}

/** «Pago · 1 al 15 nov · en negro»: un movimiento como se lee en el detalle de una persona. */
export function movementWords(
  movement: Pick<PayrollMovement, 'kind' | 'offBooks' | 'periodFrom' | 'periodTo'>,
): string {
  return [
    PAYROLL_KIND_LABELS[movement.kind],
    periodWords(movement.periodFrom, movement.periodTo),
    movement.offBooks ? 'en negro' : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
}

/** «Le debés $ 680.000 de noviembre.», en el diálogo de un adelanto o un pago. */
export function owedSentence(balanceCents: number, month: string): string {
  const mes = monthWord(month)
  if (balanceCents > 0) return `Le debés ${formatCentsShort(balanceCents)} de ${mes}.`
  if (balanceCents < 0) return `Le pagaste ${formatCentsShort(-balanceCents)} de más en ${mes}.`
  return `No le debés nada de ${mes}.`
}

// ─── Los meses ───────────────────────────────────────────────────────────────

/** `'2026-11'` → `'noviembre'`. */
export function monthWord(month: string): string {
  return monthName(Number(month.slice(5, 7)))
}

/** `'2026-11'` → `'Noviembre'`. */
export function monthTitle(month: string): string {
  return capitalizeFirst(monthWord(month))
}

/** `?mes=`: cualquier mes real; si no, el de hoy. */
export function parsePayrollMonth(raw: string | null | undefined, today: string): string {
  return isRealYearMonth(raw) ? raw : monthOf(today)
}

/**
 * Los meses de la barra: el pasado (en la primera semana de un mes se paga el anterior), este y el
 * que viene. Un mes que vino por el link se suma, para que la barra diga cuál se está mirando.
 */
export function payrollMonths(today: string, selected: string): string[] {
  const current = monthOf(today)
  const months = [addMonthsToYearMonth(current, -1), current, addMonthsToYearMonth(current, 1)]
  return months.includes(selected) ? months : [...months, selected].sort()
}

/** Cuándo se paga lo de ese mes: «1.ª semana de diciembre». */
export function settleHint(month: string): string {
  return `1.ª semana de ${monthWord(addMonthsToYearMonth(month, 1))}`
}

export function payrollHref(slug: string, month?: string | null): string {
  return `/${slug}/administracion/sueldos${month ? `?mes=${month}` : ''}`
}

// ─── Devengar ────────────────────────────────────────────────────────────────

export type AccrualOffer =
  /** Ya se devengó: el asiento, y las celdas de sueldo de ese mes quedan de solo lectura. */
  | { kind: 'done'; accrual: PayrollAccrual }
  | { kind: 'ready'; totalCents: number; date: string }
  /** Sin total no hay nada que devengar. */
  | { kind: 'no_total' }
  /**
   * Un mes que todavía no empezó: el motor no acepta un asiento manual después del fin del mes en
   * curso (`date_in_future`).
   */
  | { kind: 'future' }

/** ¿Se ofrece «Devengar» para ese mes? */
export function accrualOffer(
  report: Pick<PayrollReport, 'month' | 'employees' | 'accrual'>,
  today: string,
): AccrualOffer {
  if (report.accrual) return { kind: 'done', accrual: report.accrual }
  if (report.month > monthOf(today)) return { kind: 'future' }
  const { salaryCents } = payrollTotals(report.employees)
  if (salaryCents <= 0) return { kind: 'no_total' }
  return { kind: 'ready', totalCents: salaryCents, date: endOfMonth(report.month) }
}

// ─── Lo que se guarda ────────────────────────────────────────────────────────

export type PayrollMovementFormValues = Omit<
  CashMovementValues,
  'clientRef' | 'previewHash' | 'warningsAck'
>
export type PayrollMovementTarget = {
  employeeId: string
  month: string
  kind: PayrollKind
  /** Fue en negro. Falta = en blanco. */
  offBooks?: boolean
  /** Las fechas que cubre (opcionales). */
  periodFrom?: string | null
  periodTo?: string | null
  /** El retiro de la caja del salón que este comprobante registra (queda atado antes de guardar). */
  posCashId?: string | null
}
/** Lo que recibe `postPayrollMovement`: el movimiento de caja y a quién corresponde. */
export type PayrollMovementInput = CashMovementValues & PayrollMovementTarget

export type PayrollAccrualFormValues = Omit<
  ManualEntryValues,
  'clientRef' | 'previewHash' | 'warningsAck'
>
/** Lo que recibe `postPayrollAccrual`: el asiento y de qué mes es. */
export type PayrollAccrualInput = ManualEntryValues & { month: string }

/** El partícipe «Personal» (Sueldos a pagar). `null` si el bar no lo tiene activo. */
export function personalPartyId(ctx: Pick<PostingContext, 'parties' | 'sys'>): string | null {
  const parties = [...ctx.parties.values()].filter((party) => party.active)
  const found =
    parties.find((party) => party.systemKey === 'personal') ??
    parties.find((party) => party.payableAccountId === ctx.sys.payroll_payable.id)
  return found?.id ?? null
}

/** Cómo se nombra cada movimiento en su comprobante y en el título del diálogo. */
export const PAYROLL_KIND_TITLES: Readonly<Record<PayrollKind, string>> = {
  advance: 'Adelanto',
  payment: 'Pago de sueldo',
  overtime: 'Horas extra',
}

/** «Adelanto · Martina Ríos · noviembre»: lo que se lee después en la caja y en el comprobante. */
export function payrollDetail(kind: PayrollKind, employeeName: string, month: string): string {
  return `${PAYROLL_KIND_TITLES[kind]} · ${employeeName.trim()} · ${monthWord(month)}`
}

/**
 * El `cash_movement` de un movimiento de sueldos, siempre una salida de la caja:
 * - un adelanto o un pago, contra Sueldos a pagar [Personal] (baja lo que se le debe);
 * - las horas extra, contra Sueldos y jornales, sin partícipe (es un gasto más: no estaba devengado).
 *
 * `branchId`: la sucursal del comprobante. Va cuando la caja es de una sucursal (una caja de otra
 * sucursal no se mueve desde la principal) o cuando se sabe dónde trabaja la persona.
 */
export function payrollMovementValues(
  input: {
    kind: PayrollKind
    employeeName: string
    month: string
    treasuryAccountId: string | null
    amountCents: number | null
    date: string | null
    personalPartyId: string | null
    branchId?: string | null
  },
  ctx: Pick<PostingContext, 'sys'>,
): PayrollMovementFormValues {
  const overtime = input.kind === 'overtime'
  return {
    treasuryAccountId: input.treasuryAccountId ?? '',
    direction: 'out',
    counterpartAccountId: overtime ? ctx.sys.salaries.id : ctx.sys.payroll_payable.id,
    partyId: overtime ? null : input.personalPartyId,
    amountCents: input.amountCents ?? 0,
    date: input.date ?? '',
    shortcut: 'other',
    detail: payrollDetail(input.kind, input.employeeName, input.month),
    ...(input.branchId ? { branchId: input.branchId } : {}),
  }
}

/**
 * La sucursal de un movimiento de sueldos: la de la caja si tiene (de ahí sale la plata); si la caja es
 * de todo el bar, la de la persona. `null`: la decide la base (la principal).
 */
export function payrollBranchId(
  treasury: { branchId?: string | null } | null | undefined,
  employee: { branchId?: string | null },
): string | null {
  return treasury?.branchId || employee.branchId || null
}

/** El asiento de «Devengar»: D Sueldos y jornales / H Sueldos a pagar [Personal], a fin de mes. */
export function payrollAccrualValues(
  input: { month: string; totalCents: number; personalPartyId: string },
  ctx: Pick<PostingContext, 'sys'>,
): PayrollAccrualFormValues {
  const date = endOfMonth(input.month)
  return {
    entryKind: 'payroll',
    date,
    description: `Sueldos de ${formatMonthYear(date)}`,
    lines: [
      {
        accountId: ctx.sys.salaries.id,
        debitCents: input.totalCents,
        creditCents: null,
        partyId: null,
        dueDate: null,
        memo: 'Sueldos del personal',
      },
      {
        accountId: ctx.sys.payroll_payable.id,
        debitCents: null,
        creditCents: input.totalCents,
        partyId: input.personalPartyId,
        dueDate: null,
        memo: 'Sueldos a pagar',
      },
    ],
    correctsDocumentId: null,
  }
}

// ─── Los bordes ──────────────────────────────────────────────────────────────

/** El tope de un importe de un formulario contable: $ 9.999.999.999,99 (`MAX_AMOUNT_CENTS`). */
const MAX_SALARY_CENTS = 999_999_999_999

const BAD_DATA = 'Revisá los datos.'
const yearMonthField = z
  .string({ message: 'Elegí el mes.' })
  .refine((value) => isRealYearMonth(value), { message: 'Elegí el mes.' })
const employeeIdField = z.uuid({ message: 'Ese empleado no existe.' })

export const employeeSchema = z.object(
  {
    id: employeeIdField.nullable().default(null),
    name: z
      .string({ message: 'Escribí el nombre.' })
      .trim()
      .min(2, 'Escribí el nombre.')
      .max(80, 'El nombre puede tener hasta 80 letras.'),
    payFrequency: z.enum(PAY_FREQUENCIES, { message: 'Elegí si cobra por mes o por quincena.' }),
    active: z.boolean({ message: BAD_DATA }).default(true),
    notes: z
      .string({ message: BAD_DATA })
      .trim()
      .max(280, 'La nota puede tener hasta 280 letras.')
      .nullable()
      .default(null),
  },
  { message: BAD_DATA },
)
export type EmployeeValues = z.input<typeof employeeSchema>

const salaryAmount = (empty: string) =>
  z
    .number({ message: empty })
    .int('El sueldo tiene que estar en centavos enteros.')
    .min(0, 'El sueldo va sin signo menos.')
    .max(MAX_SALARY_CENTS, 'Ese importe es demasiado grande. Revisalo.')

export const employeeSalarySchema = z.object(
  {
    employeeId: employeeIdField,
    month: yearMonthField,
    salaryCents: salaryAmount('Escribí el sueldo.'),
  },
  { message: BAD_DATA },
)
export type EmployeeSalaryValues = z.input<typeof employeeSalarySchema>

/** El sueldo en sus dos partes: lo que va en blanco y lo que va en negro. El total es la suma. */
export const employeeSalaryPartsSchema = z
  .object(
    {
      employeeId: employeeIdField,
      month: yearMonthField,
      declaredCents: salaryAmount('Escribí la parte en blanco (puede ser cero).'),
      offBooksCents: salaryAmount('Escribí la parte en negro (puede ser cero).'),
    },
    { message: BAD_DATA },
  )
  .refine((v) => v.declaredCents + v.offBooksCents <= MAX_SALARY_CENTS, {
    path: ['offBooksCents'],
    message: 'Ese importe es demasiado grande. Revisalo.',
  })
export type EmployeeSalaryPartsValues = z.input<typeof employeeSalaryPartsSchema>

const periodDay = z
  .string({ message: 'Elegí la fecha.' })
  .refine((value) => isRealIsoDay(value), { message: 'Elegí una fecha real.' })
  .nullable()
  .default(null)

/** A quién corresponde el movimiento. El resto lo valida `cashMovementSchema`, en el camino de siempre. */
export const payrollMovementTargetSchema = z
  .looseObject({
    employeeId: employeeIdField,
    month: yearMonthField,
    kind: z.enum(PAYROLL_KINDS, { message: BAD_DATA }),
    offBooks: z.boolean({ message: BAD_DATA }).default(false),
    periodFrom: periodDay,
    periodTo: periodDay,
    posCashId: z.uuid({ message: 'Ese retiro no existe.' }).nullable().default(null),
    clientRef: z.uuid({ message: 'Falta la referencia del formulario. Recargá la página.' }),
    direction: z.literal('out', { message: BAD_DATA }),
  })
  .refine((v) => !v.periodFrom || !v.periodTo || v.periodTo >= v.periodFrom, {
    path: ['periodTo'],
    message: 'El «hasta» va después del «desde».',
  })

/** De qué mes es el asiento. El resto lo valida `manualEntrySchema`, en el camino de siempre. */
export const payrollAccrualTargetSchema = z.looseObject({
  month: yearMonthField,
  clientRef: z.uuid({ message: 'Falta la referencia del formulario. Recargá la página.' }),
})
