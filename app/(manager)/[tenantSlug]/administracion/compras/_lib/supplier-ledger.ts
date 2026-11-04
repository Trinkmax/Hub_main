/**
 * La cuenta corriente de UN proveedor, lo puro: qué dice su totalizador (Saldo · Plazo · Va a), los
 * tramos de lo que se le debe y la escalera de la deuda en el tiempo.
 * Lo prueba `tests/lib/administracion-proveedor-libreta.test.ts`.
 *
 * Sin I/O y sin cuentas nuevas: todo sale de lo que ya devuelven `getPartyPosition` y
 * `getPartyStatement` (el saldo corrido lo calcula la base).
 */

import { categoryShortName } from '@/components/administracion/kit/category'
import type { TotalizerItem } from '@/components/administracion/planilla/totalizer'
import type { AgingSummary } from '@/lib/accounting/aging'
import type { PartyStatementRow } from '@/lib/accounting/queries/parties'
import type { TaxIdType } from '@/lib/accounting/types'
import { addDays, eachIsoDay, formatDayMonth, formatIsoDay } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { formatCentsShort } from '@/lib/money'
import { dueRail, SOON_DAYS } from './libreta'

// ─── El totalizador ──────────────────────────────────────────────────────────

/**
 * «Saldo»: lo que se le debe. Sin deuda no se escribe un «$ 0»: se dice. Sin los saldos iniciales,
 * «al día» sería por lo cargado nomás, así que no se promete. Lo que hay a favor va aparte: no se
 * resta hasta que se usa en un pago.
 */
export function supplierBalanceItem(input: {
  debtCents: number
  creditCents: number
  overdueCents: number
  dueSoonCents: number
  openingPending?: boolean
}): TotalizerItem {
  if (input.debtCents > 0) {
    return {
      label: 'Saldo',
      cents: input.debtCents,
      tone: input.overdueCents > 0 ? 'bad' : input.dueSoonCents > 0 ? 'warn' : 'default',
      hint: input.creditCents > 0 ? `${formatCentsShort(input.creditCents)} a favor` : undefined,
    }
  }
  if (input.creditCents > 0) {
    return { label: 'A favor', cents: input.creditCents, tone: 'ok' }
  }
  return input.openingPending
    ? { label: 'Saldo', text: 'Sin deuda cargada', hint: 'Faltan los saldos iniciales' }
    : { label: 'Saldo', text: 'Al día', tone: 'ok' }
}

/** «21 días», «1 día»; sin plazo, lo dice. */
export function supplierTermText(days: number): string {
  if (days <= 0) return 'Sin plazo'
  return days === 1 ? '1 día' : `${days} días`
}

/** A qué cuenta van sus compras, con la palabra del dueño: «Bebidas sin alcohol». */
export function supplierCategoryText(defaultAccountName: string | null): string | null {
  return defaultAccountName ? categoryShortName(defaultAccountName) : null
}

export type AgingTranche = { key: 'overdue' | 'week' | 'later'; label: string; cents: number }

/** La deuda con uno en los tres tramos de toda la sección (vencido · esta semana · más adelante). */
export function agingTranches(aging: Pick<AgingSummary, 'totals'>): AgingTranche[] {
  const t = aging.totals
  return [
    {
      key: 'overdue',
      label: 'Vencido',
      cents: t.overdue_1_30 + t.overdue_31_60 + t.overdue_60_plus,
    },
    { key: 'week', label: 'Vence esta semana', cents: t.due_soon },
    { key: 'later', label: 'Más adelante', cents: t.not_due + t.no_due },
  ]
}

/** El detalle del pie de «Sin pagar»: los tramos de antigüedad que tienen algo, y el total. */
export function agingMath(
  aging: Pick<AgingSummary, 'totals' | 'totalCents'>,
): Array<{ label: string; cents: number; total?: boolean }> {
  const t = aging.totals
  const rows = [
    { label: 'Vencido hace más de 60 días', cents: t.overdue_60_plus },
    { label: 'Vencido de 31 a 60 días', cents: t.overdue_31_60 },
    { label: 'Vencido de 1 a 30 días', cents: t.overdue_1_30 },
    { label: 'Vence esta semana', cents: t.due_soon },
    { label: 'Más adelante', cents: t.not_due + t.no_due },
  ].filter((row) => row.cents > 0)
  return [...rows, { label: 'Le debés', cents: aging.totalCents, total: true }]
}

