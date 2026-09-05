'use client'

import { useEffect, useState } from 'react'
import { boardClockMinutes, nowHHMMInCordoba } from '@/lib/salon/operativo'

/**
 * El reloj del tablero: minutos del día de servicio (ver `boardClockMinutes`)
 * y la hora 'HH:mm' para el marcador de "ahora". Se actualiza cada 30 s —
 * suficiente para que "hace 12 min" no mienta y sin re-renderizar la lista a
 * cada rato. `null` cuando la fecha que se mira no es la de hoy.
 *
 * Arranca en `null` también en el primer render del cliente: el server no sabe
 * qué hora es en el dispositivo y así no hay desajuste de hidratación.
 */
export function useBoardClock(date: string): { minutes: number | null; hhmm: string | null } {
  const [clock, setClock] = useState<{ minutes: number | null; hhmm: string | null }>({
    minutes: null,
    hhmm: null,
  })

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const minutes = boardClockMinutes(date, now)
      setClock({ minutes, hhmm: minutes === null ? null : nowHHMMInCordoba(now) })
    }
    tick()
    const id = window.setInterval(tick, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [date])

  return clock
}
