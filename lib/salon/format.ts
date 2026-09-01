/**
 * Helpers de formato compartidos entre la grilla de salón (staff) y
 * la tarjeta de mesa en vivo (live-table-card) del floor plan.
 *
 * Puros — sin dependencias de React ni de servidor.
 */

/**
 * Formatea `cents` (bigint-compatible, number en runtime) a moneda ARS
 * sin decimales. Ej: 1500_00 → "$150.000".
 *
 * Divide por 100 para convertir centavos a pesos.
 */
export function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

/**
 * Devuelve una etiqueta de tiempo transcurrido desde `openedAt` hasta ahora.
 * Ejemplos: "5 min", "1h", "2h 30m".
 *
 * Nunca devuelve negativo (usa Math.max(0, ...)).
 */
export function elapsedLabel(openedAt: string): string {
  return durationLabel(Math.max(0, Math.round((Date.now() - new Date(openedAt).getTime()) / 60000)))
}

/** `150` → `"2h 30m"`, `120` → `"2h"`, `45` → `"45 min"`. */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
}

/**
 * `"21:30:00"` → `"21:30"`. Las horas de reserva vienen como `time` de Postgres.
 */
export function hhmm(time: string): string {
  return time.slice(0, 5)
}

/**
 * Etiqueta del horario de una reserva: `"21:30 – 00:30"` si tiene hora de fin
 * cargada, `"21:30"` si no. El fin es opcional y en la mayoría de las reservas
 * no está, así que el caso sin fin tiene que verse exactamente como antes.
 */
export function timeRangeLabel(start: string, end?: string | null): string {
  return end ? `${hhmm(start)} – ${hhmm(end)}` : hhmm(start)
}

/**
 * ¿La hora de fin cae en la madrugada del día siguiente?
 *
 * En un bar que cierra tarde, una cena 21:30 → 00:30 es la noche típica: por eso
 * no validamos "fin > inicio". Cuando el fin es menor o igual al inicio se
 * entiende como el día siguiente, y quien lo muestre tiene que aclararlo — si
 * no, "21:30 – 00:30" se lee como un error de carga.
 */
export function endsNextDay(start: string, end?: string | null): boolean {
  if (!end) return false
  return hhmm(end) <= hhmm(start)
}

/**
 * Cuánto dura la mesa, en minutos, según el horario cargado. `null` si no hay
 * hora de fin.
 *
 * Cruza medianoche sin drama (21:30 → 00:30 son 180 minutos). Fin igual al
 * inicio se lee como 24 h, que es lo que dice el comentario de la columna en la
 * DB — y también la señal más clara de que alguien se equivocó al cargar.
 */
export function tableSpanMinutes(start: string, end?: string | null): number | null {
  if (!end) return null
  const toMin = (t: string) => {
    const [h, m] = hhmm(t).split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }
  const raw = (toMin(end) - toMin(start) + 1440) % 1440
  return raw === 0 ? 1440 : raw
}

/**
 * Un tramo tan largo que casi seguro es un dedazo (quisieron poner 00:00 y
 * pusieron 20:00, o invirtieron los campos). No lo bloqueamos —un evento privado
 * puede durar mucho— pero avisamos: si no, una frase tranquilizadora tapa el
 * error en vez de mostrarlo.
 */
export const IMPLAUSIBLE_SPAN_MINUTES = 8 * 60

export function isImplausibleSpan(start: string, end?: string | null): boolean {
  const span = tableSpanMinutes(start, end)
  return span !== null && span > IMPLAUSIBLE_SPAN_MINUTES
}
