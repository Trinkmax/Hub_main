'use client'

import { useEffect, useMemo, useRef } from 'react'
import { createLiveReload } from './live-reload'

/**
 * La lectura en vivo de una pantalla del punto de venta: `poke` para cuando llega un aviso (se pasa a
 * `usePosPoke`), `now` para leer ya. No pierde avisos que llegan durante una lectura ni lee de más
 * (ver `live-reload.ts`).
 */
export function useLiveReload(
  read: () => Promise<void> | void,
  options: { settleMs?: number; minGapMs?: number } = {},
): { poke: () => void; now: () => Promise<void> } {
  const readRef = useRef(read)
  useEffect(() => {
    readRef.current = read
  }, [read])

  const { settleMs, minGapMs } = options
  const reload = useMemo(
    () => createLiveReload(() => readRef.current(), { settleMs, minGapMs }),
    [settleMs, minGapMs],
  )
  useEffect(() => () => reload.stop(), [reload])

  return useMemo(() => ({ poke: reload.poke, now: reload.now }), [reload])
}
