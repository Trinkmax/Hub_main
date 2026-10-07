/**
 * Cajas y bancos: movimiento entre cuentas (`transfer`, E.5.10), gasto
 * bancario o impuesto debitado (`bank_expense`, E.5.11) y otro ingreso o
 * egreso de una caja (`cash_movement`, E.5.12).
 *
 * - **Mover plata:** D caja destino / H caja origen, mismo importe, cajas
 *   distintas (`same_treasury`). Pagar el resumen de la tarjeta de la empresa
 *   es mover del banco a la tarjeta. E11 · depósito del efectivo: D Banco
 *   Nación 50.000.000 / H Caja 50.000.000.
 * - **Gasto bancario:** comisión con IVA {net → gastos bancarios}; IVA {vat →
 *   crédito fiscal si el banco tiene CUIT y se marca «Incluir en el libro IVA»;
 *   si no, al gasto}; percepción de IVA; comisiones sin IVA {gross}; Ley 25.413
 *   sobre créditos y sobre débitos, cada una partida en la parte computable en
 *   Ganancias (`percentOf`, 33 % por defecto) y el resto al gasto; SIRCREB;
 *   intereses; otros. Todo contra H la caja. E12.
 * - **Otro ingreso o egreso:** la caja contra una contrapartida (cualquier
 *   imputable que no sea de caja ni de IVA; con partícipe si es de control).
 *   E21 · Máximo retira $ 100.000: D Cuentas particulares de socios [Máximo] /
 *   H Caja.
 */

import { ALIQUOT_COLUMNS, checkVat, percentOf, vatFromNet } from '@/lib/accounting/iva'
import {
  ackList,
  type BuildMeta,
  bundleOf,
  centsIssues,
  counterpartyFor,
  DocLineBuilder,
  descriptionFor,
  failed,
  finalize,
  fiscalAmounts,
  memoFor,
  type PartyInfo,
  partyInfo,
  postingError,
  postingWarning,
  proposedDocument,
  sumCents,
  TAX_KIND_LABELS,
} from '@/lib/accounting/posting/common'
import type {
  BankExpenseInput,
  CASH_MOVEMENT_SHORTCUTS,
  CashMovementInput,
  TransferInput,
} from '@/lib/accounting/schemas'
import type {
  Cents,
  FiscalAmountKey,
  FiscalVoucher,
  PostingContext,
  PostingError,
  PostingResult,
  PostingWarning,
} from '@/lib/accounting/types'
import { afipVoucherCode } from '@/lib/accounting/voucher-types'

export type TransferBuildInput = Omit<TransferInput, 'clientRef' | 'previewHash'>
export type BankExpenseBuildInput = Omit<BankExpenseInput, 'clientRef' | 'previewHash'>
export type CashMovementBuildInput = Omit<CashMovementInput, 'clientRef' | 'previewHash'>

// ─── Mover plata (E.5.10) ────────────────────────────────────────────────────

/** Movimiento entre cuentas (E.5.10, E11): D destino / H origen. */
export function buildTransfer(
  input: TransferBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const fatal = centsIssues([['amountCents', input.amountCents]])
  const from = ctx.treasuries.get(input.fromTreasuryId)
  const to = ctx.treasuries.get(input.toTreasuryId)
  if (!from) fatal.push(postingError('treasury_mismatch', 'fromTreasuryId'))
  if (!to) fatal.push(postingError('treasury_mismatch', 'toTreasuryId'))
  if (input.fromTreasuryId === input.toTreasuryId)
    fatal.push(postingError('same_treasury', 'toTreasuryId'))
  if (fatal.length > 0 || !from || !to) return failed(fatal)

  const lines = new DocLineBuilder()
    .add({
      role: 'treasury',
      accountId: to.accountId,
      side: 'debit',
      amountCents: input.amountCents,
      treasuryAccountId: to.id,
      reference: input.reference,
      memo: `De ${from.name}`,
    })
    .add({
      role: 'treasury',
      accountId: from.accountId,
      side: 'credit',
      amountCents: input.amountCents,
      treasuryAccountId: from.id,
      reference: input.reference,
      memo: `A ${to.name}`,
    })
  const doc = proposedDocument({
    ref: 'd1',
    kind: 'transfer',
    issueDate: input.date,
    accountingDate: input.date,
    description: descriptionFor(
      'transfer',
      'Movimiento entre cuentas',
      `${from.name} → ${to.name}`,
    ),
    notes: input.notes,
    totalCents: input.amountCents,
    warningsAck: ackList(input.warningsAck),
    lines: lines.build().lines,
  })
  return finalize(bundleOf(meta, [doc]), ctx, meta)
}

