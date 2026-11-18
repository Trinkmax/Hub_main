/** Cómo viene hoy una sucursal (lib/branches/pulse.ts lo lee de la base). Puro: lo usa también el navegador. */

export type BranchPulse = {
  /** Reservas en pie (sin canceladas ni «no vino»). */
  reservations: number
  /** Personas de esas reservas. */
  guests: number
  /** Fechas de evento de hoy. */
  events: number
}

export type BranchPulses = Record<string, BranchPulse>

/** «12 reservas · 48 personas · 1 evento», o «Sin reservas hoy». */
export function pulseLine(pulse: BranchPulse | undefined): string | null {
  if (!pulse) return null
  if (pulse.reservations === 0 && pulse.events === 0) return 'Hoy sin reservas'
  const parts: string[] = []
  if (pulse.reservations > 0) {
    parts.push(`${pulse.reservations} ${pulse.reservations === 1 ? 'reserva' : 'reservas'}`)
    parts.push(`${pulse.guests} ${pulse.guests === 1 ? 'persona' : 'personas'}`)
  }
  if (pulse.events > 0) parts.push(`${pulse.events} ${pulse.events === 1 ? 'evento' : 'eventos'}`)
  return `Hoy: ${parts.join(' · ')}`
}
