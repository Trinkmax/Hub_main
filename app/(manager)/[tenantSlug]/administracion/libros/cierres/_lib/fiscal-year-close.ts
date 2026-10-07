import 'server-only'

import { buildFiscalYearClose, computeFiscalYearResult } from '@/lib/accounting/posting/year-end'
import {
  type FiscalYearRow,
  getJournal,
  getTrialBalance,
  type JournalEntryRow,
  settleQuery,
} from '@/lib/accounting/queries'
import type { EntryPreview, PostingContext } from '@/lib/accounting/types'
import { addDays } from '@/lib/dates'

/** `clientRef` de relleno: la vista previa no se guarda (la RPC arma sus propios asientos). */
const PREVIEW_CLIENT_REF = '00000000-0000-4000-8000-000000000000'

export type FiscalYearClosePreview =
  | {
      ok: true
      /** Ganancia (positivo) o pérdida (negativo), con los ajustes de cierre. */
      resultCents: number
      /** Cuentas patrimoniales que cancela el cierre (lo que se manda como `expected`). */
      balanceSheetAccounts: number
      /** Refundición, cierre patrimonial y apertura del ejercicio siguiente. */
      preview: EntryPreview[]
      /** Los ajustes de cierre que cargó la contadora (asientos `fy_adjustment`). */
      adjustments: JournalEntryRow[]
    }
  | { ok: false; message: string }

/**
 * Lo que va a hacer «Cerrar el ejercicio» (H.15, C.5.5), con el mismo armador
 * que el motor espeja de la RPC: el resultado del ejercicio (incluidos los
 * ajustes de cierre) y los tres asientos. Los saldos salen de sumas y saldos
 * del ejercicio: resultados desde su inicio, patrimoniales con toda su
 * historia, sin espejos.
 */
export async function fiscalYearClosePreview(
  tenantId: string,
  year: FiscalYearRow,
  ctx: PostingContext,
): Promise<FiscalYearClosePreview> {
  const [trial, journal] = await Promise.all([
    settleQuery(getTrialBalance(tenantId, { from: year.startDate, to: year.endDate })),
    settleQuery(getJournal(tenantId, { from: year.endDate, to: year.endDate, limit: 200 })),
  ])
  if (!trial.ok) return { ok: false, message: trial.message }

  const balances = trial.data.rows
    .filter((r) => r.postable && !r.isVirtual && r.accountId)
    .map((r) => ({
      accountId: r.accountId,
      balanceCents: r.closingDebitCents - r.closingCreditCents,
    }))
    .filter((b) => b.balanceCents !== 0)

  const resultCents = computeFiscalYearResult(balances, ctx)
  const built = buildFiscalYearClose(
    {
      endDate: year.endDate,
      nextStartDate: addDays(year.endDate, 1),
      label: year.endDate.slice(0, 4),
      balances,
    },
    ctx,
    { clientRef: PREVIEW_CLIENT_REF },
  )
  if (!built.ok) {
    return {
      ok: false,
      message:
        'No pudimos armar el cierre del ejercicio con los saldos de hoy. Revisá que el ejercicio anterior esté cerrado; si sigue, avisanos.',
    }
  }
  const closing = built.preview.find((e) => e.kind === 'fy_closing')
  return {
    ok: true,
    resultCents,
    balanceSheetAccounts: closing ? closing.lines.length : 0,
    preview: built.preview,
    adjustments: journal.ok ? journal.data.rows.filter((e) => e.kind === 'fy_adjustment') : [],
  }
}
