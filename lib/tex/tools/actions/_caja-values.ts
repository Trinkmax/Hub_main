import type { BankAmountField } from '@/app/(manager)/[tenantSlug]/administracion/cajas/gasto-bancario/_lib/bank-rows'
import {
  type CountMode,
  type CountPlan,
  type CountReason,
  type ReasonOption,
  reasonOptions,
} from '@/components/administracion/acciones/ajustar-vista'
import type {
  MoveDirection,
  MoveMotive,
} from '@/components/administracion/acciones/movimiento-vista'
import { vatFromNet } from '@/lib/accounting/iva'
import type {
  BankExpenseValues,
  CashMovementValues,
  TreasuryAdjustmentValues,
  WalletCheckValues,
} from '@/lib/accounting/server/document-types'
import { VAT_ACCOUNT_KEYS } from '@/lib/accounting/system-keys'
import type { AccountRef, VatRateBp } from '@/lib/accounting/types'
import type { TexTicketWarning } from '../../protocol'
import { money, type TexToolResult } from '../types'

/**
 * Lo que Tex manda en Caja, puro: del pedido en palabras a los `values` de cada formulario. Acá no se
 * decide nada que no decida la hoja: cada función copia el criterio de `movimiento-sheet.tsx`,
 * `bank-expense-form.tsx` y `ajustar-sheet.tsx`, y lo prueba `tex-actions-cajas.test.ts` contra el zod
 * del formulario y el motor.
 */

type FormValues<T> = Omit<T, 'clientRef' | 'previewHash' | 'warningsAck'>

/** Le suma avisos al tique que armó el motor. Son solo para leer: no cambian lo que se guarda. */
export function withTicketWarnings(
  result: TexToolResult,
  extra: readonly TexTicketWarning[],
): TexToolResult {
  if (result.kind !== 'prepared' || extra.length === 0) return result
  const { ticket } = result.prepared
  return {
    kind: 'prepared',
    prepared: {
      ...result.prepared,
      ticket: { ...ticket, warnings: [...ticket.warnings, ...extra] },
    },
  }
}

// ─── «Otra entrada o salida» ─────────────────────────────────────────────────

/** Las situaciones de la hoja, con las palabras que usa Tex. */
export const MOVEMENT_KINDS = [
  'socio_saco',
  'socio_puso',
  'sena',
  'rindio',
  'prestamo',
  'otra_salida',
  'otra_entrada',
] as const
export type MovementKind = (typeof MOVEMENT_KINDS)[number]

/** Cada situación escribe el par `direction` + `shortcut` de `situationGroups`: no hay combinaciones nuevas. */
export const MOVEMENT_PAIRS: Readonly<
  Record<MovementKind, { direction: MoveDirection; motive: MoveMotive }>
> = {
  socio_saco: { direction: 'out', motive: 'partner_withdrawal' },
  socio_puso: { direction: 'in', motive: 'partner_contribution' },
  sena: { direction: 'in', motive: 'deposit_received' },
  rindio: { direction: 'in', motive: 'mp_yield' },
  prestamo: { direction: 'in', motive: 'loan_received' },
  otra_salida: { direction: 'out', motive: 'other' },
  otra_entrada: { direction: 'in', motive: 'other' },
}

const VAT_KEYS: ReadonlySet<string> = new Set(VAT_ACCOUNT_KEYS)
const PARTNER_KEYS: ReadonlySet<string> = new Set(['partners_current', 'partner_loans'])

/** La contrapartida de la hoja (C.3.4): imputable y activa, que no sea de caja ni de IVA. */
export function isCounterpartAccount(
  account: Pick<AccountRef, 'postable' | 'active' | 'isTreasury' | 'systemKey'>,
): boolean {
  return (
    account.postable &&
    account.active &&
    !account.isTreasury &&
    !(account.systemKey !== null && VAT_KEYS.has(account.systemKey))
  )
}

/** Las cuentas de socios: el partícipe tiene que ser un socio. */
export function isPartnerAccount(account: Pick<AccountRef, 'systemKey'>): boolean {
  return account.systemKey !== null && PARTNER_KEYS.has(account.systemKey)
}

export type CashMovementFormValues = FormValues<CashMovementValues>

/** Lo mismo que arma la hoja: el partícipe solo viaja si la cuenta lo pide. */
export function movementValues(input: {
  kind: MovementKind
  treasuryId: string
  account: Pick<AccountRef, 'id' | 'requiresParty'>
  partyId: string | null
  cents: number
  date: string
  note?: string | null
}): CashMovementFormValues {
  const { direction, motive } = MOVEMENT_PAIRS[input.kind]
  const detail = input.note?.trim() ?? ''
  return {
    treasuryAccountId: input.treasuryId,
    direction,
    counterpartAccountId: input.account.id,
    partyId: input.account.requiresParty ? input.partyId : null,
    amountCents: input.cents,
    date: input.date,
    shortcut: motive,
    detail: detail === '' ? null : detail,
  }
}

