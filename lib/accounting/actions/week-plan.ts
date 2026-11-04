'use server'

/**
 * Plan de la semana: guardar los presupuestos. Como el resto de las acciones de Administración:
 * dueño con acceso (`write`, la contadora no llega) → zod → UNA RPC con la sesión del usuario (vuelve
 * a chequear todo y audita adentro) → error del catálogo → revalidación. La pantalla pide pesos; acá
 * ya llegan centavos. Nada de esto toca los libros.
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import { type AccSimpleState, invalidState } from '@/lib/accounting/action-state'
import { AccQueryError } from '@/lib/accounting/queries/shared'
import { getWeekPlan } from '@/lib/accounting/queries/week-plan'
import {
  addWeeks,
  type BudgetItem,
  budgetPayload,
  copyBudgetItems,
  copyWeekBudgetsSchema,
  saveWeekBudgetsSchema,
} from '@/lib/accounting/week-plan'
import { createClient } from '@/lib/supabase/server'
import { asRecord, intOf, revalidateAccounting, rpcFailure, unexpectedFailure } from './support'

/** Guarda una o varias celdas de una semana (un cero deja la fila en cero). */
export async function saveWeekBudgets(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<{ saved: number }>> {
  const op = 'weekPlan.saveWeekBudgets'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = saveWeekBudgetsSchema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_save_payment_budget', {
      p_tenant_id: auth.tenantId,
      p_week_start: parsed.data.weekStart,
      p_items: budgetPayload(parsed.data.items),
    })
    if (error) return rpcFailure(op, error)

    revalidateAccounting(slug)
    return {
      ok: true,
      data: { saved: intOf(asRecord(data)?.saved) ?? parsed.data.items.length },
      message: 'Listo: quedó guardado.',
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/**
 * «Copiar la semana pasada»: lo presupuestado la semana anterior, en las filas que esta semana están
 * en cero. Devuelve lo copiado, así la pantalla lo muestra al toque y lo puede deshacer.
 */
export async function copyPreviousWeekBudgets(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<{ items: BudgetItem[] }>> {
  const op = 'weekPlan.copyPreviousWeekBudgets'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = copyWeekBudgetsSchema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)

    const { weekStart } = parsed.data
    const [current, previous] = await Promise.all([
      getWeekPlan(auth.tenantId, weekStart),
      getWeekPlan(auth.tenantId, addWeeks(weekStart, -1)),
    ])
    const items = copyBudgetItems(current, previous)
    if (items.length === 0) {
      return {
        ok: true,
        data: { items: [] },
        message: previous.some((row) => row.budgetCents > 0)
          ? 'Esas filas ya tienen presupuesto: no se copió nada.'
          : 'La semana pasada no tiene presupuesto para copiar.',
      }
    }

    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_save_payment_budget', {
      p_tenant_id: auth.tenantId,
      p_week_start: weekStart,
      p_items: budgetPayload(items),
    })
    if (error) return rpcFailure(op, error)

    revalidateAccounting(slug)
    return {
      ok: true,
      data: { items },
      message:
        items.length === 1
          ? 'Copiamos 1 presupuesto de la semana pasada.'
          : `Copiamos ${items.length} presupuestos de la semana pasada.`,
    }
  } catch (error) {
    // Una lectura que falló trae su mensaje listo para mostrar.
    if (error instanceof AccQueryError) {
      return { ok: false, code: error.code, message: error.message }
    }
    return unexpectedFailure(op, error)
  }
}
