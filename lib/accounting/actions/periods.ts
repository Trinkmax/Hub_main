'use server'

/**
 * Cierres de mes y de ejercicio, y la liquidación de IVA (C.5, H.15).
 *
 * Cerrar es irreversible desde la pantalla de carga (se confirma antes); se
 * deshace reabriendo el ÚLTIMO mes cerrado, con motivo. La base hace todo bajo
 * el lock del bar: orden de los meses, avisos (`close_warnings`), la
 * liquidación de IVA comparada con lo que vio la persona (`preview_stale`), la
 * numeración definitiva y la foto del período.
 *
 * Contratos (db-api.md, #10 partes 2 y 3; #15 según la spec C.5.5):
 * - `acc_close_period(p_tenant_id, p_month, p_options)` con `p_options =
 *   {warnings_ack: [clave…], iva_settlement: {generate, expected}}`; `generate`
 *   ausente = true (solo cuenta con `iva_settlement_mode = 'on_close'` y la SAS
 *   responsable inscripta); `expected` = las 7 cifras de `ivaExpectedJson` (sin
 *   ellas, la base solo deja pasar una posición en cero → `preview_stale`).
 *   `close_warnings` trae `detail = {month, warnings: [{key, count, …}]}`.
 * - `acc_reopen_period(p_tenant_id, p_month, p_reason)` (motivo ≥ 5 letras).
 * - `acc_generate_iva_settlement(p_tenant_id, p_month, p_expected)`: si la
 *   vigente quedó vieja la reemplaza; si sigue al día, `iva_settlement_exists`.
 * - `acc_close_fiscal_year(p_tenant_id, p_fiscal_year_id, p_expected =
 *   {result_cents, balance_sheet_accounts})` y `acc_reopen_fiscal_year(…, p_reason)`.
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
import { createClient } from '@/lib/supabase/server'
import {
  type CloseFiscalYearResult as CloseFiscalYearResultData,
  type ClosePeriodResult as ClosePeriodResultData,
  type CloseWarningItem as CloseWarningItemData,
  closeFiscalYearMessage,
  closePeriodMessage,
  closeWarningsFromDetails,
  type IvaSettlementResult as IvaSettlementResultData,
  ivaExpectedJson,
  ivaSettlementMessage,
  parseCloseFiscalYearResult,
  parseClosePeriodResult,
  parseIvaSettlementResult,
  parseReopenPeriodResult,
  type ReopenPeriodResult as ReopenPeriodResultData,
  reopenPeriodMessage,
} from './payloads'
import { formInput, revalidateAccounting, rpcFailure, unexpectedFailure } from './support'

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type CloseWarningItem = CloseWarningItemData
export type ClosePeriodResult = ClosePeriodResultData
export type ReopenPeriodResult = ReopenPeriodResultData
export type IvaSettlementResult = IvaSettlementResultData
export type CloseFiscalYearResult = CloseFiscalYearResultData

/**
 * Lo que devuelve `closePeriod`. Con avisos sin aceptar: `code:
 * 'needs_confirmation'` y `closeWarnings` (todos juntos, con sus números); el
 * formulario los muestra, la persona los acepta y se reenvía con `warningsAck`.
 */
export type ClosePeriodState =
  | { ok: true; data: ClosePeriodResult; message: string }
  | (AccFailureState & { closeWarnings?: CloseWarningItem[] })

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
        // `generate` sin cifras no cierra a ciegas: si el mes tiene IVA, la
        // base contesta `preview_stale` y la pantalla se recarga con la posición.
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

    const result = parseClosePeriodResult(data, v.month)
    revalidateAccounting(slug)
    return { ok: true, data: result, message: closePeriodMessage(result) }
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
    const { data, error } = await supabase.rpc('acc_reopen_period', {
      p_tenant_id: auth.tenantId,
      p_month: parsed.data.month,
      p_reason: parsed.data.reason,
    })
    if (error) return rpcFailure(op, error)

    const result = parseReopenPeriodResult(data, parsed.data.month)
    revalidateAccounting(slug)
    return { ok: true, data: result, message: reopenPeriodMessage(result) }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/**
 * «Registrar la liquidación del IVA» (C.5.4), para el modo manual o si se
 * apagó al cerrar: compara con las cifras que vio la persona. Si la vigente
 * quedó vieja (se cargó algo después), la base la anula y registra la nueva.
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

    const result = parseIvaSettlementResult(data, parsed.data.month)
    revalidateAccounting(slug)
    return { ok: true, data: result, message: ivaSettlementMessage(result) }
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

    const result = parseCloseFiscalYearResult(data)
    revalidateAccounting(slug)
    return { ok: true, data: result, message: closeFiscalYearMessage(result) }
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
