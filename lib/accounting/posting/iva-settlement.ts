/**
 * Liquidación mensual de IVA (`iva_settlement`, E.5.15): el espejo de
 * `acc_compute_iva_position` y de `private.acc_generate_iva_settlement` para la
 * vista previa del cierre de mes y de «Registrar la liquidación del IVA».
 *
 * **Posición del mes M** (art. 24 de la ley de IVA: primero el saldo técnico,
 * después los pagos a cuenta y la libre disponibilidad). `DF`, `CF`, `PERC`,
 * `RET` son los movimientos netos del mes; `ST₀` y `LD₀`, los saldos a favor
 * al cierre del mes anterior.
 * - `saldo técnico = DF − CF − ST₀`.
 *   - Si es `> 0`: `x = saldo técnico − (PERC + RET + LD₀)`. Si `x > 0`, a
 *     pagar `x` y no queda nada a favor; si no, a pagar 0 y `LD₁ = −x`.
 *   - Si es `≤ 0`: `ST₁ = −saldo técnico`, `LD₁ = LD₀ + PERC + RET`, a pagar 0.
 *
 * **Asiento** (una línea neta por cuenta, el lado según el signo), en el orden
 * del art. 24: D `vat_debit` DF · H `vat_credit` CF · `vat_technical_balance`
 * por `ST₁ − ST₀` · H `vat_perceptions` PERC · H `vat_withholdings` RET ·
 * `vat_free_balance` por `LD₁ − LD₀` · H `vat_payable [ARCA]` a pagar (partida
 * que vence el `iva_due_day` del mes siguiente). Balancea en los tres casos
 * (propiedad testeada). Si todo es cero no hay comprobante.
 *
 * E15a (octubre): DF 131.040.000; CF 41.000.000; PERC 600.000; RET 300.000 →
 * a pagar 89.140.000, vence el 20/11.
 */

import {
  type BuildMeta,
  bundleOf,
  DocLineBuilder,
  dayOfNextMonth,
  descriptionFor,
  failed,
  finalize,
  partyForPayable,
  postingError,
  proposedDocument,
  signedCentsIssues,
  sumCents,
} from '@/lib/accounting/posting/common'
import { hashProposalSync } from '@/lib/accounting/preview'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import type {
  Cents,
  PartyKey,
  PostingContext,
  PostingResult,
  WarningKey,
} from '@/lib/accounting/types'
import { endOfMonth, formatMonthYear } from '@/lib/dates'

/** Las cifras del mes que devuelve `acc_compute_iva_position` (con signo: pueden venir negativas). */
export type IvaPositionFigures = {
  /** Débito fiscal del mes (Σ Haber − Σ Debe de `vat_debit`). */
  df: Cents
  /** Crédito fiscal del mes (Σ Debe − Σ Haber de `vat_credit`). */
  cf: Cents
  /** Percepciones de IVA del mes. */
  perc: Cents
  /** Retenciones de IVA del mes. */
  ret: Cents
  /** Saldo técnico a favor al cierre del mes anterior. */
  st0: Cents
  /** Saldo de libre disponibilidad al cierre del mes anterior. */
  ld0: Cents
}

export type IvaPositionResult = {
  /** DF − CF − ST₀. */
  technicalBalance: Cents
  toPay: Cents
  /** Saldo técnico a favor que queda para el mes siguiente. */
  st1: Cents
  /** Libre disponibilidad que queda para el mes siguiente. */
  ld1: Cents
}

/**
 * Posición del mes por el art. 24 (E.5.15). Siempre vale
 * `DF − CF − ST₀ − PERC − RET − LD₀ = toPay − st1 − ld1`.
 */
