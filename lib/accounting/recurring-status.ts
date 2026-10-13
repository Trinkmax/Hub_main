/**
 * La lista de gastos fijos como la planilla de los socios (pedido del
 * 12/10/2026): qué cuota es, cuánto había que pagar, cuánto se pagó, cuánto
 * falta y los tres totales. Sin I/O ni `server-only`: lo usan la lista y el
 * formulario. Lo prueba `administracion-gastos-fijos-estado.test.ts`.
 *
 * Cada renglón muestra un vencimiento:
 * - el próximo, si vence este mes o ya venció y no se cargó (`pending`);
 * - el que cubre el último comprobante, si es el de este mes (`loaded`);
 * - si no, el próximo, que es de más adelante (`upcoming`, `skipped`).
 * Los totales suman solo los dos primeros.
 */

/** Lo que la lista necesita de un gasto fijo (`RecurringExpenseRow` lo cumple). */
export type RecurringRowFacts = {
  active: boolean
  /** En cuotas y ya pasó la última. */
  ended: boolean
  monthStatus: 'loaded' | 'pending' | 'skipped' | 'upcoming'
  nextDueDate: string
  /** El vencimiento que cubrió el último comprobante. */
  loadedDue: string | null
  /** `null` = monto variable. */
  amountCents: number | null
  /** Vencimientos que faltan contando el próximo (`null` = no termina). */
  remainingDues: number | null
  installmentsTotal: number | null
}

/** El último comprobante vigente de un gasto fijo, con lo pagado (`acc_report_recurring_status`). */
export type RecurringDocument = {
  id: string
  kind: string
  accountingDate: string
  dueDate: string | null
  totalCents: number
  /** Un gasto de contado está pago al cargarlo; una factura en cuenta corriente, lo imputado. */
  paidCents: number
  /** Lo que le falta al comprobante (su partida abierta). */
  openCents: number
}

export type RecurringPaymentFacts = {
  /** `null` = nunca se cargó, o el último se anuló. */
  document: RecurringDocument | null
  /** Lo que falta de los comprobantes anteriores a ese. */
  priorOpenCents: number
}

// ─── Cuotas ──────────────────────────────────────────────────────────────────

export type RecurringInstallment = {
  /** Qué cuota es (`null` = no se sabe de cuántas). */
  current: number | null
  total: number | null
  /** Cuántas faltan contando esta. */
  remaining: number
}

/**
 * Qué cuota es la de un vencimiento. `remainingDues` cuenta desde el próximo:
 * si el renglón muestra el anterior (el que ya se cargó), falta una más.
 * `null` si no termina o ya no queda ninguna. Un total más chico que las que
 * faltan no sirve: se muestra solo cuántas quedan.
 */
export function recurringInstallment(
  input: { remainingDues: number | null; installmentsTotal: number | null },
  shown: 'next' | 'loaded' = 'next',
): RecurringInstallment | null {
  if (input.remainingDues === null) return null
  const remaining = input.remainingDues + (shown === 'loaded' ? 1 : 0)
  if (remaining < 1) return null
  const total = input.installmentsTotal
  if (total === null || total < remaining) return { current: null, total: null, remaining }
  return { current: total - remaining + 1, total, remaining }
}

/**
 * «2 de 6» con el total; sin el total, «Quedan 3» o «Última». `null` = no
 * termina. `long` es para cuando no hay una columna «Cuota» que lo explique:
 * «Cuota 2 de 6», «Quedan 3 cuotas», «Última cuota».
 */
export function installmentLabel(
  installment: RecurringInstallment | null,
  form: 'short' | 'long' = 'short',
): string | null {
  if (installment === null) return null
  const long = form === 'long'
  if (installment.current !== null && installment.total !== null) {
    return `${long ? 'Cuota ' : ''}${installment.current} de ${installment.total}`
  }
  if (installment.remaining === 1) return long ? 'Última cuota' : 'Última'
  return `Quedan ${installment.remaining}${long ? ' cuotas' : ''}`
}

// ─── El renglón ──────────────────────────────────────────────────────────────

/**
 * `paid` Pago · `partial` Pago parcial · `unpaid` Sin pagar · `overdue`
 * Vencido · `no_amount` Sin monto · `upcoming` Vence el … · `skipped` Salteado
 * · `ended` Terminó · `paused` Pausado.
 */
export type RecurringLineState =
  | 'paid'
  | 'partial'
  | 'unpaid'
  | 'overdue'
  | 'no_amount'
  | 'upcoming'
  | 'skipped'
  | 'ended'
  | 'paused'

