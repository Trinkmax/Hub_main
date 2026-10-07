/**
 * «Pagar» (H.8), la cuenta del formulario: qué facturas cancela el monto, qué
 * saldos a favor se usan, qué queda a cuenta y qué queda pendiente. Puro y
 * en centavos enteros (lo prueba `administracion-compras.test.ts`).
 *
 * Es la misma ecuación que el motor (`buildPayment`, E.5.5): `M` = lo que sale
 * de las cajas, `C` = saldos a favor usados, `W` = diferencia dada por
 * cancelada, `A` = lo aplicado a las facturas. Siempre `C ≤ A ≤ M + W + C` y lo
 * que sobra (`M + W + C − A`) queda a cuenta.
 *
 * Las facturas se cancelan por vencimiento (la más vieja primero, las sin
 * vencimiento al final) y los saldos a favor se consumen del más viejo al más
 * nuevo: si el monto no alcanza, la que queda con saldo es la que vence última.
 */

import { addDays } from '@/lib/dates'

/** Tope de «Dar por cancelado el resto» ($ 1.000, `MAX_WRITE_OFF_CENTS` del motor). */
export const WRITE_OFF_LIMIT_CENTS = 100_000

export type PlanDebt = {
  lineId: string
  label: string
  /** La cuenta de control de la partida: una imputación no cruza cuentas. */
  accountId?: string | null
  /** Lo pendiente de la partida hoy. */
  openCents: number
  /** Cuánto se quiere cancelar de esta partida (≤ pendiente; menos = pago parcial). */
  targetCents: number
  dueDate: string | null
  entryDate: string
}

export type PlanCredit = {
  lineId: string
  label: string
  accountId?: string | null
  openCents: number
  entryDate: string
}

export type PaymentPlanInput = {
  /** Las facturas tildadas. */
  debts: readonly PlanDebt[]
  /** Los saldos a favor tildados. */
  credits: readonly PlanCredit[]
  /** Lo que sale de las cajas; `null` = lo que hace falta para cancelar lo tildado. */
  amountCents: number | null
  /** «Dar por cancelado el resto» tildado. */
  writeOff: boolean
}

export type PlannedItem = { lineId: string; amountCents: number }

export type PaymentPlan = {
  /** Σ lo que se quiere cancelar de las facturas tildadas. */
  debtCents: number
  /** Σ los saldos a favor tildados (lo disponible, no lo usado). */
  creditAvailableCents: number
  /** Lo que habría que pagar con plata para cancelar lo tildado. */
  suggestedCents: number
  /** `M`: lo que sale de las cajas. */
  amountCents: number
  applications: PlannedItem[]
  creditsUsed: PlannedItem[]
  appliedCents: number
  creditUsedCents: number
  writeOffCents: number
  /** Lo que sobra y queda como pago a cuenta. */
  onAccountCents: number
  /** De lo tildado, lo que queda sin cancelar (sin contar la diferencia dada por cancelada). */
  restCents: number
  /** Hay una diferencia chica que se puede dar por cancelada. */
  canWriteOff: boolean
  /** Las facturas tildadas que quedan con algo pendiente después del pago. */
  partials: Array<{ lineId: string; label: string; pendingCents: number }>
}

function nonNegative(n: number): number {
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}

/** Vencimiento (las sin vencimiento al final) → fecha → etiqueta. */
export function compareDebts(a: PlanDebt, b: PlanDebt): number {
  const da = a.dueDate ?? '9999-12-31'
  const db = b.dueDate ?? '9999-12-31'
  if (da !== db) return da < db ? -1 : 1
  if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1
  return a.label.localeCompare(b.label, 'es')
}

function compareCredits(a: PlanCredit, b: PlanCredit): number {
  if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1
  return a.label.localeCompare(b.label, 'es')
}

/** Reparte `budget` en orden, cada uno hasta su tope. */
function fill<T extends { lineId: string }>(
  items: readonly T[],
  capOf: (item: T) => number,
  budget: number,
): PlannedItem[] {
  let left = budget
  const out: PlannedItem[] = []
  for (const item of items) {
    if (left <= 0) break
    const take = Math.min(capOf(item), left)
    if (take > 0) {
      out.push({ lineId: item.lineId, amountCents: take })
      left -= take
    }
  }
  return out
}

