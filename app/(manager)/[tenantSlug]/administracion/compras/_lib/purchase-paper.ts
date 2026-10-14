/**
 * «Cargar una compra que debo», lo puro de la presentación nueva: de las cuatro
 * tarjetas de papel al tipo de comprobante que YA se ofrecía, cuándo hay que
 * preguntar «¿Cómo te factura?», las fechas de «¿Cuándo vence?», el pago en el
 * mismo envío, el sello y la letra chica del ticket y el texto del botón.
 * Lo prueba `tests/lib/administracion-compra-papel.test.ts`.
 *
 * Nada de esto cambia lo que se manda: cada función devuelve un valor que el
 * formulario ya sabía escribir (un `VoucherType` de `voucherOptionsFor`, una
 * fecha para `dueDate`, el mismo objeto `payNow` de «Guardar y pagar…»). La
 * cuenta del asiento sigue en `purchase.ts` y en el motor.
 */

import { exactAmountText } from '@/components/administracion/acciones/gasto-papel'
import { type PaperStamp, voucherStamp } from '@/components/administracion/voucher-stamp'
import { pickTreasury, suggestDueDate } from '@/lib/accounting/defaults'
import { isNotInvoicedVoucher } from '@/lib/accounting/invoiced'
import { invoiceLetterFor } from '@/lib/accounting/posting/quick-expense'
import type { IvaCondition, VoucherType } from '@/lib/accounting/types'
import { VOUCHER_CATALOG, voucherConditionCheck } from '@/lib/accounting/voucher-types'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import type { PurchaseFormState } from './purchase'
import type { QuickVoucher } from './quick-expense'
import type { SheetTreasury } from './sheet-types'
import { notInvoicedDefault, type PurchaseDocKind } from './vouchers'

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

/**
 * «¿Es B o C?»: las dos letras, cuando el proveedor puede dar cualquiera de las
 * dos (un exento). La tarjeta «Factura B o C» escribe una sola (la recordada, o
 * la de la regla), y sin esta pregunta la otra no se podía elegir: el
 * desplegable de antes ofrecía las dos. Vacío = hay una sola letra posible.
 */
