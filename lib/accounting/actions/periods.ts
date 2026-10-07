'use server'

/**
 * Cierres de mes y de ejercicio, y la liquidación de IVA (C.5, H.15).
 *
 * Cerrar es irreversible desde la pantalla de carga (se confirma antes); se
 * deshace reabriendo el ÚLTIMO mes cerrado, con motivo. La base hace todo bajo
 * el lock del bar: orden de los meses, avisos (`close_warnings`), la
 * liquidación de IVA comparada con lo que vio la persona (`preview_stale`), la
 * numeración definitiva y la foto del período.
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import {
  type AccFailureState,
  type AccSimpleState,
  invalidState,
} from '@/lib/accounting/action-state'
import {
  closeFiscalYearSchema,
  closePeriodSchema,
  generateIvaSettlementSchema,
  reopenFiscalYearSchema,
  reopenSchema,
} from '@/lib/accounting/schemas'
import { formatCents } from '@/lib/money'
import { createClient } from '@/lib/supabase/server'
import {
  type CloseWarningItem as CloseWarningItemData,
  closeWarningsFromDetails,
  ivaExpectedJson,
  monthLabel,
} from './payloads'
import {
  asRecord,
  dayOf,
  formInput,
  intOf,
  type Rec,
  revalidateAccounting,
  rpcFailure,
  textOf,
  unexpectedFailure,
} from './support'

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type CloseWarningItem = CloseWarningItemData

export type ClosePeriodResult = {
  /** Primer día del mes cerrado (`'2026-10-01'`). */
  month: string
  numberFrom: number | null
  numberTo: number | null
  entriesCount: number | null
  ivaSettlementDocumentId: string | null
  ivaToPayCents: number | null
  ivaInFavorCents: number | null
}

/**
 * Lo que devuelve `closePeriod`. Con avisos sin aceptar: `code:
 * 'needs_confirmation'` y `closeWarnings` (todos juntos); el formulario los
 * muestra, la persona los acepta y se reenvía con `warningsAck`.
 */
export type ClosePeriodState =
  | { ok: true; data: ClosePeriodResult; message: string }
  | (AccFailureState & { closeWarnings?: CloseWarningItem[] })

export type ReopenPeriodResult = { month: string }

export type IvaSettlementResult = {
  month: string
  /** `null` si la posición del mes dio todo en cero (no se crea nada). */
  documentId: string | null
}

