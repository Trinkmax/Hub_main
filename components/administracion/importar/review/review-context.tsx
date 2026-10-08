'use client'

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { AccountOption } from '@/components/administracion/account-combobox'
import type { PartyOption } from '@/components/administracion/party-combobox'
import type { TreasuryOption } from '@/components/administracion/treasury-select'
import { resolveImportNeeds } from '@/lib/imports/actions'
import type { ImportChangeInput } from '@/lib/imports/server/types'
import type { UiImportSource } from '@/lib/imports/ui/labels'

/** Lo que hace falta para elegir en la revisión (solo a quien puede cargar). */
export type ReviewOptions = {
  parties: Array<PartyOption & { kind: string }>
  /** El plan entero (los grupos arman la ruta); `purchase` = cuenta de compras o gastos. */
  accounts: Array<AccountOption & { purchase: boolean; treasury: boolean }>
  treasuries: TreasuryOption[]
  methods: Array<{ id: string; name: string }>
  /** Jurisdicción de Ingresos Brutos de la SAS (la de las percepciones por defecto). */
  iibbJurisdictionCode: number
}

type ReviewContextValue = {
  slug: string
  batchId: string
  source: UiImportSource
  /** Puede cargar y el lote se puede tocar (no está terminado ni cancelado). */
  editable: boolean
  canWrite: boolean
  options: ReviewOptions | null
  /** La propuesta que está guardando algo (para deshabilitar sus botones). */
  busyKey: string | null
  /**
   * Aplica cambios de la revisión (`resolveImportNeeds`) y vuelve a armar. La
   * página se actualiza sola (la acción revalida). Devuelve si anduvo.
   */
  resolve: (
    key: string,
    changes: ImportChangeInput[],
    opts?: { success?: string; quiet?: boolean },
  ) => Promise<boolean>
}

const ReviewContext = createContext<ReviewContextValue | null>(null)

export function useReview(): ReviewContextValue {
  const value = useContext(ReviewContext)
  if (!value) throw new Error('useReview: falta <ReviewProvider>.')
  return value
}

export const OFFLINE_TEXT = 'Sin conexión: no se guardó. Revisá internet y probá de nuevo.'

export function ReviewProvider({
  slug,
  batchId,
  source,
  editable,
  canWrite,
  options,
  children,
}: {
  slug: string
  batchId: string
  source: UiImportSource
  editable: boolean
  canWrite: boolean
  options: ReviewOptions | null
  children: ReactNode
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const resolve = useCallback<ReviewContextValue['resolve']>(
    async (key, changes, opts = {}) => {
      if (changes.length === 0) return true
      setBusyKey(key)
      try {
        const result = await resolveImportNeeds(slug, { batchId, changes })
        if (!result.ok) {
          toast.error(result.message)
          return false
        }
        if (!opts.quiet) toast.success(opts.success ?? 'Listo, lo tuvimos en cuenta.')
        return true
      } catch {
        toast.error(OFFLINE_TEXT)
        return false
      } finally {
        setBusyKey(null)
      }
    },
    [slug, batchId],
  )

  const value = useMemo(
    () => ({ slug, batchId, source, editable, canWrite, options, busyKey, resolve }),
    [slug, batchId, source, editable, canWrite, options, busyKey, resolve],
  )
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>
}
