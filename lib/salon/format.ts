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
  const minutes = Math.max(0, Math.round((Date.now() - new Date(openedAt).getTime()) / 60000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
}