export function planPayment(input: PaymentPlanInput): PaymentPlan {
  const debts = [...input.debts]
    .map((d) => ({
      ...d,
      openCents: nonNegative(d.openCents),
      targetCents: Math.min(nonNegative(d.targetCents), nonNegative(d.openCents)),
    }))
    .sort(compareDebts)
  const credits = [...input.credits]
    .map((c) => ({ ...c, openCents: nonNegative(c.openCents) }))
    .sort(compareCredits)

  const D = debts.reduce((sum, d) => sum + d.targetCents, 0)
  const Cr = credits.reduce((sum, c) => sum + c.openCents, 0)
  const suggested = Math.max(0, D - Cr)
  const M = input.amountCents === null ? suggested : nonNegative(input.amountCents)

  // Lo que se puede aplicar sin la diferencia: la plata más los saldos a favor, hasta lo tildado.
  const appliedWithoutWriteOff = Math.min(D, M + Cr)
  const rest = D - appliedWithoutWriteOff
  const canWriteOff = rest > 0 && rest <= WRITE_OFF_LIMIT_CENTS && M > 0
  const W = input.writeOff && canWriteOff ? rest : 0
  const A = appliedWithoutWriteOff + W
  const C = Math.min(Cr, A)

  const applications = fill(debts, (d) => d.targetCents, A)
  const creditsUsed = fill(credits, (c) => c.openCents, C)
  const appliedByLine = new Map(applications.map((a) => [a.lineId, a.amountCents]))
  const partials = debts
    .map((d) => ({
      lineId: d.lineId,
      label: d.label,
      pendingCents: d.openCents - (appliedByLine.get(d.lineId) ?? 0),
    }))
    .filter((p) => p.pendingCents > 0)

  return {
    debtCents: D,
    creditAvailableCents: Cr,
    suggestedCents: suggested,
    amountCents: M,
    applications,
    creditsUsed,
    appliedCents: A,
    creditUsedCents: C,
    writeOffCents: W,
    onAccountCents: M + W + C - A,
    restCents: rest,
    canWriteOff,
    partials,
  }
}

/**
 * «Aplicar el saldo a favor» sin pagar nada (`allocateItems`): cada saldo a
 * favor, del más viejo al más nuevo, contra las facturas por vencimiento.
 * En proveedores la factura es la partida del Haber y el saldo a favor la del
 * Debe.
 */
export function creditPairs(
  debts: readonly PlanDebt[],
  credits: readonly PlanCredit[],
): Array<{ debitLineId: string; creditLineId: string; amountCents: number }> {
  const debtLeft = [...debts].sort(compareDebts).map((d) => ({
    lineId: d.lineId,
    accountId: d.accountId ?? null,
    left: Math.min(nonNegative(d.targetCents), nonNegative(d.openCents)),
  }))
  const pairs: Array<{ debitLineId: string; creditLineId: string; amountCents: number }> = []
  for (const credit of [...credits].sort(compareCredits)) {
    let available = nonNegative(credit.openCents)
    const account = credit.accountId ?? null
    for (const debt of debtLeft) {
      if (available <= 0) break
      if (debt.left <= 0) continue
      if (account !== null && debt.accountId !== null && account !== debt.accountId) continue
      const take = Math.min(available, debt.left)
      pairs.push({ debitLineId: credit.lineId, creditLineId: debt.lineId, amountCents: take })
      debt.left -= take
      available -= take
    }
  }
  return pairs
}

/** Σ de los importes de los medios (las filas sin importe no suman). */
export function sumMethods(methods: ReadonlyArray<{ amountCents: number | null }>): number {
  return methods.reduce((sum, m) => sum + nonNegative(m.amountCents ?? 0), 0)
}

/**
 * Lo que se tilda solo al abrir «Pagar» (H.8): lo vencido, lo que vence en
 * los próximos `soonDays` días y la factura que vino en `?partida=`. Las sin
 * vencimiento no se tildan solas.
 */
export function defaultDebtSelection(
  debts: ReadonlyArray<{ lineId: string; dueDate: string | null }>,
  today: string,
  opts: { soonDays?: number; extra?: string | null } = {},
): string[] {
  const soonDays = opts.soonDays ?? 7
  const limit = addDays(today, soonDays)
  return debts
    .filter((d) => d.lineId === opts.extra || (d.dueDate !== null && d.dueDate <= limit))
    .map((d) => d.lineId)
}

export type MethodRow = {
  key: string
  treasuryId: string | null
  amountCents: number | null
  reference: string
}

/**
 * Los medios de pago listos para el esquema (los que tienen caja e importe) y
 * cuánto falta asignar: con un solo medio, ese medio paga todo el monto; con
 * varios, tienen que sumar el monto.
 */
export function resolveMethods(
  rows: readonly MethodRow[],
  amountCents: number,
): {
  methods: Array<{
    type: 'treasury'
    treasuryAccountId: string
    amountCents: number
    reference: string | null
  }>
  /** Monto − Σ medios (positivo: falta asignar; negativo: sobra). */
  unassignedCents: number
  missingTreasury: boolean
} {
  if (rows.length === 1) {
    const only = rows[0]
    if (!only) return { methods: [], unassignedCents: amountCents, missingTreasury: true }
    if (!only.treasuryId)
      return { methods: [], unassignedCents: 0, missingTreasury: amountCents > 0 }
    return {
      methods:
        amountCents > 0
          ? [
              {
                type: 'treasury',
                treasuryAccountId: only.treasuryId,
                amountCents,
                reference: only.reference.trim() === '' ? null : only.reference.trim(),
              },
            ]
          : [],
      unassignedCents: 0,
      missingTreasury: false,
    }
  }
  const usable = rows.filter((r) => r.amountCents !== null && r.amountCents > 0)
  const missingTreasury = usable.some((r) => !r.treasuryId)
  const methods = usable.flatMap((r) =>
    r.treasuryId && r.amountCents
      ? [
          {
            type: 'treasury' as const,
            treasuryAccountId: r.treasuryId,
            amountCents: r.amountCents,
            reference: r.reference.trim() === '' ? null : r.reference.trim(),
          },
        ]
      : [],
  )
  return { methods, unassignedCents: amountCents - sumMethods(usable), missingTreasury }
}
