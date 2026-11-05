'use server'

import { texContext } from './context'
import { undoAction } from './decide'
import type { TexTicket } from './protocol'
import { TexStore } from './store'

/**
 * «Deshacer» de un tique. Es una server action (y no parte de la charla) porque no hace falta
 * preguntarle nada a Tex: anula lo cargado con el mismo «Deshacer» de siempre (10 minutos, solo quien
 * lo cargó) y Next vuelve a leer la pantalla solo.
 */
export async function undoTexAction(
  slug: string,
  actionId: string,
): Promise<{ ok: boolean; message: string; ticket: TexTicket | null }> {
  const auth = await texContext(slug)
  if (!auth.ok) return { ok: false, message: auth.message, ticket: null }
  const store = await TexStore.open(auth.ctx.tenantId, auth.ctx.userId)
  return undoAction(actionId, store, auth.ctx)
}
