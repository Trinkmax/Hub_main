'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SheetResult } from '../_lib/sheet-types'

const OFFLINE_READ = 'Sin conexión: no pudimos cargar esto. Probá de nuevo.'

export type SheetDataState<T> =
  | { status: 'loading'; data: T | null; message: null }
  | { status: 'ready'; data: T; message: null }
  | { status: 'error'; data: T | null; message: string }

/**
 * Trae los datos de un formulario al abrirse y cada vez que cambia `key`. Una
 * respuesta vieja nunca pisa a una nueva. `reload()` vuelve a pedir; lo que ya
 * se veía se mantiene mientras tanto (sin parpadeo). Con `load = null` no pide
 * nada y queda en `loading` sin datos.
 */
export function useSheetData<T>(load: (() => Promise<SheetResult<T>>) | null, key: string) {
  const [state, setState] = useState<SheetDataState<T>>({
    status: 'loading',
    data: null,
    message: null,
  })
  const [nonce, setNonce] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` y `nonce` deciden cuándo volver a pedir
  useEffect(() => {
    const run = loadRef.current
    if (!run) return
    let alive = true
    setState((prev) => ({ status: 'loading', data: prev.data, message: null }))
    run()
      .then((result) => {
        if (!alive) return
        setState((prev) =>
          result.ok
            ? { status: 'ready', data: result.data, message: null }
            : { status: 'error', data: prev.data, message: result.message },
        )
      })
      .catch(() => {
        if (!alive) return
        setState((prev) => ({ status: 'error', data: prev.data, message: OFFLINE_READ }))
      })
    return () => {
      alive = false
    }
  }, [key, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, reload }
}
