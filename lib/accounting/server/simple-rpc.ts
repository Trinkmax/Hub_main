import 'server-only'

/**
 * El camino de las acciones que no arman un bundle (anular, deshacer, anular
 * con fecha de hoy, imputar, desimputar, marcar una caja verificada): permiso
 * de escritura (`spec.need`, por defecto el nivel completo), zod, UNA RPC con
 * la sesión del usuario (que vuelve a chequear todo y audita adentro), error
 * mapeado y revalidación de la sección.
 */

import type { z } from 'zod'
import { type AccountingNeed, authorizeAccounting } from '@/lib/accounting/access'
import {
  type AccFailureState,
  type AccSimpleState,
  invalidState,
} from '@/lib/accounting/action-state'
import { ACC_GENERIC_ERROR, accErrorMessage, mapAccError } from '@/lib/accounting/errors'
import { createClient } from '@/lib/supabase/server'
import { afterCommit, errorName, logFailure, revalidateAdministracion } from './post-document'

export type SimpleRpcSpec<D, T> = {
  /** Para el log: `void`, `undo`, `reverse`… */
  op: string
  /**
   * El acceso que pide. Por defecto `write` (el nivel completo). `buy_write` solo en lo que también
   * hace quien tiene «solo compras y pagos» (imputar un pago a una factura de un proveedor).
   */
  need?: AccountingNeed
  schema: z.ZodType<D>
  /** Lo que se revisa antes de llamar (con la entrada ya validada): un error corta ahí. */
  check?: (slug: string, input: D) => Promise<AccFailureState | null>
  /**
   * La RPC y sus parámetros (el primero siempre `p_tenant_id`, el bar de la
   * URL). Puede ser async si necesita leer algo antes (con la misma sesión).
   */
  call: (
    tenantId: string,
    input: D,
  ) =>
    | { fn: string; args: Record<string, unknown> }
    | Promise<{ fn: string; args: Record<string, unknown> }>
  /** Lo que devuelve la acción y el texto del toast. */
  done: (data: unknown, input: D) => { data: T; message: string }
}

export async function runSimpleRpc<D, T>(
  slug: unknown,
  raw: unknown,
  spec: SimpleRpcSpec<D, T>,
): Promise<AccSimpleState<T>> {
  try {
    if (typeof slug !== 'string' || slug === '') {
      return {
        ok: false,
        code: 'forbidden',
        message: accErrorMessage('forbidden'),
        detail: { key: 'forbidden' },
      }
    }
    const auth = await authorizeAccounting(slug, spec.need ?? 'write')
    if (!auth.ok) return auth.state

    const parsed = spec.schema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)
    const checked = spec.check ? await spec.check(slug, parsed.data) : null
    if (checked) return checked

    const { fn, args } = await spec.call(auth.tenantId, parsed.data)
    const supabase = await createClient()
    const { data, error } = await supabase.rpc(fn, args)
    if (error) {
      const state = mapAccError(error)
      logFailure(spec.op, state, error.code)
      return state
    }

    // Ya está hecho (la base confirmó): nada de acá en adelante puede volverlo un error.
    afterCommit(spec.op, () => revalidateAdministracion(slug))
    const result = spec.done(data, parsed.data)
    return { ok: true, data: result.data, message: result.message }
  } catch (error) {
    console.error(`[accounting.documents.${spec.op}] inesperado`, errorName(error))
    return { ok: false, code: 'error', message: ACC_GENERIC_ERROR }
  }
}