export type CloseFiscalYearResult = {
  /** Ganancia (positivo) o pérdida (negativo) del ejercicio, en centavos. */
  resultCents: number | null
  fyResultNumber: number | null
  fyClosingNumber: number | null
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function closeResult(r: Rec, month: string): ClosePeriodResult {
  return {
    month: dayOf(r.month) ?? month,
    numberFrom: intOf(r.number_from),
    numberTo: intOf(r.number_to),
    entriesCount: intOf(r.entries_count),
    ivaSettlementDocumentId: textOf(r.iva_settlement_document_id),
    ivaToPayCents: intOf(r.iva_to_pay_cents),
    ivaInFavorCents: intOf(r.iva_in_favor_cents),
  }
}

// ─── Meses ───────────────────────────────────────────────────────────────────

/** «Cerrar octubre» (C.5.1): con los avisos aceptados y la liquidación de IVA vista. */
export async function closePeriod(slug: string, raw: unknown): Promise<ClosePeriodState> {
  const op = 'periods.close'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = closePeriodSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const v = parsed.data

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_close_period', {
      p_tenant_id: auth.tenantId,
      p_month: v.month,
      p_options: {
        warnings_ack: v.warningsAck,
        iva_settlement: {
          generate: v.ivaSettlement.generate,
          expected: v.ivaSettlement.expected ? ivaExpectedJson(v.ivaSettlement.expected) : null,
        },
      },
    })
    if (error) {
      const state = rpcFailure(op, error)
      if (state.detail?.key === 'close_warnings') {
        const closeWarnings = closeWarningsFromDetails(error.details)
        return closeWarnings.length > 0 ? { ...state, closeWarnings } : state
      }
      return state
    }

    const result = closeResult(asRecord(data) ?? {}, v.month)
    revalidateAccounting(slug)
    const toPay = result.ivaToPayCents ?? 0
    return {
      ok: true,
      data: result,
      message:
        toPay > 0
          ? `${monthLabel(v.month)} cerrado. IVA a pagar: ${formatCents(toPay)}.`
          : `${monthLabel(v.month)} cerrado.`,
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/** Reabre el último mes cerrado (C.5.2), con motivo: lo ve la contadora. */
export async function reopenPeriod(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ReopenPeriodResult>> {
  const op = 'periods.reopen'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = reopenSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_reopen_period', {
      p_tenant_id: auth.tenantId,
      p_month: parsed.data.month,
      p_reason: parsed.data.reason,
    })
    if (error) return rpcFailure(op, error)

    revalidateAccounting(slug)
    return {
      ok: true,
      data: { month: parsed.data.month },
      message: `${monthLabel(parsed.data.month)} reabierto.`,
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/**
 * «Registrar la liquidación del IVA» (C.5.4), para el modo manual o si se
 * apagó al cerrar: compara con las cifras que vio la persona.
 */
export async function generateIvaSettlement(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<IvaSettlementResult>> {
  const op = 'periods.ivaSettlement'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = generateIvaSettlementSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_generate_iva_settlement', {
      p_tenant_id: auth.tenantId,
      p_month: parsed.data.month,
      p_expected: ivaExpectedJson(parsed.data.expected),
    })
    if (error) return rpcFailure(op, error)

    const r = asRecord(data)
    const documentId =
      typeof data === 'string'
        ? data
        : (textOf(r?.document_id) ?? textOf(r?.iva_settlement_document_id) ?? textOf(r?.id))
    revalidateAccounting(slug)
    const month = monthLabel(parsed.data.month).toLowerCase()
    return {
      ok: true,
      data: { month: parsed.data.month, documentId },
      message: documentId
        ? `Liquidación del IVA de ${month} registrada.`
        : `El IVA de ${month} dio cero: no hay nada para registrar.`,
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

// ─── Ejercicio ───────────────────────────────────────────────────────────────

/**
 * «Cerrar el ejercicio» (C.5.5): refundición, cierre y apertura del siguiente,
 * comparando el resultado con el que vio la persona.
 */
export async function closeFiscalYear(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<CloseFiscalYearResult>> {
  const op = 'periods.closeFiscalYear'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = closeFiscalYearSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_close_fiscal_year', {
      p_tenant_id: auth.tenantId,
      p_fiscal_year_id: parsed.data.fiscalYearId,
      p_expected: {
        result_cents: parsed.data.expected.resultCents,
        balance_sheet_accounts: parsed.data.expected.balanceSheetAccounts,
      },
    })
    if (error) return rpcFailure(op, error)

    const r = asRecord(data) ?? {}
    const result: CloseFiscalYearResult = {
      resultCents: intOf(r.result_cents),
      fyResultNumber: intOf(r.fy_result_number),
      fyClosingNumber: intOf(r.fy_closing_number),
    }
    revalidateAccounting(slug)
    const cents = result.resultCents
    return {
      ok: true,
      data: result,
      message:
        cents === null || cents === 0
          ? 'Ejercicio cerrado.'
          : cents > 0
            ? `Ejercicio cerrado: ganancia de ${formatCents(cents)}.`
            : `Ejercicio cerrado: pérdida de ${formatCents(-cents)}.`,
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/** Reabre un ejercicio cerrado (si el siguiente no está cerrado), con motivo. */
export async function reopenFiscalYear(slug: string, raw: unknown): Promise<AccSimpleState> {
  const op = 'periods.reopenFiscalYear'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = reopenFiscalYearSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_reopen_fiscal_year', {
      p_tenant_id: auth.tenantId,
      p_fiscal_year_id: parsed.data.fiscalYearId,
      p_reason: parsed.data.reason,
    })
    if (error) return rpcFailure(op, error)

    revalidateAccounting(slug)
    return { ok: true, data: undefined, message: 'Ejercicio reabierto.' }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}
