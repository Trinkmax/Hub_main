import 'server-only'

import { z } from 'zod'
import type { AccFailureState } from '@/lib/accounting/action-state'
import type { WarningCopy } from '@/lib/accounting/errors'
import type { DocumentForm, PreviewRequest } from '@/lib/accounting/server/document-types'
import { runPostDocument, runPreviewDocument } from '@/lib/accounting/server/post-document'
import type { EntryPreview } from '@/lib/accounting/types'
import type { TexEntryLine, TexTicketWarning } from './protocol'
import { texScreenHref } from './screens'
import {
  money,
  type TexExecutor,
  type TexTicketDraft,
  type TexToolContext,
  type TexToolResult,
} from './tools/types'

/**
 * Los comprobantes pasan por el mismo camino que los formularios: `runPreviewDocument` para el tique
 * (el asiento que muestra Tex es el que arma el motor, con su hash) y `runPostDocument` al confirmar.
 * Si algo cambió entre medio, el motor lo frena y el tique vuelve a la persona con lo nuevo.
 */

/** «Deshacer» dura 10 minutos y solo para quien lo cargó (`acc_void_document`). */
const UNDO_WINDOW_MS = 10 * 60 * 1000

export function entryLines(preview: readonly EntryPreview[]): TexEntryLine[] {
  return preview.flatMap((entry) =>
    entry.lines.map((line) => ({
      account: line.partyName ? `${line.accountName} · ${line.partyName}` : line.accountName,
      debit: line.debitCents ? money(line.debitCents) : null,
      credit: line.creditCents ? money(line.creditCents) : null,
    })),
  )
}

export function ticketWarnings(warnings: readonly WarningCopy[]): TexTicketWarning[] {
  return warnings.map((w) => ({ key: w.key, title: w.message, body: null }))
}

/** Lo que no pasó la validación, en una oración que Tex pueda leer para corregir o preguntar. */
export function failureText(state: AccFailureState): string {
  const fields = state.fieldErrors ? Object.values(state.fieldErrors).slice(0, 5) : []
  return fields.length > 0 ? `${state.message} ${fields.join(' ')}` : state.message
}

/**
 * Arma el tique de un comprobante: valida con el motor y le suma el asiento y los avisos. `values` es
 * lo que manda el formulario, sin `clientRef` ni `previewHash`.
 */
export async function prepareDocument(
  ctx: TexToolContext,
  form: DocumentForm,
  values: Record<string, unknown>,
  ticket: Omit<TexTicketDraft, 'entry' | 'warnings'>,
): Promise<TexToolResult> {
  const clientRef = crypto.randomUUID()
  const withRef = { ...values, clientRef }
  const state = await runPreviewDocument(ctx.slug, { form, values: withRef } as PreviewRequest)
  if (!state.ok) return { kind: 'error', message: failureText(state) }
  return {
    kind: 'prepared',
    prepared: {
      executor: 'document',
      payload: {
        form,
        values: withRef,
        previewHash: state.hash,
        warningsAck: state.warnings.map((w) => w.key),
      },
      ticket: {
        ...ticket,
        entry: entryLines(state.preview),
        warnings: ticketWarnings(state.warnings),
      },
    },
  }
}

const documentPayload = z.object({
  form: z.string(),
  values: z.record(z.string(), z.unknown()),
  previewHash: z.string(),
  warningsAck: z.array(z.string()),
})

export const documentExecutor: TexExecutor = {
  run: async (raw, ctx) => {
    const parsed = documentPayload.safeParse(raw)
    if (!parsed.success)
      return { ok: false, kind: 'failed', message: 'El tique está roto: armalo de nuevo.' }
    const { form, values, previewHash, warningsAck } = parsed.data
    const state = await runPostDocument(ctx.slug, form as DocumentForm, {
      ...values,
      previewHash,
      warningsAck,
    })
    if (state.ok) {
      const documentId = state.result.documents[0]?.id ?? null
      const link = documentId ? texScreenHref(ctx.slug, 'comprobante', { id: documentId }) : null
      return {
        ok: true,
        message: state.message,
        documentId,
        href: link?.ok ? link.href : null,
        point: null,
        undoUntil: documentId ? new Date(Date.now() + UNDO_WINDOW_MS).toISOString() : null,
        data: { replayed: state.result.replayed },
      }
    }
    // Avisos que solo ve la base (posible duplicado, caja en negativo): la persona los tiene que ver.
    if (state.code === 'needs_confirmation' && state.warnings) {
      return {
        ok: false,
        kind: 'review',
        message: state.message,
        warnings: ticketWarnings(state.warnings),
        payload: {
          ...parsed.data,
          warningsAck: [...new Set([...warningsAck, ...state.warnings.map((w) => w.key)])],
        },
      }
    }
    // Cambió algo en la base, o el mes está cerrado: el asiento nuevo tiene su propio hash.
    if (state.hash && state.preview) {
      return {
        ok: false,
        kind: 'review',
        message: state.message,
        warnings: [{ key: 'changed', title: state.message, body: null }],
        entry: entryLines(state.preview),
        payload: { ...parsed.data, previewHash: state.hash },
      }
    }
    return { ok: false, kind: 'failed', message: failureText(state) }
  },
}
