/**
 * El Resumen, puro: los tres números del panel verde, las cuentas de al lado y los renglones de
 * «Para hoy». Sale de lo que ya calcula `lib/accounting/home.ts`; acá se elige qué se muestra y cómo
 * se dice, en la forma del prototipo aprobado. Lo prueba `administracion-resumen-render.test.tsx`.
 *
 * Las reglas de siempre: `null` no es cero (un dato que falta se dibuja «—», nunca `$ 0`) y nunca un
 * menos pelado.
 */

import {
  fixedDueRows,
  fixedProgress,
  type HomeAction,
  type HomeRecurringRow,
  integrationForBooks,
  payablesTranches,
  type RecurringPayments,
  type SetupStrip,
  type TodayItem,
} from '@/lib/accounting/home'
import type { PayrollTotals } from '@/lib/accounting/payroll'
import type { Projection } from '@/lib/accounting/projection'
import type { IntegrationAttentionItem } from '@/lib/accounting/queries/integrations'
import type { AccSummary, SummaryAttentionItem } from '@/lib/accounting/queries/summary'
import type { WeekPlanTotals } from '@/lib/accounting/week-plan'
import { daysBetween, formatDayMonth, isRealIsoDay, monthName, weekdayName } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

// ─── Las cuentas al lado de «Plata hoy» ──────────────────────────────────────

export type HeroAccount = { id: string; name: string; text: string; href: string }

/** Cuántas cuentas entran al lado del número; el resto es «y N más», que lleva a Caja. */
export const HERO_ACCOUNTS_MAX = 6

/**
 * Las cuentas con lo que tienen, en el orden de Ajustes. Lo que no es plata se dice con palabras:
 * un descubierto, y lo que debe la tarjeta de la empresa (sin deuda, la tarjeta no se nombra).
 */
export function heroAccounts(
  summary: Pick<AccSummary, 'treasuries'>,
  base: string,
): { accounts: HeroAccount[]; more: number } {
  const all: HeroAccount[] = []
  for (const t of summary.treasuries) {
    const href = `${base}/cajas/${t.id}`
    if (t.kind === 'credit_card') {
      if (t.balanceCents < 0) {
        all.push({
          id: t.id,
          name: t.name,
          text: `debe ${formatCentsShort(-t.balanceCents)}`,
          href,
        })
      }
      continue
    }
    all.push({
      id: t.id,
      name: t.name,
      text:
        t.balanceCents < 0
          ? `descubierto ${formatCentsShort(-t.balanceCents)}`
          : formatCentsShort(t.balanceCents),
      href,
    })
  }
  return {
    accounts: all.slice(0, HERO_ACCOUNTS_MAX),
    more: Math.max(0, all.length - HERO_ACCOUNTS_MAX),
  }
}

// ─── Los tres números ────────────────────────────────────────────────────────

export type HeroNumber = {
  key: 'debt' | 'fixed' | 'sold'
  label: string
  /** `null`: no se sabe. Se dibuja «—», nunca `$ 0`. */
  cents: number | null
  hint: string | null
  href: string
}

function debtNumber(
  payables: AccSummary['payables'] | undefined,
  openingPending: boolean,
  base: string,
): HeroNumber {
  const number = (cents: number | null, hint: string | null): HeroNumber => ({
    key: 'debt',
    label: 'Le debés a proveedores',
    cents,
    hint,
    href: `${base}/compras`,
  })
  const tranches = payablesTranches(payables ?? null, { openingPending })
  if (!tranches) return number(null, null)
  if (tranches.unknown) return number(null, 'Entra con los saldos iniciales')
  if (tranches.isEmpty) return number(0, 'Nada pendiente')
  const overdue = tranches.tranches.find((t) => t.key === 'overdue')?.cents ?? 0
  const week = tranches.tranches.find((t) => t.key === 'week')?.cents ?? 0
  return number(
    tranches.totalCents,
    overdue > 0
      ? `${formatCentsShort(overdue)} vencido`
      : week > 0
        ? `${formatCentsShort(week)} vence esta semana`
        : 'Nada vencido',
  )
}

/** Lo que hace falta saber de los sueldos del mes (`payrollTotals`). */
export type HeroPayroll = Pick<
  PayrollTotals,
  'owedCents' | 'salaryCents' | 'advancesCents' | 'paidCents'
