/**
 * Asiento de apertura (`opening`, E.5.16, el asistente de puesta en marcha).
 *
 * Fecha = `books_start_date`. D cajas (la tarjeta de la empresa, su deuda, al
 * Haber) · D créditos a cobrar `[partícipe]` (partidas con vencimiento y
 * referencia) · H deudas con proveedores `[partícipe]` (partidas) · otros
 * saldos del lado elegido · H capital social; la diferencia va a «Saldo de
 * apertura a asignar» (`opening_equity`): al Haber si el activo supera al
 * pasivo más el capital, al Debe si es al revés. No entra a los libros IVA.
 *
 * E14 (01/10/2026): Caja 15.000.000 · Mercado Pago 82.000.000 · Banco Nación
 * 100.000.000 · Posnet crédito 12.000.000 / Proveedores [Coca-Cola] 38.000.000
 * · Capital social 100.000.000 · Saldo de apertura a asignar 71.000.000.
 */

import {
  ackList,
  type BuildMeta,
  bundleOf,
  centsIssues,
  DocLineBuilder,
  descriptionFor,
  failed,
  finalize,
  partyInfo,
  postingError,
  proposedDocument,
  sumCents,
} from '@/lib/accounting/posting/common'
import type { OpeningInput } from '@/lib/accounting/schemas'
import type { PostingContext, PostingError, PostingResult } from '@/lib/accounting/types'

export type OpeningBuildInput = Omit<OpeningInput, 'clientRef' | 'previewHash'>

/** Asiento de apertura (E.5.16, E14). */
export function buildOpening(
  input: OpeningBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const fatal: PostingError[] = centsIssues([
    ...input.treasuries.map((t, i) => [`treasuries.${i}.balanceCents`, t.balanceCents] as const),
    ...input.payables.map((p, i) => [`payables.${i}.amountCents`, p.amountCents] as const),
    ...input.receivables.map((r, i) => [`receivables.${i}.amountCents`, r.amountCents] as const),
    ...input.others.map((o, i) => [`others.${i}.amountCents`, o.amountCents] as const),
    ['shareCapitalCents', input.shareCapitalCents],
  ])
  if (fatal.length > 0) return failed(fatal)
  const date = ctx.settings.booksStartDate
  const lines = new DocLineBuilder()

  for (const [i, t] of input.treasuries.entries()) {
    const treasury = ctx.treasuries.get(t.treasuryAccountId)
    if (!treasury) {
      fatal.push(postingError('treasury_mismatch', `treasuries.${i}.treasuryAccountId`))
      continue
    }
    // La tarjeta de la empresa es un pasivo: su saldo inicial es la deuda, al Haber.
    lines.add({
      role: 'opening',
      accountId: treasury.accountId,
      side: treasury.kind === 'credit_card' ? 'credit' : 'debit',
      amountCents: t.balanceCents,
      memo: treasury.name,
    })
  }
  for (const [i, r] of input.receivables.entries()) {
    const party = partyInfo({ id: r.partyId }, ctx)
    if (!party) {
      fatal.push(postingError('party_not_found', `receivables.${i}.partyId`))
      continue
    }
    lines.add({
      role: 'opening',
      accountId: r.accountId ?? party.receivableAccountId,
      side: 'debit',
      amountCents: r.amountCents,
      partyRef: party.key,
      dueDate: r.dueDate,
      reference: r.reference,
      memo: r.reference ? `Saldo inicial · ${r.reference}` : 'Saldo inicial',
    })
  }
  for (const [i, p] of input.payables.entries()) {
    const party = partyInfo({ id: p.partyId }, ctx)
    if (!party) {
      fatal.push(postingError('party_not_found', `payables.${i}.partyId`))
      continue
    }
    lines.add({
      role: 'opening',
      accountId: p.accountId ?? party.payableAccountId,
      side: 'credit',
      amountCents: p.amountCents,
      partyRef: party.key,
      dueDate: p.dueDate,
      reference: p.reference,
      memo: p.reference ? `Saldo inicial · ${p.reference}` : 'Saldo inicial',
    })
  }
  for (const o of input.others) {
    lines.add({
      role: 'opening',
      accountId: o.accountId,
      side: o.side,
      amountCents: o.amountCents,
      partyRef: o.partyId ? { id: o.partyId } : null,
      dueDate: o.partyId ? o.dueDate : null,
      reference: o.reference,
      memo: o.reference ?? 'Saldo inicial',
    })
  }
  lines.add({
    role: 'opening',
    accountId: ctx.sys.share_capital.id,
    side: 'credit',
    amountCents: input.shareCapitalCents ?? 0,
    memo: 'Capital social',
  })
  if (fatal.length > 0) return failed(fatal)

  // Lo que no cierra entre activo, pasivo y capital: patrimonio inicial a revisar por la contadora.
  const draft = lines.build().lines
  const debit = sumCents(draft.filter((l) => l.side === 'debit').map((l) => l.amountCents))
  const credit = sumCents(draft.filter((l) => l.side === 'credit').map((l) => l.amountCents))
  lines.addSigned(
    { role: 'opening', accountId: ctx.sys.opening_equity.id, memo: 'Saldo de apertura a asignar' },
    debit - credit,
    'credit',
  )
  const built = lines.build()
  const doc = proposedDocument({
    ref: 'd1',
    kind: 'opening',
    entryKind: 'opening',
    issueDate: date,
    accountingDate: date,
    description: descriptionFor('opening', 'Asiento de apertura'),
    totalCents: Math.max(debit, credit),
    warningsAck: ackList(input.warningsAck),
    lines: built.lines,
  })
  return finalize(bundleOf(meta, [doc]), ctx, meta)
}
