'use server'

import { authorizeAccounting } from '@/lib/accounting/access'
import { todayInCordoba } from '@/lib/dates'
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
  const auth = await authorizeAccounting(slug, 'read')
  if (!auth.ok) return { ok: false, message: auth.state.message, ticket: null }
  const accounting = auth.access.accounting
  const store = await TexStore.open(auth.tenantId, auth.userId)
  return undoAction(actionId, store, {
    slug,
    tenantId: auth.tenantId,
    tenantName: auth.access.tenant.name,
    userId: auth.userId,
    isAccountant: auth.access.role === 'accountant',
    access: { read: accounting.read, write: accounting.write, admin: accounting.admin },
    today: todayInCordoba(),
  })
}