/** «CUIT 30-70111222-5», «DNI 30123456», o `null` si no tiene. */
export function documentText(taxIdType: TaxIdType, taxId: string | null): string | null {
  if (taxIdType === 'none' || !taxId) return null
  if (taxIdType === 'dni') return `DNI ${taxId}`
  return `${taxIdType === 'cuil' ? 'CUIL' : 'CUIT'} ${formatCuit(taxId)}`
}

// ─── Los movimientos ─────────────────────────────────────────────────────────

/**
 * El verbo de un movimiento: el sentido lo da la palabra, nunca solo el color
 * ni la columna.
 */
export function ledgerVerb(
  documentKind: string | null,
  move: { increaseCents: number; decreaseCents: number },
): string {
  switch (documentKind) {
    case 'purchase':
      return 'Te dejó'
    case 'purchase_debit_note':
      return 'Te cargó'
    case 'payment':
      return 'Le pagaste'
    case 'purchase_credit_note':
      return 'Te descontó'
    case 'opening':
      return 'Arrancó con'
    default:
      return move.increaseCents > 0 && move.decreaseCents <= 0 ? 'Sumó' : 'Bajó'
  }
}

export type LedgerLineTone = 'ok' | 'warn' | 'late' | 'muted'

export type LedgerLine = {
  id: string
  date: string
  verb: string
  /** El comprobante («Factura A 0003-00001100», «Pago»). */
  label: string
  /** El número interno del comprobante, para nombrar un pago («n.º 12»). */
  seq: number | null
  documentId: string | null
  /** Solo en lo que suma deuda: «pagada», «vencida hace 12 días», «vence el 24/10». */
  status: { text: string; tone: LedgerLineTone } | null
  /** «Te dejó»: lo que sumó a la deuda (`null` si no sumó). */
  increaseCents: number | null
  /** «Le pagaste»: lo que la bajó. */
  decreaseCents: number | null
  /** «Le debés» después de este movimiento (lo calcula la base). */
  balanceCents: number
}

function lineStatus(row: PartyStatementRow, today: string): LedgerLine['status'] {
  if (row.increaseCents <= 0) return null
  if (row.openCents !== null && row.openCents <= 0) return { text: 'pagada', tone: 'ok' }
  const rail = dueRail(row.dueDate, today, SOON_DAYS)
  if (rail.tone === 'late') {
    return { text: `vencida hace ${rail.value} ${rail.unit ?? 'días'}`, tone: 'late' }
  }
  if (!row.dueDate) return { text: 'sin fecha de pago', tone: 'muted' }
  return {
    text: `${rail.label} ${rail.value}${rail.unit ? ` ${rail.unit}` : ''}`,
    tone: rail.tone === 'warn' ? 'warn' : 'muted',
  }
}

export type SupplierLedger = {
  lines: LedgerLine[]
  /** «Al 15/07 no le debías nada» / «Al 15/07 le debías $ X» (`null` en las páginas siguientes). */
  opening: { text: string; balanceCents: number } | null
  /** «Hoy le debés» / «Al 13/10 le debías» (`null` si quedan páginas: todavía no se sabe). */
  closing: { text: string; balanceCents: number } | null
  /** Σ de lo que te dejó y de lo que le pagaste en lo que se ve. */
  totals: { increaseCents: number; decreaseCents: number }
}

function owedWords(cents: number): string {
  if (cents > 0) return `le debías ${formatCentsShort(cents)}`
  if (cents < 0) return `tenías ${formatCentsShort(-cents)} a favor`
  return 'no le debías nada'
}

/**
 * La libreta de un período, del más viejo al más nuevo, con el saldo de
 * arranque arriba y el de cierre abajo.
 */
