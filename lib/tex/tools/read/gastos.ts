import 'server-only'

import { z } from 'zod'
import {
  buildSheet,
  parseSheetMonth,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla'
import {
  installmentWords,
  type Sheet,
  type SheetItem,
  type SheetTotals,
  sheetTotals,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla-words'
import {
  accrualOffer,
  employeeBalanceCents,
  PAY_FREQUENCY_LABELS,
  type PayrollEmployee,
  type PayrollReport,
  type PayrollTotals,
  payrollTotals,
} from '@/lib/accounting/payroll'
import { listRecurringExpenses } from '@/lib/accounting/queries/documents'
import { getPayrollReport } from '@/lib/accounting/queries/payroll'
import { listRecurringPayments } from '@/lib/accounting/queries/recurring'
import { settleQuery } from '@/lib/accounting/queries/shared'
import type { RecurringLineState } from '@/lib/accounting/recurring-status'
import { formatMonthLabel, monthOf } from '@/lib/dates'
import { capped, dayText, defineTool, money, monthField } from '../types'
import { cappedBySize, compact, moneyIf, plain, texMonth } from './common'

/** Lo que se muestra de una lista. */
const LIST_MAX = 40
/** Son dos listas en una respuesta: cada una con su parte, y primero lo que falta. */
const PENDING_MAX_CHARS = 7_000
const PAID_MAX_CHARS = 4_000

// ─── Lo puro: gastos fijos ───────────────────────────────────────────────────

const LINE_STATE_WORDS: Readonly<Record<RecurringLineState, string>> = {
  paid: 'Pagado',
  partial: 'Pago parcial',
  unpaid: 'Sin pagar',
  overdue: 'Vencido',
  no_amount: 'Sin monto',
  upcoming: 'Vence más adelante',
  skipped: 'Este mes no se paga',
  ended: 'Terminó',
  paused: 'Pausado',
}

/** Lo que pide que alguien haga algo: cargar o pagar. */
const NEEDS_DOING: ReadonlySet<RecurringLineState> = new Set<RecurringLineState>([
  'overdue',
  'unpaid',
  'partial',
  'no_amount',
])

export function sheetRow(item: SheetItem) {
  const { row, line } = item
  return compact({
    id: row.id,
    nombre: row.name,
    proveedor: row.partyName,
    estado: LINE_STATE_WORDS[line.state],
    vence: dayText(line.dueDate ?? item.day),
    monto: line.dueCents === null ? 'Variable: todavía sin monto' : money(line.dueCents),
    pagado: moneyIf(line.paidCents),
    falta: moneyIf(line.remainingCents),
    cuota: installmentWords(line.installment),
    comprobante_id: line.documentId,
    caja: row.treasuryName,
    de_antes_sin_pagar: moneyIf(line.priorOpenCents),
  })
}

/** Cuáles faltan y cuáles se pagaron, con los totales de la pantalla (que suman los sueldos). */
export function sheetData(sheet: Sheet, totals: SheetTotals, payroll: PayrollTotals | null) {
  const pending = sheet.items.filter((item) => NEEDS_DOING.has(item.line.state))
  const paid = sheet.items.filter((item) => item.line.state === 'paid')
  const skipped = sheet.items.filter((item) => item.line.state === 'skipped')
  const dash = (cents: number | null) => (cents === null ? null : money(cents))
  const missing = cappedBySize(pending.map(sheetRow), LIST_MAX, PENDING_MAX_CHARS)
  const done = cappedBySize(paid.map(sheetRow), LIST_MAX, PAID_MAX_CHARS)
  return compact({
    mes: formatMonthLabel(sheet.month),
    oracion: plain(sheet.progress.sentence),
    total_del_mes: dash(totals.totalCents),
    pagado: dash(totals.paidCents),
    falta_pagar: dash(totals.pendingCents),
    vencido: dash(totals.overdueCents),
    sin_monto: totals.noAmount || null,
    fijos: compact({
      pagado: money(sheet.progress.paidCents),
      falta: money(sheet.progress.remainingCents),
      vencido: moneyIf(sheet.progress.overdueCents),
      de_meses_anteriores_sin_pagar: moneyIf(sheet.progress.priorOpenCents),
    }),
    sueldos:
      payroll === null
        ? 'No se pudieron leer: el total no los cuenta.'
        : totals.payrollCents === null
          ? null
          : { total: money(payroll.salaryCents), falta: money(payroll.owedCents) },
    faltan: missing.filas,
    faltan_hay_mas: missing.hay_mas || null,
    pagados: done.filas,
    pagados_hay_mas: done.hay_mas || null,
    este_mes_no_se_pagan:
      skipped.length > 0
        ? skipped.map((item) => ({ id: item.row.id, nombre: item.row.name }))
        : null,
    vencen_mas_adelante: sheet.later.length || null,
    pausados_o_terminados: sheet.off.length || null,
  })
}

// ─── Lo puro: sueldos ────────────────────────────────────────────────────────

export function employeeRow(employee: PayrollEmployee) {
  const balance = employeeBalanceCents(employee)
  return compact({
    id: employee.id,
    empleado: employee.name,
    cobra: PAY_FREQUENCY_LABELS[employee.payFrequency],
    sueldo: money(employee.salaryCents),
    adelantos: moneyIf(employee.advancesCents),
    pagado: moneyIf(employee.paidCents),
    saldo: balance < 0 ? `le pagaste ${money(-balance)} de más` : money(balance),
    inactivo: employee.active ? null : true,
  })
}

export function payrollData(report: PayrollReport, today: string) {
  const totals = payrollTotals(report.employees)
  const offer = accrualOffer(report, today)
  const { filas, hay_mas } = capped(report.employees.map(employeeRow), LIST_MAX)
  return {
    mes: formatMonthLabel(report.month),
    sueldos: money(totals.salaryCents),
    adelantos: money(totals.advancesCents),
    pagado: money(totals.paidCents),
    le_debes_a_fin_de_mes: money(totals.owedCents),
    devengado:
      offer.kind === 'done'
        ? { comprobante_id: offer.accrual.documentId, total: money(offer.accrual.amountCents) }
        : false,
    cuantos: totals.count,
    filas,
    hay_mas,
  }
}

// ─── Las herramientas ────────────────────────────────────────────────────────

/** Gastos fijos y sueldos. */
export const gastosReadTools = [
  defineTool({
    name: 'ver_gastos_fijos',
    description:
      'Los gastos fijos de un mes: cuáles faltan y cuáles se pagaron, con id, monto y vencimiento, y los totales con los sueldos. Se puede mirar este mes o el que viene.',
    input: z.object({
      mes: monthField('Este mes o el que viene, yyyy-MM. Si no se dice, este.').optional(),
    }),
    need: 'read',
    doing: () => 'Mirando los gastos fijos',
    done: () => 'Miré los gastos fijos',
    run: async (input, ctx) => {
      const month = input.mes ? parseSheetMonth(input.mes, ctx.today) : monthOf(ctx.today)
      if (!month) {
        return {
          kind: 'error',
          message:
            'La planilla de gastos fijos muestra este mes y el que viene. Para otro mes, buscá los comprobantes con buscar_comprobantes.',
        }
      }
      // Con los inactivos: un gasto en cuotas que terminó este mes se apaga solo, pero lo que se
      // pagó sigue contando. Es la misma lectura de la pantalla y del Resumen.
      const [rows, payments, payroll] = await Promise.all([
        listRecurringExpenses(ctx.tenantId, { includeInactive: true, today: ctx.today }),
        listRecurringPayments(ctx.tenantId),
        settleQuery(getPayrollReport(ctx.tenantId, month)),
      ])
      const sheet = buildSheet(rows, payments, { month, today: ctx.today })
      const salaries = payroll.ok ? payrollTotals(payroll.data.employees) : null
      return {
        kind: 'data',
        data: sheetData(sheet, sheetTotals(sheet, salaries), salaries),
      }
    },
  }),

  defineTool({
    name: 'ver_sueldos',
    description:
      'La planilla de sueldos de un mes: cada empleado con su id, sueldo, adelantos, lo pagado y su saldo, y si el mes ya se devengó.',
    input: z.object({
      mes: monthField('Mes yyyy-MM. Si no se dice, el actual.').optional(),
    }),
    need: 'read',
    doing: () => 'Mirando los sueldos',
    done: () => 'Miré los sueldos',
    run: async (input, ctx) => {
      const month = texMonth(input.mes, ctx.today)
      if (!month.ok) return { kind: 'error', message: month.message }
      const report = await getPayrollReport(ctx.tenantId, month.month)
      return { kind: 'data', data: payrollData(report, ctx.today) }
    },
  }),
]
