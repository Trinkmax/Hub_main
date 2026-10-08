'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { newClientRef } from '@/components/administracion/cajas-ventas/client-ref'
import type { AccFailureState } from '@/lib/accounting/action-state'
import type { WarningCopy } from '@/lib/accounting/errors'
import type { EntryPreview, WarningKey } from '@/lib/accounting/types'
import { emitArcaSalesVoucher } from '@/lib/arca/emit-actions'
import type { ArcaEmitResult, ArcaEmitValues } from '@/lib/arca/emit-form'
import type { CbteTipo } from '@/lib/arca/vouchers'

/** Después de un corte o de una emisión sin asiento: no se puede volver a emitir desde este formulario. */
export type ArcaLock =
  | {
      readonly kind: 'unknown'
      readonly voucherId: string | null
      readonly label: string | null
      readonly message: string
    }
  | {
      readonly kind: 'not_posted'
      readonly voucherId: string
      readonly label: string
      readonly cae: string | null
      readonly message: string
    }

export type ArcaBanner = { readonly tone: 'error' | 'info'; readonly state: AccFailureState }

type Attempt = {
  readonly values: Omit<ArcaEmitValues, 'clientRef' | 'previewHash' | 'warningsAck'>
  readonly key: string
  readonly hash: string
}

type Override = { readonly key: string; readonly preview: EntryPreview[]; readonly hash: string }

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * El envío de «La emito ahora con ARCA» (diseño §3.2.2):
 *
 * 1. Los avisos del asiento se confirman antes (como al guardar cualquier comprobante).
 * 2. «¿Emitimos la factura?» y recién ahí `emitArcaSalesVoucher`, con la misma
 *    referencia del formulario en cada intento: si se corta la respuesta, el
 *    reintento no emite dos veces (la acción la reconoce).
 * 3. Lo que vuelve:
 *    - emitida → `onEmitted`;
 *    - ARCA da otro número → `onNumberChanged` y aviso (la vista previa se rearma sola);
 *    - cambió algo de la base → la vista previa del servidor hasta que se toque algo;
 *    - no se sabe si se emitió, o se emitió y falta el asiento → **bloqueo**
 *      (`lock`): el formulario ya no emite y ofrece verificar o cargarla;
 *    - lo demás → errores por campo y el aviso con «Cómo se arregla».
 */
