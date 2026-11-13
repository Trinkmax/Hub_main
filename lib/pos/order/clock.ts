/**
 * Horas para mostrar — PURO.
 *
 * Se arman a mano con las partes de `Intl` (no con la cadena ya formateada): el servidor y el
 * celular tienen que escribir exactamente lo mismo, y el reloj siempre es el del bar, no el del
 * teléfono.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** «21:34» en la zona horaria del bar. Vacío si la fecha no se puede leer. */
export function clockAt(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = formatterFor(timeZone).formatToParts(date)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Minutos enteros desde un instante (nunca negativos). `null` si no hay desde cuándo. */
export function minutesSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((nowMs - t) / 60_000))
}
