/**
 * Cierre de ejercicio (E.5.18): la vista previa de lo que genera
 * `acc_close_fiscal_year` (C.5.5) con los saldos que vio la persona.
 *
 * 1. **Refundición** (`fy_result`, fecha = fin del ejercicio): una línea por
 *    cuenta de resultado con saldo, del lado que la deja en cero; la diferencia
 *    a «Resultado del ejercicio» (`current_year_result`): al Haber si es
 *    ganancia, al Debe si es pérdida. Mueve saldos.
 * 2. **Cierre patrimonial** (`fy_closing`, espejo, misma fecha): cancela cada
 *    cuenta patrimonial por su saldo a esa fecha (incluida la refundición), sin
 *    partícipe.
 * 3. **Apertura** (`fy_opening`, espejo, primer día del ejercicio siguiente): la
 *    inversa del cierre.
 *
 * Los ajustes de la contadora (amortizaciones, existencias) son asientos
 * manuales `fy_adjustment` (E.5.14) que ya vienen sumados en los saldos. Las
 * cuentas van en el orden del plan (por código). Los espejos no tocan saldos:
 * todo reporte los excluye (C.5.5).
 *
 * E20 · ejercicio 2026: Ventas salón facturadas 105.665.245 (A), Compras
 * bebidas 71.074.380 (D) y Amortizaciones 2.500.000 (D) → D 4.1.01.01.001
 * 105.665.245 / H 4.2.01.03.002 2.500.000 / H 5.1.01.01.002 71.074.380 /
 * H 3.3.03.04.000 Resultado del ejercicio 32.090.865.
 */

import {
  type BuildMeta,
  bundleOf,
  DocLineBuilder,
  descriptionFor,
  failed,
  finalize,
  postingError,
  proposedDocument,
  signedCentsIssues,
  sumCents,
} from '@/lib/accounting/posting/common'
import type {
  AccountRef,
  Cents,
  IsoDate,
  PostingContext,
  PostingError,
  PostingResult,
  ProposedDocument,
} from '@/lib/accounting/types'
import { addDays } from '@/lib/dates'

export type AccountBalance = {
  accountId: string
  /**
   * Saldo con signo (Σ Debe − Σ Haber): en las cuentas de resultado, el del
   * ejercicio con los ajustes de cierre; en las patrimoniales, el histórico a
   * la fecha de cierre (sin espejos).
   */
  balanceCents: Cents
}

export type FiscalYearCloseInput = {
  /** Último día del ejercicio (fecha de la refundición y del cierre). */
  endDate: IsoDate
  /** Primer día del ejercicio siguiente (fecha de la apertura); por defecto, el día siguiente. */
  nextStartDate?: IsoDate | null
  /** Rótulo del ejercicio para las descripciones («2026»). */
  label?: string | null
  balances: readonly AccountBalance[]
}

