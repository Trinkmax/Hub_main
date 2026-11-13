/**
 * La planilla de gastos fijos, en palabras: los tipos de la hoja y todo lo que
 * se dice de un renglón (su estado, qué se puede hacer con él, sus cuotas) y de
 * la hoja entera (el totalizador).
 *
 * Puro, sin I/O ni `server-only`: lo usan el server (para armar la pantalla) y
 * las islas cliente (el renglón, la tira de pago, «Completar»). La hoja en sí la
 * arma `planilla.ts`, que corre solo en el server. Lo prueban
 * `administracion-gastos-fijos-planilla.test.ts` y `…-envio.test.ts`.
 *
 * Nada de acá cambia qué se guarda: `recurringEditPayload` arma el mismo
 * paquete de 15 claves que mandaba el «Deshacer» de «Saltear».
 */

import {
  documentHref,
  gastosFijosFillHref,
  gastosFijosHref,
  newPurchaseHref,
  recurringHref,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import {
  type ExpenseTarget,
  isInvoiceVoucher,
  type QuickVoucher,
  quickVoucherFromType,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import { dueInMonth } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/recurring'
import type { SheetParty } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'
import type { FixedProgress } from '@/lib/accounting/home'
import { isNotInvoicedVoucher } from '@/lib/accounting/invoiced'
import type { PayrollTotals } from '@/lib/accounting/payroll'
import type { RecurringExpenseRow, RecurringMonthStatus } from '@/lib/accounting/queries/documents'
import type {
  RecurringDocument,
  RecurringInstallment,
  RecurringLine,
} from '@/lib/accounting/recurring-status'
import type { IvaCondition } from '@/lib/accounting/types'
import { isVoucherType, VOUCHER_CATALOG, voucherLabel } from '@/lib/accounting/voucher-types'
import {
  capitalizeFirst,
  daysBetween,
  formatDayMonth,
  formatIsoDay,
  monthName,
  monthOf,
} from '@/lib/dates'
import { formatCuit, normalizeCuit, parseCuit } from '@/lib/fiscal'
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
  /** El día en que vence el renglón (`yyyy-MM-dd`). */
  day: string
}

/** Los renglones seguidos de un mismo tramo: de un mes anterior, del mes o de uno posterior. */
export type SheetStretch = {
  place: 'before' | 'month' | 'ahead'
  items: SheetItem[]
}

export type Sheet = {
  /** `yyyy-MM`. */
  month: string
  /** Es el mes de hoy (si no, es el que viene). */
  isCurrent: boolean
  today: string
  /** Los renglones del mes, en orden estable (día y nombre). */
  items: SheetItem[]
  stretches: SheetStretch[]
  /** No vencen en ese mes. */
  later: SheetItem[]
  /** En pausa o terminados. */
  off: SheetItem[]
  /** El mismo número del Resumen. */
  progress: FixedProgress
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

/** Dentro del año de hoy alcanza con día y mes; si no, la fecha entera. */
function shortDay(iso: string, today: string): string {
  return iso.slice(0, 4) === today.slice(0, 4) ? formatDayMonth(iso) : formatIsoDay(iso)
}

// ─── Cuotas ──────────────────────────────────────────────────────────────────

/**
 * Las cuotas en palabras, debajo del concepto: «cuota 2 de 6»; sin saber de
 * cuántas, «quedan 3» o «última cuota». `null` = no es en cuotas.
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

/** Lo que se sabe de un gasto fijo, para el `title` del concepto: «Internet · Factura A · Fibertel». */
export function rowSubline(row: RecurringExpenseRow): string[] {
  const paper = papelLabel(row.voucherType)
  return [row.accountName, paper === 'Sin factura' ? 'sin factura' : paper, row.partyName].filter(
    (part): part is string => Boolean(part),
  )
}

// ─── El estado ───────────────────────────────────────────────────────────────

export type RowTone = 'ok' | 'warn' | 'bad' | 'muted'

export type RowStatus = {
  /** «Pagado», «Vencido», «Por vencer», «Lo debés»… */
  label: string
  tone: RowTone
  /** «Pagado» es un sello, no una etiqueta. */
  stamp: boolean
  /** La frase entera, para quien no ve el sello: «Pagado el 08/10». */
  title: string
  /** Lo que sigue, en gris: «el 08/10», «$ 10.000 menos que el monto». */
  detail: string | null
  /** Lo que se suma debajo: «Era la última cuota», «Debés $ X de antes». */
  extras: string[]
  /** Pagaste menos que el monto y el comprobante está saldado: lo que pregunta «¿Era eso?». */
  short: { expectedCents: number; paidCents: number } | null
}

function dueBehind(dueDate: string, today: string): string {
  const days = daysBetween(dueDate, today)
  if (days === 1) return 'venció ayer'
  // Pasado el mes y medio, contar días no ayuda: se dice la fecha.
  return days > 45 ? `venció el ${shortDay(dueDate, today)}` : `venció hace ${days} días`
}

/**
 * Cómo va un renglón, siempre con palabras (el color acompaña, nunca alcanza).
 * El vencimiento ya está en su columna: acá se dice solo lo que esa fecha no dice.
 */
export function rowStatus(item: SheetItem, today: string): RowStatus {
  const { row, line, doc } = item
  const extras: string[] = []
  if (row.ended && line.state !== 'ended') extras.push('Era la última cuota')
  if (line.priorOpenCents > 0) extras.push(`Debés ${pesos(line.priorOpenCents)} de antes`)
  const out = (
    label: string,
    tone: RowTone,
    detail: string | null = null,
    short: RowStatus['short'] = null,
  ): RowStatus => ({
    label,
    tone,
    stamp: false,
    title: detail ? `${label} · ${detail}` : label,
    detail,
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
      const when = doc ? shortDay(doc.accountingDate, today) : null
      // Pagaste de más: se dice la diferencia con su palabra, igual que cuando pagaste de menos
      // (un importe pelado al lado del monto no dice qué es).
      const over = line.dueCents !== null ? paid - line.dueCents : 0
      const parts = [
        when ? `el ${when}` : null,
        // Menos de un peso es redondeo (el impuesto del cierre trae centavos): no hay nada que decir.
        over >= 100 ? `${pesos(over)} más que el monto` : null,
      ]
      return {
        ...out('Pagado', 'ok', parts.filter(Boolean).join(' · ') || null),
        stamp: true,
        title: when ? `Pagado el ${when}` : 'Pagado',
      }
    }
    case 'partial':
    case 'unpaid':
    case 'overdue': {
      if (settled && remaining > 0) {
        return out(
          `Pagaste ${pesos(paid)}`,
          'warn',
          `${pesos(remaining)} menos que el monto`,
          line.dueCents === null ? null : { expectedCents: line.dueCents, paidCents: paid },
        )
      }
      if (owed) {
        if (line.state === 'overdue') {
          const tail = paid > 0 ? ` · pagaste ${pesos(paid)}, falta ${pesos(remaining)}` : ''
          return out('Lo debés', 'bad', `${dueBehind(due, today)}${tail}`)
        }
        if (line.state === 'partial') {
          return out(`Pagaste ${pesos(paid)}`, 'warn', `falta ${pesos(remaining)}`)
        }
        return out('Lo debés', 'warn', `vence el ${shortDay(due, today)}`)
      }
      if (line.state === 'overdue') return out('Vencido', 'bad')
      // Cerca del vencimiento (los días de aviso de ese gasto) va en ámbar; lejos, en gris.
      const days = daysBetween(today, due)
      if (days === 0) return out('Vence hoy', 'warn')
      if (days === 1) return out('Vence mañana', 'warn')
      return out('Por vencer', days <= Math.max(1, row.remindDaysBefore) ? 'warn' : 'muted')
    }
    case 'no_amount':
      return out('Sin monto', line.pastDue ? 'bad' : 'muted')
    case 'upcoming':
      return out('Por vencer', 'muted')
    case 'skipped':
      return out('Este mes no se paga', 'muted')
    case 'paused':
      return out('En pausa', 'muted')
    case 'ended':
      return out(
        'Terminó',
        'muted',
        row.endsOn ? `la última cuota venció el ${shortDay(row.endsOn, today)}` : null,
      )
  }
}

/** La pregunta de quien pagó menos de lo que calculaba: la contesta el «⋯» de la fila. */
export function askWords(short: NonNullable<RowStatus['short']>): string {
  return `Calculabas ${pesos(short.expectedCents)}. ¿Era eso?`
}

/** El casillero: vacío, tildado, a medias o con raya («este mes no se paga»). */
export function tickState(item: SheetItem): 'empty' | 'done' | 'half' | 'skip' {
  const { line } = item
  if (line.state === 'paid') return 'done'
  if (line.state === 'skipped' || line.state === 'paused' || line.state === 'ended') return 'skip'
  return (line.paidCents ?? 0) > 0 ? 'half' : 'empty'
}

// ─── Los impuestos que se devengan solos ─────────────────────────────────────

/** La cuenta de un gasto → el partícipe al que se le paga (`null`: el bar no lo tiene activo). */
export type AutoTaxPlan = Readonly<Record<string, string | null>>

const AUTO_TAX_PARTIES: Readonly<Record<string, string>> = {
  iibb_expense: 'rentas',
  municipal_tax_expense: 'municipalidad',
}

/**
 * Ingresos Brutos y Comercio e Industria, con los impuestos automáticos prendidos, ya se devengan
 * en cada cierre del día (D Ingresos Brutos / H IIBB a pagar [Rentas]: `buildSalesClose`). Un gasto
 * fijo con esas cuentas no puede volver a cargar el gasto al pagarse, porque quedaría dos veces:
 * pagarlo es cancelarle la deuda al partícipe (`rentas` o `municipalidad`), con la hoja «Pagar».
 *
 * Con los impuestos apagados el plan queda vacío y esos gastos fijos se pagan como cualquier otro.
 */
export function autoTaxPlan(input: {
  settings: { auto: boolean } | null | undefined
  accounts: ReadonlyArray<{ id: string; systemKey: string | null }>
  parties: ReadonlyArray<{ id: string; systemKey: string | null; active: boolean }>
}): AutoTaxPlan {
  if (!input.settings?.auto) return {}
  const plan: Record<string, string | null> = {}
  for (const account of input.accounts) {
    const partyKey = account.systemKey ? AUTO_TAX_PARTIES[account.systemKey] : undefined
    if (!partyKey) continue
    plan[account.id] =
      input.parties.find((party) => party.systemKey === partyKey && party.active)?.id ?? null
  }
  return plan
}

// ─── Qué se puede hacer con un renglón ───────────────────────────────────────

/** Lo que hace tildar: cargar el gasto, pagarle a alguien o ir a la factura. */
export type PayAction =
  | { kind: 'gasto'; recurringId: string }
  | {
      kind: 'pagar'
      partyId: string
      /** El gasto fijo que queda pagado con este pago (Rentas, Municipalidad). */
      recurringId?: string
    }
  | { kind: 'document'; documentId: string }

export type RowActions = {
  /** Lo que hace tildar el casillero. `null`: no se ofrece. */
  pay: PayAction | null
  /** Se paga desde el renglón: vence este mes o ya venció. */
  payInRow: boolean
  /** Todavía no vence: se paga por adelantado. */
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
  /** Cambiar el monto en la celda y entrar a la ficha. */
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
 * Tildar nunca paga con el comprobante de este mes ya saldado, aunque la cuenta
 * diga «falta»: otro gasto con el mismo gasto fijo daría por cargado el mes que
 * viene. Ahí va «¿Era eso?».
 */
export function rowActions(
  item: SheetItem,
  opts: { canWrite: boolean; autoTax?: AutoTaxPlan | null },
): RowActions {
  if (!opts.canWrite) return NO_ACTIONS
  const { row, line, doc, realStatus } = item
  const loaded = line.documentId !== null
  const owed = doc !== null && doc.openCents > 0
  const settled = doc !== null && doc.openCents === 0
  const paid = line.paidCents ?? 0
  const detailed = row.breakdown.length > 0
  // Se devenga solo en cada cierre: se le paga al partícipe, nunca como otro gasto (`autoTaxPlan`).
  const taxParty = opts.autoTax?.[row.accountId]
  const autoTax = taxParty !== undefined
  const fresh: PayAction | null = !autoTax
    ? { kind: 'gasto', recurringId: row.id }
    : taxParty === null
      ? null
      : { kind: 'pagar', partyId: taxParty, recurringId: row.id }

  let pay: PayAction | null = null
  let payInRow = false
  let payAhead = false
  if (owed && doc) {
    pay = row.partyId
      ? { kind: 'pagar', partyId: row.partyId }
      : { kind: 'document', documentId: doc.id }
    payInRow = true
  } else if (!loaded && row.active && realStatus === 'pending') {
    pay = fresh
    payInRow = fresh !== null
  } else if (!loaded && row.active && realStatus === 'upcoming') {
    pay = fresh
    payAhead = fresh !== null
  }

  return {
    pay,
    payInRow,
    payAhead,
    bill: !autoTax && row.active && realStatus !== 'skipped',
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

/** ¿El monto se escribe en su celda? No con comprobante cargado ni con detalle (es la suma). */
export function amountEditable(item: SheetItem, actions: Pick<RowActions, 'edit'>): boolean {
  return actions.edit && item.line.documentId === null && item.row.breakdown.length === 0
}

/** Lo que hace una opción del «⋯» que no es un link. */
export type RowDo = 'pay' | 'skip' | 'unskip' | 'keep' | 'pause' | 'resume' | 'remove'

export type RowMenuItem = {
  key: string
  label: string
  /** En gris, debajo. */
  hint?: string
  /** El grupo: entre uno y otro va una raya. */
  section: 'pay' | 'edit' | 'state'
} & ({ href: string; run?: undefined } | { run: RowDo; href?: undefined; cents?: number })

/**
 * El «⋯» de la fila: todo lo que no es de todos los días y no se pierde. Lo decide esto, sin React,
 * para que la pantalla no tenga que abrir el menú para saber qué ofrece.
 */
export function rowMenu(
  item: SheetItem,
  actions: RowActions,
  ctx: { tenantSlug: string; month: string; isMisc?: boolean },
): RowMenuItem[] {
  const { row, line, doc } = item
  const { tenantSlug, month } = ctx
  const nextDue = formatDayMonth(row.nextDueDate)
  const menu: RowMenuItem[] = []
  const { pay } = actions

  if (actions.payAhead && pay?.kind !== 'document') {
    menu.push({
      key: 'pay',
      section: 'pay',
      label: 'Pagar por adelantado',
      hint: `Paga el vencimiento del ${nextDue}.`,
      run: 'pay',
    })
  }
  if (pay?.kind === 'document') {
    menu.push({
      key: 'factura',
      section: 'pay',
      label: 'Ver la factura y pagarla',
      href: documentHref(tenantSlug, pay.documentId),
    })
  } else if (doc) {
    menu.push({
      key: 'comprobante',
      section: 'pay',
      label: 'Ver el comprobante',
      href: documentHref(tenantSlug, doc.id),
    })
  }
  if (actions.bill) {
    menu.push({
      key: 'factura-despues',
      section: 'pay',
      label: 'Me llegó la factura y la pago después',
      hint: `Queda como deuda con el proveedor. Cubre el vencimiento del ${nextDue}.`,
      href: newPurchaseHref(tenantSlug, {
        proveedor: row.partyId,
        gastoFijo: row.id,
        volver: gastosFijosHref(tenantSlug, { mes: month }),
      }),
    })
  }
  if (actions.skip) {
    menu.push({
      key: 'skip',
      section: 'pay',
      label: 'Este mes no se paga',
      hint: 'Usalo también si ya lo cargaste por otro lado.',
      run: 'skip',
    })
  }
  if (actions.unskip) {
    menu.push({ key: 'unskip', section: 'pay', label: 'Sí se paga este mes', run: 'unskip' })
  }
  const paid = line.paidCents ?? 0
  if (actions.ask) {
    menu.push({
      key: 'keep',
      section: 'pay',
      label: `Sí, dejar ${pesos(paid)}`,
      hint: 'Pasa a ser el monto de siempre.',
      run: 'keep',
      cents: paid,
    })
  }
  if (actions.keepPaid) {
    menu.push({
      key: 'keep',
      section: 'pay',
      label: `Usar ${pesos(paid)} de ahora en más`,
      run: 'keep',
      cents: paid,
    })
  }

  menu.push({
    key: 'ficha',
    section: 'edit',
    label: row.breakdown.length > 0 ? 'Editar el detalle' : 'Editar',
    hint: 'El día, las cuotas, el papel, a quién y con qué.',
    href: recurringHref(tenantSlug, row.id),
  })
  if (row.breakdown.length > 0) {
    menu.push({
      key: 'sueldos',
      section: 'edit',
      label: 'Contabilidad › Sueldos del mes',
      hint: 'Los números del mes que te pasa la contadora.',
      href: `/${tenantSlug}/administracion/libros/asiento-manual?tipo=sueldos`,
    })
  }
  if (ctx.isMisc && actions.edit) {
    menu.push({
      key: 'categoria',
      section: 'edit',
      label: 'Cambiar de categoría',
      hint: 'Quedó en «Gastos varios».',
      href: gastosFijosFillHref(tenantSlug, { ver: 'varios', foco: row.id }),
    })
  }

  if (actions.pause) menu.push({ key: 'pause', section: 'state', label: 'Pausar', run: 'pause' })
  if (actions.resume) {
    menu.push({ key: 'resume', section: 'state', label: 'Reanudar', run: 'resume' })
  }
  if (actions.remove)
    menu.push({ key: 'remove', section: 'state', label: 'Eliminar', run: 'remove' })
  return menu
}

// ─── La tira de pago ─────────────────────────────────────────────────────────

/** «Más opciones»: el formulario entero, con ese gasto fijo elegido, y la vuelta a la planilla. */
export function morePayOptionsHref(slug: string, recurringId: string, month: string): string {
  return newPurchaseHref(slug, {
    modo: 'pago',
    gastoFijo: recurringId,
    volver: gastosFijosHref(slug, { mes: month }),
  })
}

/** Lo que la tira mira de un proveedor (los de la hoja, `SheetParty`). */
export type StripParty = Pick<SheetParty, 'id' | 'name' | 'tradeName' | 'taxId' | 'active' | 'kind'>

/**
 * De quién es la factura de un gasto fijo que no tiene proveedor: uno que ya existe o uno nuevo. Con
 * un proveedor en el gasto fijo, la tira no pregunta.
 */
export type StripSupplier =
  | { kind: 'party'; partyId: string }
  | { kind: 'new'; name: string; taxId: string; ivaCondition: IvaCondition }

/** El gasto fijo, como lo precarga la tira (`recurringPrefill`). */
type FixedTarget = Extract<ExpenseTarget, { kind: 'party' | 'account' }>

/** Se le puede cargar un gasto (lo mismo que `payableParties` de «Nuevo gasto»). */
function isPayableParty(p: StripParty): boolean {
  return p.active && (p.kind === 'supplier' || p.kind === 'other')
}

/** El activo que ya tiene ese CUIT (son únicos entre los activos de un bar). */
function cuitOwner(parties: readonly StripParty[], cuit: string): StripParty | null {
  return (
    parties.find((p) => p.active && p.taxId !== null && normalizeCuit(p.taxId) === cuit) ?? null
  )
}

/** Con factura y un gasto fijo sin proveedor, la tira pregunta de quién es. */
export function stripAsksSupplier(fixed: FixedTarget | null, voucher: QuickVoucher): boolean {
  return fixed?.kind === 'account' && isInvoiceVoucher(voucher)
}

/**
 * Con qué se carga el pago: el gasto fijo tal cual o, si la tira preguntó el proveedor, ese proveedor
 * con la categoría del gasto fijo (la de la planilla). Una factura A la hace un responsable inscripto.
 */
export function stripTarget(input: {
  fixed: FixedTarget | null
  voucher: QuickVoucher
  supplier: StripSupplier | null
}): ExpenseTarget | null {
  const { fixed, supplier } = input
  if (fixed === null || supplier === null || !stripAsksSupplier(fixed, input.voucher)) return fixed
  if (supplier.kind === 'party') {
    return { kind: 'party', partyId: supplier.partyId, accountId: fixed.accountId }
  }
  return {
    kind: 'new',
    name: supplier.name,
    taxId: supplier.taxId,
    ivaCondition: input.voucher === 'a' ? 'responsable_inscripto' : supplier.ivaCondition,
    accountId: fixed.accountId,
  }
}

/**
 * Lo que la tira no puede resolver todavía, en palabras. `null` = se puede cargar. Una factura pide
 * proveedor y número: la tira los pregunta, y el QR de ARCA los completa.
 */
export function payStripBlock(input: {
  amountCents: number | null
  target: ExpenseTarget | null
  voucher: QuickVoucher
  /** Ya se sabe el punto de venta y el número (los leyó el QR o se escribieron). */
  hasNumber: boolean
  /** Para avisar si el CUIT de un proveedor nuevo ya es de otro. */
  parties?: readonly StripParty[]
}): string | null {
  if (input.amountCents === null || input.amountCents <= 0) {
    return 'Falta el monto: escribilo en la columna Monto.'
  }
  const { target } = input
  if (target === null) return 'Este gasto fijo no tiene proveedor ni categoría que sirvan.'
  if (target.accountId === null) return 'Este gasto fijo no tiene una categoría que sirva.'
  if (!isInvoiceVoucher(input.voucher)) return null
  if (target.kind === 'account') {
    return input.hasNumber
      ? 'Para la factura falta el proveedor.'
      : 'Para la factura falta el proveedor y el número.'
  }
  if (target.kind === 'new') {
    if (target.name.trim().length < 2) return 'Escribí el nombre del proveedor nuevo.'
    const cuit = parseCuit(target.taxId)
    if (!cuit.ok) {
      return cuit.reason === 'vacio'
        ? 'Para la factura falta el CUIT del proveedor nuevo.'
        : 'El CUIT del proveedor nuevo no es válido: revisalo.'
    }
    const owner = cuitOwner(input.parties ?? [], cuit.cuit)
    if (owner) {
      const name = owner.tradeName ?? owner.name
      return isPayableParty(owner)
        ? `Ese CUIT ya es de «${name}»: elegilo en Proveedor.`
        : `Ese CUIT es de «${name}», que no es un proveedor: revisalo.`
    }
  }
  if (!input.hasNumber) return 'Para la factura falta el número.'
  return null
}

/**
 * El proveedor que trae el QR de ARCA (el CUIT de quien facturó): el activo que ya tiene ese CUIT o
 * uno nuevo con ese CUIT, con `name` y la condición que dice la letra (la C la hace un monotributista).
 * `null`: el CUIT no sirve, o es de alguien a quien no se le carga un gasto (un medio de cobro).
 */
export function stripSupplierFromQr(
  qr: { cuit: string; voucherType: string | null },
  parties: readonly StripParty[],
  name: string,
): StripSupplier | null {
  const cuit = parseCuit(qr.cuit)
  if (!cuit.ok) return null
  const owner = cuitOwner(parties, cuit.cuit)
  if (owner) return isPayableParty(owner) ? { kind: 'party', partyId: owner.id } : null
  const letter = isVoucherType(qr.voucherType) ? VOUCHER_CATALOG[qr.voucherType].letter : null
  return {
    kind: 'new',
    name: name.trim(),
    taxId: formatCuit(cuit.cuit),
    ivaCondition: letter === 'C' ? 'monotributo' : 'responsable_inscripto',
  }
}

/**
 * Lo que queda elegido después de leer el QR. Lo que se eligió a mano de la lista no se toca; un
 * proveedor nuevo pasa a ser el que ya tiene ese CUIT, o toma el CUIT y la letra si todavía no tenía.
 */
export function supplierAfterQr(
  current: StripSupplier | null,
  qr: { cuit: string; voucherType: string | null },
  parties: readonly StripParty[],
  fallbackName: string,
): StripSupplier | null {
  const name = current?.kind === 'new' && current.name.trim() !== '' ? current.name : fallbackName
  const read = stripSupplierFromQr(qr, parties, name)
  if (read === null || current === null) return current ?? read
  if (current.kind === 'party') return current
  if (read.kind === 'party') return read
  return current.taxId.trim() === ''
    ? { ...current, taxId: read.taxId, ivaCondition: read.ivaCondition }
    : current
}

/** Lo que el QR de ARCA le completa a la tira. Un comprobante que no se carga no cambia el papel. */
export function stripFromQr(data: {
  voucherType: string | null
  pointOfSale: number
  number: number
  totalCents: number | null
}): {
  voucher: QuickVoucher | null
  pointOfSale: number
  number: number
  amountCents: number | null
} {
  return {
    voucher: quickVoucherFromType(data.voucherType),
    pointOfSale: data.pointOfSale,
    number: data.number,
    amountCents: data.totalCents !== null && data.totalCents > 0 ? data.totalCents : null,
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

// ─── Lo que suma lo que se ve ────────────────────────────────────────────────

export type ShownTotals = {
  count: number
  /** Pagado más lo que falta, de los que tienen monto. */
  totalCents: number
  paidCents: number
  remainingCents: number
  /** Los que no tienen monto: no suman. */
  noAmount: number
}

/**
 * La suma de un grupo de renglones. Misma cuenta que el total del mes: pagado
 * más lo que falta, sin los que no tienen monto.
 */
export function shownTotals(items: readonly SheetItem[]): ShownTotals {
  const totals: ShownTotals = {
    count: items.length,
    totalCents: 0,
    paidCents: 0,
    remainingCents: 0,
    noAmount: 0,
  }
  for (const { line } of items) {
    if (line.state === 'no_amount') totals.noAmount += 1
    if (line.remainingCents === null || line.paidCents === null) continue
    totals.paidCents += line.paidCents
    totals.remainingCents += line.remainingCents
    totals.totalCents += line.paidCents + line.remainingCents
  }
  return totals
}

// ─── Lo que quedó de antes (mirando el mes que viene) ────────────────────────

/**
 * Mirando el mes que viene, la hoja trae dos cosas distintas: lo que vence ESE
 * mes y lo que quedó de antes sin pagar (aparece una vez, con su fecha vieja).
 * Nunca se suman bajo el nombre del mes que viene: un «Total de noviembre»
 * armado con la deuda de octubre es un número con el mes equivocado.
 *
 * En el mes de hoy no se separa nada: lo vencido de antes es parte de «Por
 * pagar», como en el Resumen.
 */
export type SheetCarry = {
  /** El mes de hoy (`yyyy-MM`): la hoja donde se pagan. */
  month: string
  /** Los que quedaron de antes sin pagar. */
  count: number
  /** Lo que suman (los que no tienen monto no suman). */
  cents: number
  /** Los renglones que sí son del mes que se mira. */
  own: SheetItem[]
  /** Lo que suman esos (pagado, falta y cuántos no tienen monto). */
  ownTotals: ShownTotals
}

function isCarried(item: SheetItem, month: string): boolean {
  const { state } = item.line
  return monthOf(item.day) < month && state !== 'paid' && state !== 'skipped'
}

/** `null` en el mes de hoy, o si no quedó nada de antes. */
export function sheetCarry(
  sheet: Pick<Sheet, 'isCurrent' | 'items' | 'month' | 'today'>,
): SheetCarry | null {
  if (sheet.isCurrent) return null
  const carried = sheet.items.filter((item) => isCarried(item, sheet.month))
  if (carried.length === 0) return null
  const own = sheet.items.filter((item) => !isCarried(item, sheet.month))
  return {
    month: monthOf(sheet.today),
    count: carried.length,
    cents: carried.reduce((sum, item) => sum + (item.line.remainingCents ?? 0), 0),
    own,
    ownTotals: shownTotals(own),
  }
}

// ─── El totalizador ──────────────────────────────────────────────────────────

/** Lo que aportan los sueldos a la hoja. */
export type PayrollSums = Pick<
  PayrollTotals,
  'count' | 'salaryCents' | 'advancesCents' | 'paidCents' | 'owedCents'
>

export type SheetTotals = {
  /** `null`: nada suma todavía. Nunca «$ 0» por un dato que falta. */
  totalCents: number | null
  paidCents: number | null
  pendingCents: number | null
  overdueCents: number | null
  /** Lo que suman los sueldos; `null` si no hay ninguno que sumar. */
  payrollCents: number | null
  /** Vencen este mes y no tienen monto: no suman. */
  noAmount: number
}

/**
 * Total del mes, Pagado, Por pagar y Vencido: el totalizador que pidió Tomi. Suma los gastos fijos
 * que vencen en el mes (los mismos del Resumen) y la planilla de Sueldos. Mirando el mes que viene,
 * lo que quedó de antes no entra al total del mes: su deuda se ve en «Vencido» y en su tramo.
 */
export function sheetTotals(
  sheet: Pick<Sheet, 'isCurrent' | 'items' | 'month' | 'today' | 'progress'>,
  payroll: PayrollSums | null,
): SheetTotals {
  const { progress } = sheet
  const carry = sheetCarry(sheet)
  const own = carry
    ? carry.ownTotals
    : {
        totalCents: progress.totalCents,
        paidCents: progress.paidCents,
        remainingCents: progress.remainingCents,
        noAmount: progress.noAmountDue,
      }
  const counted = carry
    ? carry.own.some((item) => item.line.remainingCents !== null)
    : progress.countedRows > 0
  const salaries =
    payroll && (payroll.salaryCents > 0 || payroll.advancesCents > 0 || payroll.paidCents > 0)
      ? payroll
      : null
  // Nada suma todavía: sin «$ 0». Lo que quedó de antes puede estar vencido igual.
  const nothing = !counted && !salaries
  return {
    totalCents: nothing ? null : own.totalCents + (salaries?.salaryCents ?? 0),
    paidCents: nothing
      ? null
      : own.paidCents + (salaries ? salaries.advancesCents + salaries.paidCents : 0),
    pendingCents: nothing ? null : own.remainingCents + (salaries?.owedCents ?? 0),
    overdueCents: nothing && progress.overdueCents === 0 ? null : progress.overdueCents,
    payrollCents: salaries?.salaryCents ?? null,
    noAmount: own.noAmount,
  }
}

/** Cómo va la fila fija de los sueldos: «Falta $ X», «Pagado» o que todavía no hay nada. */
export function payrollRowStatus(payroll: PayrollSums | null): {
  label: string
  tone: RowTone
  stamp: boolean
} {
  if (payroll === null) return { label: 'No se pudo leer', tone: 'bad', stamp: false }
  if (payroll.salaryCents <= 0) {
    return {
      label: payroll.count === 0 ? 'Sin cargar' : 'Sin sueldos',
      tone: 'muted',
      stamp: false,
    }
  }
  if (payroll.owedCents > 0) {
    return { label: `Falta ${pesos(payroll.owedCents)}`, tone: 'muted', stamp: false }
  }
  return { label: 'Pagado', tone: 'ok', stamp: true }
}
