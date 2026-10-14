/**
 * La hoja de UN proveedor («su libreta»), lo puro: qué dice la tapa («Le debés
 * $ X · 3 compras sin pagar…»), los tres datos que hacen que la próxima compra
 * sea de un toque (en qué le comprás, cómo te factura, cuándo le pagás), los
 * renglones de la libreta con sus tres palabras (te dejó · le pagaste · le
 * debés) y la escalera de la deuda en el tiempo.
 * Lo prueba `tests/lib/administracion-proveedor-libreta.test.ts`.
 *
 * Sin I/O y sin cuentas nuevas: todo sale de lo que ya devuelven
 * `getPartyPosition` y `getPartyStatement` (el saldo corrido lo calcula la base).
 */

import { categoryShortName } from '@/components/administracion/kit/category'
import type { AgingSummary } from '@/lib/accounting/aging'
import type { PartyStatementRow } from '@/lib/accounting/queries/parties'
import type { IvaCondition, TaxIdType } from '@/lib/accounting/types'
import { addDays, daysBetween, eachIsoDay, formatDayMonth, formatIsoDay } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { formatCentsShort } from '@/lib/money'
import { dueRail, SOON_DAYS } from './libreta'

// ─── La tapa ─────────────────────────────────────────────────────────────────

export type SupplierHero =
  | { kind: 'debt'; cents: number; sentence: string }
  | { kind: 'credit'; cents: number; sentence: string }
  | { kind: 'clear'; title: string; sentence: string }

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * El número de la tapa y su oración. Sin deuda no se muestra «$ 0»: se dice
 * «No le debés nada».
 */
export function supplierHero(input: {
  debtCents: number
  creditCents: number
  /** Cuántas compras sin pagar. */
  debtCount: number
  overdueCents: number
  oldestDueDate: string | null
  nextDueDate: string | null
  today: string
}): SupplierHero {
  const favor =
    input.creditCents > 0 ? ` Tenés ${formatCentsShort(input.creditCents)} a favor.` : ''
  if (input.debtCents > 0) {
    const many = input.debtCount !== 1
    const what = `${count(input.debtCount, 'compra sin pagar', 'compras sin pagar')}.`
    let when: string
    if (input.overdueCents > 0 && input.oldestDueDate) {
      const late = Math.max(1, daysBetween(input.oldestDueDate, input.today))
      const ago = `hace ${count(late, 'día', 'días')}`
      when = many ? `La más vieja venció ${ago}.` : `Venció ${ago}.`
    } else if (input.nextDueDate) {
      const days = daysBetween(input.today, input.nextDueDate)
      const day =
        days <= 0 ? 'hoy' : days === 1 ? 'mañana' : `el ${formatDayMonth(input.nextDueDate)}`
      when = many ? `Nada vencido: la próxima vence ${day}.` : `Vence ${day}.`
    } else {
      when = 'Sin fecha de pago.'
    }
    return { kind: 'debt', cents: input.debtCents, sentence: `${what} ${when}${favor}` }
  }
  if (input.creditCents > 0) {
    return {
      kind: 'credit',
      cents: input.creditCents,
      sentence: 'No le debés nada. Se descuenta solo de la próxima compra.',
    }
  }
  return { kind: 'clear', title: 'No le debés nada', sentence: 'Está al día.' }
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

/** El detalle de «¿Cómo se calcula?»: los tramos de antigüedad que tienen algo, y el total. */
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

// ─── Sus tres datos de carga ─────────────────────────────────────────────────

export type SupplierFact = {
  key: 'category' | 'invoicing' | 'term'
  /** Está cargado. */
  set: boolean
  /** Lo que se lee cuando está («Bebidas sin alcohol», «Le pagás a 21 días»). */
  text: string
  /** Cuando falta y se puede cargar: el botón («En qué le comprás»). */
  missing: string
  /** Cuando falta y mira la contadora: se lee como falta, sin botón. */
  missingReadOnly: string
}

const CONDITION_LABELS: Readonly<Record<IvaCondition, string>> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
  no_alcanzado: 'No alcanzado por el IVA',
  sin_datos: 'Sin datos',
}

/** «CUIT 30-70111222-5», «DNI 30123456», o `null` si no tiene. */
export function documentText(taxIdType: TaxIdType, taxId: string | null): string | null {
  if (taxIdType === 'none' || !taxId) return null
  if (taxIdType === 'dni') return `DNI ${taxId}`
  return `${taxIdType === 'cuil' ? 'CUIL' : 'CUIT'} ${formatCuit(taxId)}`
}

/**
 * Los tres datos que destraban la carga: con los tres puestos, cargarle una
 * compra es elegir el papel y escribir el total.
 */
export function supplierFacts(party: {
  defaultAccountName: string | null
  ivaCondition: IvaCondition
  taxIdType: TaxIdType
  taxId: string | null
  paymentTermDays: number
}): SupplierFact[] {
  const document = documentText(party.taxIdType, party.taxId)
  const knowsInvoicing = party.ivaCondition !== 'sin_datos'
  return [
    {
      key: 'category',
      set: party.defaultAccountName !== null,
      text: party.defaultAccountName ? categoryShortName(party.defaultAccountName) : '',
      missing: 'En qué le comprás',
      missingReadOnly: 'Sin categoría',
    },
    {
      key: 'invoicing',
      set: knowsInvoicing,
      text: knowsInvoicing
        ? `${CONDITION_LABELS[party.ivaCondition]} · ${document ?? 'Sin CUIT'}`
        : '',
      missing: 'Cómo te factura',
      missingReadOnly: document
        ? `Sin datos de cómo factura · ${document}`
        : 'Sin datos de cómo factura',
    },
    {
      key: 'term',
      set: party.paymentTermDays > 0,
      text: `Le pagás a ${count(party.paymentTermDays, 'día', 'días')}`,
      missing: 'A cuántos días le pagás',
      missingReadOnly: 'Sin plazo',
    },
  ]
}

// ─── Los renglones de su libreta ─────────────────────────────────────────────

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
