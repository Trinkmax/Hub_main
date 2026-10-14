/**
 * La planilla de gastos fijos, en palabras: los tipos de la hoja y todo lo que
 * se dice de un renglón (su frase de estado, qué se puede hacer con él, sus
 * cuotas), la oración de la cabecera, lo que va en «Lo que sigue», los filtros
 * y los títulos de los dibujos.
 *
 * Puro, sin I/O ni `server-only`: lo usan el server (para armar la pantalla) y
 * las islas cliente (el renglón, «Lo que sigue», «Completar»). La hoja en sí la
 * arma `planilla.ts`, que corre solo en el server. Lo prueban
 * `administracion-gastos-fijos-planilla.test.ts` y `…-envio.test.ts`.
 *
 * Nada de acá cambia qué se guarda: `recurringEditPayload` arma el mismo
 * paquete de 15 claves que mandaba el «Deshacer» de «Saltear».
 */

import { dueInMonth } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/recurring'
import type { FixedProgress } from '@/lib/accounting/home'
import { isNotInvoicedVoucher } from '@/lib/accounting/invoiced'
import type { RecurringExpenseRow, RecurringMonthStatus } from '@/lib/accounting/queries/documents'
import type {
  RecurringDocument,
  RecurringInstallment,
  RecurringLine,
} from '@/lib/accounting/recurring-status'
import { voucherLabel } from '@/lib/accounting/voucher-types'
import {
  addMonthsToYearMonth,
  capitalizeFirst,
  daysBetween,
  formatDayMonth,
  formatIsoDay,
  monthName,
  monthOf,
  weekdayName,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

// ─── La hoja ─────────────────────────────────────────────────────────────────

/** Un renglón de la planilla. */
export type SheetItem = {
  /** El gasto fijo, con el `monthStatus` del mes que se mira (no siempre el de hoy). */
  row: RecurringExpenseRow
  line: RecurringLine
  /** El comprobante del vencimiento que muestra el renglón (`null`: no hay, o es de otro vencimiento). */
  doc: RecurringDocument | null
  /** «Este mes» de verdad (contra hoy), aunque se esté mirando el mes que viene. */
  realStatus: RecurringMonthStatus
  /** El día del que cuelga el renglón (`yyyy-MM-dd`). */
  day: string
}

/** Los renglones que vencen un mismo día. `place`: de un mes anterior, del mes o de uno posterior. */
export type SheetGroup = {
  day: string
  place: 'before' | 'month' | 'ahead'
  items: SheetItem[]
  /** Lo que falta pagar de ese día (los sin monto no suman). */
  remainingCents: number
  /** Lo que había que pagar ese día (los sin monto no suman). */
  dueCents: number
}

export type SheetCounts = {
  todo: number
  vencido: number
  porVencer: number
  /** Vencido + por vencer: lo que queda por pagar de esa hoja. */
  falta: number
  pagado: number
  /** Activos sin monto, venzan cuando venzan. */
  sinMonto: number
  enCuotas: number
}

/** Lo que le falta a un bar para arrancar con la planilla (solo para quien carga). */
export type SheetSetup = {
  /** Activos sin monto. */
  missing: number
  /** Activos. */
  total: number
  /** Activos que quedaron en «Gastos varios». */
  misc: number
  /** El día que dicen TODOS (si son cinco o más): los dejó así «Pegar una lista». */
  sameDay: number | null
  /** Alguno se pagó alguna vez desde la planilla. */
  everPaid: boolean
}

export type Sheet = {
  /** `yyyy-MM`. */
  month: string
  /** Es el mes de hoy (si no, es el que viene). */
  isCurrent: boolean
  today: string
  /** Los renglones del mes, en orden estable (día y nombre). */
  items: SheetItem[]
  groups: SheetGroup[]
  /** No vencen en ese mes. */
  later: SheetItem[]
  /** En pausa o terminados. */
  off: SheetItem[]
  /** El mismo número del Resumen. */
  progress: FixedProgress
  counts: SheetCounts
  /** El que sigue entre los que se pueden pagar, y los dos de después. */
  next: SheetItem | null
  afterNext: SheetItem[]
  setup: SheetSetup | null
  /** Se anuló el último pago y el vencimiento quedó corrido. */
  voided: SheetItem[]
}

// ─── Fechas y plata, dichas ──────────────────────────────────────────────────

const pesos = (cents: number) => formatCentsShort(cents)

/** `'2026-10'` → `'octubre'`. */
export function monthWord(month: string): string {
  return monthName(Number(month.slice(5, 7)))
}

/** `'2026-10'` → `'Octubre'`. */
export function monthTitle(month: string): string {
  return capitalizeFirst(monthWord(month))
}

/** `'2026-10-15'` → `'jueves 15/10'`. */
export function weekdayDay(iso: string): string {
  return `${weekdayName(iso)} ${formatDayMonth(iso)}`
}

/** `'2026-11-10'` → `'10 de noviembre'`. */
export function dayOfMonthWords(iso: string): string {
  return `${Number(iso.slice(8, 10))} de ${monthWord(iso.slice(0, 7))}`
}

/** Dentro del año de hoy alcanza con día y mes; si no, la fecha entera. */
function shortDay(iso: string, today: string): string {
  return iso.slice(0, 4) === today.slice(0, 4) ? formatDayMonth(iso) : formatIsoDay(iso)
}

function countWords(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`
}

// ─── Cuotas ──────────────────────────────────────────────────────────────────

/**
 * Las cuotas en palabras, para ir al lado de los puntitos: «cuota 2 de 6»;
 * sin saber de cuántas, «quedan 3» o «última cuota». `null` = no es en cuotas.
 */
export function installmentWords(installment: RecurringInstallment | null): string | null {
  if (installment === null) return null
  if (installment.current !== null && installment.total !== null) {
    return `cuota ${installment.current} de ${installment.total}`
  }
  return installment.remaining === 1 ? 'última cuota' : `quedan ${installment.remaining}`
}

export type DetectedInstallment = {
  current: number
  total: number
  /** El nombre sin la cuota («Licuadora USA cord»); `null` si no quedaría un nombre. */
  cleanName: string | null
}

const NAME_INSTALLMENT = /(?<![\d/.,])(?:cuotas?\s*)?(\d{1,3})\s*\/\s*(\d{1,3})(?![\d/.,])/i

/**
 * ¿El nombre trae la cuota escrita? «Licuadora 6/6 USA cord» → cuota 6 de 6.
 * Vale «n/m» con 1 ≤ n ≤ m ≤ 120; «24/7» o «7/3» no son una cuota, y una fecha
 * («10/11/2026») tampoco.
 */
export function detectInstallment(name: string): DetectedInstallment | null {
  const match = NAME_INSTALLMENT.exec(name)
  if (!match) return null
  const current = Number(match[1])
  const total = Number(match[2])
  if (!(current >= 1 && current <= total && total <= 120)) return null
  const clean = `${name.slice(0, match.index)} ${name.slice(match.index + match[0].length)}`
    .replace(/[([{]\s*[)\]}]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—·:,]+|[\s\-–—·:,]+$/g, '')
  return { current, total, cleanName: clean.length >= 2 ? clean : null }
}

// ─── El papel de siempre ─────────────────────────────────────────────────────

/** «Factura A», «Tique», «Sin factura»; `null` si no se definió («No sé o cambia»). */
export function papelLabel(voucherType: string | null | undefined): string | null {
  if (!voucherType) return null
  if (isNotInvoicedVoucher(voucherType)) return 'Sin factura'
  return voucherLabel(voucherType)
}

export type InvoiceBucket = 'con' | 'sin' | 'nose'

/** Con factura, sin factura o sin definir: la misma regla del filtro de Comprobantes. */
export function invoiceBucket(voucherType: string | null | undefined): InvoiceBucket {
  if (!voucherType) return 'nose'
  return isNotInvoicedVoucher(voucherType) ? 'sin' : 'con'
}

export const INVOICE_BUCKET_LABELS: Readonly<Record<InvoiceBucket, string>> = {
  con: 'Con factura',
  sin: 'Sin factura',
  nose: 'Sin definir',
}

/** La línea gris de abajo del nombre: «Internet · Factura A · Fibertel» (lo que no está, no se escribe). */
export function rowSubline(row: RecurringExpenseRow): string[] {
  const paper = papelLabel(row.voucherType)
  return [row.accountName, paper === 'Sin factura' ? 'sin factura' : paper, row.partyName].filter(
    (part): part is string => Boolean(part),
  )
}

// ─── La frase de estado ──────────────────────────────────────────────────────

export type RowTone = 'ok' | 'warn' | 'late' | 'muted'

export type RowWords = {
  /** Lo corto, para la píldora: «Venció hace 3 días», «Pagado el 08/10», «Sin monto». */
  label: string
  /** Lo que sigue, en gris: «vence el 10/11», «$ 10.000 menos que el monto». */
  detail: string | null
  /** La frase entera: «Sin monto · vence el 10/11». */
  text: string
  /** `null` = solo una fecha: va en gris, sin píldora. */
  tone: RowTone | null
  /** Lo que se suma debajo: «Era la última cuota», «Debés $ X de antes». */
  extras: string[]
  /** Pagaste menos que el monto y el comprobante está saldado: lo que pregunta «¿Era eso?». */
  short: { expectedCents: number; paidCents: number } | null
}

function dueAhead(dueDate: string, today: string): string {
  const days = daysBetween(today, dueDate)
  if (days === 0) return 'vence hoy'
  if (days === 1) return 'vence mañana'
  return `vence el ${weekdayDay(dueDate)}`
}

function dueBehind(dueDate: string, today: string): string {
  const days = daysBetween(dueDate, today)
  if (days === 1) return 'venció ayer'
  // Pasado el mes y medio, contar días no ayuda: se dice la fecha.
  return days > 45 ? `venció el ${shortDay(dueDate, today)}` : `venció hace ${days} días`
}

/**
 * Cómo va un renglón, siempre con palabras (el color acompaña, nunca alcanza).
 * Las claves internas no cambian: esto solo las dice.
 */
export function rowWords(item: SheetItem, today: string): RowWords {
  const { row, line, doc } = item
  const extras: string[] = []
  if (row.ended && line.state !== 'ended') extras.push('Era la última cuota')
  if (line.priorOpenCents > 0) extras.push(`Debés ${pesos(line.priorOpenCents)} de antes`)
  const out = (
    label: string,
    detail: string | null,
    tone: RowTone | null,
    short: RowWords['short'] = null,
  ): RowWords => ({
    label,
    detail,
    text: detail ? `${label} · ${detail}` : label,
    tone,
    extras,
    short,
  })
  const due = line.dueDate ?? row.nextDueDate
  const paid = line.paidCents ?? 0
  const remaining = line.remainingCents ?? 0
  // Con el comprobante saldado lo que «falta» es la diferencia con el monto calculado.
  const settled = doc !== null && doc.openCents === 0
  const owed = doc !== null && doc.openCents > 0

  switch (line.state) {
    case 'paid': {
      const when = doc ? `Pagado el ${shortDay(doc.accountingDate, today)}` : 'Pagado'
      const over = line.dueCents !== null && paid > line.dueCents
      return out(when, over ? pesos(paid) : null, 'ok')
    }
    case 'partial':
    case 'unpaid':
    case 'overdue': {
      if (settled && remaining > 0) {
        return out(
          `Pagaste ${pesos(paid)}`,
          `${pesos(remaining)} menos que el monto`,
          'warn',
          line.dueCents === null ? null : { expectedCents: line.dueCents, paidCents: paid },
        )
      }
      if (owed) {
        if (line.state === 'overdue') {
          const tail = paid > 0 ? ` · pagaste ${pesos(paid)}, falta ${pesos(remaining)}` : ''
          return out('Lo debés', `${dueBehind(due, today)}${tail}`, 'late')
        }
        if (line.state === 'partial') {
          return out(`Pagaste ${pesos(paid)}`, `falta ${pesos(remaining)}`, 'warn')
        }
        return out('Lo debés', `vence el ${shortDay(due, today)}`, 'warn')
      }
      if (line.state === 'overdue') return out(capitalizeFirst(dueBehind(due, today)), null, 'late')
      // Cerca del vencimiento (los días de aviso de ese gasto) va en ámbar; lejos, es solo una fecha.
      const days = daysBetween(today, due)
      return days <= Math.max(1, row.remindDaysBefore)
        ? out(capitalizeFirst(dueAhead(due, today)), null, 'warn')
        : out(`Vence el ${shortDay(due, today)}`, null, null)
    }
    case 'no_amount':
      return line.pastDue
        ? out('Sin monto', `venció el ${shortDay(due, today)}`, 'late')
        : out('Sin monto', `vence el ${shortDay(due, today)}`, 'muted')
    case 'upcoming':
      return out(`Vence el ${shortDay(due, today)}`, null, null)
    case 'skipped':
      return out('Este mes no se paga', null, 'muted')
    case 'paused':
      return out('En pausa', null, 'muted')
    case 'ended':
      return out(
        'Terminó',
        row.endsOn ? `la última cuota venció el ${shortDay(row.endsOn, today)}` : null,
        'muted',
      )
  }
}

/** El tinte del renglón, como las tarjetas de Operativo. */
export function rowTint(item: SheetItem): 'ok' | 'warn' | 'late' | null {
  const { line, doc } = item
  if (line.state === 'paid') return 'ok'
  const settledShort = doc !== null && doc.openCents === 0 && (line.remainingCents ?? 0) > 0
  if (settledShort) return 'warn'
  if (line.state === 'overdue' || (line.state === 'no_amount' && line.pastDue)) return 'late'
  return null
}

/** El casillero: vacío, tildado, a medias o con raya («este mes no se paga»). */
export function tickState(item: SheetItem): 'empty' | 'done' | 'half' | 'skip' {
  const { line } = item
  if (line.state === 'paid') return 'done'
  if (line.state === 'skipped' || line.state === 'paused' || line.state === 'ended') return 'skip'
  return (line.paidCents ?? 0) > 0 ? 'half' : 'empty'
}

// ─── Qué se puede hacer con un renglón ───────────────────────────────────────

/** Lo que hace «Pagar»: cargar el gasto, pagar la factura que se debe o ir a ella. */
export type PayAction =
  | { kind: 'gasto'; recurringId: string }
  | { kind: 'pagar'; partyId: string }
  | { kind: 'document'; documentId: string }

export type RowActions = {
  /** Lo que hace «Pagar» (y el casillero vacío). `null`: no se ofrece. */
  pay: PayAction | null
  /** El botón va a la vista en el renglón (los que todavía no vencen lo tienen adentro). */
  payInRow: boolean
  /** Todavía no vence este mes: adentro dice «Pagar por adelantado». */
  payAhead: boolean
  /** «Me llegó la factura y la pago después». */
  bill: boolean
  /** «Este mes no se paga». */
  skip: boolean
  /** «Sí se paga este mes». */
  unskip: boolean
  pause: boolean
  resume: boolean
  /** «¿Era eso?»: dejar como monto lo que se pagó. */
  ask: boolean
  /** Pagaste de más: «Usar $ X de ahora en más». */
  keepPaid: boolean
  /** Cambiar monto y día en el lugar. */
  edit: boolean
  remove: boolean
}

const NO_ACTIONS: RowActions = {
  pay: null,
  payInRow: false,
  payAhead: false,
  bill: false,
  skip: false,
  unskip: false,
  pause: false,
  resume: false,
  ask: false,
  keepPaid: false,
  edit: false,
  remove: false,
}

/**
 * Qué se le ofrece a quien carga. A la contadora, nada (`canWrite: false`).
 *
 * «Pagar» nunca aparece con el comprobante de este mes ya saldado, aunque la
 * cuenta diga «falta»: otro gasto con el mismo gasto fijo daría por cargado el
 * mes que viene. Ahí va «¿Era eso?».
 */
export function rowActions(item: SheetItem, opts: { canWrite: boolean }): RowActions {
  if (!opts.canWrite) return NO_ACTIONS
  const { row, line, doc, realStatus } = item
  const loaded = line.documentId !== null
  const owed = doc !== null && doc.openCents > 0
  const settled = doc !== null && doc.openCents === 0
  const paid = line.paidCents ?? 0
  const detailed = row.breakdown.length > 0

  let pay: PayAction | null = null
  let payInRow = false
  let payAhead = false
  if (owed && doc) {
    pay = row.partyId
      ? { kind: 'pagar', partyId: row.partyId }
      : { kind: 'document', documentId: doc.id }
    payInRow = true
  } else if (!loaded && row.active && realStatus === 'pending') {
    pay = { kind: 'gasto', recurringId: row.id }
    payInRow = true
  } else if (!loaded && row.active && realStatus === 'upcoming') {
    pay = { kind: 'gasto', recurringId: row.id }
    payAhead = true
  }

  return {
    pay,
    payInRow,
    payAhead,
    bill: row.active && realStatus !== 'skipped',
    skip: row.active && realStatus === 'pending' && !loaded,
    // Devolverlo lo deja activo: vale en uno que sigue activo o en el que se apagó solo por no
    // pagar la última cuota. A uno que alguien puso en pausa no lo reanuda por la ventana.
    unskip: realStatus === 'skipped' && row.skippedDue !== null && (row.active || row.ended),
    pause: row.active,
    resume: !row.active && !row.ended,
    ask: settled && (line.remainingCents ?? 0) > 0 && paid > 0 && !detailed,
    keepPaid:
      line.state === 'paid' &&
      settled &&
      !detailed &&
      line.dueCents !== null &&
      paid > line.dueCents,
    edit: !row.ended,
    remove: true,
  }
}

// ─── El envío de una edición del renglón ─────────────────────────────────────

/** Lo único que la planilla le cambia a un gasto fijo sin pasar por la ficha. */
export type RowEditPatch = {
  name?: string
  accountId?: string
  /** `null` = vuelve a «sin monto». */
  amountCents?: number | null
  dueDay?: number
  nextDueDate?: string
  active?: boolean
  /** Solo la pregunta de cuotas de «Completar»: van las dos juntas, como en la ficha. */
  endsOn?: string | null
  installmentsTotal?: number | null
}

/**
 * Lo que hace falta de un gasto fijo para editarlo. Lo cumplen la fila de la
 * lista (`RecurringExpenseRow`) y lo que devuelve la acción al guardar.
 */
export type EditableRow = Pick<
  RecurringExpenseRow,
  | 'id'
  | 'name'
  | 'partyId'
  | 'accountId'
  | 'voucherType'
  | 'vatRateBp'
  | 'amountCents'
  | 'frequency'
  | 'dueDay'
  | 'nextDueDate'
  | 'remindDaysBefore'
  | 'treasuryAccountId'
  | 'active'
  | 'notes'
> & {
  /** Para la concurrencia optimista (`expectedUpdatedAt`). */
  updatedAt: string | null
  breakdown?: RecurringExpenseRow['breakdown']
}

/**
 * El paquete de una edición del renglón para `saveRecurringExpense`: las
 * mismas 15 claves, en el mismo orden, que mandaba el «Deshacer» de «Saltear».
 * Nunca `endsOn`, `installmentsTotal` ni `breakdown`: la base conserva lo que
 * no se manda. La única excepción es la pregunta de cuotas de «Completar», que
 * suma `endsOn` + `installmentsTotal` como la ficha.
 *
 * Con detalle (los sueldos) el monto es la suma del detalle: no se manda otro.
 */
export function recurringEditPayload(row: EditableRow, patch: RowEditPatch = {}) {
  const detailed = (row.breakdown?.length ?? 0) > 0
  const base = {
    id: row.id,
    expectedUpdatedAt: row.updatedAt,
    name: patch.name ?? row.name,
    partyId: row.partyId,
    accountId: patch.accountId ?? row.accountId,
    voucherType: row.voucherType,
    vatRateBp: row.vatRateBp,
    amountCents: !detailed && patch.amountCents !== undefined ? patch.amountCents : row.amountCents,
    frequency: row.frequency,
    dueDay: patch.dueDay ?? row.dueDay,
    nextDueDate: patch.nextDueDate ?? row.nextDueDate,
    remindDaysBefore: row.remindDaysBefore,
    treasuryAccountId: row.treasuryAccountId,
    active: patch.active ?? row.active,
    notes: row.notes,
  }
  if (patch.endsOn === undefined) return base
  return { ...base, endsOn: patch.endsOn, installmentsTotal: patch.installmentsTotal ?? null }
}

/**
 * Cambiar el día en el lugar: el día nuevo y el próximo vencimiento en el MISMO
 * mes del que ya tenía, para no saltear ni repetir ninguno.
 */
export function dueDayPatch(
  row: Pick<RecurringExpenseRow, 'nextDueDate'>,
  day: number,
): Required<Pick<RowEditPatch, 'dueDay' | 'nextDueDate'>> {
  const dueDay = Math.min(31, Math.max(1, Math.trunc(day)))
  return { dueDay, nextDueDate: dueInMonth(monthOf(row.nextDueDate), dueDay) }
}

/** Lo que cambia entre lo guardado y lo que se escribió (monto y día). `null` = nada. */
export function quickEditPatch(
  row: Pick<RecurringExpenseRow, 'amountCents' | 'dueDay' | 'nextDueDate' | 'breakdown'>,
  draft: { amountCents: number | null; dueDay: number | null },
): RowEditPatch | null {
  const patch: RowEditPatch = {}
  if (row.breakdown.length === 0 && draft.amountCents !== row.amountCents) {
    patch.amountCents = draft.amountCents
  }
  if (draft.dueDay !== null && draft.dueDay !== row.dueDay) {
    Object.assign(patch, dueDayPatch(row, draft.dueDay))
  }
  return Object.keys(patch).length > 0 ? patch : null
}

/** Por qué no se guardó un renglón, en palabras, y qué se le ofrece. */
export type SaveFailure = {
  kind: 'stale' | 'category' | 'name' | 'other'
  message: string
}

/**
 * El motivo de un guardado que falló, dicho corto (va al lado del campo):
 * alguien lo cambió recién, la categoría ya no sirve, el nombre está repetido,
 * o lo que haya dicho el servidor.
 */
export function saveFailure(result: {
  code: string
  message: string
  detail?: Record<string, unknown>
}): SaveFailure {
  const key = typeof result.detail?.key === 'string' ? result.detail.key : null
  if (result.code === 'stale') return { kind: 'stale', message: 'Alguien lo cambió recién.' }
  if (key === 'invalid_imputation_account') {
    return {
      kind: 'category',
      message: 'No se guardó: la categoría de este gasto ya no se puede usar.',
    }
  }
  if (key === 'recurring_name_taken') {
    return { kind: 'name', message: 'Ya hay un gasto fijo con ese nombre.' }
  }
  return { kind: 'other', message: `No se guardó. ${result.message}`.trim() }
}

// ─── Filtros (viven en la URL) ───────────────────────────────────────────────

export const SHEET_FILTERS = ['vencido', 'por-vencer', 'pagado', 'sin-monto', 'en-cuotas'] as const
export type SheetFilter = (typeof SHEET_FILTERS)[number]

export const SHEET_FILTER_LABELS: Readonly<Record<SheetFilter, string>> = {
  vencido: 'Vencido',
  'por-vencer': 'Por vencer',
  pagado: 'Pagado',
  'sin-monto': 'Sin monto',
  'en-cuotas': 'En cuotas',
}

export function parseSheetFilter(raw: string | null | undefined): SheetFilter | null {
  return (SHEET_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as SheetFilter) : null
}

export function parseInvoiceBucket(raw: string | null | undefined): InvoiceBucket | null {
  return raw === 'con' || raw === 'sin' || raw === 'nose' ? raw : null
}

const isOverdueItem = ({ line }: SheetItem) =>
  line.state === 'overdue' || (line.state === 'no_amount' && line.pastDue)
const isDueSoonItem = ({ line }: SheetItem) =>
  line.state === 'unpaid' ||
  line.state === 'partial' ||
  (line.state === 'no_amount' && !line.pastDue)

/** ¿El renglón entra en ese filtro? */
export function matchesSheetFilter(item: SheetItem, filter: SheetFilter): boolean {
  switch (filter) {
    case 'vencido':
      return isOverdueItem(item)
    case 'por-vencer':
      return isDueSoonItem(item)
    case 'pagado':
      return item.line.state === 'paid'
    case 'sin-monto':
      return item.row.active && !item.row.ended && item.row.amountCents === null
    case 'en-cuotas':
      return item.line.installment !== null
  }
}

export type SheetQuery = {
  ver: SheetFilter | null
  categoria: string | null
  factura: InvoiceBucket | null
}

export function matchesSheetQuery(item: SheetItem, query: SheetQuery): boolean {
  if (query.ver && !matchesSheetFilter(item, query.ver)) return false
  if (query.categoria && item.row.accountId !== query.categoria) return false
  if (query.factura && invoiceBucket(item.row.voucherType) !== query.factura) return false
  return true
}

export type SheetFilterPill = { key: SheetFilter; label: string; count: number }

/**
 * Las píldoras de filtro que valen la pena: ni las vacías ni las que dejarían
 * la lista igual que «Todo». Si no queda ninguna, no hay barra (un bar con todo
 * por vencer y sin monto no necesita filtrar nada).
 */
export function sheetFilterPills(sheet: Pick<Sheet, 'items' | 'later'>): SheetFilterPill[] {
  const pills: SheetFilterPill[] = []
  for (const key of SHEET_FILTERS) {
    const inSheet = sheet.items.filter((item) => matchesSheetFilter(item, key)).length
    const inLater = sheet.later.filter((item) => matchesSheetFilter(item, key)).length
    const count = inSheet + inLater
    if (count === 0) continue
    if (inSheet === sheet.items.length && inLater === 0) continue
    pills.push({ key, label: SHEET_FILTER_LABELS[key], count })
  }
  return pills
}

// ─── La oración de la cabecera ───────────────────────────────────────────────

export type SheetSentence =
  /** La hoja no tiene renglones: no hay número, hay un titular. */
  | { kind: 'empty'; title: string; text: string; nextMonth: string | null }
  /** Hay renglones y ninguno suma: nunca «$ 0». */
  | { kind: 'no_amounts'; title: string; text: string }
  | {
      kind: 'number'
      cents: number
      text: string
      /** Todo pago: va la píldora «Al día». */
      allPaid: boolean
      /** Vencen este mes y no tienen monto: no suman. */
      noAmount: number
    }

/** Lo próximo que vence fuera de la hoja: «el 10 de noviembre: 31 gastos, $ 2.450.000». */
function upcomingWords(later: readonly SheetItem[]): { text: string; month: string } | null {
  const active = later.filter((item) => item.line.state === 'upcoming')
  const first = active.reduce<string | null>(
    (min, item) => (min === null || item.day < min ? item.day : min),
    null,
  )
  if (first === null) return null
  const sameDay = active.filter((item) => item.day === first)
  const withAmount = sameDay.filter((item) => item.row.amountCents !== null)
  const total = withAmount.reduce((sum, item) => sum + (item.row.amountCents ?? 0), 0)
  const count = countWords(sameDay.length, 'gasto', 'gastos')
  const amount =
    withAmount.length === 0
      ? 'todavía sin monto'
      : withAmount.length === sameDay.length
        ? pesos(total)
        : `${pesos(total)} (${countWords(sameDay.length - withAmount.length, 'sin monto', 'sin monto')})`
  return {
    text: `Lo próximo es el ${dayOfMonthWords(first)}: ${count}, ${amount}.`,
    month: monthOf(first),
  }
}

/**
 * Qué se dice al lado del número de arriba. El orden importa: primero «no hay
 * renglones», después «ninguno suma» (nunca «$ 0» por un dato que falta) y
 * recién después el número.
 */
export function sheetSentence(sheet: Sheet): SheetSentence {
  const { progress, items, month } = sheet
  const mes = monthWord(month)

  if (items.length === 0) {
    const upcoming = upcomingWords(sheet.later)
    const nextMonth = addMonthsToYearMonth(month, 1)
    return {
      kind: 'empty',
      title: `En ${mes} no vence ninguno`,
      text: upcoming?.text ?? progress.sentence,
      // El link solo si lo próximo cae en el mes de al lado, que es la otra hoja.
      nextMonth: sheet.isCurrent && upcoming?.month === nextMonth ? nextMonth : null,
    }
  }

  const counted = items.filter((item) => item.line.remainingCents !== null)
  if (counted.length === 0) {
    const live = items.filter((item) => item.line.state === 'no_amount')
    if (live.length === 0) {
      // Lo único que hay en la hoja son los que se marcaron «este mes no se paga».
      return {
        kind: 'empty',
        title: `En ${mes} no queda ninguno para pagar`,
        text:
          items.length === 1
            ? 'El único de este mes quedó como «este mes no se paga».'
            : `Los ${items.length} de este mes quedaron como «este mes no se paga».`,
        nextMonth: sheet.isCurrent ? addMonthsToYearMonth(month, 1) : null,
      }
    }
    const days = [...new Set(live.map((item) => item.day))].sort()
    const first = days[0]
    const one = live.length === 1
    const everyone =
      progress.missingAmount === progress.activeRows && live.length === progress.activeRows
    const lead = everyone
      ? `Tenés ${countWords(live.length, 'gasto fijo y no tiene monto', 'gastos fijos y ninguno tiene monto')}.`
      : one
        ? `Es un solo gasto de ${mes} y no tiene monto.`
        : `Son ${live.length} gastos de ${mes} y ninguno tiene monto.`
    const when =
      first === undefined
        ? ''
        : days.length === 1
          ? ` ${one ? 'Vence' : 'Vencen'} el ${dayOfMonthWords(first)}.`
          : ` El primero vence el ${dayOfMonthWords(first)}.`
    return { kind: 'no_amounts', title: 'Todavía no sé cuánto te falta', text: `${lead}${when}` }
  }

  const total = progress.totalCents
  const lead =
    counted.length === 1 ? `Es un solo gasto de ${mes}.` : `Son ${counted.length} gastos de ${mes}.`
  // Mirando el mes que viene, lo que quedó sin pagar de antes aparece una vez, con su fecha
  // vieja: se dice, para que nadie crea que son los vencimientos de ese mes.
  const carried = sheet.isCurrent
    ? 0
    : counted.filter((item) => monthOf(item.day) < month && (item.line.remainingCents ?? 0) > 0)
        .length
  let text: string
  if (progress.remainingCents === 0) {
    text = `Pagaste los ${pesos(total)} de gastos fijos de ${mes}.`
  } else if (carried > 0 && carried === counted.length) {
    text =
      carried === 1
        ? `Es el que quedó de antes sin pagar. Cuando lo pagues, acá vas a ver el de ${mes}.`
        : `Son los ${carried} que quedaron de antes sin pagar. Cuando los pagues, acá vas a ver los de ${mes}.`
  } else if (carried > 0) {
    const rest = counted.length - carried
    text = `Son ${counted.length} gastos: ${carried === 1 ? '1 quedó' : `${carried} quedaron`} de antes sin pagar y ${
      rest === 1 ? '1 vence' : `${rest} vencen`
    } en ${mes}.`
  } else if (progress.paidCents > 0) {
    text = `Pagaste ${pesos(progress.paidCents)} de ${pesos(total)}. ${
      progress.pendingRows === 1 ? 'Te falta 1' : `Te faltan ${progress.pendingRows}`
    }.`
  } else if (progress.overdueRows > 0) {
    text = `${lead} ${
      progress.overdueRows === 1
        ? `1 ya venció: ${pesos(progress.overdueCents)}`
        : `${progress.overdueRows} ya vencieron: suman ${pesos(progress.overdueCents)}`
    }.`
  } else {
    const firstDue = counted
      .filter((item) => (item.line.remainingCents ?? 0) > 0)
      .reduce<string | null>((min, item) => (min === null || item.day < min ? item.day : min), null)
    text =
      firstDue === null
        ? lead
        : `${lead} ${counted.length === 1 ? 'Vence' : 'El primero vence'} el ${weekdayDay(firstDue)}.`
  }
  return {
    kind: 'number',
    cents: progress.remainingCents,
    text,
    allPaid: progress.remainingCents === 0,
    noAmount: progress.noAmountDue,
  }
}

// ─── «Lo que sigue» ──────────────────────────────────────────────────────────

export type NextUpView =
  /** El bar recién arranca: tres pasos numerados. */
  | { kind: 'setup'; setup: SheetSetup }
  /** Lo mismo para quien solo mira. */
  | { kind: 'setup_readonly'; text: string }
  /** Lo que sigue: un gasto para pagar ahora. */
  | {
      kind: 'pay'
      id: string
      name: string
      status: RowWords
      /** `null` = sin monto: se pone al pagar. */
      amountCents: number | null
      action: PayAction
      /** Ya está la factura cargada: falta pagarla. */
      billed: boolean
      after: string | null
    }
  /** Mirando el mes que viene: lo primero que vence, sin botón. */
  | { kind: 'first_due'; when: string; detail: string; daysText: string }
  | { kind: 'all_paid'; text: string; nextMonth: string | null }
  /** Lo que queda es por diferencias con el monto. */
  | { kind: 'review'; text: string }
  | { kind: 'none' }

function afterWords(items: readonly SheetItem[], more: number): string | null {
  const first = items[0]
  if (!first) return null
  const rest = items.length - 1 + more
  return rest > 0 ? `Después: ${first.row.name} y ${rest} más.` : `Después: ${first.row.name}.`
}

/**
 * La acción del momento, una sola por estado. Lo decide la hoja; la isla
 * cliente solo la dibuja y abre la carga.
 */
export function nextUpView(sheet: Sheet, opts: { canWrite: boolean }): NextUpView {
  const { progress, items, month } = sheet
  const mes = monthWord(month)

  if (progress.countedRows === 0 && progress.missingAmount > 0) {
    if (opts.canWrite && sheet.setup) return { kind: 'setup', setup: sheet.setup }
    return {
      kind: 'setup_readonly',
      text: `${countWords(progress.missingAmount, 'gasto fijo sin monto', 'gastos fijos sin monto')}: todavía no se sabe cuánto falta.`,
    }
  }
  if (items.length === 0) return { kind: 'none' }

  // Mirando el mes que viene: lo primero que vence de ESE mes, sin botón. Si lo único que hay
  // es lo que quedó de antes sin pagar, lo que sigue es pagarlo: va el botón de siempre.
  const ahead = sheet.isCurrent ? undefined : sheet.groups.find((g) => g.place !== 'before')
  if (ahead) {
    const days = daysBetween(sheet.today, ahead.day)
    const count = countWords(ahead.items.length, 'gasto', 'gastos')
    return {
      kind: 'first_due',
      when: capitalizeFirst(`${weekdayName(ahead.day)} ${dayOfMonthWords(ahead.day)}`),
      detail: ahead.dueCents > 0 ? `${count} · ${pesos(ahead.dueCents)}` : count,
      daysText: days <= 0 ? 'Vence hoy.' : days === 1 ? 'Falta 1 día.' : `Faltan ${days} días.`,
    }
  }

  if (sheet.next) {
    const actions = rowActions(sheet.next, { canWrite: true })
    if (actions.pay) {
      const nextId = sheet.next.row.id
      const pending = items.filter(
        (item) => item.row.id !== nextId && rowActions(item, { canWrite: true }).payInRow,
      ).length
      const { doc, line, row } = sheet.next
      return {
        kind: 'pay',
        id: row.id,
        name: row.name,
        status: rowWords(sheet.next, sheet.today),
        // De una factura cargada se paga lo que le falta a la factura.
        amountCents:
          doc && doc.openCents > 0 ? doc.openCents : (line.remainingCents ?? row.amountCents),
        action: actions.pay,
        billed: actions.pay.kind !== 'gasto',
        after: afterWords(sheet.afterNext, Math.max(0, pending - sheet.afterNext.length)),
      }
    }
  }

  if (progress.countedRows > 0 && progress.remainingCents === 0) {
    const nextMonth = addMonthsToYearMonth(month, 1)
    return { kind: 'all_paid', text: `No queda nada por pagar en ${mes}.`, nextMonth }
  }
  if (progress.remainingCents > 0) {
    return {
      kind: 'review',
      text:
        progress.pendingRows === 1
          ? 'Queda un renglón por revisar: pagaste distinto de lo que calculabas.'
          : `Quedan ${progress.pendingRows} renglones por revisar: pagaste distinto de lo que calculabas.`,
    }
  }
  return { kind: 'none' }
}

// ─── Los dibujos ─────────────────────────────────────────────────────────────

export type DueDay = { date: string; cents: number; count: number; overdue: boolean }

/** «El 15 se te van $ 35.000»; con vencidos, «Tenés $ 880.000 vencidos del 10». */
export function dueTitle(days: readonly DueDay[]): string {
  const withMoney = days.filter((d) => d.cents > 0)
  const overdue = withMoney.filter((d) => d.overdue)
  if (overdue.length > 0) {
    const total = overdue.reduce((sum, d) => sum + d.cents, 0)
    const only = overdue.length === 1 ? overdue[0] : undefined
    return only
      ? `Tenés ${pesos(total)} vencidos del ${Number(only.date.slice(8, 10))}`
      : `Tenés ${pesos(total)} vencidos`
  }
  const busiest = withMoney.reduce<DueDay | null>(
    (best, d) => (best === null || d.cents > best.cents ? d : best),
    null,
  )
  if (!busiest) return 'Este mes no queda nada por vencer'
  return `El ${Number(busiest.date.slice(8, 10))} se te van ${pesos(busiest.cents)}`
}

export type CategoryBar = { id: string; name: string; cents: number; count: number }

/** «Lo que más se lleva de lo fijo: Alquiler (93 %)», como el Resumen dice lo de las compras. */
export function categoryTitle(bars: readonly CategoryBar[]): string {
  const total = bars.reduce((sum, b) => sum + b.cents, 0)
  const top = bars.reduce<CategoryBar | null>(
    (best, b) => (best === null || b.cents > best.cents ? b : best),
    null,
  )
  if (!top || total <= 0) return 'En qué se va lo fijo'
  return `Lo que más se lleva de lo fijo: ${top.name} (${Math.round((top.cents * 100) / total)} %)`
}

export type PaperSplit = {
  conCents: number
  sinCents: number
  noseCents: number
  /** Algún gasto del mes tiene papel de siempre. */
  defined: boolean
}

/** «$ 35.000 de lo fijo van con factura». Un título que cuenta, sin opinar. */
export function paperTitle(split: PaperSplit): string {
  if (split.conCents > 0) return `${pesos(split.conCents)} de lo fijo van con factura`
  if (split.sinCents > 0) return `${pesos(split.sinCents)} de lo fijo van sin factura`
  return 'Con qué papel pagás lo fijo'
}
