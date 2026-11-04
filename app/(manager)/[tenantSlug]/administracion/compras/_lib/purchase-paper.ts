/**
 * «Cargar una compra», lo puro de la pantalla con forma de factura: el recuadro de la letra y lo que
 * se puede elegir en él, cuándo hay que preguntar «¿Cómo te factura?», el plazo de «La debo», el pago
 * en el mismo envío, por dónde se manda una compra y pago, y el texto del botón.
 * Lo prueba `tests/lib/administracion-compra-papel.test.ts`.
 *
 * Nada de esto cambia lo que se manda: cada función devuelve un valor que el
 * formulario ya sabía escribir (un `VoucherType` de `voucherOptionsFor`, una
 * fecha para `dueDate`, el mismo objeto `payNow` de «Guardar y pagar…»). La
 * cuenta del asiento sigue en `purchase.ts` y en el motor.
 */

import { exactAmountText } from '@/components/administracion/acciones/gasto-papel'
import { pickTreasury } from '@/lib/accounting/defaults'
import { isNotInvoicedVoucher } from '@/lib/accounting/invoiced'
import { invoiceLetterFor } from '@/lib/accounting/posting/quick-expense'
import type { IvaCondition, VoucherType } from '@/lib/accounting/types'
import { VOUCHER_CATALOG, voucherConditionCheck } from '@/lib/accounting/voucher-types'
import { daysBetween } from '@/lib/dates'
import type { PurchaseFormState } from './purchase'
import { QUICK_DETAIL_MAX, type QuickVoucher, withRemito } from './quick-expense'
import type { SheetTreasury } from './sheet-types'
import {
  CREDIT_NOTE_ORDER,
  DEBIT_NOTE_ORDER,
  notInvoicedDefault,
  type PurchaseDocKind,
  type PurchaseFamily,
} from './vouchers'

/**
 * ESPERA EL SÍ DEL DUEÑO (duda 2 del índice de la tanda 2). Apagada, la compra
 * propone lo mismo que siempre: el papel de `defaultVoucherFor` y el
 * vencimiento de `suggestDueDate` (fecha del papel + plazo).
 *
 * Prendida (`true`), deja de proponer cuando no se sabe:
 * - de un proveedor del que no sabemos cómo factura (`sin_datos`) y sin nada
 *   recordado, no viene ningún papel marcado (hoy viene «Tique», que casi
 *   nunca es): hay que tocar el que se tiene en la mano;
 * - de un proveedor sin plazo, no viene ninguna fecha marcada en «¿Cuándo
 *   vence?» (hoy viene «El mismo día», y la compra figura vencida al día
 *   siguiente): hay que tocar una, o «Sin fecha».
 * Es el único lugar donde se prende.
 */
export const ASK_WHEN_UNKNOWN: boolean = false

/** ¿Hay que dejar el papel sin marcar? (solo con `ASK_WHEN_UNKNOWN`). */
export function asksPaper(input: {
  condition: IvaCondition | null
  remembered: string | null
  ask?: boolean
}): boolean {
  const ask = input.ask ?? ASK_WHEN_UNKNOWN
  return ask && input.condition === 'sin_datos' && !input.remembered
}

/** ¿Hay que dejar el vencimiento sin marcar? (solo con `ASK_WHEN_UNKNOWN`). */
export function asksDue(input: { termDays: number; ask?: boolean }): boolean {
  const ask = input.ask ?? ASK_WHEN_UNKNOWN
  return ask && input.termDays <= 0
}

// ─── Los cuatro papeles ──────────────────────────────────────────────────────

/** La tarjeta que corresponde a un tipo. `null`: no es ninguna de las cuatro («Es otro papel»). */
export function paperOfVoucher(type: string | null | undefined): QuickVoucher | null {
  if (type === 'factura_a') return 'a'
  if (type === 'factura_b' || type === 'factura_c') return 'bc'
  if (type === 'tique') return 'ticket'
  if (isNotInvoicedVoucher(type)) return 'none'
  return null
}

/**
 * El tipo que escribe cada tarjeta, entre los que el formulario ya ofrecía
 * (`options` = `voucherOptionsFor(...)`). `null` = ese papel no entra con lo
 * que sabemos del proveedor: no se escribe nada y se pregunta («¿Cómo te
 * factura?», `invoicingGap`).
 *
 * «Factura B o C»: el recordado si es uno de los dos; si no, B con un
 * responsable inscripto y C con los demás (la regla del motor,
 * `invoiceLetterFor`); el que esté entre las opciones.
 */