// ─── Gastos del banco ────────────────────────────────────────────────────────

export type BankExpenseFormValues = FormValues<BankExpenseValues>
export type BankAmounts = Partial<Record<BankAmountField, number>>
export type BankVoucher = {
  voucherType: 'resumen_bancario' | 'factura_a' | 'otro_comprobante'
  pointOfSale: number
  number: number
}

/** Con el comprobante del banco, el IVA va al 21 %: es lo que concilia la base. */
export function bankRate(voucher: BankVoucher | null, asked: VatRateBp): VatRateBp {
  return voucher ? 2100 : asked
}

/** Los mismos ocho importes de la pantalla; lo que no se dijo, en cero. */
export function bankExpenseValues(input: {
  treasuryId: string
  date: string
  amounts: BankAmounts
  vatRateBp: VatRateBp
  voucher: BankVoucher | null
  others: ReadonlyArray<{ accountId: string; amountCents: number }>
  note?: string | null
}): BankExpenseFormValues {
  const { amounts } = input
  const notes = input.note?.trim() ?? ''
  return {
    treasuryAccountId: input.treasuryId,
    date: input.date,
    includeInIvaBook: input.voucher !== null,
    voucher: input.voucher,
    feesNetCents: amounts.feesNetCents ?? 0,
    vatRateBp: bankRate(input.voucher, input.vatRateBp),
    vatAdjustCents: 0,
    vatPerceptionCents: amounts.vatPerceptionCents ?? 0,
    feesNoVatCents: amounts.feesNoVatCents ?? 0,
    ley25413CreditCents: amounts.ley25413CreditCents ?? 0,
    ley25413DebitCents: amounts.ley25413DebitCents ?? 0,
    sircrebCents: amounts.sircrebCents ?? 0,
    interestCents: amounts.interestCents ?? 0,
    others: input.others.map((o) => ({ accountId: o.accountId, amountCents: o.amountCents })),
    notes: notes === '' ? null : notes,
  }
}

/** El IVA de las comisiones, como lo calcula la pantalla y el motor. */
export function bankVatCents(feesNetCents: number, rate: VatRateBp): number {
  return feesNetCents > 0 && rate !== 0 ? vatFromNet(feesNetCents, rate) : 0
}

/** «Total debitado»: lo mismo que suma la pantalla para compararlo con el resumen. */
export function bankExpenseTotalCents(input: {
  amounts: BankAmounts
  vatRateBp: VatRateBp
  others: ReadonlyArray<{ amountCents: number }>
}): number {
  const { amounts } = input
  return (
    (amounts.feesNetCents ?? 0) +
    bankVatCents(amounts.feesNetCents ?? 0, input.vatRateBp) +
    (amounts.vatPerceptionCents ?? 0) +
    (amounts.feesNoVatCents ?? 0) +
    (amounts.ley25413CreditCents ?? 0) +
    (amounts.ley25413DebitCents ?? 0) +
    (amounts.sircrebCents ?? 0) +
    (amounts.interestCents ?? 0) +
    input.others.reduce((sum, o) => sum + o.amountCents, 0)
  )
}

// ─── Contar la caja ──────────────────────────────────────────────────────────

/** Lo contado en el sentido de la cuenta: en la tarjeta de la empresa, la deuda va en negativo. */
export function countedBookCents(mode: CountMode, countedCents: number): number {
  return mode === 'card' ? -countedCents : countedCents
}

export type CountDecision = {
  diff: number
  plan: CountPlan
  options: ReasonOption[]
  /** `null`: hay que preguntar por qué hay diferencia. */
  reason: CountReason | null
}

/** El mismo plan de la hoja: qué se guarda según la caja, la diferencia y las ventas tildadas. */
export function countDecision(input: {
  mode: CountMode
  bookCents: number
  countedBook: number
  ticked: number
  reason: CountReason | null
}): CountDecision {
  const diff = input.countedBook - input.bookCents
  const options = reasonOptions(input.mode, diff)
  const reason =
    input.reason && options.some((o) => o.value === input.reason)
      ? input.reason
      : options.length === 0
        ? 'other'
        : null
  const plan: CountPlan =
    diff === 0 && (input.mode !== 'wallet' || input.ticked === 0)
      ? 'check'
      : input.mode === 'wallet'
        ? 'wallet'
        : reason === 'bank_fees'
          ? 'bank_fees'
          : 'adjust'
  return { diff, plan, options, reason }
}

