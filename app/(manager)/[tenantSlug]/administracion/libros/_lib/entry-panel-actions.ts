'use server'

import { z } from 'zod'
import { authorizeAccounting } from '@/lib/accounting/access'
import { loadPostingCatalog } from '@/lib/accounting/context'
import {
  AccQueryError,
  getDocument,
  getEntry,
  getEntryDocumentId,
  getImputationFlags,
  getRecurringExpense,
  listLineReimputations,
  type QueryOutcome,
  settleQuery,
} from '@/lib/accounting/queries'
import { listDocumentAttachments } from '@/lib/accounting/queries/attachments'
import { getDocumentOrigin } from '@/lib/accounting/queries/document-origin'
import { reimputeAccountOptions } from '@/lib/accounting/reimpute'
import { voidNotes } from '../../comprobantes/_lib/document-story'
import { buildEntryPanel, type EntryPanelData } from './entry-panel'

const inputSchema = z.strictObject({
  entryId: z.uuid('Ese asiento no existe.'),
  /** El plan ya está en la pantalla: no hace falta mandarlo de nuevo. */
  withAccounts: z.boolean(),
})

/**
 * Lo que muestra el panel del asiento. Es una lectura: alcanza con el acceso de lectura, y la RLS la
 * vuelve a decidir fila por fila. Nunca tira: el panel muestra el error con «Reintentar».
 */
export async function loadEntryPanel(
  slug: string,
  raw: unknown,
): Promise<QueryOutcome<EntryPanelData>> {
  const auth = await authorizeAccounting(slug, 'read')
  if (!auth.ok) return { ok: false, code: auth.state.code, message: auth.state.message }
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, code: 'invalid', message: 'Ese asiento no existe.' }
  }
  const { entryId, withAccounts } = parsed.data
  const tenantId = auth.tenantId

  return settleQuery(
    (async () => {
      const documentId = await getEntryDocumentId(tenantId, entryId)
      const doc = documentId ? await getDocument(tenantId, documentId) : null
      if (!doc)
        throw new AccQueryError('acc_journal_entries', 'conflict', 'Ese asiento ya no está.')
      const entry = doc.entry?.id === entryId ? doc.entry : await getEntry(tenantId, entryId)
      if (!entry)
        throw new AccQueryError('acc_journal_entries', 'conflict', 'Ese asiento ya no está.')

      const [catalog, flags, reimputations, attachments, recurring, origin] = await Promise.all([
        loadPostingCatalog(tenantId),
        settleQuery(
          getImputationFlags(tenantId, { from: doc.accountingDate, to: doc.accountingDate }),
        ),
        settleQuery(listLineReimputations(tenantId, doc.id)),
        settleQuery(listDocumentAttachments(tenantId, doc.id)),
        doc.recurringExpenseId
          ? settleQuery(getRecurringExpense(tenantId, doc.recurringExpenseId))
          : null,
        settleQuery(getDocumentOrigin(tenantId, doc.id)),
      ])

      return buildEntryPanel({
        doc,
        entry,
        canWrite: auth.access.accounting.write,
        accounts: new Map(catalog.accounts.map((a) => [a.id, a])),
        flags: flags.ok ? flags.data : [],
        reimputations: reimputations.ok ? reimputations.data : [],
        attachments: attachments.ok ? attachments.data : [],
        attachmentsError: attachments.ok ? null : attachments.message,
        voidNotes: voidNotes(doc, {
          recurring: !doc.recurringExpenseId ? undefined : recurring?.ok ? recurring.data : 'error',
          origin: origin.ok ? origin.data : null,
        }),
        options: withAccounts ? reimputeAccountOptions(catalog.accounts) : null,
      })
    })(),
  )
}
