import 'server-only'

import type { z } from 'zod'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import { failureText } from './document-action'
import type { TexExecutor, TexToolContext } from './tools/types'

/**
 * Lo que no es un comprobante (un proveedor, un gasto fijo, los objetivos): se ejecuta con la misma
 * server action del formulario, que valida usuario, rol y datos. El ejecutor solo la llama y traduce la
 * respuesta. `where` dice a dónde llevar a la persona para mostrárselo.
 */
export function simpleExecutor<P, D = unknown>(
  schema: z.ZodType<P>,
  run: (payload: P, ctx: TexToolContext) => Promise<AccSimpleState<D>>,
  where?: (
    data: D,
    payload: P,
    ctx: TexToolContext,
  ) => { href: string | null; point?: string | null },
): TexExecutor {
  return {
    run: async (raw, ctx) => {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        return { ok: false, kind: 'failed', message: 'El tique está roto: armalo de nuevo.' }
      }
      const state = await run(parsed.data, ctx)
      if (!state.ok) return { ok: false, kind: 'failed', message: failureText(state) }
      const place = where?.(state.data, parsed.data, ctx)
      return {
        ok: true,
        message: state.message,
        href: place?.href ?? null,
        point: place?.point ?? null,
        undoUntil: null,
        data: state.data ?? undefined,
      }
    },
  }
}
