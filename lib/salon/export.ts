/**
 * Exportar el listado de reservas a una planilla.
 *
 * Lo pidió el dueño así: "todo el listado, ordenado por hora y
 * alfabéticamente". Es una planilla para imprimir o compartir con el equipo,
 * no un dump técnico: columnas con nombre en castellano, fechas dd/MM/yyyy,
 * plata en pesos, estados y avisos con las palabras que usa el bar.
 *
 * Puro: sin DB ni React, se testea con fixtures.
 */

import { rowsToCsv } from '@/lib/stats/csv'
import { resolveReservationAlerts, SERVICE_ALERT_META } from './alerts'
import { serviceMinutes } from './operativo'
import {
  describeCake,
  MEAL_TYPE_LABELS,
  ORIGIN_LABELS,
  RESERVATION_KIND_LABELS,
  type ReservationWithJoins,
  STATUS_LABELS,
  ZONE_LABELS,
} from './types'

export const EXPORT_HEADERS = [
  'Fecha',
  'Hora',
  'Hasta',
  'Cliente',
  'Teléfono',
  'Personas',
  'Asistieron',
  'Servicio',
  'Zona',
  'Evento',
  'Mesa',
  'Tipo',
  'Torta',
  'Champagne',
  'Seña ($)',
  'Origen',
  'Gestor',
  'Asistente',
  'Estado',
  'Avisos',
  'Comentario',
  'Llegó a las',
] as const

/**
 * Orden de lectura de la planilla: fecha, hora (la madrugada al final de su
 * noche) y nombre. A igual hora dos reservas se leen en orden alfabético, que
 * es como la anfitriona las busca cuando llega la gente.
 */
export function sortForExport<T extends ReservationWithJoins>(rows: ReadonlyArray<T>): T[] {
  return [...rows].sort((a, b) => {
    if (a.reservation_date !== b.reservation_date)
      return a.reservation_date < b.reservation_date ? -1 : 1
    const ta = serviceMinutes(a.reservation_time_local)
    const tb = serviceMinutes(b.reservation_time_local)
    if (ta !== tb) return ta - tb
    return a.guest_name.localeCompare(b.guest_name, 'es-AR', { sensitivity: 'base' })
  })
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function fmtTime(t: string | null): string {
  return t ? t.slice(0, 5) : ''
}

function fmtStamp(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Argentina/Cordoba',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

/** Una fila de la planilla, en el orden de `EXPORT_HEADERS`. */
export function reservationToExportRow(r: ReservationWithJoins): string[] {
  const alerts = resolveReservationAlerts(r.service_alerts, r.customer?.service_alerts)
  const event = r.scheduled_event?.template?.name ?? ''
  const zone = r.zone === 'event_floating' ? 'Evento' : ZONE_LABELS[r.zone]
  const cake =
    r.cake_count > 0
      ? `${r.cake_count > 1 ? `${r.cake_count} × ` : ''}${
          r.cake_option ? describeCake(r.cake_option) : 'sin elegir'
        }`
      : ''
  return [
    fmtDate(r.reservation_date),
    fmtTime(r.reservation_time_local),
    fmtTime(r.reservation_end_time_local),
    r.guest_name,
    r.customer?.phone ?? r.guest_phone ?? '',
    String(r.estimated_guests),
    r.actual_guests === null ? '' : String(r.actual_guests),
    MEAL_TYPE_LABELS[r.meal_type],
    zone,
    event,
    r.table_label ?? '',
    r.kind === 'normal' ? '' : RESERVATION_KIND_LABELS[r.kind],
    cake,
    r.champagne_count > 0 ? String(r.champagne_count) : '',
    // Pesos, no centavos: es lo que el dueño suma en la planilla.
    r.deposit_cents > 0 ? String(Math.round(r.deposit_cents / 100)) : '',
    ORIGIN_LABELS[r.origin],
    r.primary_manager?.display_name ?? '',
    r.assistant_manager?.display_name ?? '',
    STATUS_LABELS[r.status],
    alerts.map((a) => SERVICE_ALERT_META[a.alert].label).join(', '),
    (r.comments ?? '').replace(/\s+/g, ' ').trim(),
    fmtStamp(r.arrived_at),
  ]
}

/**
 * La planilla entera: ordenada, con BOM y `;` para que Excel en español la
 * abra en columnas y con tildes.
 */
export function reservationsToCsv(rows: ReadonlyArray<ReservationWithJoins>): string {
  return rowsToCsv([...EXPORT_HEADERS], sortForExport(rows).map(reservationToExportRow), {
    separator: ';',
    bom: true,
  })
}

/** `reservas-hub-2026-09-05.csv` / `reservas-hub-2026-09-01_2026-09-30.csv`. */
export function exportFilename(slug: string, range: { from?: string; to?: string }): string {
  const { from, to } = range
  const period = from && to && from !== to ? `${from}_${to}` : (from ?? to ?? 'todas')
  return `reservas-${slug}-${period}.csv`
}
