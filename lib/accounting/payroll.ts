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
 */

import { z } from 'zod'
import type { CashMovementValues, ManualEntryValues } from '@/lib/accounting/server/document-types'
import type { PostingContext } from '@/lib/accounting/types'
import {
  addMonthsToYearMonth,
  capitalizeFirst,
  endOfMonth,
  formatMonthYear,
  isRealYearMonth,
  monthName,
  monthOf,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

// ─── Lo que se lee ───────────────────────────────────────────────────────────

export const PAY_FREQUENCIES = ['monthly', 'biweekly'] as const
export type PayFrequency = (typeof PAY_FREQUENCIES)[number]

export const PAY_FREQUENCY_LABELS: Readonly<Record<PayFrequency, string>> = {
  monthly: 'Mensual',
  biweekly: 'Quincenal',
}

export const PAYROLL_KINDS = ['advance', 'payment'] as const
export type PayrollKind = (typeof PAYROLL_KINDS)[number]

export const PAYROLL_KIND_LABELS: Readonly<Record<PayrollKind, string>> = {
  advance: 'Adelanto',
  payment: 'Pago',
}

export type PayrollMovement = {
  documentId: string
  kind: PayrollKind
  date: string
  amountCents: number
  /** La caja o cuenta de la que salió. */
  treasury: string | null
}

export type PayrollEmployee = {
  id: string
  name: string
  payFrequency: PayFrequency
  active: boolean
  notes: string | null
  salaryCents: number
  advancesCents: number
  paidCents: number
  movements: PayrollMovement[]
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

const rawMovementSchema = z.object({
  document_id: z.string(),
  kind: z.enum(PAYROLL_KINDS),
  date: z.string(),
  amount_cents: centsField,
  treasury: z.string().nullish(),
})

const rawEmployeeSchema = z.object({
  id: z.string(),
  name: z.string(),
  pay_frequency: z.enum(PAY_FREQUENCIES),
  active: z.boolean(),
  notes: z.string().nullish(),
  salary_cents: centsField,
  advances_cents: centsField,
  paid_cents: centsField,
  movements: z.array(rawMovementSchema),
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
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
      payFrequency: e.pay_frequency,
      active: e.active,
      notes: e.notes ?? null,
      salaryCents: e.salary_cents,
      advancesCents: e.advances_cents,
      paidCents: e.paid_cents,
      movements: e.movements.map((m) => ({
        documentId: m.document_id,
        kind: m.kind,
        date: m.date,
        amountCents: m.amount_cents,
        treasury: m.treasury ?? null,
      })),
    })),
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
export type PayrollMovementTarget = { employeeId: string; month: string; kind: PayrollKind }
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

/** «Adelanto · Martina Ríos · noviembre»: lo que se lee después en la caja y en el comprobante. */
export function payrollDetail(kind: PayrollKind, employeeName: string, month: string): string {
  const what = kind === 'advance' ? 'Adelanto' : 'Pago de sueldo'
  return `${what} · ${employeeName.trim()} · ${monthWord(month)}`
}

/** El `cash_movement` de un adelanto o un pago: salida de la caja contra Sueldos a pagar [Personal]. */
export function payrollMovementValues(
  input: {
    kind: PayrollKind
    employeeName: string
    month: string
    treasuryAccountId: string | null
    amountCents: number | null
    date: string | null
    personalPartyId: string | null
  },
  ctx: Pick<PostingContext, 'sys'>,
): PayrollMovementFormValues {
  return {
    treasuryAccountId: input.treasuryAccountId ?? '',
    direction: 'out',
    counterpartAccountId: ctx.sys.payroll_payable.id,
    partyId: input.personalPartyId,
    amountCents: input.amountCents ?? 0,
    date: input.date ?? '',
    shortcut: 'other',
    detail: payrollDetail(input.kind, input.employeeName, input.month),
  }
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

export const employeeSalarySchema = z.object(
  {
    employeeId: employeeIdField,
    month: yearMonthField,
    salaryCents: z
      .number({ message: 'Escribí el sueldo.' })
      .int('El sueldo tiene que estar en centavos enteros.')
      .min(0, 'El sueldo va sin signo menos.')
      .max(MAX_SALARY_CENTS, 'Ese importe es demasiado grande. Revisalo.'),
  },
  { message: BAD_DATA },
)
export type EmployeeSalaryValues = z.input<typeof employeeSalarySchema>

/** A quién corresponde el movimiento. El resto lo valida `cashMovementSchema`, en el camino de siempre. */
export const payrollMovementTargetSchema = z.looseObject({
  employeeId: employeeIdField,
  month: yearMonthField,
  kind: z.enum(PAYROLL_KINDS, { message: BAD_DATA }),
  clientRef: z.uuid({ message: 'Falta la referencia del formulario. Recargá la página.' }),
  direction: z.literal('out', { message: BAD_DATA }),
})

/** De qué mes es el asiento. El resto lo valida `manualEntrySchema`, en el camino de siempre. */
export const payrollAccrualTargetSchema = z.looseObject({
  month: yearMonthField,
  clientRef: z.uuid({ message: 'Falta la referencia del formulario. Recargá la página.' }),
})