export type RecurringLine = {
  state: RecurringLineState
  /** El vencimiento del renglón (`null` en uno pausado o terminado). */
  dueDate: string | null
  /** Lo que había que pagar (`null` = variable y todavía no se cargó). */
  dueCents: number | null
  /** Lo pagado y lo que falta: `null` si el renglón no entra en los totales. */
  paidCents: number | null
  remainingCents: number | null
  /** «Sin monto» con el vencimiento ya pasado. */
  pastDue: boolean
  /** El comprobante cargado de ese vencimiento. */
  documentId: string | null
  installment: RecurringInstallment | null
  /** Lo que quedó sin pagar de comprobantes de vencimientos anteriores. */
  priorOpenCents: number
}

/**
 * El renglón de un gasto fijo.
 *
 * - Monto: el monto fijo; si es variable, el total del comprobante cargado.
 * - Pagado: lo pagado de ese comprobante. Falta = Monto − Pagado, nunca menos de cero.
 * - «Vencido» le gana a «Pago parcial»: pasó el vencimiento y falta algo. En
 *   una factura en cuenta corriente manda el vencimiento de la factura.
 * - Uno pausado no se informa aunque tenga algo cargado.
 */
export function recurringLine(
  row: RecurringRowFacts,
  facts: RecurringPaymentFacts | null | undefined,
  today: string,
): RecurringLine {
  const doc = facts?.document ?? null
  const paused = !row.active && !row.ended
  const loaded = !paused && row.monthStatus === 'loaded' ? doc : null
  // El último comprobante, si no es el de este renglón, es de un vencimiento anterior.
  const priorOpenCents =
    Math.max(0, facts?.priorOpenCents ?? 0) + (loaded || !doc ? 0 : Math.max(0, doc.openCents))

  if (loaded) {
    const dueDate = loaded.dueDate ?? row.loadedDue ?? loaded.accountingDate
    const dueCents = row.amountCents ?? loaded.totalCents
    const paidCents = Math.max(0, loaded.paidCents)
    const remainingCents = Math.max(0, dueCents - paidCents)
    const state: RecurringLineState =
      remainingCents === 0
        ? 'paid'
        : dueDate < today
          ? 'overdue'
          : paidCents > 0
            ? 'partial'
            : 'unpaid'
    return {
      state,
      dueDate,
      dueCents,
      paidCents,
      remainingCents,
      pastDue: false,
      documentId: loaded.id,
      installment: recurringInstallment(row, 'loaded'),
      priorOpenCents,
    }
  }

  const blank = {
    dueCents: row.amountCents,
    paidCents: null,
    remainingCents: null,
    pastDue: false,
    documentId: null,
    priorOpenCents,
  }
  if (row.ended) return { ...blank, state: 'ended', dueDate: null, installment: null }
  const installment = recurringInstallment(row)
  if (paused) return { ...blank, state: 'paused', dueDate: null, installment }

  if (row.monthStatus === 'pending') {
    const dueDate = row.nextDueDate
    if (row.amountCents === null) {
      return { ...blank, state: 'no_amount', dueDate, pastDue: dueDate < today, installment }
    }
    return {
      ...blank,
      state: dueDate < today ? 'overdue' : 'unpaid',
      dueDate,
      paidCents: 0,
      remainingCents: row.amountCents,
      installment,
    }
  }

  return {
    ...blank,
    state: row.monthStatus === 'skipped' ? 'skipped' : 'upcoming',
    dueDate: row.nextDueDate,
    installment,
  }
}

/** Los que piden hacer algo (cargar o pagar): van primero en la lista. */
export function needsAction(state: RecurringLineState): boolean {
  return state === 'overdue' || state === 'unpaid' || state === 'partial' || state === 'no_amount'
}

// ─── Los tres totales ────────────────────────────────────────────────────────

export type RecurringTotals = {
  /** «Falta pagar». */
  remainingCents: number
  /** «Ya pagaste». */
  paidCents: number
  /** «Vencido»: lo que falta de los que ya pasaron el vencimiento. */
  overdueCents: number
  /** Los que entran en los totales (con monto conocido). */
  countedRows: number
  /** Vencen este mes pero no tienen monto: no suman. */
  noAmountCount: number
  /** Aparte: lo que quedó sin pagar de vencimientos anteriores. */
  priorOpenCents: number
}

export function recurringTotals(lines: readonly RecurringLine[]): RecurringTotals {
  const totals: RecurringTotals = {
    remainingCents: 0,
    paidCents: 0,
    overdueCents: 0,
    countedRows: 0,
    noAmountCount: 0,
    priorOpenCents: 0,
  }
  for (const line of lines) {
    totals.priorOpenCents += line.priorOpenCents
    if (line.state === 'no_amount') totals.noAmountCount += 1
    if (line.remainingCents === null || line.paidCents === null) continue
    totals.countedRows += 1
    totals.remainingCents += line.remainingCents
    totals.paidCents += line.paidCents
    if (line.state === 'overdue') totals.overdueCents += line.remainingCents
  }
  return totals
}