export function invoiceLetterChoices(options: readonly VoucherType[]): VoucherType[] {
  const letters = options.filter((type) => type === 'factura_b' || type === 'factura_c')
  return letters.length > 1 ? letters : []
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
  condition: IvaCondition
  hasTaxId: boolean
  /** El papel elegido entra al Libro IVA (`VOUCHER_CATALOG[type].ivaBook`). */
  entersIvaBook: boolean
}): InvoicingGap | null {
  const rejected = (type: VoucherType) =>
    voucherConditionCheck(type, input.condition).status === 'rejected'
  const blocked =
    input.paper === 'a'
      ? rejected('factura_a')
      : input.paper === 'bc'
        ? rejected('factura_b') && rejected('factura_c')
        : false
  if (blocked) {
    return {
      kind: input.condition === 'sin_datos' ? 'unknown' : 'mismatch',
      suggest: input.paper === 'a' ? 'responsable_inscripto' : null,
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
  const paper = input.paper ? PAPER_NAMES[input.paper] : 'ese papel'
  return {
    title: `${input.name} figura como ${noun}`,
    body: `Un ${noun} no da ${paper}. Si te dio una, corregí cómo factura:`,
  }
}

// ─── ¿Cuándo vence? ──────────────────────────────────────────────────────────

export type DueChoice = {
  key: 'term' | 'same' | 'd7' | 'd15' | 'd30' | 'other' | 'none'
  label: string
  /** La fecha que escribe. `null` = sin fecha. `undefined` = abre el campo («Otra fecha»). */
  value: string | null | undefined
  /** Los días que suma a la fecha del papel (para «Pagarle siempre a N días»). */
  days: number | null
  active: boolean
}

const QUICK_DAYS = [7, 15, 30] as const

/**
 * Los chips de «¿Cuándo vence?». Queda marcado el que coincide con el
 * vencimiento que el formulario YA tiene (el de `suggestDueDate`, o el que tocó
 * la persona): el valor por defecto no cambia, solo se ve.
 *
 * `answered: false` (solo con `ASK_WHEN_UNKNOWN`): ninguno marcado.
 */
export function dueChoices(input: {
  issueDate: string | null
  dueDate: string | null
  /** El plazo de la ficha del proveedor (0 = no tiene). */
  termDays: number
  /** El plazo de sus últimas compras, si es siempre el mismo (`defaults.suggestedTermDays`). */
  suggestedTermDays?: number | null
  answered?: boolean
}): DueChoice[] {
  const { issueDate, dueDate } = input
  const answered = input.answered ?? true
  const out: DueChoice[] = []
  const add = (key: DueChoice['key'], label: string, days: number) => {
    if (!issueDate) return
    out.push({ key, label, value: suggestDueDate(issueDate, days), days, active: false })
  }

  const suggested = input.suggestedTermDays ?? 0
  const usual = input.termDays > 0 ? input.termDays : suggested > 0 ? suggested : 0
  if (usual > 0) {
    add(
      'term',
      input.termDays > 0
        ? `A ${usual} días, como siempre`
        : `A ${usual} días, como las últimas veces`,
      usual,
    )
  }
  add('same', 'El mismo día', 0)
  for (const days of QUICK_DAYS) {
    // El plazo de siempre ya tiene su chip: no se repite.
    if (days !== usual) add(`d${days}`, `En ${days} días`, days)
  }

  const match = answered && dueDate !== null ? out.find((c) => c.value === dueDate) : undefined
  if (match) match.active = true
  out.push({
    key: 'other',
    label: 'Otra fecha',
    value: undefined,
    days: null,
    active: answered && dueDate !== null && !match,
  })
  out.push({
    key: 'none',
    label: 'Sin fecha',
    value: null,
    days: null,
    active: answered && dueDate === null,
  })
  return out
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
  today: string
}): NonNullable<PurchaseFormState['payNow']> {
  return {
    treasuryAccountId: pickTreasury({
      treasuries: input.treasuries.filter((t) => t.active),
      lastUsedWithParty: input.lastUsedWithParty,
      order: input.treasuries.map((t) => t.id),
    }),
    amountCents: null,
    date: input.today,
    reference: '',
  }
}

// ─── El ticket ───────────────────────────────────────────────────────────────

/** El sello del papel: el mismo mapa de toda la sección (la Factura M sella «A»). */
export function purchaseStamp(voucherType: string | null | undefined): PaperStamp | null {
  return voucherStamp(voucherType)
}

/** «Papel»: el nombre del comprobante con su número, como va en el ticket. */
export function paperLine(input: {
  voucherType: VoucherType | null
  pos: string
  number: string
  remito: string
}): string | null {
  if (!input.voucherType) return null
  if (isNotInvoicedVoucher(input.voucherType)) {
    const remito = input.remito.trim()
    return remito ? `Remito ${remito}` : 'Remito o nada'
  }
  const label = VOUCHER_CATALOG[input.voucherType].label
  const number = [input.pos, input.number].filter((part) => part !== '').join('-')
  return number && input.pos !== '' && input.number !== '' ? `${label} ${number}` : label
}

/**
 * Lo que falta para poder cargarla, en una oración («Falta decir a quién le
 * compraste y cuánto es.»). `null` = no falta nada de lo que se sabe nombrar.
 * Mientras falte, el ticket queda en borrador: nunca promete un «$ 0».
 */
export function purchaseDraftMissing(missing: {
  party: boolean
  account: boolean
  paper: boolean
  number: boolean
  total: boolean
}): string | null {
  const parts = [
    missing.party ? 'a quién le compraste' : null,
    missing.account ? 'en qué le comprás' : null,
    missing.paper ? 'qué papel te dieron' : null,
    missing.total ? 'cuánto es' : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return missing.number ? 'Falta el número del papel.' : null
  const last = parts.at(-1) ?? ''
  const list = parts.length === 1 ? last : `${parts.slice(0, -1).join(', ')} y ${last}`
  return `Falta decir ${list}.${missing.number ? ' También falta el número del papel.' : ''}`
}

/** El rótulo del total: qué pasa con esa plata. */
export function purchaseTotalLabel(input: { docKind: PurchaseDocKind; paying: boolean }): string {
  if (input.docKind === 'purchase_credit_note') return 'Queda a tu favor'
  return input.paying ? 'Pagás ahora' : 'Le vas a deber'
}

/** Debajo del total de una compra a deber: «Vence el 30/10» / «Sin fecha de pago». */
export function dueLine(dueDate: string | null): string {
  return dueDate ? `Vence el ${formatDayMonth(dueDate)}` : 'Sin fecha de pago'
}

/**
 * La letra chica del ticket: qué queda después de cargarla, siempre cierto.
 * Una compra sin factura se debe igual y queda en los números: lo único que
 * cambia es que no entra al Libro IVA.
 */
export function purchaseOutcomeNote(input: {
  docKind: PurchaseDocKind
  /** Como se lo nombra: el de fantasía, si tiene. */
  supplier: string
  voucherType: VoucherType | null
  totalCents: number
  /** Lo que se paga ahora (`null` = queda todo a deber). */
  paidCents: number | null
  /** Lo que ya se le debía, si se pudo leer. */
  priorDebtCents: number | null
}): string {
  const { supplier, totalCents } = input
  if (input.docKind === 'purchase_credit_note') {
    return `Queda a tu favor con ${supplier}: se descuenta en el próximo pago.`
  }
  const book = isNotInvoicedVoucher(input.voucherType)
    ? 'Sin factura: queda en tus números y no entra al Libro IVA.'
    : input.voucherType && VOUCHER_CATALOG[input.voucherType].ivaBook
      ? 'Entra al Libro IVA.'
      : 'No entra al Libro IVA.'
  if (input.paidCents !== null) {
    const rest = totalCents - input.paidCents
    return rest > 0
      ? `Pagás ${formatCentsShort(input.paidCents)} ahora y le quedás debiendo ${formatCentsShort(rest)}. ${book}`
      : `Queda pagado: con ${supplier} no queda deuda. ${book}`
  }
  const prior = input.priorDebtCents ?? 0
  const sum =
    prior > 0 ? ` Con esto le vas a deber ${formatCentsShort(prior + totalCents)} en total.` : ''
  return `Queda anotado en la libreta de ${supplier}. ${book}${sum}`
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
          ? 'Cargar y pagar'
          : 'Cargar compra'
  return input.totalCents !== null && input.totalCents > 0
    ? `${verb} · ${exactAmountText(input.totalCents)}`
    : verb
}

// ─── Las cuatro secciones ────────────────────────────────────────────────────

export type PurchaseStepState = 'done' | 'current' | 'todo'

/**
 * El círculo de cada sección: tilde si ya está, número relleno en la primera
 * que falta y gris en las de después. Todas están siempre abiertas.
 */
export function purchaseStepStates(done: readonly boolean[]): PurchaseStepState[] {
  const first = done.indexOf(false)
  return done.map((ok, index) => (ok ? 'done' : index === first ? 'current' : 'todo'))
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
