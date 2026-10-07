/**
 * Ajustes: arqueo de una caja o un banco (`treasury_adjustment`, E.5.13) y
 * «Anular con fecha de hoy» un comprobante de un mes cerrado (`reversal`,
 * E.5.17).
 *
 * **Arqueo.** «¿Cuánto hay ahora?» contra el saldo de libro que vio la persona
 * (`expected_book_cents`; la RPC repite el chequeo `stale_balance`). La
 * diferencia `contado − libro` mueve la caja (D si sobra, H si falta) y se
 * explica del otro lado: en efectivo, faltante o sobrante de caja; en un banco
 * o billetera, el reparto que eligió la persona o, si no eligió, «Diferencias
 * de cobro a conciliar». **Nunca** se registra una diferencia de banco o
 * billetera como faltante de caja (la validación lo frena con
 * `adjustment_account_invalid`). Contado y libro van en el sentido de la cuenta
 * (Debe − Haber): en la tarjeta de la empresa (pasivo) la deuda es negativa.
 * Con diferencia cero no hay comprobante: eso es `acc_mark_treasury_checked`.
 *
 * E18 · caja el 31/10: libro 45.230.000, contado 45.000.000 → D 5.3.03.05
 * Faltantes de caja 230.000 / H 1.1.01.01 Caja 230.000.
 *
 * **Anulación.** El comprobante `reversal` es el espejo exacto del original:
 * mismos renglones con los lados invertidos (misma cuenta, partícipe,
 * vencimiento y metadatos), con fecha en un mes abierto. La RPC
 * (`acc_reverse_document`) la escribe y la imputa sola contra el original; acá
 * se arma la vista previa con las mismas reglas.
 *
 * E19 · la copia de la Factura A de E1 anulada el 12/11: D Proveedores
 * [Coca-Cola] 86.000.000 / H Compras: bebidas sin alcohol 71.074.380 / H IVA CF
 * 14.925.620.
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
  memoFor,
  postingError,
  proposedDocument,
  signedCentsIssues,
  sumCents,
  truncate,
} from '@/lib/accounting/posting/common'
import type { TreasuryAdjustmentInput } from '@/lib/accounting/schemas'
import type {
  Cents,
  DocLine,
  DocumentKind,
  IsoDate,
  PartyKey,
  PostingContext,
  PostingError,
  PostingResult,
  ProposedDocument,
  Side,
  TaxKind,
  TreasuryRef,
} from '@/lib/accounting/types'

export type TreasuryAdjustmentBuildInput = Omit<
  TreasuryAdjustmentInput,
  'clientRef' | 'previewHash'
>

/** Cómo se explica (una parte de) la diferencia de un arqueo. */
export type AdjustmentSplit = {
  accountId: string
  amountCents: Cents
  taxKind: TaxKind
  /** Solo en cuentas de control (el IVA a documentar de la billetera). */
  partyId: string | null
}

export type TreasuryAdjustmentSpec = {
  ref: string
  treasury: TreasuryRef
  date: IsoDate
  countedCents: Cents
  expectedBookCents: Cents
  /** Vacío = el reparto por defecto (faltante/sobrante en efectivo, diferencias a conciliar en el resto). */
  splits: readonly AdjustmentSplit[]
  notes: string | null
  warningsAck: readonly string[]
}

/** El documento `treasury_adjustment` (sin validar todavía); lo usa también el arqueo de billetera. */
export function composeTreasuryAdjustment(
  spec: TreasuryAdjustmentSpec,
  ctx: PostingContext,
):
  | { ok: true; value: { doc: ProposedDocument; errors: PostingError[] } }
  | {
      ok: false
      errors: PostingError[]
    } {
  const diff = spec.countedCents - spec.expectedBookCents
  if (diff === 0) return { ok: false, errors: [postingError('amount_required', 'countedCents')] }

  const treasurySide: Side = diff > 0 ? 'debit' : 'credit'
  const splitSide: Side = diff > 0 ? 'credit' : 'debit'
  const amount = Math.abs(diff)
  const errors: PostingError[] = []

  let splits: AdjustmentSplit[] = [...spec.splits]
  if (splits.length === 0) {
    const key =
      spec.treasury.kind === 'cash'
        ? diff < 0
          ? 'cash_short'
          : 'cash_over'
        : 'reconciliation_differences'
    splits = [
      { accountId: ctx.sys[key].id, amountCents: amount, taxKind: 'diferencia', partyId: null },
    ]
  }
  const explained = sumCents(splits.map((s) => s.amountCents))
  if (explained !== amount) {
    errors.push(
      postingError('total_mismatch', 'splits', {
        computed_cents: explained,
        control_cents: amount,
      }),
    )
  }

  const lines = new DocLineBuilder()
  lines.add({
    role: 'treasury',
    accountId: spec.treasury.accountId,
    side: treasurySide,
    amountCents: amount,
    treasuryAccountId: spec.treasury.id,
    memo: spec.treasury.name,
  })
  for (const s of splits) {
    const partyRef: PartyKey | null = s.partyId ? { id: s.partyId } : null
    lines.add({
      role: 'adjustment_split',
      accountId: s.accountId,
      side: splitSide,
      amountCents: s.amountCents,
      taxKind: s.taxKind,
      partyRef,
      memo: memoFor('adjustment_split', {
        taxKind: s.taxKind,
        label:
          spec.treasury.kind === 'cash' && s.taxKind === 'diferencia'
            ? diff < 0
              ? 'Faltante de caja'
              : 'Sobrante de caja'
            : null,
      }),
    })
  }

  const doc = proposedDocument({
    ref: spec.ref,
    kind: 'treasury_adjustment',
    issueDate: spec.date,
    accountingDate: spec.date,
    description: descriptionFor(
      'treasury_adjustment',
      'Ajuste de saldo',
      spec.treasury.name,
      diff < 0 ? 'faltante' : 'sobrante',
    ),
    notes: spec.notes,
    totalCents: amount,
    countedCents: spec.countedCents,
    expectedBookCents: spec.expectedBookCents,
    warningsAck: ackList(spec.warningsAck),
    // Como el libro diario: primero el Debe (E18: el faltante y después la caja).
    lines: lines.build({ debitFirst: true }).lines,
  })
  return { ok: true, value: { doc, errors } }
}