export function voucherForPaper(
  paper: QuickVoucher,
  input: {
    options: readonly VoucherType[]
    remembered?: string | null
    condition: IvaCondition | null
  },
): VoucherType | null {
  const has = (type: VoucherType) => input.options.includes(type)
  switch (paper) {
    case 'a':
      return has('factura_a') ? 'factura_a' : null
    case 'ticket':
      return has('tique') ? 'tique' : null
    case 'none':
      return notInvoicedDefault(input.options)
    case 'bc': {
      const remembered = input.remembered
      if ((remembered === 'factura_b' || remembered === 'factura_c') && has(remembered)) {
        return remembered
      }
      const byCondition = invoiceLetterFor(input.condition ?? 'responsable_inscripto')
      if (has(byCondition)) return byCondition
      const other: VoucherType = byCondition === 'factura_b' ? 'factura_c' : 'factura_b'
      return has(other) ? other : null
    }
  }
}

/** Lo que no es ninguna de las cuatro tarjetas (Factura M, tique factura, recibo, otro, DDJJ). */
export function otherPaperTypes(options: readonly VoucherType[]): VoucherType[] {
  return options.filter((type) => paperOfVoucher(type) === null)
}

// ─── El recuadro de la letra ─────────────────────────────────────────────────

export type LetterBox = {
  /** Lo que va adentro del recuadro: «A», «TQ», «R». */
  mark: string
  /** Una palabra y no una letra: va más chica. */
  word: boolean
  /** La letra chica de abajo: «COD. 01», «INTERNO». */
  code: string
  /** El título del papel: «FACTURA», «TIQUE», «REMITO». */
  title: string
}

const FAMILY_TITLES: Readonly<Partial<Record<string, string>>> = {
  factura: 'FACTURA',
  tique_factura: 'TIQUE FACTURA',
  nota_credito: 'NOTA DE CRÉDITO',
  nota_debito: 'NOTA DE DÉBITO',
  recibo: 'RECIBO',
  tique: 'TIQUE',
  sin_comprobante: 'REMITO',
  ddjj: 'DDJJ O BOLETA',
}

const WORD_MARKS: Readonly<Partial<Record<VoucherType, string>>> = {
  tique: 'TQ',
  sin_comprobante: 'R',
  otro_comprobante: 'OT',
  ddjj_impuesto: 'DJ',
}

/** Lo que dibuja el recuadro de arriba de una factura, para cualquier tipo de comprobante. */
export function letterBoxOf(type: VoucherType | null): LetterBox {
  if (type === null) return { mark: '–', word: false, code: '', title: 'COMPROBANTE' }
  const info = VOUCHER_CATALOG[type]
  const mark = info.letter ?? WORD_MARKS[type] ?? '–'
  const code =
    info.afipCode !== null
      ? `COD. ${String(info.afipCode).padStart(2, '0')}`
      : type === 'sin_comprobante'
        ? 'INTERNO'
        : ''
  return {
    mark,
    word: info.letter === null,
    code,
    title: FAMILY_TITLES[info.family] ?? 'COMPROBANTE',
  }
}

export type PaperPick = { type: VoucherType; label: string; wide: boolean }

const LETTERS_OF_NOTE = (order: readonly VoucherType[]): PaperPick[] =>
  order.map((type) => ({ type, label: VOUCHER_CATALOG[type].letter ?? '', wide: false }))

/**
 * Los botones debajo del recuadro: A, B y C, y en una compra también Tique y Remito. Se ofrecen aunque
 * el proveedor no los dé: si te dio una Factura A y figura como monotributista, tocarla abre «¿Cómo te
 * factura?» (ver `invoicingGap`). Un organismo no: una DDJJ no tiene letra y se elige de una lista.
 */
export function paperPicks(input: {
  family: PurchaseFamily
  options: readonly VoucherType[]
  isTaxAgency?: boolean
}): PaperPick[] {
  const picks: PaperPick[] =
    input.family === 'nc'
      ? LETTERS_OF_NOTE(CREDIT_NOTE_ORDER)
      : input.family === 'nd'
        ? LETTERS_OF_NOTE(DEBIT_NOTE_ORDER)
        : [
            { type: 'factura_a', label: 'A', wide: false },
            { type: 'factura_b', label: 'B', wide: false },
            { type: 'factura_c', label: 'C', wide: false },
            { type: 'tique', label: 'Tique', wide: true },
            {
              type: notInvoicedDefault(input.options) ?? 'sin_comprobante',
              label: 'Remito',
              wide: true,
            },
          ]
  return input.isTaxAgency ? picks.filter((pick) => input.options.includes(pick.type)) : picks
}

