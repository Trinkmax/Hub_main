import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { z } from 'zod'

// Filtros de la pestaña "Registros de ejecución". Módulo PURO (sin server-only)
// porque lo comparten la page (parseo de searchParams) y la barra de filtros del
// cliente: una sola definición de qué se puede filtrar.

export const TZ = 'America/Argentina/Cordoba'
export const LOG_PAGE_SIZE = 50

/** Ventana por defecto: el último mes, que es lo que el dueño mira al entrar. */
export const DEFAULT_RANGE_DAYS = 30

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()

export const flowLogFiltersSchema = z.object({
  desde: dateField,
  hasta: dateField,
  accion: z
    .enum([
      'enrolled',
      'send_template',
      'wait',
      'condition',
      'add_tag',
      'trigger',
      'completed',
      'failed',
    ])
    .optional(),
  estado: z.enum(['executed', 'waiting', 'skipped', 'error']).optional(),
  contacto: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
})

export type FlowLogFilters = z.infer<typeof flowLogFiltersSchema>

function ymdInTz(date: Date): string {
  const zoned = toZonedTime(date, TZ)
  const y = zoned.getFullYear()
  const m = String(zoned.getMonth() + 1).padStart(2, '0')
  const d = String(zoned.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const base = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/**
 * Convierte el rango de fechas locales (el dueño piensa en días del bar, no en
 * UTC) a instantes para la query. `toIso` es el arranque del día SIGUIENTE a
 * `hasta`, así el filtro `< toIso` incluye el último día completo.
 */
export function resolveLogRange(
  filters: { desde?: string; hasta?: string },
  now: Date = new Date(),
): { desde: string; hasta: string; fromIso: string; toIso: string } {
  const today = ymdInTz(now)
  const hasta = filters.hasta ?? today
  const desde = filters.desde ?? addDaysToYmd(hasta, -(DEFAULT_RANGE_DAYS - 1))
  // Rango dado vuelta (el dueño eligió mal): lo ordenamos en vez de devolver cero filas.
  const [from, to] = desde <= hasta ? [desde, hasta] : [hasta, desde]
  return {
    desde: from,
    hasta: to,
    fromIso: fromZonedTime(`${from}T00:00:00`, TZ).toISOString(),
    toIso: fromZonedTime(`${addDaysToYmd(to, 1)}T00:00:00`, TZ).toISOString(),
  }
}

/** ¿Hay algún filtro puesto a mano, más allá del rango por defecto? */
export function hasActiveLogFilters(filters: FlowLogFilters): boolean {
  return Boolean(
    filters.desde || filters.hasta || filters.accion || filters.estado || filters.contacto,
  )
}