// ─── Gasto bancario (E.5.11) ─────────────────────────────────────────────────

/** Parte computable en Ganancias y resto de un concepto de la Ley 25.413 (redondeo a la mitad hacia arriba). */
export function splitBankTax(
  amountCents: number,
  computableBp: number,
): {
  computable: number
  expense: number
} {
  // Un porcentaje fuera de 0–100 % en Ajustes no puede dejar un renglón negativo.
  const bp = Math.min(Math.max(Math.trunc(computableBp), 0), 10_000)
  const computable = percentOf(amountCents, bp)
  return { computable, expense: amountCents - computable }
}

/** Gasto bancario o impuesto debitado (E.5.11, E12). */
export function buildBankExpense(
  input: BankExpenseBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const fatal = centsIssues([
    ['feesNetCents', input.feesNetCents],
    ['vatPerceptionCents', input.vatPerceptionCents],
    ['feesNoVatCents', input.feesNoVatCents],
    ['ley25413CreditCents', input.ley25413CreditCents],
    ['ley25413DebitCents', input.ley25413DebitCents],
    ['sircrebCents', input.sircrebCents],
    ['interestCents', input.interestCents],
    ...input.others.map((o, i) => [`others.${i}.amountCents`, o.amountCents] as const),
  ])
  const treasury = ctx.treasuries.get(input.treasuryAccountId)
  if (!treasury) fatal.push(postingError('treasury_mismatch', 'treasuryAccountId'))
  if (fatal.length > 0 || !treasury) return failed(fatal)

  const errors: PostingError[] = []
  const warnings: PostingWarning[] = []
  // El banco como partícipe: hace falta para que el IVA entre al libro (con su CUIT).
  let bank: PartyInfo | null = null
  if (input.includeInIvaBook) {
    bank = treasury.bankPartyId ? partyInfo({ id: treasury.bankPartyId }, ctx) : null
    if (!bank) {
      return failed([
        postingError('party_tax_id_required', 'includeInIvaBook', { party_name: treasury.name }),
      ])
    }
    if (!input.voucher) return failed([postingError('voucher_number_required', 'voucher')])
  }

  const rate = input.vatRateBp
  const computedVat = rate === 0 ? 0 : vatFromNet(input.feesNetCents, rate)
  const vat = rate === 0 ? 0 : computedVat + input.vatAdjustCents
  if (vat < 0)
    return failed([postingError('vat_out_of_tolerance', 'vatAdjustCents', { rate_bp: rate })])
  if (rate !== 0 && input.feesNetCents > 0) {
    const check = checkVat(input.feesNetCents, rate, vat, ctx.settings.vatToleranceCents)
    if (check === 'warn') {
      warnings.push(
        postingWarning('vat_diff', 'd1', {
          rate_bp: rate,
          diff_cents: Math.abs(vat - computedVat),
        }),
      )
    } else if (check === 'error') {
      errors.push(postingError('vat_out_of_tolerance', 'vatAdjustCents', { rate_bp: rate }))
    }
  }
  const inBook = input.includeInIvaBook && bank !== null
  const fees = ctx.sys.bank_fees.id

  const lines = new DocLineBuilder()
  lines.add({
    role: 'net',
    accountId: fees,
    side: 'debit',
    amountCents: input.feesNetCents,
    vatRateBp: rate,
    baseCents: input.feesNetCents,
    memo: memoFor('net', { rateBp: rate }),
  })
  lines.add({
    role: 'vat',
    accountId: inBook ? ctx.sys.vat_credit.id : fees,
    side: 'debit',
    amountCents: input.feesNetCents > 0 ? vat : 0,
    vatRateBp: rate,
    baseCents: input.feesNetCents,
    vatComputedCents: computedVat,
    taxKind: 'iva',
    memo: memoFor('vat', { rateBp: rate }),
  })
  lines.add({
    role: 'perception',
    accountId: ctx.sys.vat_perceptions.id,
    side: 'debit',
    amountCents: input.vatPerceptionCents,
    taxKind: 'iva',
    memo: memoFor('perception', { taxKind: 'iva' }),
  })
  lines.add({
    role: 'gross',
    accountId: fees,
    side: 'debit',
    amountCents: input.feesNoVatCents,
    memo: 'Comisiones sin IVA',
  })
  const leyCredit = splitBankTax(input.ley25413CreditCents, ctx.settings.bankTaxCreditComputableBp)
  const leyDebit = splitBankTax(input.ley25413DebitCents, ctx.settings.bankTaxDebitComputableBp)
  for (const [taxKind, part] of [
    ['ley_25413_credito', leyCredit],
    ['ley_25413_debito', leyDebit],
  ] as const) {
    lines.add({
      role: 'other_tax',
      accountId: ctx.sys.bank_tax_credit.id,
      side: 'debit',
      amountCents: part.computable,
      taxKind,
      memo: `${TAX_KIND_LABELS[taxKind]} (computable en Ganancias)`,
    })
    lines.add({
      role: 'other_tax',
      accountId: ctx.sys.bank_tax_expense.id,
      side: 'debit',
      amountCents: part.expense,
      taxKind,
      memo: TAX_KIND_LABELS[taxKind],
    })
  }
  lines.add({
    role: 'other_tax',
    accountId: ctx.sys.iibb_sircreb.id,
    side: 'debit',
    amountCents: input.sircrebCents,
    taxKind: 'sircreb',
    memo: TAX_KIND_LABELS.sircreb,
  })
  lines.add({
    role: 'other_tax',
    accountId: ctx.sys.interest_expense.id,
    side: 'debit',
    amountCents: input.interestCents,
    taxKind: 'interes',
    memo: TAX_KIND_LABELS.interes,
  })
  for (const o of input.others) {
    lines.add({
      role: 'other_tax',
      accountId: o.accountId,
      side: 'debit',
      amountCents: o.amountCents,
      taxKind: 'otro',
      memo: ctx.accounts.get(o.accountId)?.name ?? TAX_KIND_LABELS.otro,
    })
  }
  const vatPosted = input.feesNetCents > 0 ? vat : 0
  const total = sumCents([
    input.feesNetCents,
    vatPosted,
    input.vatPerceptionCents,
    input.feesNoVatCents,
    input.ley25413CreditCents,
    input.ley25413DebitCents,
    input.sircrebCents,
    input.interestCents,
    ...input.others.map((o) => o.amountCents),
  ])
  lines.add({
    role: 'treasury',
    accountId: treasury.accountId,
    side: 'credit',
    amountCents: total,
    treasuryAccountId: treasury.id,
    memo: treasury.name,
  })

  const fiscalVouchers: FiscalVoucher[] = []
  if (inBook && bank && input.voucher) {
    const amounts: Partial<Record<FiscalAmountKey, Cents>> = {
      perc_iva_cents: input.vatPerceptionCents,
      total_cents: input.feesNetCents + vatPosted + input.vatPerceptionCents,
      vat_computable_cents: vatPosted,
    }
    amounts[ALIQUOT_COLUMNS[rate].net] = input.feesNetCents
    const vatColumn = ALIQUOT_COLUMNS[rate].vat
    if (vatColumn) amounts[vatColumn] = vatPosted
    fiscalVouchers.push({
      book: 'purchases',
      voucherType: input.voucher.voucherType,
      afipVoucherCode: afipVoucherCode(input.voucher.voucherType),
      isCreditNote: false,
      voucherDate: input.date,
      pointOfSale: input.voucher.pointOfSale,
      numberFrom: input.voucher.number,
      numberTo: null,
      channel: null,
      counterparty: counterpartyFor(bank),
      amounts: fiscalAmounts(amounts),
    })
  }

  const doc = proposedDocument({
    ref: 'd1',
    kind: 'bank_expense',
    voucherType: input.voucher?.voucherType ?? null,
    afipVoucherCode: input.voucher ? afipVoucherCode(input.voucher.voucherType) : null,
    party: inBook && bank ? bank.key : null,
    issueDate: input.date,
    accountingDate: input.date,
    pointOfSale: input.voucher?.pointOfSale ?? null,
    number: input.voucher?.number ?? null,
    description: descriptionFor('bank_expense', 'Gasto bancario', treasury.name),
    notes: input.notes,
    totalCents: total,
    warningsAck: ackList(input.warningsAck),
    lines: lines.build().lines,
    fiscalVouchers,
  })
  return finalize(bundleOf(meta, [doc]), ctx, meta, { errors, warnings })
}

