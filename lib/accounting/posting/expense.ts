/**
 * Gasto de contado sin factura (`expense`, E.5.3) — «compré tres Cocas a la vuelta».
 *
 * Un solo comprobante y un solo asiento: D gasto {gross} / H caja {treasury}.
 * Sin comprobante fiscal: «sin comprobante» o un tique sin comercio
 * identificado (no entra al libro IVA; el checklist del cierre lo lista). El
 * partícipe es opcional y solo sirve para estadísticas y defaults: no hay
 * cuenta corriente que mover, así que no va en ningún renglón.
 *
 * E4 · $ 4.500 en efectivo: D 5.1.01.02 Compras: bebidas sin alcohol 450.000 /
 * H 1.1.01.01 Caja 450.000.
 */

import {
  accountingDateFor,
  ackList,
  type BuildMeta,
  bundleOf,
  centsIssues,
  DocLineBuilder,
  descriptionFor,
  failed,
  finalize,
  NEW_PARTY_REF,
  type NewPartyFields,
  newPartyFrom,
  type PartyInfo,
  partyInfo,
  postingError,
  proposedDocument,
  sumCents,
} from '@/lib/accounting/posting/common'
import type {
  Cents,
  IsoDate,
  NewParty,
  PartyKey,
  PostingContext,
  PostingError,
  PostingResult,
  ProposedDocument,
} from '@/lib/accounting/types'
import { VOUCHER_CATALOG } from '@/lib/accounting/voucher-types'

/** Tope de imputaciones de un gasto (matriz C.3.4: `gross` 1..20). */
export const EXPENSE_MAX_LINES = 20

export type ExpenseInput = {
  date: IsoDate
  treasuryAccountId: string
  /** `sin_comprobante`, o `tique` sin comercio identificado. */
  voucherType: 'sin_comprobante' | 'tique'
  /** Proveedor existente (solo estadísticas y defaults). */
  partyId: string | null
  /** Proveedor nuevo en línea (se crea en el mismo envío). */
  newParty: NewPartyFields | null
  /** En qué se gastó: una o más cuentas de imputación con su importe (IVA incluido). */
  lines: ReadonlyArray<{ accountId: string; amountCents: Cents }>
  notes: string | null
  warningsAck: readonly string[]
}

export type ComposedExpense = {
  doc: ProposedDocument
  newParties: NewParty[]
  party: PartyInfo | null
}

/** El documento `expense` (sin validar todavía); lo usa también «Nuevo gasto». */
export function composeExpense(
  input: ExpenseInput,
  ctx: PostingContext,
  meta: BuildMeta,
  ref = 'd1',
): { ok: true; value: ComposedExpense } | { ok: false; errors: PostingError[] } {
  const errors = centsIssues(input.lines.map((l, i) => [`lines.${i}.amountCents`, l.amountCents]))
  if (input.lines.length > EXPENSE_MAX_LINES) {
    errors.push(postingError('invalid_bundle', 'lines', { reason: 'expense_lines' }))
  }
  const treasury = ctx.treasuries.get(input.treasuryAccountId)
  if (!treasury) errors.push(postingError('treasury_mismatch', 'treasuryAccountId'))
  if (errors.length > 0 || !treasury) return { ok: false, errors }

  const newParties: NewParty[] = []
  let partyKey: PartyKey | null = null
  if (input.partyId) partyKey = { id: input.partyId }
  else if (input.newParty) {
    newParties.push(newPartyFrom(input.newParty, input.lines[0]?.accountId ?? null))
    partyKey = { ref: NEW_PARTY_REF }
  }
  const party = partyKey ? partyInfo(partyKey, ctx, newParties) : null
  if (partyKey && !party) return { ok: false, errors: [postingError('party_not_found', 'partyId')] }

  const lines = new DocLineBuilder()
  for (const row of input.lines) {
    const account = ctx.accounts.get(row.accountId)
    lines.add({
      role: 'gross',
      accountId: row.accountId,
      side: 'debit',
      amountCents: row.amountCents,
      memo: account?.name ?? '',
    })
  }
  const total = sumCents(input.lines.map((l) => l.amountCents))
  lines.add({
    role: 'treasury',
    accountId: treasury.accountId,
    side: 'credit',
    amountCents: total,
    treasuryAccountId: treasury.id,
    memo: treasury.name,
  })

  const firstAccount = input.lines[0] ? ctx.accounts.get(input.lines[0].accountId) : undefined
  const doc = proposedDocument({
    ref,
    kind: 'expense',
    voucherType: input.voucherType,
    party: partyKey,
    issueDate: input.date,
    accountingDate: accountingDateFor(input.date, meta),
    description: descriptionFor(
      'expense',
      VOUCHER_CATALOG[input.voucherType].label,
      firstAccount?.name,
      party?.displayName,
    ),
    notes: input.notes,
    totalCents: total,
    warningsAck: ackList(input.warningsAck),
    lines: lines.build().lines,
  })
  return { ok: true, value: { doc, newParties, party } }
}

/** Gasto de contado sin factura (E.5.3, E4). */
export function buildExpense(
  input: ExpenseInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const composed = composeExpense(input, ctx, meta)
  if (!composed.ok) return failed(composed.errors)
  const { doc, newParties } = composed.value
  return finalize(bundleOf(meta, [doc], [], newParties), ctx, meta)
}
