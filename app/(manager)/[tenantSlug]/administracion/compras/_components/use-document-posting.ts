'use client'

/**
 * El envío de un comprobante de Compras (G.3 · G.6), igual para las hojas y la
 * factura de proveedor. La vista previa la arma el formulario en el navegador
 * (`previewDocumentForm`, el mismo código que la acción) y su hash viaja como
 * `previewHash`:
 *
 * 1. `needs_confirmation` → los avisos quedan para el diálogo; aceptarlos
 *    reenvía lo mismo con sus claves en `warningsAck` (no cambian el hash).
 * 2. `preview_stale` → el asiento nuevo del servidor reemplaza al del
 *    formulario mientras no se toque nada; guardar de nuevo usa su hash.
 * 3. `period_closed` con hash → «Cargarlo el 01/10» reenvía con ese hash.
 * 4. Cualquier otro error → errores por campo + un aviso arriba de los botones.
 * 5. Sin conexión → «Sin conexión: no se guardó…» [Reintentar] con el mismo
 *    `clientRef` (un reintento nunca duplica: devuelve lo ya guardado).
 *
 * Después de guardar se genera un `clientRef` nuevo («Cargar otro»).
 */

import { useRouter } from 'next/navigation'
import { type RefObject, useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { toastUndo } from '@/components/administracion/quick-actions'
import {
  ACC_UNREACHABLE,
  type AccActionState,
  type AccFailureState,
} from '@/lib/accounting/action-state'
import { undoDocument } from '@/lib/accounting/actions/documents'
import type { WarningCopy } from '@/lib/accounting/errors'
import type { EntryPreview, WarningKey } from '@/lib/accounting/types'
import { formatDayMonth } from '@/lib/dates'
import { newClientRef } from '../_lib/client-ref'

export type PostingBanner = {
  tone: 'error' | 'warning' | 'info'
  message: string
  action?: { label: string; run: () => void }
}

export type SavedState = Extract<AccActionState, { ok: true }>

export type PostingMeta = {
  clientRef: string
  previewHash: string
  warningsAck: WarningKey[]
}

type Attempt<V> = { values: V; hash: string; key: string }
type Override = { key: string; preview: EntryPreview[]; hash: string }

const REVIEW_MESSAGE = 'Revisá lo marcado en rojo.'

export function useDocumentPosting<V>(opts: {
  tenantSlug: string
  action: (slug: string, input: V & PostingMeta) => Promise<AccActionState>
  onSaved: (saved: SavedState) => void
  formRef?: RefObject<HTMLElement | null>
  /** Los campos que el formulario dibuja (para no repetir arriba lo que ya se ve en su lugar). */
  isKnownField?: (key: string) => boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [banner, setBanner] = useState<PostingBanner | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [warnings, setWarnings] = useState<WarningCopy[] | null>(null)
  const [override, setOverrideState] = useState<Override | null>(null)

  const clientRefRef = useRef(newClientRef())
  const acksRef = useRef<WarningKey[]>([])
  const attemptRef = useRef<Attempt<V> | null>(null)
  const overrideRef = useRef<Override | null>(null)
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const setOverride = useCallback((next: Override | null) => {
    overrideRef.current = next
    setOverrideState(next)
  }, [])

  // El foco va al primer campo marcado (después de que se pintó el error).
  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return
    const root = optsRef.current.formRef?.current
    if (!root) return
    const frame = requestAnimationFrame(() => {
      root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [fieldErrors])

  const runRef = useRef<(attempt: Attempt<V>) => void>(() => {})

  const applyFailure = useCallback(
    (state: AccFailureState, attempt: Attempt<V>) => {
      if (state.code === 'needs_confirmation' && state.warnings && state.warnings.length > 0) {
        setWarnings(state.warnings)
        return
      }
      if (state.code === 'preview_stale' && state.preview && state.hash) {
        setOverride({ key: attempt.key, preview: state.preview, hash: state.hash })
        setFieldErrors({})
        setBanner({ tone: 'info', message: state.message })
        return
      }
      const firstOpen = state.detail?.first_open_date
      const correctedHash = state.hash
      if (
        state.detail?.key === 'period_closed' &&
        state.preview &&
        correctedHash &&
        typeof firstOpen === 'string'
      ) {
        setOverride({ key: attempt.key, preview: state.preview, hash: correctedHash })
        setFieldErrors({})
        setBanner({
          tone: 'warning',
          message: state.message,
          action: {
            label: `Cargarlo el ${formatDayMonth(firstOpen)}`,
            run: () => runRef.current({ ...attempt, hash: correctedHash }),
          },
        })
        return
      }
      const errors = state.fieldErrors ?? {}
      setFieldErrors(errors)
      const known = optsRef.current.isKnownField
      const keys = Object.keys(errors)
      const allShown = keys.length > 0 && known !== undefined && keys.every((k) => known(k))
      setBanner({ tone: 'error', message: allShown ? REVIEW_MESSAGE : state.message })
    },
    [setOverride],
  )

  const run = useCallback(
    (attempt: Attempt<V>) => {
      attemptRef.current = attempt
      setBanner(null)
      startTransition(async () => {
        const { tenantSlug, action, onSaved } = optsRef.current
        try {
          const current = overrideRef.current
          const previewHash = current && current.key === attempt.key ? current.hash : attempt.hash
          const result = await action(tenantSlug, {
            ...attempt.values,
            clientRef: clientRefRef.current,
            previewHash,
            warningsAck: acksRef.current,
          })
          if (!result.ok) {
            applyFailure(result, attempt)
            return
          }
          // Guardado: el formulario arranca de nuevo con otra referencia.
          acksRef.current = []
          attemptRef.current = null
          clientRefRef.current = newClientRef()
          setOverride(null)
          setFieldErrors({})
          setBanner(null)
          setWarnings(null)
          onSaved(result)
        } catch {
          setBanner({
            tone: 'error',
            message: ACC_UNREACHABLE.offline,
            action: { label: ACC_UNREACHABLE.retryLabel, run: () => runRef.current(attempt) },
          })
        }
      })
    },
    [applyFailure, setOverride],
  )

  useEffect(() => {
    runRef.current = run
  }, [run])

  /** Guardar estos valores con el hash de la vista previa que se está mostrando. */
  const submit = useCallback(
    (values: V, hash: string, key: string) => run({ values, hash, key }),
    [run],
  )

  /** Aceptar los avisos y guardar igual. */
  const confirmWarnings = useCallback(() => {
    const attempt = attemptRef.current
    const accepted = warnings ?? []
    setWarnings(null)
    if (!attempt) return
    acksRef.current = [...new Set([...acksRef.current, ...accepted.map((w) => w.key)])]
    run(attempt)
  }, [run, warnings])

  const dismissWarnings = useCallback(() => setWarnings(null), [])

  const clearFieldErrors = useCallback(() => {
    setFieldErrors((prev) => (Object.keys(prev).length === 0 ? prev : {}))
  }, [])

  /** El asiento del servidor que reemplaza al del formulario (si sigue siendo la misma carga). */
  const overrideFor = useCallback(
    (key: string): EntryPreview[] | null =>
      override && override.key === key ? override.preview : null,
    [override],
  )

  /** El «Deshacer» de lo que se acaba de guardar (6 s; la base lo acepta 10 minutos). */
  const undoToast = useCallback(
    (message: string, saved: SavedState) => {
      const documentId = saved.result.documents[0]?.id
      if (!documentId) {
        toast.success(message)
        return
      }
      const slug = optsRef.current.tenantSlug
      toastUndo(message, {
        onUndo: async () => {
          try {
            const undone = await undoDocument(slug, documentId)
            if (undone.ok) {
              toast.success(undone.message)
              router.refresh()
            } else toast.error(undone.message)
          } catch {
            toast.error(ACC_UNREACHABLE.offline)
          }
        },
      })
    },
    [router],
  )

  return {
    pending,
    banner,
    setBanner,
    fieldErrors,
    clearFieldErrors,
    warnings,
    confirmWarnings,
    dismissWarnings,
    overrideFor,
    submit,
    undoToast,
  }
}
