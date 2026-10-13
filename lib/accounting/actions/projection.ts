'use server'

/**
 * Ventas › Proyección y «Ventas contra caja» (12/10/2026): guardar los
 * objetivos por día y lo que entró en cada caja. Como el resto de las acciones
 * de Administración: dueño con acceso (`write`) → zod → UNA RPC con la sesión
 * del usuario (vuelve a chequear todo, toma el lock del bar y audita adentro) →
 * error del catálogo → revalidación. Nada de esto toca los libros.
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import { type AccSimpleState, invalidState } from '@/lib/accounting/action-state'
import { dailyCashSchema, salesTargetsSchema } from '@/lib/accounting/projection-schemas'
import { formatDayMonth } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'
import { asRecord, intOf, revalidateAccounting, rpcFailure, unexpectedFailure } from './support'

export type SavedTargets = { saved: number; deleted: number }

/**
 * Guarda el objetivo (y la nota) de uno o varios días. Viaja solo lo que
 * cambia: «Cargar una lista» manda los objetivos de un mes sin tocar las notas.
 */
export async function saveSalesTargets(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<SavedTargets>> {
  const op = 'projection.saveSalesTargets'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = salesTargetsSchema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_save_sales_targets', {
      p_tenant_id: auth.tenantId,
      p_items: parsed.data.items.map((item) => ({
        day: item.day,
        ...(item.targetCents !== undefined ? { target_cents: item.targetCents } : {}),
        ...(item.note !== undefined ? { note: item.note } : {}),
      })),
    })
    if (error) return rpcFailure(op, error)
    const row = asRecord(data)
    const result: SavedTargets = {
      saved: intOf(row?.saved) ?? 0,
      deleted: intOf(row?.deleted) ?? 0,
    }

    revalidateAccounting(slug)
    const days = parsed.data.items.length
    return {
      ok: true,
      data: result,
      message: days === 1 ? 'Listo: quedó guardado.' : `Listo: se actualizaron ${days} días.`,
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/** Guarda lo que entró un día en cada caja (reemplaza lo que había de ese día). */
export async function saveDailyCash(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<{ day: string; totalCents: number }>> {
  const op = 'projection.saveDailyCash'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = dailyCashSchema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_save_daily_cash', {
      p_tenant_id: auth.tenantId,
      p_day: parsed.data.day,
      p_items: parsed.data.items.map((item) => ({
        treasury_account_id: item.treasuryAccountId,
        amount_cents: item.amountCents,
      })),
    })
    if (error) return rpcFailure(op, error)

    revalidateAccounting(slug)
    return {
      ok: true,
      data: { day: parsed.data.day, totalCents: intOf(asRecord(data)?.total_cents) ?? 0 },
      message: `Listo: quedó cargado lo que entró el ${formatDayMonth(parsed.data.day)}.`,
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}
