'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SheetLoad } from './types'

const OFFLINE_READ = 'Sin conexión: no pudimos cargar esto. Probá de nuevo.'

export type SheetLoadState<T> =
  | { status: 'idle'; data: null }
  | { status: 'loading'; data: T | null }
  | { status: 'ready'; data: T }
  | { status: 'error'; data: T | null; message: string }

/**
 * Trae los datos de una hoja al abrirse (y cada vez que cambia `key`). Sin
 * `load` no pide nada (`idle`). Una respuesta vieja nunca pisa a una nueva.
 * `reload()` vuelve a pedir; con `silent` mantiene lo que se ve mientras tanto.
 */
export function useSheetLoad<T>(load: (() => Promise<SheetLoad<T>>) | null, key: string) {
  const [state, setState] = useState<SheetLoadState<T>>(
    load ? { status: 'loading', data: null } : { status: 'idle', data: null },
  )
  const [nonce, setNonce] = useState(0)
  const silentRef = useRef(false)
  const loadRef = useRef(load)
  loadRef.current = load

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` y `nonce` deciden cuándo volver a pedir
  useEffect(() => {
    const run = loadRef.current
    if (!run) {
      setState((prev) => (prev.status === 'idle' ? prev : { status: 'idle', data: null }))
      return
    }
    let alive = true
    if (!silentRef.current) {
      setState((prev) => ({ status: 'loading', data: prev.status === 'idle' ? null : prev.data }))
    }
    silentRef.current = false
    run()
      .then((result) => {
        if (!alive) return
        setState((prev) =>
          result.ok
            ? { status: 'ready', data: result.data }
            : {
                status: 'error',
                data: prev.status === 'idle' ? null : prev.data,
                message: result.message,
              },
        )
      })
      .catch(() => {
        if (!alive) return
        setState((prev) => ({
          status: 'error',
          data: prev.status === 'idle' ? null : prev.data,
          message: OFFLINE_READ,
        }))
      })
    return () => {
      alive = false
    }
  }, [key, nonce])

  const reload = useCallback((opts: { silent?: boolean } = {}) => {
    silentRef.current = opts.silent === true
    setNonce((n) => n + 1)
  }, [])

  return { ...state, reload }
}
