'use server'

/**
 * Reimputar un renglón (Silvia, reunión del 29/10: «suelen encontrar que en energía eléctrica
 * metieron una de agua»): cambia la cuenta de un renglón de imputación con el mes abierto. No toca
 * importe, proveedor, partidas ni IVA, y queda quién, cuándo, de qué cuenta a qué cuenta y por qué.
 *
 * Lo pueden hacer los dueños con acceso y la contadora: por eso alcanza con el acceso de lectura
 * (`authorizeAccounting(slug, 'read')`). `acc_reimpute_line` lo vuelve a decidir (lock del bar, mes
 * abierto, renglón de imputación, cuenta imputable) y deja la historia y la auditoría.
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import { type AccSimpleState, invalidState } from '@/lib/accounting/action-state'
import { mapReimputeError } from '@/lib/accounting/errors'
import { reimputedMessage, reimputeSchema } from '@/lib/accounting/reimpute'
import { createClient } from '@/lib/supabase/server'
import {
  asRecord,
  formInput,
  revalidateAccounting,
  rpcFailure,
  textOf,
  unexpectedFailure,
} from './support'

export type ReimputeResult = {
  documentId: string | null
  lineId: string | null
  from: { id: string | null; code: string | null; name: string | null }
  to: { id: string | null; code: string | null; name: string | null }
}

function accountOf(value: unknown): ReimputeResult['to'] {
  const row = asRecord(value)
  return { id: textOf(row?.id), code: textOf(row?.code), name: textOf(row?.name) }
}

export async function reimputeLine(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ReimputeResult>> {
  const op = 'reimpute.line'
  try {
    const auth = await authorizeAccounting(slug, 'read')
    if (!auth.ok) return auth.state
    const parsed = reimputeSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_reimpute_line', {
      p_tenant_id: auth.tenantId,
      p_line_id: parsed.data.lineId,
      p_account_id: parsed.data.accountId,
      p_reason: parsed.data.reason,
    })
    if (error) {
      const state = mapReimputeError(error)
      // Lo que no es de la persona (un código que no se reconoce) se loguea, sin datos personales.
      return state.code === 'error' ? rpcFailure(op, error) : state
    }

    const row = asRecord(data)
    const to = accountOf(row?.to)
    revalidateAccounting(slug)
    return {
      ok: true,
      data: {
        documentId: textOf(row?.document_id),
        lineId: textOf(row?.line_id),
        from: accountOf(row?.from),
        to,
      },
      message: reimputedMessage(to.name ?? 'la cuenta nueva'),
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}