/**
 * Cómo factura quien da ese comprobante. Se usa para proponerlo al crear un proveedor o al corregir su
 * ficha: una Factura C la da un monotributista; A y B, un responsable inscripto.
 */
export function conditionForVoucher(type: VoucherType | null): IvaCondition | null {
  const letter = type ? VOUCHER_CATALOG[type].letter : null
  if (letter === 'A' || letter === 'B' || letter === 'M') return 'responsable_inscripto'
  if (letter === 'C') return 'monotributo'
  return null
}

// ─── «¿Cómo te factura?» ─────────────────────────────────────────────────────

/**
 * Lo que falta saber del proveedor para cargarle ese papel:
 * - `unknown`: no sabemos cómo factura (entró por «Agregar de una lista»);
 * - `mismatch`: lo que sabemos no coincide con el papel (un monotributista y
 *   una Factura A);
 * - `cuit`: sabemos cómo factura pero falta el CUIT, y el papel va al Libro IVA.
 * `suggest` es la condición que viene marcada (quien da una Factura A es
 * responsable inscripto).
 */
export type InvoicingGap = { kind: 'unknown' | 'mismatch' | 'cuit'; suggest: IvaCondition | null }

export function invoicingGap(input: {
  paper: QuickVoucher | null
  /** El comprobante exacto que se tocó. Con los botones A, B y C se sabe cuál es de los dos. */
  voucherType?: VoucherType | null
  condition: IvaCondition
  hasTaxId: boolean
  /** El papel elegido entra al Libro IVA (`VOUCHER_CATALOG[type].ivaBook`). */
  entersIvaBook: boolean
}): InvoicingGap | null {
  const rejected = (type: VoucherType) =>
    voucherConditionCheck(type, input.condition).status === 'rejected'
  const blocked = input.voucherType
    ? rejected(input.voucherType)
    : input.paper === 'a'
      ? rejected('factura_a')
      : input.paper === 'bc'
        ? rejected('factura_b') && rejected('factura_c')
        : false
  if (blocked) {
    return {
      kind: input.condition === 'sin_datos' ? 'unknown' : 'mismatch',
      suggest:
        (input.voucherType ? conditionForVoucher(input.voucherType) : null) ??
        (input.paper === 'a' ? 'responsable_inscripto' : null),
    }
  }
  if (!input.hasTaxId && input.entersIvaBook) return { kind: 'cuit', suggest: null }
  return null
}

/** Las tres respuestas de «¿Cómo te factura?», con lo que significa cada una. */
export const INVOICING_CHOICES: ReadonlyArray<{
  value: IvaCondition
  label: string
  hint: string
}> = [
  { value: 'responsable_inscripto', label: 'Responsable inscripto', hint: 'Te da Factura A o B.' },
  { value: 'monotributo', label: 'Monotributo', hint: 'Te da Factura C.' },
  { value: 'exento', label: 'Exento', hint: 'Te da Factura B o C.' },
]

const CONDITION_NOUNS: Readonly<Record<IvaCondition, string>> = {
  responsable_inscripto: 'responsable inscripto',
  monotributo: 'monotributista',
  exento: 'exento',
  consumidor_final: 'consumidor final',
  no_alcanzado: 'no alcanzado por el IVA',
  sin_datos: 'sin datos',
}

/** «responsable inscripto», «monotributista»: la condición dicha de una persona. */
export function conditionNoun(condition: IvaCondition): string {
  return CONDITION_NOUNS[condition]
}

const PAPER_NAMES: Readonly<Record<QuickVoucher, string>> = {
  a: 'Factura A',
  bc: 'Factura B o C',
  ticket: 'Tique',
  none: 'Remito',
}

/**
 * El nombre del papel que no coincide. En «B o C» la condición dice cuál de los dos se tocó: un
 * responsable inscripto sí da B y un monotributista sí da C.
 */
function paperNameFor(paper: QuickVoucher | null, condition: IvaCondition): string {
  if (paper === null) return 'ese papel'
  if (paper === 'bc' && condition === 'responsable_inscripto') return 'Factura C'
  if (paper === 'bc' && condition === 'monotributo') return 'Factura B'
  return PAPER_NAMES[paper]
}

