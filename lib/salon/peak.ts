/**
 * Calcula la ventana de N minutos con más gente simultánea durante el día,
 * asumiendo que cada reserva ocupa `assumedStayMinutes` desde su hora de inicio.
 *
 * Estrategia: line sweep sobre puntos `{minute, delta}`. Procesamos los `-delta`
 * antes que los `+delta` al mismo minuto para que un cierre no se solape con
 * la apertura del siguiente turno y devuelva un pico inflado.
 *
 * Output:
 * - `startMin`/`endMin` en minutos desde medianoche.
 * - `startHHMM`/`endHHMM` ya formateados.
 * - `guests` es el máximo simultáneo durante el intervalo.
 * - `null` si no hay reservas válidas.
 */

export type PeakInput = {
  /** HH:MM o HH:MM:SS — sólo se leen los primeros 5 caracteres */
  time: string
  /** Cantidad de personas a contar; null se cuenta como 0 (skipped) */
  guests: number | null
}

export type PeakWindow = {
  startMin: number
  endMin: number
  startHHMM: string
  endHHMM: string
  guests: number
}

export function computePeakWindow(
  reservations: ReadonlyArray<PeakInput>,
  assumedStayMinutes = 90,
  windowMinutes = 60,
): PeakWindow | null {
  type Event = { minute: number; delta: number }
  const events: Event[] = []

  for (const r of reservations) {
    const guests = Number(r.guests ?? 0)
    if (!Number.isFinite(guests) || guests <= 0) continue
    const m = parseHHMM(r.time)
    if (m === null) continue
    events.push({ minute: m, delta: +guests })
    events.push({ minute: m + assumedStayMinutes, delta: -guests })
  }

  if (events.length === 0) return null

  events.sort((a, b) => {
    if (a.minute !== b.minute) return a.minute - b.minute
    // Procesar bajas antes que altas en el mismo minuto evita contar como
    // simultáneo el cierre exacto con la apertura del siguiente turno.
    return a.delta - b.delta
  })

  let running = 0
  let maxRunning = 0
  let peakStart = 0

  for (const e of events) {
    running += e.delta
    if (running > maxRunning) {
      maxRunning = running
      peakStart = e.minute
    }
  }

  if (maxRunning <= 0) return null

  // La ventana de "1h pico" arranca al inicio del pico — la lectura intuitiva
  // para un operador. Si el pico dura menos de windowMinutes, la ventana
  // mostrará todo el pico + parte del decay; eso es honesto.
  const startMin = peakStart
  const endMin = peakStart + windowMinutes

  return {
    startMin,
    endMin,
    startHHMM: formatHHMM(startMin),
    endHHMM: formatHHMM(endMin),
    guests: maxRunning,
  }
}

function parseHHMM(s: string): number | null {
  if (typeof s !== 'string' || s.length < 4) return null
  const [hStr, mStr] = s.slice(0, 5).split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

function formatHHMM(totalMin: number): string {
  const clamped = ((totalMin % 1440) + 1440) % 1440
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
