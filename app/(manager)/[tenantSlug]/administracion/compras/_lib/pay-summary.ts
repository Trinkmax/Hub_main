/**
 * La hoja «Pagar», lo puro de lo que se LEE: la oración que dice cómo queda la
 * deuda después del pago («Le quedás debiendo $ X»), los atajos que mueven los
 * tildes («Lo vencido», «Todo»), el encabezado y los renglones del ticket.
 * Lo prueba `tests/lib/administracion-pagar-resumen.test.ts`.
 *
 * No hace ninguna cuenta nueva: lee el resultado de `planPayment`
 * (`payment-plan.ts`), que es la misma ecuación del motor. Acá solo se pasa a
 * palabras.
 */

import { formatCentsShort } from '@/lib/money'
import type { PaymentPlan } from './payment-plan'

type DebtLike = { lineId: string; openCents: number; dueDate: string | null }

// ─── Los atajos de «¿Qué le pagás?» ──────────────────────────────────────────

export type QuickSelection = { ids: string[]; cents: number }

/**
 * Lo que tilda cada atajo: «Lo vencido» (lo que ya pasó su fecha) y «Todo».
 * Son los mismos tildes de siempre, puestos de una.
 */
export function quickSelections(
  debts: readonly DebtLike[],
  today: string,
): { overdue: QuickSelection; all: QuickSelection } {
  const pick = (list: readonly DebtLike[]): QuickSelection => ({
    ids: list.map((d) => d.lineId),
    cents: list.reduce((sum, d) => sum + d.openCents, 0),
  })
  return {
    overdue: pick(debts.filter((d) => d.dueDate !== null && d.dueDate < today)),
    all: pick(debts),
  }
}

/** Cuál de los atajos coincide con lo que está tildado ahora (`null`: una mezcla a mano). */
export function activeQuick(
  selected: ReadonlySet<string>,
  quick: { overdue: QuickSelection; all: QuickSelection },
): 'none' | 'overdue' | 'all' | null {
  if (selected.size === 0) return 'none'
  const same = (ids: readonly string[]) =>
    ids.length === selected.size && ids.every((id) => selected.has(id))
  // Si todo está vencido, los dos atajos tildan lo mismo: se marca «Todo».
  if (same(quick.all.ids)) return 'all'
  if (same(quick.overdue.ids)) return 'overdue'
  return null
}

// ─── El encabezado ───────────────────────────────────────────────────────────

/** Debajo de «Pagar a {nombre}»: cuánto se le debe y en cuántas compras. */
export function payHeadline(input: {
  debtCents: number
  creditCents: number
  /** Cuántas compras sin pagar. */
  count: number
}): string {
  const credit = input.creditCents > 0 ? formatCentsShort(input.creditCents) : null
  if (input.debtCents <= 0) {
    return credit
      ? `No le debés nada y tenés ${credit} a favor.`
      : 'No le debés nada: lo que le des queda a cuenta.'
  }
  const where = input.count === 1 ? 'en 1 compra' : `en ${input.count} compras`
  const debt = `Le debés ${formatCentsShort(input.debtCents)} ${where}`
  return credit ? `${debt} y tenés ${credit} a favor.` : `${debt}.`
}

// ─── Cómo queda después del pago ─────────────────────────────────────────────

export type PaymentOutcomeKind = 'nothing' | 'clears' | 'remains' | 'on_account'

export type PaymentOutcome = {
  kind: PaymentOutcomeKind
  /** La oración principal: «Le quedás debiendo $ 2.956.600.» */
  sentence: string
  /** Lo que la acompaña: la compra que queda a medias, lo que sobra. */
  details: string[]
  /** Lo que este pago cubre de la deuda (con lo que tenés a favor y el redondeo). */
  coveredCents: number
  /** Toda la deuda de la cuenta que se está pagando. */
  totalCents: number
  /** Lo que queda debiendo después. */
  remainingCents: number
}

