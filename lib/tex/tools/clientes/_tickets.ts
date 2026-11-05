import 'server-only'

import type { AccSimpleState } from '@/lib/accounting/action-state'
import type { TexTicketWarning } from '../../protocol'
import { texScreenHref } from '../../screens'
import type { TexTicketDraft, TexToolContext, TexToolResult } from '../types'

/** Lo que comparten las herramientas de preparar de Clientes y de Club. */

export const fail = (message: string): TexToolResult => ({ kind: 'error', message })

export const warn = (key: string, title: string): TexTicketWarning => ({ key, title, body: null })

export function prepared(
  executor: string,
  payload: unknown,
  ticket: Omit<TexTicketDraft, 'entry' | 'warnings' | 'total'> &
    Partial<Pick<TexTicketDraft, 'warnings' | 'total'>>,
): TexToolResult {
  return {
    kind: 'prepared',
    prepared: {
      executor,
      payload,
      ticket: { total: null, warnings: [], ...ticket, entry: [] },
    },
  }
}

/** Los renglones que tienen algo para decir. */
export function rowsOf(
  rows: ReadonlyArray<readonly [string, string | null | undefined]>,
): Array<{ label: string; value: string }> {
  return rows.flatMap(([label, value]) => (value ? [{ label, value }] : []))
}

/** Lo que dice una acción de las de siempre, en lo que entiende `simpleExecutor`. */
export function settled<D>(
  state:
    | { ok: true; message?: string }
    | { ok: false; message: string; fieldErrors?: Record<string, string> },
  data: D,
  done: string,
): AccSimpleState<D> {
  return state.ok
    ? { ok: true, data, message: state.message ?? done }
    : { ok: false, code: 'error', message: state.message, fieldErrors: state.fieldErrors }
}

export const failure = (message: string): AccSimpleState<never> => ({
  ok: false,
  code: 'error',
  message,
})

/** Lo que se lee para confirmar puede fallar: el tique lo dice, sin datos de nadie en el log. */
export function guarded<P, D>(
  run: (payload: P, ctx: TexToolContext) => Promise<AccSimpleState<D>>,
): (payload: P, ctx: TexToolContext) => Promise<AccSimpleState<D>> {
  return async (payload, ctx) => {
    try {
      return await run(payload, ctx)
    } catch (error) {
      console.error('[tex.clientes]', error instanceof Error ? error.name : 'desconocido')
      return failure('No se pudo: falló la lectura. Probá de nuevo.')
    }
  }
}

export function place(
  ctx: TexToolContext,
  screen: string,
  params: { id?: string } = {},
  point: string | null = null,
) {
  const link = texScreenHref(ctx.slug, screen, params)
  return { href: link.ok ? link.href : null, point }
}

export const CHANGE_NOTHING = 'No hay nada para cambiar: preguntale qué quiere cambiar.'

export function yesNo(value: boolean | undefined): string | null {
  return value === undefined ? null : value ? 'Sí' : 'No'
}