/** Arqueo de una caja o un banco con diferencia (E.5.13, E18). */
export function buildTreasuryAdjustment(
  input: TreasuryAdjustmentBuildInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const fatal = [
    ...signedCentsIssues([
      ['countedCents', input.countedCents],
      ['expectedBookCents', input.expectedBookCents],
    ]),
    ...centsIssues(input.splits.map((s, i) => [`splits.${i}.amountCents`, s.amountCents] as const)),
  ]
  const treasury = ctx.treasuries.get(input.treasuryAccountId)
  if (!treasury) fatal.push(postingError('treasury_mismatch', 'treasuryAccountId'))
  // Un banco o una billetera pueden quedar en rojo; la plata contada de una caja, no.
  if (treasury?.kind === 'cash' && input.countedCents < 0) {
    fatal.push(postingError('cash_count_invalid', 'countedCents'))
  }
  if (fatal.length > 0 || !treasury) return failed(fatal)

  const composed = composeTreasuryAdjustment(
    {
      ref: 'd1',
      treasury,
      date: input.date,
      countedCents: input.countedCents,
      expectedBookCents: input.expectedBookCents,
      splits: input.splits.map((s) => ({
        accountId: s.accountId,
        amountCents: s.amountCents,
        taxKind: s.taxKind,
        partyId: s.partyId,
      })),
      notes: input.notes,
      warningsAck: input.warningsAck,
    },
    ctx,
  )
  if (!composed.ok) return failed(composed.errors)
  return finalize(bundleOf(meta, [composed.value.doc]), ctx, meta, {
    errors: composed.value.errors,
  })
}

// ─── Anulación con fecha de hoy (E.5.17) ─────────────────────────────────────

/** Tipos que se pueden anular con fecha de hoy (C.4.3; el resto da `kind_not_reversible`). */
export const REVERSIBLE_KINDS: readonly DocumentKind[] = [
  'purchase',
  'purchase_credit_note',
  'purchase_debit_note',
  'expense',
  'payment',
  'sales_close',
  'sales_invoice',
  'sales_credit_note',
  'sales_debit_note',
  'collection',
  'transfer',
  'bank_expense',
  'cash_movement',
  'treasury_adjustment',
  'manual',
]

/** El comprobante original tal como lo devuelve la lectura del detalle. */
export type ReversalSource = {
  id: string
  kind: DocumentKind
  description: string
  party: PartyKey | null
  accountingDate: IsoDate
  totalCents: Cents
  lines: readonly DocLine[]
}

export type ReversalInput = {
  original: ReversalSource
  /** En un mes abierto y no antes que la fecha contable del original. */
  reversalDate: IsoDate
  reason: string
}

/**
 * Vista previa de «Anular con fecha de hoy» (E.5.17, E19): el espejo exacto de
 * los renglones del original, con los mismos `line_no`. El rol pasa a ser
 * `reversal`, así que la caja, el tipo de impuesto y el canal (columnas que la
 * tabla solo admite en sus roles) quedan en `null`; todo lo demás se copia.
 */
export function buildReversal(
  input: ReversalInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const { original } = input
  const errors: PostingError[] = []
  if (!REVERSIBLE_KINDS.includes(original.kind)) {
    errors.push(postingError('kind_not_reversible', 'documentId'))
  }
  if (input.reversalDate < original.accountingDate) {
    errors.push(postingError('reversal_date_invalid', 'reversalDate'))
  }
  const reason = input.reason.trim()
  if (reason.length < 5 || reason.length > 300)
    errors.push(postingError('reason_required', 'reason'))
  if (errors.length > 0) return failed(errors)

  const lines: DocLine[] = [...original.lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => ({
      ...l,
      role: 'reversal',
      side: l.side === 'debit' ? 'credit' : 'debit',
      treasuryAccountId: null,
      taxKind: null,
      channel: null,
    }))
  const doc = proposedDocument({
    ref: 'd1',
    kind: 'reversal',
    entryKind: 'reversal',
    party: original.party,
    issueDate: input.reversalDate,
    accountingDate: input.reversalDate,
    description: truncate(`Anulación de ${original.description}`, 200),
    notes: reason,
    totalCents: original.totalCents,
    lines,
  })
  return finalize(bundleOf(meta, [doc]), ctx, meta, { rpcOnly: true })
}
