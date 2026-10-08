'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ACC_UNREACHABLE, type AccFailureState } from '@/lib/accounting/action-state'
import { getArcaNextNumber } from '@/lib/arca/emit-actions'
import type { ArcaNextNumber } from '@/lib/arca/emit-form'
import type { CbteTipo } from '@/lib/arca/vouchers'

export type ArcaNextNumberState =
  | { readonly status: 'idle'; readonly data: null; readonly error: null }
  | { readonly status: 'loading'; readonly data: null; readonly error: null }
  | { readonly status: 'ready'; readonly data: ArcaNextNumber; readonly error: null }
  | { readonly status: 'error'; readonly data: null; readonly error: AccFailureState }

const IDLE: ArcaNextNumberState = { status: 'idle', data: null, error: null }
const LOADING: ArcaNextNumberState = { status: 'loading', data: null, error: null }

/**
 * El próximo número de ARCA para un tipo de comprobante (`getArcaNextNumber`): se
 * pide al abrir y cada vez que cambia el tipo, y queda guardado por tipo mientras
 * dura el formulario. `retry` lo vuelve a pedir; `override` lo cambia sin
 * preguntar (cuando la emisión contesta «ahora el número es otro»).
 */
export function useArcaNextNumber(slug: string, cbteTipo: CbteTipo | null, enabled: boolean) {
  const cache = useRef(new Map<number, ArcaNextNumber>())
  // Arranca «cargando» si ya hay tipo: así nadie empieza otra acción antes (van de a una).
  const [state, setState] = useState<ArcaNextNumberState>(() =>
    enabled && cbteTipo !== null ? LOADING : IDLE,
  )
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!enabled || cbteTipo === null) {
      setState(IDLE)
      return
    }
    // `nonce` cambia con «Reintentar»: vuelve a pedirlo aunque esté guardado.
    void nonce
    const cached = cache.current.get(cbteTipo)
    if (cached) {
      setState({ status: 'ready', data: cached, error: null })
      return
    }
    let alive = true
    setState(LOADING)
    getArcaNextNumber(slug, { cbteTipo })
      .then((res) => {
        if (!alive) return
        if (res.ok) {
          cache.current.set(cbteTipo, res.data)
          setState({ status: 'ready', data: res.data, error: null })
        } else {
          setState({ status: 'error', data: null, error: res })
        }
      })
      .catch(() => {
        if (!alive) return
        setState({
          status: 'error',
          data: null,
          error: { ok: false, code: 'error', message: ACC_UNREACHABLE.offline },
        })
      })
    return () => {
      alive = false
    }
  }, [slug, cbteTipo, enabled, nonce])

  const retry = useCallback(() => {
    if (cbteTipo !== null) cache.current.delete(cbteTipo)
    setNonce((n) => n + 1)
  }, [cbteTipo])

  const override = useCallback(
    (tipo: CbteTipo, nextNumber: number) => {
      const prev = cache.current.get(tipo)
      if (!prev) return
      const updated: ArcaNextNumber = { ...prev, nextNumber, lastNumber: nextNumber - 1 }
      cache.current.set(tipo, updated)
      if (tipo === cbteTipo) setState({ status: 'ready', data: updated, error: null })
    },
    [cbteTipo],
  )

  return { ...state, retry, override }
}