export function computeIvaPosition(f: IvaPositionFigures): IvaPositionResult {
  const technicalBalance = f.df - f.cf - f.st0
  if (technicalBalance > 0) {
    const x = technicalBalance - (f.perc + f.ret + f.ld0)
    return x > 0
      ? { technicalBalance, toPay: x, st1: 0, ld1: 0 }
      : { technicalBalance, toPay: 0, st1: 0, ld1: -x }
  }
  return { technicalBalance, toPay: 0, st1: -technicalBalance, ld1: f.ld0 + f.perc + f.ret }
}

export type IvaSettlementInput = {
  /** El mes (`'2026-10'` o cualquier día de él): la liquidación va con fecha de fin de mes. */
  month: string
  figures: IvaPositionFigures
  /** El partícipe ARCA; si no viene, el organismo cuya cuenta «le debemos» es «IVA a pagar». */
  arcaPartyId?: string | null
  warningsAck?: readonly WarningKey[]
}

/**
 * Vista previa de la liquidación de IVA del mes (E.5.15: E15a/b/c). Con todo
 * en cero no hay comprobante: devuelve un bundle sin documentos (la RPC
 * tampoco crea nada).
 */
export function buildIvaSettlement(
  input: IvaSettlementInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const { figures } = input
  const fatal = signedCentsIssues([
    ['figures.df', figures.df],
    ['figures.cf', figures.cf],
    ['figures.perc', figures.perc],
    ['figures.ret', figures.ret],
    ['figures.st0', figures.st0],
    ['figures.ld0', figures.ld0],
  ])
  if (fatal.length > 0) return failed(fatal)

  const position = computeIvaPosition(figures)
  const date = endOfMonth(input.month)
  const dueDate = dayOfNextMonth(date, ctx.settings.ivaDueDay)
  const arca = input.arcaPartyId
    ? (ctx.parties.get(input.arcaPartyId) ?? null)
    : partyForPayable(ctx, 'vat_payable', 'tax_agency')
  if (position.toPay > 0 && !arca) return failed([postingError('party_required', 'arcaPartyId')])
  const arcaKey: PartyKey | null = arca ? { id: arca.id } : null

  const lines = new DocLineBuilder()
  const settle = (key: SystemAccountKey, signedDebit: Cents, label: string) =>
    lines.addSigned(
      { role: 'settlement', accountId: ctx.sys[key].id, memo: label },
      signedDebit,
      'debit',
    )
  settle('vat_debit', figures.df, 'Débito fiscal del mes')
  settle('vat_credit', -figures.cf, 'Crédito fiscal del mes')
  settle('vat_technical_balance', position.st1 - figures.st0, 'Saldo técnico a favor')
  settle('vat_perceptions', -figures.perc, 'Percepciones de IVA del mes')
  settle('vat_withholdings', -figures.ret, 'Retenciones de IVA del mes')
  settle('vat_free_balance', position.ld1 - figures.ld0, 'Saldo de libre disponibilidad')
  lines.add({
    role: 'settlement',
    accountId: ctx.sys.vat_payable.id,
    side: 'credit',
    amountCents: position.toPay,
    partyRef: arcaKey,
    dueDate: position.toPay > 0 ? dueDate : null,
    memo: 'IVA a pagar',
  })
  const built = lines.build()

  if (built.lines.length === 0) {
    const empty = bundleOf(meta, [])
    return { ok: true, bundle: empty, warnings: [], preview: [], hash: hashProposalSync(empty) }
  }
  const total = sumCents(built.lines.filter((l) => l.side === 'debit').map((l) => l.amountCents))
  const doc = proposedDocument({
    ref: 'd1',
    kind: 'iva_settlement',
    entryKind: 'iva_settlement',
    party: arcaKey,
    issueDate: date,
    accountingDate: date,
    dueDate: position.toPay > 0 ? dueDate : null,
    description: descriptionFor('iva_settlement', `Liquidación de IVA de ${formatMonthYear(date)}`),
    totalCents: total,
    warningsAck: [...(input.warningsAck ?? [])],
    lines: built.lines,
  })
  return finalize(bundleOf(meta, [doc]), ctx, meta, { rpcOnly: true })
}
