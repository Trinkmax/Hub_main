'use client'

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { AccountOption } from '@/components/administracion/account-combobox'
import type { PartyOption } from '@/components/administracion/party-combobox'
import type { TreasuryOption } from '@/components/administracion/treasury-select'
import { resolveImportNeeds } from '@/lib/imports/actions'
import type { ImportChangeInput } from '@/lib/imports/server/types'
import type { UiImportSource } from '@/lib/imports/ui/labels'
import type { RuleDraft } from '@/lib/imports/ui/payloads'

/** Lo que hace falta para elegir en la revisión (solo a quien puede cargar). */
export type ReviewOptions = {
  /** `updatedAt` hace falta para guardarle el CUIT a uno que ya estaba («Sí: es {proveedor}»). */
  parties: Array<PartyOption & { kind: string; updatedAt?: string | null }>
  /** El plan entero (los grupos arman la ruta); `purchase` = categoría de compras o gastos. */
  accounts: Array<
    AccountOption & {
      purchase: boolean
      treasury: boolean
      /** `asset`, `expense`…: arma los grupos del selector de categorías. */
      type: string
      systemKey?: string | null
    }
  >
  treasuries: TreasuryOption[]
  methods: Array<{ id: string; name: string }>
  /** Jurisdicción de Ingresos Brutos de la SAS (la de las percepciones por defecto). */
  iibbJurisdictionCode: number
}

type ReviewContextValue = {
  slug: string
  batchId: string
  source: UiImportSource
  /** Puede cargar y el archivo se puede tocar (no está terminado ni descartado). */
  editable: boolean
  canWrite: boolean
  options: ReviewOptions | null
  /** La fecha de arranque del bar (lo anterior no se puede cargar). */
  booksStartDate: string | null
  /** La hoja que está guardando algo (para deshabilitar sus botones). */
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
  /** La hoja abierta en una lista (una por vez). Estado de pantalla: no se guarda. */
  openKey: string | null
  setOpenKey: (key: string | null) => void
  /** La hoja que la persona trajo «a la mano» entre las preguntas (`null` = la primera). */
  handKey: string | null
  setHandKey: (key: string | null) => void
  /** Algo para enseñarle al banco, precargado desde una pregunta (`null` = cerrado). */
  teach: Partial<RuleDraft> | null
  setTeach: (draft: Partial<RuleDraft> | null) => void
}

const ReviewContext = createContext<ReviewContextValue | null>(null)

export function useReview(): ReviewContextValue {
  const value = useContext(ReviewContext)
  if (!value) throw new Error('useReview: falta <ReviewProvider>.')
  return value
}

export const OFFLINE_TEXT = 'Sin conexión: no se guardó. Revisá internet y probá de nuevo.'

/**
 * Lo que comparten las piezas de la revisión de un archivo: de qué archivo es,
 * si se puede tocar, con qué se contesta (proveedores, categorías, cajas) y
 * `resolve`, que manda UN cambio por toque como siempre. Además, el estado de
 * pantalla que no se guarda: qué hoja está abierta o en la mano y qué se le
 * está por enseñar al banco.
 */
export function ReviewProvider({
  slug,
  batchId,
  source,
  editable,
  canWrite,
  options,
  booksStartDate = null,
  children,
}: {
  slug: string
  batchId: string
  source: UiImportSource
  editable: boolean
  canWrite: boolean
  options: ReviewOptions | null
  booksStartDate?: string | null
  children: ReactNode
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [handKey, setHandKey] = useState<string | null>(null)
  const [teach, setTeach] = useState<Partial<RuleDraft> | null>(null)

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
        if (!opts.quiet) toast.success(opts.success ?? 'Listo, lo tuve en cuenta.')
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
    () => ({
      slug,
      batchId,
      source,
      editable,
      canWrite,
      options,
      booksStartDate,
      busyKey,
      resolve,
      openKey,
      setOpenKey,
      handKey,
      setHandKey,
      teach,
      setTeach,
    }),
    [
      slug,
      batchId,
      source,
      editable,
      canWrite,
      options,
      booksStartDate,
      busyKey,
      resolve,
      openKey,
      handKey,
      teach,
    ],
  )
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>
}