/** Compara códigos de cuenta por segmento numérico: `1.1.9` va antes que `1.1.10`. */
export function compareAccountCodes(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number(x)
    const ny = Number(y)
    if (Number.isFinite(nx) && Number.isFinite(ny) && nx !== ny) return nx - ny
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

const isResult = (a: AccountRef) => a.type === 'income' || a.type === 'expense'

/**
 * Resultado del ejercicio a partir de los saldos: ingresos − egresos (positivo
 * = ganancia). Es lo que la RPC compara con `p_expected.result_cents`.
 */
export function computeFiscalYearResult(
  balances: readonly AccountBalance[],
  ctx: Pick<PostingContext, 'accounts'>,
): Cents {
  return -sumCents(
    balances
      .filter((b) => {
        const account = ctx.accounts.get(b.accountId)
        return account ? isResult(account) : false
      })
      .map((b) => b.balanceCents),
  )
}

/** Refundición, cierre patrimonial y apertura del ejercicio siguiente (E.5.18, E20). */
export function buildFiscalYearClose(
  input: FiscalYearCloseInput,
  ctx: PostingContext,
  meta: BuildMeta,
): PostingResult {
  const fatal: PostingError[] = signedCentsIssues(
    input.balances.map((b, i) => [`balances.${i}.balanceCents`, b.balanceCents] as const),
  )
  // Una cuenta puede venir más de una vez (por partícipe, por ejemplo): se suma.
  const byAccount = new Map<string, { account: AccountRef; balance: Cents }>()
  input.balances.forEach((b, i) => {
    const account = ctx.accounts.get(b.accountId)
    if (!account) {
      fatal.push(postingError('account_not_found', `balances.${i}.accountId`))
      return
    }
    const prev = byAccount.get(account.id)
    byAccount.set(account.id, { account, balance: (prev?.balance ?? 0) + b.balanceCents })
  })
  if (fatal.length > 0) return failed(fatal)

  const ordered = [...byAccount.values()].sort((a, b) =>
    compareAccountCodes(a.account.code, b.account.code),
  )
  const resultAccounts = ordered.filter((x) => isResult(x.account) && x.balance !== 0)
  const result = -sumCents(resultAccounts.map((x) => x.balance))
  const label = input.label?.trim() || input.endDate.slice(0, 4)
  const nextStart = input.nextStartDate ?? addDays(input.endDate, 1)
  const resultAccountId = ctx.sys.current_year_result.id

  // 1. Refundición: cada resultado contra «Resultado del ejercicio».
  const refund = new DocLineBuilder()
  for (const x of resultAccounts) {
    refund.addSigned(
      { role: 'fy_result', accountId: x.account.id, memo: x.account.name },
      -x.balance,
      'debit',
    )
  }
  refund.addSigned(
    { role: 'fy_result', accountId: resultAccountId, memo: 'Resultado del ejercicio' },
    result,
    'credit',
  )

  // 2. y 3. Saldos patrimoniales después de la refundición.
  const patrimonial = new Map<string, { account: AccountRef; balance: Cents }>()
  for (const x of ordered) if (!isResult(x.account)) patrimonial.set(x.account.id, { ...x })
  const resultAccount = ctx.sys.current_year_result
  const prevResult = patrimonial.get(resultAccountId)
  patrimonial.set(resultAccountId, {
    account: resultAccount,
    balance: (prevResult?.balance ?? 0) - result,
  })
  const closingSet = [...patrimonial.values()]
    .filter((x) => x.balance !== 0)
    .sort((a, b) => compareAccountCodes(a.account.code, b.account.code))
  const closing = new DocLineBuilder()
  const opening = new DocLineBuilder()
  for (const x of closingSet) {
    closing.addSigned(
      { role: 'mirror', accountId: x.account.id, memo: x.account.name },
      -x.balance,
      'debit',
    )
    opening.addSigned(
      { role: 'mirror', accountId: x.account.id, memo: x.account.name },
      x.balance,
      'debit',
    )
  }

  const documents: ProposedDocument[] = []
  const push = (
    ref: string,
    kind: 'fy_result' | 'fy_closing' | 'fy_opening',
    date: IsoDate,
    description: string,
    builder: DocLineBuilder,
  ) => {
    const lines = builder.build().lines
    if (lines.length === 0) return
    documents.push(
      proposedDocument({
        ref,
        kind,
        entryKind: kind,
        issueDate: date,
        accountingDate: date,
        description: descriptionFor(kind, description),
        totalCents: sumCents(lines.filter((l) => l.side === 'debit').map((l) => l.amountCents)),
        lines,
      }),
    )
  }
  push('d1', 'fy_result', input.endDate, `Refundición de resultados del ejercicio ${label}`, refund)
  push('d2', 'fy_closing', input.endDate, `Cierre patrimonial del ejercicio ${label}`, closing)
  push('d3', 'fy_opening', nextStart, `Apertura del ejercicio siguiente a ${label}`, opening)
  if (documents.length === 0) return failed([postingError('amount_required', 'balances')])
  return finalize(bundleOf(meta, documents), ctx, meta, { rpcOnly: true })
}