export function useArcaEmission(opts: {
  readonly tenantSlug: string
  readonly onNumberChanged: (cbteTipo: CbteTipo, nextNumber: number) => void
  readonly onEmitted: (data: ArcaEmitResult, message: string) => void
  /** Volver a pedir la página (para que aparezca lo que quedó en verificación). */
  readonly onRefresh?: () => void
}) {
  const [clientRef] = useState(newClientRef)
  const [pending, start] = useTransition()
  const [banner, setBanner] = useState<ArcaBanner | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [warnings, setWarnings] = useState<WarningCopy[] | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [override, setOverride] = useState<Override | null>(null)
  const [lock, setLock] = useState<ArcaLock | null>(null)
  const acks = useRef<WarningKey[]>([])
  const attempt = useRef<Attempt | null>(null)
  /** Los avisos que se están mostrando vinieron de la acción (ya se confirmó «Emitir»). */
  const resendAfterWarnings = useRef(false)
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const handle = useCallback((res: Awaited<ReturnType<typeof emitArcaSalesVoucher>>) => {
    const current = attempt.current
    if (res.ok) {
      setConfirming(false)
      setBanner(null)
      setFieldErrors({})
      optsRef.current.onEmitted(res.data, res.message)
      return
    }
    setConfirming(false)
    const key = text(res.detail?.key)
    const voucherId = text(res.detail?.voucher_id)
    const nothingEmitted = res.detail?.nothing_emitted === true
    if (
      key === 'arca_unknown_state' ||
      (key === 'arca_in_flight' && voucherId && !nothingEmitted)
    ) {
      setLock({ kind: 'unknown', voucherId, label: text(res.detail?.label), message: res.message })
      return
    }
    if (key === 'arca_in_flight' && nothingEmitted) {
      // Otra factura de este tipo quedó en verificación: que se vea arriba para verificarla.
      optsRef.current.onRefresh?.()
    }
    if (key === 'arca_authorized_not_posted' && voucherId) {
      setLock({
        kind: 'not_posted',
        voucherId,
        label: text(res.detail?.label) ?? 'La factura',
        cae: text(res.detail?.cae),
        message: res.message,
      })
      return
    }
    if (key === 'arca_number_changed') {
      const next = res.detail?.next_number
      const tipo = res.detail?.cbte_tipo
      if (typeof next === 'number' && typeof tipo === 'number') {
        optsRef.current.onNumberChanged(tipo as CbteTipo, next)
      }
      setFieldErrors({})
      setBanner({ tone: 'info', state: res })
      return
    }
    if (res.code === 'preview_stale' && res.preview && res.hash && current) {
      setOverride({ key: current.key, preview: res.preview, hash: res.hash })
      setFieldErrors({})
      setBanner({ tone: 'info', state: res })
      return
    }
    if (res.code === 'needs_confirmation' && res.warnings && res.warnings.length > 0) {
      resendAfterWarnings.current = true
      setWarnings(res.warnings)
      return
    }
    setFieldErrors(res.fieldErrors ?? {})
    setBanner({ tone: 'error', state: res })
  }, [])

  const emit = useCallback(() => {
    const current = attempt.current
    if (!current) return
    setBanner(null)
    start(async () => {
      try {
        const res = await emitArcaSalesVoucher(optsRef.current.tenantSlug, {
          ...current.values,
          clientRef,
          previewHash: override && override.key === current.key ? override.hash : current.hash,
          warningsAck: acks.current,
        } as ArcaEmitValues)
        handle(res)
      } catch {
        setConfirming(false)
        setBanner({
          tone: 'error',
          state: {
            ok: false,
            code: 'error',
            message:
              'Se cortó la conexión y no sabemos si llegó a ARCA. Tocá «Reintentar»: si ya se emitió, no se emite de nuevo.',
            detail: { key: 'offline', retry: true },
          },
        })
      }
    })
  }, [clientRef, handle, override])

  /** «Emitir»: primero los avisos del asiento que falten aceptar; después la confirmación. */
  const request = useCallback(
    (
      values: Attempt['values'],
      preview: {
        readonly key: string
        readonly hash: string
        readonly warnings: readonly WarningCopy[]
      },
    ) => {
      attempt.current = { values, key: preview.key, hash: preview.hash }
      setBanner(null)
      const unacked = preview.warnings.filter((w) => !acks.current.includes(w.key))
      if (unacked.length > 0) {
        resendAfterWarnings.current = false
        setWarnings(unacked)
        return
      }
      setConfirming(true)
    },
    [],
  )

  const confirmWarnings = useCallback(() => {
    const accepted = warnings ?? []
    acks.current = [...new Set([...acks.current, ...accepted.map((w) => w.key)])]
    setWarnings(null)
    if (resendAfterWarnings.current) {
      resendAfterWarnings.current = false
      emit()
    } else {
      setConfirming(true)
    }
  }, [emit, warnings])

  const overrideFor = useCallback(
    (key: string): EntryPreview[] | null =>
      override && override.key === key ? override.preview : null,
    [override],
  )

  const clearFieldError = useCallback((key: string) => {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  return {
    pending,
    banner,
    setBanner,
    fieldErrors,
    clearFieldError,
    warnings,
    dismissWarnings: () => setWarnings(null),
    confirmWarnings,
    confirming,
    setConfirming,
    request,
    emit,
    retry: emit,
    overrideFor,
    lock,
    setLock,
  }
}
