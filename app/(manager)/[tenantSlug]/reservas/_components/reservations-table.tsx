import { ChevronLeft, ChevronRight, GlassWater } from 'lucide-react'
import Link from 'next/link'
import { Fragment } from 'react'
import { AttendanceCell } from '@/components/reservations/attendance-cell'
import { CakeChip } from '@/components/reservations/cake-chip'
import { ReservationCommentPopover } from '@/components/reservations/comment-popover'
import { ReservationQuickView } from '@/components/reservations/reservation-quick-view'
import { alertRowTint, ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import { ServiceSummary } from '@/components/reservations/service-summary'
import { StatusPill } from '@/components/reservations/status-pill'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { highestSeverity, resolveReservationAlerts } from '@/lib/salon/alerts'
import { formatDayLabel } from '@/lib/salon/date-presets'
import { ARSFormat, endsNextDay } from '@/lib/salon/format'
import { groupByService } from '@/lib/salon/services'
import { MEAL_TYPE_LABELS, type ReservationWithJoins, ZONE_LABELS } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

function formatDate(d: string): string {
  // 'YYYY-MM-DD' → 'dd/MM'
  const [_y, m, day] = d.split('-')
  return `${day}/${m}`
}

function formatTime(t: string): string {
  // 'HH:MM:SS' → 'HH:MM'
  return t.slice(0, 5)
}

function zoneOrEvent(r: ReservationWithJoins): string {
  if (r.zone === 'event_floating') {
    return r.scheduled_event?.template?.name ?? 'Evento'
  }
  return ZONE_LABELS[r.zone]
}

function dayName(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return ''
  const date = new Date(Date.UTC(y, m - 1, day))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    timeZone: 'UTC',
  })
    .format(date)
    .replace('.', '')
}

/** Las canceladas y no-show siguen listándose, pero no ocupan mesa. */
function coversOf(rows: ReservationWithJoins[]): number {
  return rows
    .filter((r) => r.status !== 'cancelled' && r.status !== 'no_show')
    .reduce((acc, r) => acc + (r.actual_guests ?? r.estimated_guests ?? 0), 0)
}

/** Agrupa preservando el orden que vino del server (asc o desc según el modo). */
function groupByDate(
  rows: ReservationWithJoins[],
): Array<{ date: string; rows: ReservationWithJoins[] }> {
  const groups: Array<{ date: string; rows: ReservationWithJoins[] }> = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last && last.date === row.reservation_date) last.rows.push(row)
    else groups.push({ date: row.reservation_date, rows: [row] })
  }
  return groups
}