/** El título y la explicación del bloque «¿Cómo te factura?», según lo que falte. */
export function gapWords(
  gap: InvoicingGap,
  input: { name: string; condition: IvaCondition; paper: QuickVoucher | null },
): { title: string; body: string } {
  if (gap.kind === 'cuit') {
    return {
      title: `${input.name} no tiene CUIT cargado`,
      body: 'El Libro IVA lo necesita. Está arriba en la factura.',
    }
  }
  if (gap.kind === 'unknown') {
    return {
      title: `¿Cómo te factura ${input.name}?`,
      body: 'Todavía no lo sabemos y hace falta para cargarle una factura. Queda en su ficha: no te lo volvemos a preguntar.',
    }
  }
  const noun = conditionNoun(input.condition)
  const paper = paperNameFor(input.paper, input.condition)
  return {
    title: `${input.name} figura como ${noun}`,
    body: `Un ${noun} no da ${paper}. Si te dio una, corregí cómo factura:`,
  }
}

// ─── La debo: a cuántos días ─────────────────────────────────────────────────

export type DueTerm = {
  /** Días entre la fecha del papel y el vencimiento. `null`: sin fecha de pago. */
  days: number | null
  /** Lo que se dice al lado del plazo cuando es el de siempre. */
  note: 'como siempre' | 'como las últimas veces' | null
  /** El plazo de sus últimas compras, si no es el que está puesto: se ofrece con un toque. */
  suggestion: number | null
}

/**
 * «A 21 días, como siempre»: el plazo que resulta de las dos fechas. Sale del vencimiento que el
 * formulario YA tiene (el de `suggestDueDate`, o el que tocó la persona): el valor por defecto no
 * cambia, solo se dice.
 */
export function dueTermOf(input: {
  issueDate: string | null
  dueDate: string | null
  /** El plazo de la ficha del proveedor (0 = no tiene). */
  termDays: number
  /** El plazo de sus últimas compras, si es siempre el mismo (`defaults.suggestedTermDays`). */
  suggestedTermDays?: number | null
}): DueTerm {
  const { issueDate, dueDate, termDays } = input
  const suggested = termDays > 0 ? 0 : (input.suggestedTermDays ?? 0)
  const days = issueDate && dueDate ? daysBetween(issueDate, dueDate) : null
  return {
    days,
    note:
      days !== null && days > 0 && days === termDays
        ? 'como siempre'
        : days !== null && days > 0 && days === suggested
          ? 'como las últimas veces'
          : null,
    suggestion: suggested > 0 && days !== suggested ? suggested : null,
  }
}

/** Lo que se tipea en el plazo: un número de días, de 0 a un año largo. `null`: no se entiende. */
export function parseTermDays(text: string): number | null {
  const digits = text.trim()
  if (!/^\d{1,3}$/.test(digits)) return null
  return Number(digits)
}

/**
 * El plazo de un proveedor NUEVO que viaja con la compra: el del tilde
 * «Pagarle siempre a N días», y solo mientras ese tilde está a la vista
 * (`offeredTerm`). Si deja de verse (se pasó a «Ya lo pagué», o cambió la fecha
 * del papel y el vencimiento ya no es «En N días») vuelve a 0, que es lo que
 * se mandó siempre cuando nadie escribe un plazo: nunca viaja un plazo que la
 * persona no tiene adelante.
 */
export function newPartyTermToSend(termDays: number, offeredTerm: number | null): number {
  return offeredTerm !== null && termDays === offeredTerm ? termDays : 0
}

/** «Así, desde mañana va a figurar como vencida»: la compra a deber vence el mismo día del papel. */
export function dueSameDayWarning(input: {
  issueDate: string | null
  dueDate: string | null
  paying: boolean
}): boolean {
  return !input.paying && input.issueDate !== null && input.dueDate === input.issueDate
}

// ─── «Ya lo pagué» ───────────────────────────────────────────────────────────

/**
 * El pago en el mismo envío, tal como lo armaba «Guardar y pagar…»: la caja de
 * siempre con ese proveedor (o la Caja), el total (`amountCents: null`), hoy y
 * sin referencia.
 */
export function initialPayNow(input: {
  treasuries: ReadonlyArray<Pick<SheetTreasury, 'id' | 'kind' | 'active'>>
  lastUsedWithParty: string | null
  /** Lo último que pagó esta persona en este dispositivo (`pickTreasury`). */
  myLast?: string | null
  today: string
}): NonNullable<PurchaseFormState['payNow']> {
  return {
    treasuryAccountId: pickTreasury({
      treasuries: input.treasuries.filter((t) => t.active),
      lastUsedWithParty: input.lastUsedWithParty,
      myLastQuickExpense: input.myLast ?? null,
      order: input.treasuries.map((t) => t.id),
    }),
    amountCents: null,
    date: input.today,
    reference: '',
  }
}

