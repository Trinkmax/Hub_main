'use client'

/**
 * El envío de un formulario contable (G.3 · G.6), igual para las hojas y las
 * pantallas de carga de Ventas y Cajas:
 *
 * 1. Los avisos que la vista previa ya conoce (caja en descubierto, facturado
 *    de más…) se confirman ANTES de mandar nada: diálogo con todos juntos.
 * 2. Manda los valores (centavos) con el `clientRef` del formulario, el hash
 *    de la vista previa que vio la persona y los avisos que ya aceptó.
 * 3. `needs_confirmation` (avisos que solo ve la base) → el mismo diálogo; al
 *    aceptarlos se reenvía lo mismo con sus claves en `warningsAck`.
 * 4. `preview_stale` → la vista previa nueva del servidor reemplaza a la del
 *    formulario hasta que se toque algo; guardar de nuevo usa su hash.
 * 5. Cualquier otro error → errores por campo + un aviso arriba de los botones.
 * 6. Sin conexión → «Sin conexión: no se guardó…» [Reintentar] con el mismo
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
import { newClientRef } from './client-ref'

export type PostingBanner = {
  tone: 'error' | 'warning' | 'info'
  message: string
  action?: { label: string; run: () => void }
}

export type SavedState = Extract<AccActionState, { ok: true }>

/**
 * Los valores de un formulario: los mismos que ya validó la vista previa con
 * el esquema zod de la acción (`previewDocumentForm`). El servidor los vuelve
 * a validar con ese esquema.
 */
export type FormValues = Readonly<Record<string, unknown>>

type Attempt = { values: FormValues; hash: string; key: string }

type Override = { key: string; preview: EntryPreview[]; hash: string }

export type PostingOptions<I> = {
  tenantSlug: string
  action: (slug: string, input: I) => Promise<AccActionState>
  onSaved: (saved: SavedState) => void
  /** Para mover el foco al primer campo con error. */
  formRef?: RefObject<HTMLElement | null>
  /** Los campos que el formulario dibuja (para no repetir arriba lo que ya se ve en su lugar). */
  isKnownField?: (key: string) => boolean
  /** Cualquier error (p. ej. `stale` de un saldo: recargar lo que se mostró). */
  onFailure?: (state: AccFailureState) => void
}

const REVIEW_MESSAGE = 'Revisá lo marcado en rojo.'

export function usePosting<I>(opts: PostingOptions<I>) {
  const [pending, startTransition] = useTransition()
  const [banner, setBanner] = useState<PostingBanner | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [warnings, setWarnings] = useState<WarningCopy[] | null>(null)
  const [override, setOverrideState] = useState<Override | null>(null)

  // Lo que necesitan las funciones asíncronas sin quedar atadas a un render viejo.
  const acksRef = useRef<WarningKey[]>([])
  const attemptRef = useRef<Attempt | null>(null)
  const overrideRef = useRef<Override | null>(null)
  const optsRef = useRef(opts)
  const [firstClientRef] = useState(newClientRef)
  // Un UUID por carga: se mantiene entre reintentos y confirmaciones; cambia al guardar.
  const clientRefRef = useRef(firstClientRef)
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

  const runRef = useRef<(attempt: Attempt) => void>(() => {})

  const applyFailure = useCallback(
    (state: AccFailureState, attempt: Attempt) => {
      optsRef.current.onFailure?.(state)
      if (state.code === 'needs_confirmation' && state.warnings && state.warnings.length > 0) {
        attemptRef.current = attempt
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
    (attempt: Attempt) => {
      attemptRef.current = attempt
      setBanner(null)
      startTransition(async () => {
        const { tenantSlug, action, onSaved } = optsRef.current
        try {
          const current = overrideRef.current
          const previewHash = current && current.key === attempt.key ? current.hash : attempt.hash
          // Los valores del formulario (ya validados por la vista previa) + lo que agrega el envío.
          const input = {
            ...attempt.values,
            clientRef: clientRefRef.current,
            previewHash,
            warningsAck: acksRef.current,
          } as unknown as I
          const result = await action(tenantSlug, input)
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

  /**
   * Guardar estos valores con la vista previa que se está mostrando. Si la
   * vista previa trae avisos que todavía no se aceptaron, primero se muestran.
   */
  const submit = useCallback(
    (
      values: FormValues,
      preview: { hash: string; warnings: readonly WarningCopy[] },
      key: string,
    ) => {
      const attempt: Attempt = { values, hash: preview.hash, key }
      const unacked = preview.warnings.filter((w) => !acksRef.current.includes(w.key))
      if (unacked.length > 0) {
        attemptRef.current = attempt
        setBanner(null)
        setWarnings(unacked)
        return
      }
      run(attempt)
    },
    [run],
  )

  /** Aceptar los avisos y guardar igual (con algo más, p. ej. el motivo de un override). */
  const confirmWarnings = useCallback(
    (patch?: FormValues) => {
      const attempt = attemptRef.current
      const accepted = warnings ?? []
      setWarnings(null)
      if (!attempt) return
      acksRef.current = [...new Set([...acksRef.current, ...accepted.map((w) => w.key)])]
      run({ ...attempt, values: patch ? { ...attempt.values, ...patch } : attempt.values })
    },
    [run, warnings],
  )

  const dismissWarnings = useCallback(() => setWarnings(null), [])

  const clearFieldError = useCallback((key: string) => {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  /** La vista previa del servidor que reemplaza a la del formulario (si sigue siendo la misma carga). */
  const overrideFor = useCallback(
    (key: string): EntryPreview[] | null =>
      override && override.key === key ? override.preview : null,
    [override],
  )

  return {
    pending,
    banner,
    setBanner,
    fieldErrors,
    clearFieldError,
    warnings,
    confirmWarnings,
    dismissWarnings,
    overrideFor,
    submit,
  }
}

/**
 * El «Deshacer» de lo que se acaba de guardar (6 s; la base lo acepta 10
 * minutos): anula todo el envío con `undoDocument`.
 */
export function useUndoToast(tenantSlug: string) {
  const router = useRouter()
  return useCallback(
    (message: string, saved: SavedState) => {
      const documentId = saved.result.documents[0]?.id
      if (!documentId) {
        toast.success(message)
        return
      }
      toastUndo(message, {
        onUndo: async () => {
          try {
            const undone = await undoDocument(tenantSlug, documentId)
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
    [router, tenantSlug],
  )
}