export function ReservationsTable({
  tenantSlug,
  rows,
  page,
  totalPages,
  totalCount,
  searchParams,
  groupByDay = false,
  highlightId,
  canRecordAttendance = false,
  today,
}: {
  tenantSlug: string
  rows: ReservationWithJoins[]
  page: number
  totalPages: number
  totalCount: number
  searchParams: Record<string, string | string[] | undefined>
  /** Modo rango: subheader por día en vez de repetir la fecha en cada fila. */
  groupByDay?: boolean
  /** Reserva recién creada — se resalta para que se vea de una. */
  highlightId?: string
  /** ¿Este rol puede registrar la asistencia? (`RESERVATION_OPERATOR_ROLES`) */
  canRecordAttendance?: boolean
  /** Hoy en el reloj del local, yyyy-MM-dd: nada a futuro se marca como asistido. */
  today: string
}) {
  const baseQs = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === 'page') continue
    if (typeof v === 'string' && v) baseQs.set(k, v)
  }

  function pageHref(p: number) {
    const qs = new URLSearchParams(baseQs)
    if (p > 1) qs.set('page', String(p))
    const q = qs.toString()
    return `/${tenantSlug}/reservas${q ? `?${q}` : ''}`
  }

  const columnCount = groupByDay ? 8 : 9

  // Dos ejes de lectura, uno por modo:
  //   · rango  → por DÍA (la agenda de la semana se lee día por día)
  //   · día    → por SERVICIO (armar el salón es una decisión por servicio:
  //              la merienda de las 17 y la cena de las 22 no comparten nada)
  const groups = groupByDay
    ? groupByDate(rows).map((g) => ({ key: g.date, date: g.date, bucket: null, rows: g.rows }))
    : groupByService(rows).map((b) => ({
        key: b.mealType,
        date: '',
        bucket: b,
        rows: b.rows,
      }))

  return (
    <DataTableShell>
      <DataTableScroll>
        <DataTableRoot>
          <DataTableHead>
            <tr>
              {groupByDay ? null : <DataTableHeader>Fecha</DataTableHeader>}
              <DataTableHeader>Hora</DataTableHeader>
              <DataTableHeader>Cliente</DataTableHeader>
              <DataTableHeader>Asistieron</DataTableHeader>
              <DataTableHeader>Servicio / Zona</DataTableHeader>
              <DataTableHeader className="text-right">Seña</DataTableHeader>
              <DataTableHeader>Gestor</DataTableHeader>
              <DataTableHeader>Estado</DataTableHeader>
              <DataTableHeader className="w-1 text-right">·</DataTableHeader>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {groups.map((group) => (
              <Fragment key={group.key || 'all'}>
                {group.bucket ? (
                  // Cabecera del servicio: cubiertos + desglose por zona. Es la
                  // respuesta a "¿cuántos tengo en la cena y cuántos van arriba?"
                  <tr className="bg-secondary/40">
                    <th scope="colgroup" colSpan={columnCount} className="px-4 py-2.5 text-left">
                      <ServiceSummary bucket={group.bucket} compact />
                    </th>
                  </tr>
                ) : groupByDay ? (
                  <tr className="bg-secondary/40">
                    <th
                      scope="colgroup"
                      colSpan={columnCount}
                      className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      {formatDayLabel(group.date)}
                      <span className="font-normal normal-case tracking-normal">
                        {' · '}
                        {group.rows.length} {group.rows.length === 1 ? 'reserva' : 'reservas'}
                        {' · '}
                        {coversOf(group.rows)} cubiertos
                        {/* En un rango la fila del día suma servicios distintos:
                            sin el desglose, "38 cubiertos" no dice si es una
                            merienda grande o una cena normal. */}
                        {(() => {
                          const services = groupByService(group.rows)
                          const cakes = services.reduce((acc, b) => acc + b.cakes, 0)
                          const parts: string[] = []
                          if (services.length > 1) {
                            parts.push(...services.map((b) => `${b.label} ${b.covers}`))
                          }
                          // La torta se encarga con días: en la agenda de la
                          // semana tiene que estar en la fila del día, no a dos
                          // clicks adentro.
                          if (cakes > 0) parts.push(`${cakes} ${cakes === 1 ? 'torta' : 'tortas'}`)
                          return parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
                        })()}
                      </span>
                    </th>
                  </tr>
                ) : null}

                {group.rows.map((r) => {
                  // Avisos: los de la reserva más los de la ficha del cliente.
                  const alerts = resolveReservationAlerts(
                    r.service_alerts,
                    r.customer?.service_alerts,
                  )
                  const alertTone = highestSeverity(alerts)
                  return (
                    <DataTableRow
                      key={r.id}
                      className={cn(
                        alertRowTint(alertTone),
                        // El verde de "recién creada" gana: es momentáneo y lo
                        // acaba de provocar el usuario, así que no puede quedar
                        // tapado por el tinte del aviso.
                        r.id === highlightId &&
                          'bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/30',
                      )}
                    >
                      {groupByDay ? null : (
                        <DataTableCell>
                          <div className="flex flex-col leading-tight">
                            <span className="font-medium">{formatDate(r.reservation_date)}</span>
                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                              {dayName(r.reservation_date)}
                            </span>
                          </div>
                        </DataTableCell>
                      )}
                      <DataTableCell className="font-mono text-sm tabular-nums">
                        <div className="flex flex-col leading-tight">
                          <span>{formatTime(r.reservation_time_local)}</span>
                          {r.reservation_end_time_local ? (
                            <span
                              className="text-[11px] text-muted-foreground"
                              title={
                                endsNextDay(r.reservation_time_local, r.reservation_end_time_local)
                                  ? 'Termina a la madrugada del día siguiente'
                                  : 'Hora de finalización'
                              }
                            >
                              → {formatTime(r.reservation_end_time_local)}
                            </span>
                          ) : null}
                        </div>
                      </DataTableCell>
                      <DataTableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex min-w-0 flex-col leading-tight">
                            <span className="font-medium">{r.guest_name}</span>
                            {r.customer ? (
                              <span className="text-[11px] text-muted-foreground">
                                CRM · {r.customer.phone}
                              </span>
                            ) : r.guest_phone ? (
                              <span className="text-[11px] text-muted-foreground">
                                {r.guest_phone}
                              </span>
                            ) : null}
                            <ServiceAlertChips alerts={alerts} className="mt-1" />
                            {/* Antes era un 🎂 sin sabor: decía que hay torta y
                                nunca cuál, y la torta la hace el bar. */}
                            {r.cake_count > 0 ? (
                              <CakeChip
                                count={r.cake_count}
                                option={r.cake_option}
                                optionId={r.cake_option_id}
                                className="mt-1 self-start"
                              />
                            ) : null}
                            {/* Comentario destacado: se lee entero, sin abrir el
                                popover. Es la válvula para lo que no entra en
                                ningún chip ("silla de ruedas eléctrica"). */}
                            {r.highlight_comment && r.comments ? (
                              <span className="mt-1 line-clamp-2 max-w-[28ch] text-[11px] font-medium text-foreground">
                                {r.comments}
                              </span>
                            ) : null}
                          </div>
                          {r.comments ? <ReservationCommentPopover comment={r.comments} /> : null}
                          {r.champagne_count > 0 ? (
                            <GlassWater
                              className="size-3.5 text-amber-500"
                              aria-label={`${r.champagne_count} champagne`}
                            />
                          ) : null}
                        </div>
                      </DataTableCell>
                      <DataTableCell>
                        <AttendanceCell
                          tenantSlug={tenantSlug}
                          reservationId={r.id}
                          status={r.status}
                          estimatedGuests={r.estimated_guests}
                          actualGuests={r.actual_guests}
                          canEdit={canRecordAttendance}
                          isPast={r.reservation_date <= today}
                        />
                      </DataTableCell>
                      <DataTableCell>
                        {/* Servicio + zona en dos líneas: eran dos columnas y la
                            tabla ya scrolleaba de más al sumar la seña. */}
                        <div className="flex flex-col leading-tight">
                          <span className="text-[12px]">{MEAL_TYPE_LABELS[r.meal_type]}</span>
                          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {r.scheduled_event?.template?.color_hex ? (
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: r.scheduled_event.template.color_hex }}
                                aria-hidden
                              />
                            ) : null}
                            {zoneOrEvent(r)}
                          </span>
                        </div>
                      </DataTableCell>
                      <DataTableCell className="text-right font-mono text-sm tabular-nums">
                        {r.deposit_cents > 0 ? (
                          ARSFormat(r.deposit_cents)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </DataTableCell>
                      <DataTableCell>
                        <div className="flex flex-col leading-tight">
                          <span className="text-sm">{r.primary_manager?.display_name ?? '—'}</span>
                          {r.assistant_manager ? (
                            <span className="text-[11px] text-muted-foreground">
                              + {r.assistant_manager.display_name}
                            </span>
                          ) : null}
                        </div>
                      </DataTableCell>
                      <DataTableCell>
                        <StatusPill status={r.status} />
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        <ReservationQuickView tenantSlug={tenantSlug} reservation={r} />
                      </DataTableCell>
                    </DataTableRow>
                  )
                })}
              </Fragment>
            ))}
          </DataTableBody>
        </DataTableRoot>
      </DataTableScroll>
      <DataTableFooter>
        <span>
          {totalCount.toLocaleString('es-AR')} {totalCount === 1 ? 'reserva' : 'reservas'}
        </span>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" disabled={page <= 1}>
            <Link href={pageHref(Math.max(1, page - 1))} aria-label="Página anterior">
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <span className="px-2 tabular-nums">
            {page} / {totalPages}
          </span>
          <Button asChild variant="ghost" size="sm" disabled={page >= totalPages}>
            <Link href={pageHref(Math.min(totalPages, page + 1))} aria-label="Página siguiente">
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
      </DataTableFooter>
    </DataTableShell>
  )
}