export function supplierLedger(input: {
  rows: readonly PartyStatementRow[]
  from: string
  to: string
  openingCents: number | null
  hasMore: boolean
  today: string
  /**
   * Lo que hoy tiene a favor sin usar. La libreta ya lo restó (una nota de
   * crédito baja el saldo el día que llega) y la tapa no (dice «Le debés» por
   * lo que falta pagar): si no se aclara, la misma hoja muestra dos «le debés»
   * con números distintos.
   */
  unusedCreditCents?: number
}): SupplierLedger {
  const lines: LedgerLine[] = input.rows
    .filter((r) => r.rowKind === 'line')
    .map((r, index) => ({
      id: r.lineId ?? `${r.entryId ?? 'fila'}-${index}`,
      date: r.entryDate ?? input.from,
      verb: ledgerVerb(r.documentKind, r),
      label: r.documentLabel ?? 'Comprobante',
      seq: r.documentSeq,
      documentId: r.documentId,
      status: lineStatus(r, input.today),
      increaseCents: r.increaseCents > 0 ? r.increaseCents : null,
      decreaseCents: r.decreaseCents > 0 ? r.decreaseCents : null,
      balanceCents: r.runningBalanceCents,
    }))

  const opening =
    input.openingCents === null
      ? null
      : {
          text: `Al ${formatDayMonth(addDays(input.from, -1))} ${owedWords(input.openingCents)}`,
          balanceCents: input.openingCents,
        }
  const last = lines.at(-1)
  const closingCents = last ? last.balanceCents : (input.openingCents ?? 0)
  const closing = input.hasMore
    ? null
    : {
        text:
          input.to === input.today
            ? closingCents > 0
              ? (input.unusedCreditCents ?? 0) > 0
                ? 'Hoy le debés, ya restado lo que tenés a favor'
                : 'Hoy le debés'
              : closingCents < 0
                ? 'Hoy tenés a favor'
                : 'Hoy no le debés nada'
            : `Al ${formatIsoDay(input.to)}`,
        balanceCents: closingCents,
      }
  return {
    lines,
    opening,
    closing,
    totals: lines.reduce(
      (acc, l) => ({
        increaseCents: acc.increaseCents + (l.increaseCents ?? 0),
        decreaseCents: acc.decreaseCents + (l.decreaseCents ?? 0),
      }),
      { increaseCents: 0, decreaseCents: 0 },
    ),
  }
}

/**
 * El título que afirma, arriba de la libreta: en el período, ¿se le acumuló
 * deuda o se la fue bajando? `lead` es el período ya dicho («En los últimos 90
 * días»). `null` = todavía no se puede decir (quedan páginas por ver).
 */
export function ledgerTrendTitle(input: {
  lead: string
  openingCents: number | null
  closingCents: number | null
  movements: number
}): string | null {
  if (input.openingCents === null || input.closingCents === null) return null
  if (input.movements === 0) return `${input.lead} no hubo movimientos`
  const diff = input.closingCents - input.openingCents
  if (diff > 0) return `${input.lead} le pasaste a deber ${formatCentsShort(diff)} más`
  if (diff < 0) return `${input.lead} le bajaste la deuda en ${formatCentsShort(-diff)}`
  return `${input.lead} la deuda quedó igual`
}

/** Cuántos días quietos se dejan a la vista antes del primer escalón. */
const LEAD_DAYS = 3

/**
 * La escalera sin la raya plana del principio: si en las primeras semanas del
 * período la deuda no se movió, el dibujo arranca unos días antes del primer
 * escalón (lo anterior ya lo dice el renglón «Al 15/07 no le debías nada»).
 * Si nunca se movió, queda como está.
 */
export function trimFlatStart<T extends { cents: number }>(
  points: readonly T[],
  lead = LEAD_DAYS,
): T[] {
  const first = points[0]
  if (!first) return []
  const change = points.findIndex((p) => p.cents !== first.cents)
  if (change < 0) return [...points]
  return points.slice(Math.max(0, change - Math.max(0, lead)))
}

/** Cuántos días dibuja la escalera como mucho (un año largo). */
const MAX_STEP_DAYS = 400

/**
 * La columna «Le debés» como escalera: un punto por día del período,
 * arrastrando el saldo en los días sin movimiento. Arranca en el saldo de
 * apertura y el último punto es el saldo final. Un saldo a favor (negativo) se
 * dibuja en cero: la escalera es de lo que se debe.
 */
export function statementBalancePoints(input: {
  lines: ReadonlyArray<Pick<LedgerLine, 'date' | 'balanceCents'>>
  from: string
  to: string
  openingCents: number
}): Array<{ date: string; cents: number }> {
  if (input.from > input.to) return []
  // El saldo con que cierra cada día: el del último movimiento de ese día.
  const closeOf = new Map<string, number>()
  for (const line of input.lines) closeOf.set(line.date, line.balanceCents)
  let balance = input.openingCents
  return eachIsoDay(input.from, input.to, MAX_STEP_DAYS).map((day) => {
    balance = closeOf.get(day) ?? balance
    return { date: day, cents: Math.max(0, balance) }
  })
}
