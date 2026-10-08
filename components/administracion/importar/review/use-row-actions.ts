'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { newPurchaseHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { toastUndo } from '@/components/administracion/quick-actions'
import { formatIsoDay } from '@/lib/dates'
import { fetchProposalItemIds } from '@/lib/imports/review-actions'
import { formatCents } from '@/lib/money'
import { OFFLINE_TEXT, useReview } from './review-context'
import type { ProposalView } from './types'

/**
 * Lo que se hace con las filas de una propuesta: «No es nuestro» (con
 * «Deshacer»), volver a incluirla y «Cargarla a mano» (se saca de la
 * importación para que no quede dos veces y se abre el formulario de siempre).
 */
export function useRowActions() {
  const { slug, batchId, resolve } = useReview()
  const { openAction } = useAccounting()
  const router = useRouter()

  const itemIdsOf = useCallback(
    async (key: string): Promise<string[] | null> => {
      try {
        const result = await fetchProposalItemIds(slug, { batchId, proposalKey: key })
        if (!result.ok) {
          toast.error(result.message)
          return null
        }
        return result.data.itemIds
      } catch {
        toast.error(OFFLINE_TEXT)
        return null
      }
    },
    [slug, batchId],
  )

  /** «No es nuestro»: las filas quedan afuera (se recuerda) y se puede deshacer. */
  const ignore = useCallback(
    async (p: ProposalView, reason: string, message = 'Listo: no se va a cargar.') => {
      const itemIds = await itemIdsOf(p.key)
      if (!itemIds) return false
      const ok = await resolve(p.key, [{ kind: 'ignore', itemIds, reason }], { quiet: true })
      if (ok) {
        toastUndo(message, {
          description: p.summary.label,
          onUndo: async () => {
            await resolve(p.key, [{ kind: 'unignore', itemIds }], {
              success: 'Listo: lo volvimos a incluir.',
            })
          },
        })
      }
      return ok
    },
    [itemIdsOf, resolve],
  )

  /** Volver a incluir lo que se marcó «No es nuestro». */
  const unignore = useCallback(
    async (p: ProposalView) => {
      const itemIds = await itemIdsOf(p.key)
      if (!itemIds) return false
      return resolve(p.key, [{ kind: 'unignore', itemIds }], {
        success: 'Listo: lo volvimos a incluir.',
      })
    },
    [itemIdsOf, resolve],
  )

  /**
   * «Cargarla a mano»: se saca de la importación (para que no quede dos veces)
   * y se abre el formulario que corresponde, con los datos a la vista.
   */
  const loadByHand = useCallback(
    async (p: ProposalView) => {
      const ok = await ignore(p, 'Se carga a mano', 'Lo sacamos de la importación.')
      if (!ok) return
      const s = p.summary
      toast(`Cargalo con estos datos: ${s.label}`, {
        description: `${s.counterparty ? `${s.counterparty} · ` : ''}${formatIsoDay(s.date)} · ${formatCents(s.total_cents)}`,
        duration: 15_000,
      })
      const here = `${window.location.pathname}${window.location.search}`
      switch (p.form) {
        case 'purchase':
        case 'purchase_credit_note':
          router.push(
            newPurchaseHref(slug, {
              tipo: s.kind === 'credit_note' ? 'nc' : 'factura',
              proveedor: p.partyId,
              volver: here,
            }),
          )
          return
        case 'bank_expense':
          router.push(`/${slug}/administracion/cajas/gasto-bancario`)
          return
        case 'payment':
          openAction('pagar', p.partyId ? { proveedor: p.partyId } : undefined)
          return
        case 'collection':
          openAction('cobrar')
          return
        case 'transfer':
          openAction('mover')
          return
        default:
          openAction('movimiento')
      }
    },
    [ignore, openAction, router, slug],
  )

  return { ignore, unignore, loadByHand }
}