>

/**
 * Lo que falta de gastos fijos (las mismas cuentas de su pestaña: `fixedProgress`) y de sueldos.
 * Lo que no se pudo leer no suma, y se dice: un número a medias nunca pasa por entero.
 */
function fixedNumber(
  input: {
    recurring: readonly HomeRecurringRow[] | null
    payments: RecurringPayments | null
    payroll: HeroPayroll | null
    today: string
  },
  base: string,
): HeroNumber {
  const number = (cents: number | null, hint: string | null): HeroNumber => ({
    key: 'fixed',
    label: 'Falta de fijos y sueldos',
    cents,
    hint,
    href: `${base}/gastos-fijos`,
  })
  const payroll = input.payroll?.owedCents ?? null
  const hasSalaries =
    input.payroll !== null &&
    (input.payroll.salaryCents > 0 ||
      input.payroll.advancesCents > 0 ||
      input.payroll.paidCents > 0)
  const fixed = input.recurring ? fixedProgress(input.recurring, input.payments, input.today) : null
  const fixedCents =
    fixed?.state === 'progress' ? fixed.remainingCents : fixed?.state === 'nothing_due' ? 0 : null
  const amountsMissing = fixed?.state === 'no_amounts' ? fixed.missingAmount : 0

  // Sin ningún gasto fijo con monto y sin sueldos cargados, un cero no es un dato (la misma regla
  // del totalizador de Gastos y sueldos: `sheetTotals`).
  if (fixedCents === null && !hasSalaries) {
    if (amountsMissing > 0) return number(null, `${amountsMissing} sin monto`)
    if (fixed?.state === 'empty' && payroll !== null) return number(null, 'Todavía sin cargar')
    return number(null, null)
  }

  const total = (fixedCents ?? 0) + (payroll ?? 0)
  if (fixed === null) return number(total, 'Sin contar los fijos')
  if (payroll === null) return number(total, 'Sin contar los sueldos')
  if (amountsMissing > 0) return number(total, `${amountsMissing} sin monto`)
  if (fixed.overdueCents > 0) {
    return number(total, `${formatCentsShort(fixed.overdueCents)} de fijos vencido`)
  }
  if (fixedCents !== null && fixedCents > 0) {
    return number(total, `${formatCentsShort(fixedCents)} de fijos`)
  }
  return number(total, payroll > 0 ? `${formatCentsShort(payroll)} de sueldos` : 'Al día')
}

function soldNumber(
  projection: Pick<Projection, 'summary' | 'days'> | null,
  today: string,
  base: string,
): HeroNumber {
  const month = monthName(Number(today.slice(5, 7)))
  const number = (cents: number | null, hint: string | null): HeroNumber => ({
    key: 'sold',
    label: month ? `Vendiste en ${month}` : 'Vendiste este mes',
    cents,
    hint,
    href: `${base}/ventas`,
  })
  if (!projection) return number(null, null)
  const { summary, days } = projection
  // Un mes sin ningún cierre no vendió cero: todavía no se cargó.
  if (!days.some((day) => day.hasClose)) {
    return number(
      null,
      summary.hasTargets
        ? `Objetivo ${formatCentsShort(summary.monthTargetCents)}`
        : 'Todavía sin cierres',
    )
  }
  return number(
    summary.soldCents,
    summary.hasTargets ? `Objetivo ${formatCentsShort(summary.monthTargetCents)}` : 'Sin objetivo',
  )
}

export function heroNumbers(input: {
  base: string
  today: string
  summary: Pick<AccSummary, 'payables'> | null
  /** Faltan los saldos iniciales: ahí va lo que el bar ya debía al empezar. */
  openingPending: boolean
  recurring: readonly HomeRecurringRow[] | null
  payments: RecurringPayments | null
  /** Los sueldos del mes. `null`: no se pudieron leer. */
  payroll: HeroPayroll | null
  projection: Pick<Projection, 'summary' | 'days'> | null
}): HeroNumber[] {
  const { base, today } = input
  return [
    debtNumber(input.summary?.payables, input.openingPending, base),
    fixedNumber(input, base),
    soldNumber(input.projection, today, base),
  ]
}

// ─── «Para hoy» ──────────────────────────────────────────────────────────────