type PlanLike = Pick<
  PaymentPlan,
  | 'amountCents'
  | 'appliedCents'
  | 'creditUsedCents'
  | 'writeOffCents'
  | 'onAccountCents'
  | 'partials'
  | 'applications'
>

/**
 * Una sola oración en lugar de tres avisos sueltos: con este pago, ¿cuánto le
 * quedás debiendo? `debtTotalCents` es TODO lo que se le debe en esa cuenta
 * (lo tildado y lo que no), así «Le quedás debiendo» cuenta también lo que no
 * se tocó.
 */
export function paymentOutcome(input: { plan: PlanLike; debtTotalCents: number }): PaymentOutcome {
  const { plan } = input
  const total = Math.max(0, input.debtTotalCents)
  const covered = Math.min(total, Math.max(0, plan.appliedCents))
  const remaining = total - covered
  const base = { coveredCents: covered, totalCents: total, remainingCents: remaining }
  const moves = plan.amountCents > 0 || plan.appliedCents > 0

  if (!moves) {
    return {
      ...base,
      kind: 'nothing',
      sentence:
        total > 0
          ? 'Tildá lo que le pagás o escribí cuánto.'
          : 'Escribí cuánto le dejás: queda a cuenta.',
      details: [],
    }
  }

  // Plata que no paga ninguna compra (no hay ninguna, o no se tildó ninguna): queda a cuenta.
  if (plan.appliedCents <= 0) {
    return {
      ...base,
      kind: 'on_account',
      sentence: `Le dejás ${formatCentsShort(plan.onAccountCents)} a cuenta: se descuentan de la próxima compra.`,
      details: total > 0 ? [`Lo que le debés queda igual: ${formatCentsShort(total)}.`] : [],
    }
  }

  const details: string[] = []
  // La compra que este pago toca pero no termina de pagar.
  const touched = new Set(plan.applications.map((a) => a.lineId))
  for (const partial of plan.partials) {
    if (touched.has(partial.lineId)) {
      details.push(
        `${partial.label} queda con ${formatCentsShort(partial.pendingCents)} sin pagar.`,
      )
    }
  }
  if (plan.onAccountCents > 0) {
    details.push(
      `Sobran ${formatCentsShort(plan.onAccountCents)}: quedan a tu favor y se descuentan de la próxima compra.`,
    )
  }
  if (remaining <= 0) {
    return { ...base, kind: 'clears', sentence: 'Con esto no le debés más nada.', details }
  }
  return {
    ...base,
    kind: 'remains',
    sentence: `Le quedás debiendo ${formatCentsShort(remaining)}.`,
    details,
  }
}

// ─── El ticket del pago ──────────────────────────────────────────────────────

/** Cuántas compras se nombran en el ticket antes de «y N más». */
export const PAY_TICKET_ROWS = 3

/** Los renglones del ticket: una compra por renglón (las primeras) y cuántas quedaron afuera. */
export function payTicketRows(
  applications: ReadonlyArray<{ lineId: string; amountCents: number }>,
  labelOf: (lineId: string) => string | undefined,
  max = PAY_TICKET_ROWS,
): { rows: Array<{ key: string; label: string; cents: number }>; more: number; moreCents: number } {
  const shown = applications.slice(0, max)
  const rest = applications.slice(max)
  return {
    rows: shown.map((a) => ({
      key: a.lineId,
      label: labelOf(a.lineId) ?? 'Compra',
      cents: a.amountCents,
    })),
    more: rest.length,
    moreCents: rest.reduce((sum, a) => sum + a.amountCents, 0),
  }
}

// ─── «Un gasto fijo» ─────────────────────────────────────────────────────────

type RecurringLike = { id: string; name: string; nextDueDate: string; pending: boolean }

/** Los gastos fijos de este mes que todavía no se cargaron, el que vence antes primero. */
export function pendingRecurring<T extends RecurringLike>(recurring: readonly T[]): T[] {
  return recurring
    .filter((r) => r.pending)
    .sort(
      (a, b) => a.nextDueDate.localeCompare(b.nextDueDate) || a.name.localeCompare(b.name, 'es'),
    )
}
