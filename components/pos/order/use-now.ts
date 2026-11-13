'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * La hora de la base, avanzando acá. El reloj del celular puede estar corrido unos minutos, y los
 * relojes de las tandas («hace 9 min») tienen que coincidir con los del mapa y los de cocina.
 */
export function useNow(serverNow: string, everyMs = 15_000): number {
  const offset = useRef(0)
  const [now, setNow] = useState(() => Date.parse(serverNow))

  useEffect(() => {
    offset.current = Date.parse(serverNow) - Date.now()
    setNow(Date.now() + offset.current)
  }, [serverNow])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + offset.current), everyMs)
    return () => window.clearInterval(timer)
  }, [everyMs])

  return now
}