export type ParaHoyRow = {
  key: 'close' | 'plan' | 'overdue' | 'integration' | 'setup'
  title: string
  /** Al lado del título, en gris. */
  detail: string | null
  /** El detalle es lo vencido: va en el color de lo vencido. */
  late: boolean
  action: HomeAction | null
  /** No hay acción: lo que no cargó se vuelve a pedir («Reintentar»). */
  retry: boolean
}

function row(
  key: ParaHoyRow['key'],
  title: string,
  detail: string | null,
  action: HomeAction | null,
  extra: Partial<Pick<ParaHoyRow, 'late' | 'retry'>> = {},
): ParaHoyRow {
  return { key, title, detail, action, late: false, retry: false, ...extra }
}

/** «martes 03/11». */
function weekdayAndDay(iso: string): string {
  const weekday = weekdayName(iso)
  return weekday ? `${weekday} ${formatDayMonth(iso)}` : formatDayMonth(iso)
}

/** La fecha que trae el link de cargar un cierre (`/ventas/cierre?fecha=2026-11-03`). */
function closeDateOf(action: HomeAction): string | null {
  if (action.kind !== 'href') return null
  const fecha = new URLSearchParams(action.href.split('?')[1] ?? '').get('fecha')
  return fecha && isRealIsoDay(fecha) ? fecha : null
}

/**
 * «Falta el cierre de ayer · martes 03/11». Sale de la tarjeta que ya arma `buildToday`: si está
 * hecho, o si no hay nada que cargar todavía (el primer día de los libros), no va.
 */
function closeRow(items: readonly TodayItem[]): ParaHoyRow | null {
  const item = items.find((i) => i.id === 'daily_close')
  if (!item || item.done || item.action === null) return null
  const action: HomeAction = { ...item.action, label: 'Cargar' }
  // No se pudo saber si falta (no cargó nada de donde sale): se ofrece, sin afirmarlo.
  if (item.tone === 'muted') return row('close', item.title, item.status, action)
  if (item.title === 'Los cierres del día') {
    return row('close', 'Faltan cierres del día', item.status.replace(/\.$/, ''), action)
  }
  const date = closeDateOf(item.action)
  return row(
    'close',
    item.title === 'El cierre de ayer' ? 'Falta el cierre de ayer' : 'Falta un cierre del día',
    date ? weekdayAndDay(date) : null,
    action,
  )
}

/** «Plan de la semana · llevás $ X de $ Y». Sin presupuesto y sin nada que pagar, no hay renglón. */
function planRow(plan: WeekPlanTotals | null, base: string): ParaHoyRow | null {
  if (!plan) return null
  const action: HomeAction = { kind: 'href', href: `${base}/compras/semana`, label: 'Abrir' }
  if (plan.budgetCents > 0) {
    return row(
      'plan',
      'Plan de la semana',
      `llevás ${formatCentsShort(plan.paidCents)} de ${formatCentsShort(plan.budgetCents)}`,
      action,
    )
  }
  if (plan.debtCents > 0 || plan.paidCents > 0) {
    return row('plan', 'Plan de la semana', 'todavía sin armar', action)
  }
  return null
}

function lateDays(item: SummaryAttentionItem, today: string): number {
  if (item.days !== null) return Math.abs(item.days)
  return item.date ? Math.max(0, daysBetween(item.date, today)) : 0
}

function lateText(days: number): string | null {
  if (days <= 0) return null
  return days === 1 ? 'vencido hace 1 día' : `vencido hace ${days} días`
}

/**
 * Lo vencido más urgente: el comprobante o el gasto fijo con más días de atraso, con su «Pagar». Si
 * hay más, se dice cuántos (el total y lo vencido ya están en el panel de arriba).
 */