// ─── Otro ingreso o egreso (E.5.12) ──────────────────────────────────────────

export type CashMovementShortcut = (typeof CASH_MOVEMENT_SHORTCUTS)[number]

const SHORTCUT_LABELS: Readonly<Record<CashMovementShortcut, string>> = {
  partner_withdrawal: 'Retiro de un socio',
  partner_contribution: 'Aporte de un socio',
  mp_yield: 'Rendimiento de Mercado Pago',
  loan_received: 'Préstamo recibido',
  deposit_received: 'Seña recibida',
  other: 'Otro movimiento',
}

/** Otro ingreso o egreso de una caja (E.5.12, E21): la caja contra una contrapartida, Debe primero. */
export function buildCashMovement(
  input: CashMovementBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const fatal = centsIssues([['amountCents', input.amountCents]])
  const treasury = ctx.treasuries.get(input.treasuryAccountId)
  if (!treasury) fatal.push(postingError('treasury_mismatch', 'treasuryAccountId'))
  const party = input.partyId ? partyInfo({ id: input.partyId }, ctx) : null
  if (input.partyId && !party) fatal.push(postingError('party_not_found', 'partyId'))
  if (fatal.length > 0 || !treasury) return failed(fatal)

  const counterpartAccount = ctx.accounts.get(input.counterpartAccountId)
  const entering = input.direction === 'in'
  const label =
    input.shortcut === 'other'
      ? entering
        ? 'Otro ingreso'
        : 'Otro egreso'
      : SHORTCUT_LABELS[input.shortcut]
  const treasuryLine = {
    role: 'treasury',
    accountId: treasury.accountId,
    side: entering ? 'debit' : 'credit',
    amountCents: input.amountCents,
    treasuryAccountId: treasury.id,
    memo: treasury.name,
  } as const
  const counterpartLine = {
    role: 'counterpart',
    accountId: input.counterpartAccountId,
    side: entering ? 'credit' : 'debit',
    amountCents: input.amountCents,
    partyRef: party?.key ?? null,
    memo: input.detail ?? label,
  } as const
  const lines = new DocLineBuilder()
  // El Debe primero, como en el diario: entra plata → caja y contrapartida; sale → contrapartida y caja.
  if (entering) lines.add(treasuryLine).add(counterpartLine)
  else lines.add(counterpartLine).add(treasuryLine)

  const doc = proposedDocument({
    ref: 'd1',
    kind: 'cash_movement',
    party: party?.key ?? null,
    issueDate: input.date,
    accountingDate: input.date,
    description: descriptionFor(
      'cash_movement',
      label,
      party?.displayName ?? counterpartAccount?.name,
      treasury.name,
    ),
    notes: input.detail,
    totalCents: input.amountCents,
    warningsAck: ackList(input.warningsAck),
    lines: lines.build().lines,
  })
  return finalize(bundleOf(meta, [doc]), ctx, meta)
}
