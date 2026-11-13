/**
 * Un cobro, armado — PURO.
 *
 * De lo que el mozo tocó (el medio, con cuánto paga, la propina, si se factura) sale lo que se le
 * muestra ANTES de cobrar y lo que viaja a la base. Las cuentas son las de `lib/pos/cash/bill.ts`
 * (las mismas que hace la base); acá solo se arman en el orden en que la pantalla las pregunta.
 */
import { cashChange, chargePreview, defaultInvoice, tipFromPct } from '@/lib/pos/cash/bill'
import type { Bill, PayMethod } from '@/lib/pos/cash/types'
import type { Portion } from './split'

/** Efectivo: paga justo, o entrega un monto (un billete de los sugeridos, o lo que se escribió). */
export type Tender = { kind: 'exact' } | { kind: 'given'; cents: number | null }

/** La propina va aparte: un porcentaje de los que usa el bar, o un monto. */
export type Tip =
  | { kind: 'none' }
  | { kind: 'pct'; pct: number }
  | { kind: 'amount'; cents: number | null }

export function tipCentsOf(tip: Tip, amountCents: number): number {
  if (tip.kind === 'pct') return tipFromPct(amountCents, tip.pct)
  if (tip.kind === 'amount') return tip.cents !== null && tip.cents > 0 ? tip.cents : 0
  return 0
}

export type Charge = {
  method: PayMethod
  /** Lo que baja de la cuenta. */
  amountCents: number
  /** Recargo de crédito (lo vuelve a calcular la base; acá es para mostrarlo antes). */
  surchargeCents: number
  tipCents: number
  /** Lo que se le cobra de verdad: monto + recargo + propina. */
  totalCents: number
  invoice: boolean
  /** Solo efectivo: con cuánto paga. `null` = justo. */
  tenderedCents: number | null
  /** Solo efectivo: el vuelto. `null` = lo que entregó no alcanza. */
  changeCents: number | null
  /** Lo que queda por cobrar después de este. */
  afterCents: number
  /** Con este cobro la mesa se cierra. */
  closes: boolean
}

export function composeCharge(input: {
  method: PayMethod
  portion: Pick<Portion, 'amountCents' | 'closes'>
  tip: Tip
  tender: Tender
  /** `null` = lo que el bar tiene puesto para ese medio. */
  invoice: boolean | null
  settings: Pick<Bill['settings'], 'credit_surcharge_bp' | 'invoice_by_method'>
  remainingCents: number
}): Charge {
  const { method, portion, settings } = input
  const amountCents = Math.max(0, portion.amountCents)
  const preview = chargePreview({
    amountCents,
    method,
    surchargeBp: settings.credit_surcharge_bp,
    tipCents: tipCentsOf(input.tip, amountCents),
  })

  let tenderedCents: number | null = null
  let changeCents: number | null = 0
  if (method === 'cash' && input.tender.kind === 'given') {
    const given = input.tender.cents
    if (given === null || given <= 0) {
      changeCents = null
    } else if (given !== preview.totalCents) {
      tenderedCents = given
      changeCents = cashChange(given, amountCents, preview.tipCents)
    }
  }

  return {
    method,
    amountCents,
    surchargeCents: preview.surchargeCents,
    tipCents: preview.tipCents,
    totalCents: preview.totalCents,
    invoice: input.invoice ?? defaultInvoice(method, settings.invoice_by_method),
    tenderedCents,
    changeCents,
    afterCents: Math.max(0, input.remainingCents - amountCents),
    closes: portion.closes,
  }
}

/** ¿Está todo para cobrar? Hay monto y, en efectivo, lo que entregó alcanza. */
export function chargeReady(charge: Charge): boolean {
  return charge.amountCents > 0 && charge.changeCents !== null
}

/** Lo que viaja a `pay()`. La clave se arma una vez por cobro y se repite en cada reintento. */
export type ChargeInput = {
  sessionId: string
  method: PayMethod
  amountCents: number
  idempotencyKey: string
  tenderedCents: number | null
  tipCents: number
  invoice: boolean
  payerLabel: string | null
  itemIds?: string[]
  reference: string | null
  shiftId: string | null
}

export function toChargeInput(
  sessionId: string,
  charge: Charge,
  extra: {
    key: string
    portion: Pick<Portion, 'label' | 'itemIds'>
    reference?: string | null
    shiftId?: string | null
  },
): ChargeInput {
  const reference = extra.reference?.trim().slice(0, 80) || null
  return {
    sessionId,
    method: charge.method,
    amountCents: charge.amountCents,
    idempotencyKey: extra.key,
    tenderedCents: charge.method === 'cash' ? charge.tenderedCents : null,
    tipCents: charge.tipCents,
    invoice: charge.invoice,
    payerLabel: extra.portion.label,
    ...(extra.portion.itemIds.length > 0 ? { itemIds: extra.portion.itemIds } : {}),
    reference,
    shiftId: extra.shiftId ?? null,
  }
}

/**
 * Qué hacer cuando un cobro no entra:
 *   · `retry`   no se sabe si llegó (sin señal) o la base falló sin anotar nada: se reintenta con LA
 *               MISMA clave, que nunca cobra dos veces. Mientras tanto no se cambia nada del cobro.
 *   · `refresh` la cuenta cambió por debajo (otro celular cobró, la mesa se cerró, la caja se cerró):
 *               se vuelve a leer y se muestra por qué.
 *   · `fix`     hay algo mal en lo que se cargó: se corrige en la pantalla.
 *   · `stop`    no se puede seguir desde acá (sesión vencida, sin permiso).
 */
export type PayFailureKind = 'retry' | 'refresh' | 'fix' | 'stop'

const REFRESH_CODES = new Set([
  'amount_exceeds_remaining',
  'nothing_to_pay',
  'session_not_open',
  'session_not_found',
  'no_open_shift',
  'shift_required',
  'shift_not_open',
  'shift_not_found',
  'items_invalid',
  'items_already_paid',
  'bill_not_settled',
  'bill_overpaid',
  'nothing_to_charge',
  'close_needs_approver',
])
const FIX_CODES = new Set([
  'tendered_too_low',
  'amount_invalid',
  'tip_invalid',
  'method_invalid',
  'invalid',
])
const STOP_CODES = new Set(['unauthenticated', 'forbidden', 'disabled'])

export function payFailureKind(code: string | null | undefined): PayFailureKind {
  if (!code) return 'retry'
  if (REFRESH_CODES.has(code)) return 'refresh'
  if (FIX_CODES.has(code)) return 'fix'
  if (STOP_CODES.has(code)) return 'stop'
  return 'retry'
}

/** «10 %», «12,5 %»: un porcentaje guardado en puntos básicos, como se lee. */
export function bpLabel(bp: number): string {
  const whole = Math.trunc(bp / 100)
  const rest = Math.abs(bp % 100)
  const decimals = rest === 0 ? '' : `,${String(rest).padStart(2, '0').replace(/0$/, '')}`
  return `${whole}${decimals} %`
}