function overdueRow(input: {
  summary: Pick<AccSummary, 'attention' | 'payables'> | null
  recurring: readonly HomeRecurringRow[] | null
  today: string
  base: string
}): ParaHoyRow | null {
  const { summary, today, base } = input
  const payables = (summary?.attention ?? []).filter((item) => item.kind === 'payable_overdue')
  const fixed = fixedDueRows(input.recurring).filter((r) => r.daysToDue < 0)
  const payable = payables.reduce<SummaryAttentionItem | null>(
    (worst, item) =>
      worst === null || lateDays(item, today) > lateDays(worst, today) ? item : worst,
    null,
  )
  const oldestFixed = fixed[0] ?? null
  if (payable === null && oldestFixed === null) return null

  // Los avisos llegan topeados: el total de proveedores con algo vencido es el de la base.
  const partiesRed = Math.max(payables.length, summary?.payables?.partiesRed ?? 0)
  const others = partiesRed + fixed.length - 1
  const more = others > 0 ? `y ${others} más` : null
  const join = (...parts: Array<string | null>) => parts.filter(Boolean).join(' · ') || null

  if (
    payable !== null &&
    (oldestFixed === null || lateDays(payable, today) >= -oldestFixed.daysToDue)
  ) {
    const days = lateDays(payable, today)
    return row(
      'overdue',
      payable.label.trim() || 'Una factura',
      join(
        payable.amountCents === null ? null : formatCentsShort(payable.amountCents),
        lateText(days),
        more,
      ),
      payable.partyId
        ? { kind: 'sheet', sheet: 'pagar', params: { proveedor: payable.partyId }, label: 'Pagar' }
        : { kind: 'href', href: `${base}/compras`, label: 'Ver' },
      { late: true },
    )
  }

  if (oldestFixed === null) return null
  return row(
    'overdue',
    oldestFixed.name,
    join(
      oldestFixed.amountCents === null ? 'sin monto' : formatCentsShort(oldestFixed.amountCents),
      lateText(-oldestFixed.daysToDue),
      more,
    ),
    { kind: 'sheet', sheet: 'gasto', params: { 'gasto-fijo': oldestFixed.id }, label: 'Pagar' },
    { late: true },
  )
}

/**
 * Lo de ARCA y los archivos: los comprobantes para revisar y lo que dejó de andar. Un solo renglón,
 * el más urgente (vienen ordenados por urgencia); `href` viene relativo a la sección.
 */
function integrationRow(input: {
  /** `null`: la lectura falló y lo que hay que decir es eso. */
  integration: readonly IntegrationAttentionItem[] | null
  today: string
  booksStartDate: string | null
  base: string
}): ParaHoyRow | null {
  if (input.integration === null) {
    return row('integration', 'No pudimos revisar ARCA ni los archivos', null, null, {
      retry: true,
    })
  }
  const items = integrationForBooks(input.integration, {
    today: input.today,
    booksStartDate: input.booksStartDate,
  })
  const first = items[0]
  if (!first) return null
  return row(
    'integration',
    first.label.replace(/\.$/, ''),
    items.length > 1 ? `y ${items.length - 1} más` : null,
    { kind: 'href', href: `${input.base}${first.href}`, label: first.actionLabel },
  )
}

/**
 * «Puesta en marcha · te faltan N pasos», mientras falte algo: «no la encuentran» fue un reclamo de
 * la reunión. Los pasos son los que cuenta la guía, adonde lleva. Si no se sabe el avance, no se
 * afirma un número.
 */
function setupRow(setup: SetupStrip, countKnown: boolean): ParaHoyRow | null {
  const left = setup.total - setup.done
  const action: HomeAction = { kind: 'href', href: setup.guideHref, label: 'Seguir' }
  if (!countKnown) {
    return setup.complete ? null : row('setup', 'Puesta en marcha', null, action)
  }
  if (left <= 0) return null
  return row(
    'setup',
    'Puesta en marcha',
    left === 1 ? 'te falta 1 paso' : `te faltan ${left} pasos`,
    action,
  )
}

/** Máximo cinco renglones, uno por cada cosa, en el orden del día. */
export function paraHoyRows(input: {
  items: readonly TodayItem[]
  setup: SetupStrip
  /** Con la guía o con el resumen se sabe contar los pasos; sin ninguno de los dos, no. */
  setupCountKnown: boolean
  summary: Pick<AccSummary, 'attention' | 'payables'> | null
  recurring: readonly HomeRecurringRow[] | null
  weekPlan: WeekPlanTotals | null
  integration: readonly IntegrationAttentionItem[] | null
  booksStartDate: string | null
  today: string
  base: string
}): ParaHoyRow[] {
  const rows = [
    closeRow(input.items),
    planRow(input.weekPlan, input.base),
    overdueRow(input),
    integrationRow(input),
    setupRow(input.setup, input.setupCountKnown),
  ]
  return rows.filter((r): r is ParaHoyRow => r !== null)
}