export type TreasuryAdjustmentFormValues = FormValues<TreasuryAdjustmentValues>

/** Con «Son intereses», la diferencia va a rendimientos; si no, el reparto por defecto del motor. */
export function treasuryAdjustmentValues(input: {
  treasuryId: string
  date: string
  countedBook: number
  bookCents: number
  reason: CountReason | null
  interestAccountId: string
}): TreasuryAdjustmentFormValues {
  const diff = input.countedBook - input.bookCents
  return {
    treasuryAccountId: input.treasuryId,
    date: input.date,
    countedCents: input.countedBook,
    expectedBookCents: input.bookCents,
    splits:
      input.reason === 'interest' && diff > 0
        ? [
            {
              accountId: input.interestAccountId,
              amountCents: diff,
              taxKind: 'rendimiento',
              partyId: null,
            },
          ]
        : [],
    notes: null,
  }
}

export type WalletBreakdownKey = 'comision' | 'iva_comision' | 'sircupa' | 'otro'
export type WalletBreakdown = Readonly<Record<WalletBreakdownKey, number | null>>

export const WALLET_BREAKDOWN_ROWS: ReadonlyArray<{ key: WalletBreakdownKey; label: string }> = [
  { key: 'comision', label: 'Comisión' },
  { key: 'iva_comision', label: 'IVA de la comisión' },
  { key: 'sircupa', label: 'Ingresos Brutos' },
  { key: 'otro', label: 'Otros cargos' },
]

/** Lo que dijo la persona o, mientras no diga nada, lo estimado por las tasas (como la hoja). */
export function walletBreakdown(
  estimates: {
    commissionCents: number
    commissionVatCents: number
    sircupaCents: number
  } | null,
  said: Partial<Record<WalletBreakdownKey, number>> | null,
): WalletBreakdown {
  if (said) {
    return {
      comision: said.comision ?? null,
      iva_comision: said.iva_comision ?? null,
      sircupa: said.sircupa ?? null,
      otro: said.otro ?? null,
    }
  }
  return {
    comision: estimates && estimates.commissionCents > 0 ? estimates.commissionCents : null,
    iva_comision:
      estimates && estimates.commissionVatCents > 0 ? estimates.commissionVatCents : null,
    sircupa: estimates && estimates.sircupaCents > 0 ? estimates.sircupaCents : null,
    otro: null,
  }
}

export function breakdownTotal(breakdown: WalletBreakdown): number {
  return WALLET_BREAKDOWN_ROWS.reduce((sum, row) => sum + (breakdown[row.key] ?? 0), 0)
}

export type WalletCheckFormValues = FormValues<WalletCheckValues>

/** «Ajustar saldo de Mercado Pago»: las ventas que entraron y lo que se quedó la billetera. */
export function walletCheckValues(input: {
  treasuryId: string
  date: string
  countedBook: number
  bookCents: number
  items: ReadonlyArray<{ lineId: string; openCents: number }>
  breakdown: WalletBreakdown
  certificate?: string | null
  otherFeesAccountId: string
}): WalletCheckFormValues {
  const diff = input.countedBook - input.bookCents
  // Sin partidas y con plata de más, todo es rendimiento: no lleva desglose.
  const withBreakdown = input.items.length > 0 || diff < 0
  const certificate = input.certificate?.trim() ?? ''
  return {
    treasuryAccountId: input.treasuryId,
    partyId: null,
    date: input.date,
    countedCents: input.countedBook,
    expectedBookCents: input.bookCents,
    items: input.items.map((item) => ({ lineId: item.lineId, amountCents: item.openCents })),
    breakdown: withBreakdown
      ? WALLET_BREAKDOWN_ROWS.flatMap((row) => {
          const amount = input.breakdown[row.key]
          if (amount === null || amount <= 0) return []
          return [
            {
              taxKind: row.key,
              amountCents: amount,
              accountId: row.key === 'otro' ? input.otherFeesAccountId : null,
              certificateNumber: row.key === 'sircupa' && certificate !== '' ? certificate : null,
              salesMethodId: null,
            },
          ]
        })
      : [],
  }
}

/** «Debés $ 100» · «Sin deuda» · «Descubierto $ 100» · «$ 100»: lo que dice el sistema, en palabras. */
export function systemBalanceText(mode: CountMode, bookCents: number): string {
  const amount = money(Math.abs(bookCents))
  if (mode === 'card') {
    if (bookCents === 0) return 'Sin deuda'
    return bookCents < 0 ? `Debés ${amount}` : `A favor ${amount}`
  }
  return bookCents < 0 ? `Descubierto ${amount}` : amount
}