// ─── Por dónde se manda ──────────────────────────────────────────────────────

export type PurchaseRoute = 'purchase' | 'quick_expense'

function hasAmount(cents: number | null): boolean {
  return cents !== null && cents > 0
}

/**
 * «Compra y pago» cubre lo que hacía la hoja «Nuevo gasto», con la misma decisión:
 *
 * - Sin proveedor, o con remito o tique sin número: es un gasto de contado (`postQuickExpense`).
 * - Con factura: la compra con su pago en el mismo envío (`postPurchase` con `payNow`). Es donde se
 *   elige la letra exacta y el resto del papel.
 * - Remito o tique con lo que un gasto no lleva (renglones, percepciones, un pago parcial, otra fecha
 *   de pago, n.º de transferencia, una nota larga): también la compra, que siempre los supo guardar.
 *
 * A deber, o una nota de crédito o de débito, siempre la compra.
 */
export function purchaseRoute(
  state: PurchaseFormState,
  input: { family: PurchaseFamily; today: string; notes: string; remito: string },
): PurchaseRoute {
  const pay = state.payNow
  if (pay === null || input.family !== 'factura') return 'purchase'
  if (state.party === null) return 'quick_expense'
  const hasNumber = state.pointOfSale !== null && state.number !== null
  const plain =
    state.voucherType === 'sin_comprobante' || (state.voucherType === 'tique' && !hasNumber)
  if (!plain) return 'purchase'
  const paperExtras =
    state.amountMode === 'detail' ||
    hasAmount(state.percIvaCents) ||
    hasAmount(state.percIibbCents) ||
    hasAmount(state.percGananciasCents) ||
    hasAmount(state.otherTaxesCents)
  const payExtras =
    pay.amountCents !== null ||
    pay.reference.trim() !== '' ||
    (pay.date !== null && pay.date !== input.today)
  const detail =
    state.voucherType === 'sin_comprobante' ? withRemito(input.remito, input.notes) : input.notes
  return paperExtras || payExtras || detail.length > QUICK_DETAIL_MAX ? 'purchase' : 'quick_expense'
}

// ─── El QR de la factura ─────────────────────────────────────────────────────

/** El proveedor de esa CUIT, entre los que se les puede cargar una compra. */
export function findPartyByCuit<T extends { taxId: string | null; active: boolean }>(
  parties: readonly T[],
  cuit: string,
): T | null {
  const digits = cuit.replace(/\D/g, '')
  if (digits.length !== 11) return null
  const same = parties.filter((party) => (party.taxId ?? '').replace(/\D/g, '') === digits)
  return same.find((party) => party.active) ?? same[0] ?? null
}

/** El botón que guarda, con la forma del de «Nuevo gasto» («Cargar gasto · $ 12.500»). */
export function purchaseSubmitLabel(input: {
  docKind: PurchaseDocKind
  paying: boolean
  totalCents: number | null
}): string {
  const verb =
    input.docKind === 'purchase_credit_note'
      ? 'Cargar nota de crédito'
      : input.docKind === 'purchase_debit_note'
        ? 'Cargar nota de débito'
        : input.paying
          ? 'Cargar compra y pago'
          : 'Cargar compra'
  return input.totalCents !== null && input.totalCents > 0
    ? `${verb} · ${exactAmountText(input.totalCents)}`
    : verb
}

/**
 * Cómo se lee una compra pendiente dentro de la hoja de UN proveedor. El motor
 * guarda la descripción de una compra sin factura como «Sin comprobante · Nombre»:
 * en la hoja de ese proveedor el nombre sobra y la palabra del dueño es «sin
 * factura» («Compra sin factura»). Solo se dibuja así: lo que se manda no cambia.
 */
export function pendingItemText(label: string, names: ReadonlyArray<string | null>): string {
  let text = label.trim()
  for (const name of names) {
    const suffix = name ? ` · ${name.trim()}` : ''
    if (suffix && text.endsWith(suffix)) {
      text = text.slice(0, -suffix.length).trim()
      break
    }
  }
  if (/^sin comprobante$/i.test(text)) return 'Compra sin factura'
  return text.replace(/^sin comprobante\b/i, 'Sin factura')
}
