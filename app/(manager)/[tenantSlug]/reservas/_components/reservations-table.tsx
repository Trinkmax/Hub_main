import { GlassWater, Users } from 'lucide-react'
import { AttendanceCell } from '@/components/reservations/attendance-cell'
import { CakeChip } from '@/components/reservations/cake-chip'
import { ReservationCommentPopover } from '@/components/reservations/comment-popover'
import { dayLabel } from '@/components/reservations/day-labels'
import { ReservationQuickView } from '@/components/reservations/reservation-quick-view'
import { alertRowTint, ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import { ServiceSummary } from '@/components/reservations/service-summary'
import { StatusPill } from '@/components/reservations/status-pill'
import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import {
  DataTableBody,
  DataTableCell,
  DataTableGroupRow,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { Pagination } from '@/components/ui/pagination'
import { formatDayMonth, weekdayName } from '@/lib/dates/format'
import { highestSeverity, type ResolvedAlert, resolveReservationAlerts } from '@/lib/salon/alerts'
import { endsNextDay } from '@/lib/salon/format'
import { joinedEventName, placeLabel } from '@/lib/salon/place-label'
import { groupByService, type ServiceBucket } from '@/lib/salon/services'
import { MEAL_TYPE_LABELS, type ReservationWithJoins } from '@/lib/salon/types'
import { makePageHref } from '@/lib/table/pagination'
import { cn } from '@/lib/utils'

function formatTime(t: string): string {
  // 'HH:MM:SS' → 'HH:MM'
  return t.slice(0, 5)
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

type Group = {
  key: string
  date: string
  bucket: ServiceBucket<ReservationWithJoins> | null
  rows: ReservationWithJoins[]
}

/** «Vie 31/07 · 4 reservas · 38 cubiertos · Cena 30 · Merienda 8 · 1 torta». */
function DayGroupLabel({ group }: { group: Group }) {
  // En un rango la fila del día suma servicios distintos: sin el desglose,
  // "38 cubiertos" no dice si es una merienda grande o una cena normal.
  const services = groupByService(group.rows)
  const cakes = services.reduce((acc, b) => acc + b.cakes, 0)
  const parts: string[] = []
  if (services.length > 1) parts.push(...services.map((b) => `${b.label} ${b.covers}`))
  // La torta se encarga con días: en la agenda de la semana tiene que estar en
  // la fila del día, no a dos clicks adentro.
  if (cakes > 0) parts.push(`${cakes} ${cakes === 1 ? 'torta' : 'tortas'}`)
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="type-label text-foreground">{dayLabel(group.date)}</span>
      <span className="type-caption font-normal tabular-nums text-muted-foreground">
        {group.rows.length} {group.rows.length === 1 ? 'reserva' : 'reservas'} ·{' '}
        {coversOf(group.rows)} cubiertos
        {parts.length > 0 ? ` · ${parts.join(' · ')}` : ''}
      </span>
    </span>
  )
}

function GroupLabel({ group }: { group: Group }) {
  // Cabecera del servicio: cubiertos + desglose por zona. Es la respuesta a
  // "¿cuántos tengo en la cena y cuántos van arriba?"
  return group.bucket ? (
    <ServiceSummary bucket={group.bucket} compact />
  ) : (
    <DayGroupLabel group={group} />
  )
}

/** Nombre + mesa + teléfono + avisos + torta + comentario destacado: lo que se lee de una reserva. */
function GuestBlock({
  r,
  alerts,
  showComment,
}: {
  r: ReservationWithJoins
  alerts: ResolvedAlert[]
  showComment: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-foreground">{r.guest_name}</span>
        {r.table_label ? (
          <Badge tone="neutral" appearance="outline" className="tabular-nums">
            M {r.table_label}
          </Badge>
        ) : null}
        {r.comments ? <ReservationCommentPopover comment={r.comments} /> : null}
        {r.champagne_count > 0 ? (
          <span className="inline-flex items-center text-brand-text">
            <GlassWater className="size-3.5" aria-hidden />
            <span className="sr-only">{r.champagne_count} champagne</span>
          </span>
        ) : null}
      </span>
      {r.customer ? (
        <span className="type-caption text-muted-foreground">CRM · {r.customer.phone}</span>
      ) : r.guest_phone ? (
        <span className="type-caption text-muted-foreground">{r.guest_phone}</span>
      ) : null}
      <ServiceAlertChips alerts={alerts} />
      {/* Antes era un 🎂 sin sabor: decía que hay torta y nunca cuál, y la
          torta la hace el bar. */}
      {r.cake_count > 0 ? (
        <CakeChip
          count={r.cake_count}
          option={r.cake_option}
          optionId={r.cake_option_id}
          className="self-start"
        />
      ) : null}
      {/* Comentario destacado: se lee entero, sin abrir el popover. Es la
          válvula para lo que no entra en ningún chip ("silla de ruedas
          eléctrica"). */}
      {showComment && r.highlight_comment && r.comments ? (
        <span className="line-clamp-2 max-w-[32ch] type-caption font-medium text-foreground">
          {r.comments}
        </span>
      ) : null}
    </div>
  )
}

/** Servicio + dónde se sienta en dos líneas (`placeLabel`, igual que el calendario). */
function PlaceBlock({ r }: { r: ReservationWithJoins }) {
  return (
    <div className="flex flex-col">
      <span>{MEAL_TYPE_LABELS[r.meal_type]}</span>
      <span className="flex items-center gap-1.5 type-caption text-muted-foreground">
        {r.scheduled_event?.template?.color_hex ? (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: r.scheduled_event.template.color_hex }}
            aria-hidden
          />
        ) : null}
        {placeLabel(r, joinedEventName(r))}
      </span>
    </div>
  )
}

/**
 * La agenda de reservas: primitivos de la `DataTable` del kit con filas de
 * grupo (por servicio en un día, por día en un rango) y, en el celular, la
 * misma información como tarjetas (doble marcado, CSS puro). Se usan los
 * primitivos y no la tabla declarativa porque cada fila lleva su tinte (el peor
 * aviso de la reserva, o el verde de la recién creada).
 *
 * Server Component: las islas cliente son la asistencia, el comentario y la
 * vista rápida. La paginación es la del kit (links reales; en el extremo, un
 * `<span>` deshabilitado y no un link que se podía tocar igual).
 */
export function ReservationsTable({
  tenantSlug,
  rows,
  page,
  pageSize,
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
  /** Cuántas reservas trae cada página (la de la consulta). */
  pageSize: number
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
  const columnCount = groupByDay ? 8 : 9

  // Dos ejes de lectura, uno por modo:
  //   · rango  → por DÍA (la agenda de la semana se lee día por día)
  //   · día    → por SERVICIO (armar el salón es una decisión por servicio:
  //              la merienda de las 17 y la cena de las 22 no comparten nada)
  const groups: Group[] = groupByDay
    ? groupByDate(rows).map((g) => ({ key: g.date, date: g.date, bucket: null, rows: g.rows }))
    : groupByService(rows).map((b) => ({ key: b.mealType, date: '', bucket: b, rows: b.rows }))

  const rowTint = (r: ReservationWithJoins, alerts: ResolvedAlert[]) =>
    // El verde de "recién creada" gana: es momentáneo y lo acaba de provocar
    // el usuario, así que no puede quedar tapado por el tinte del aviso.
    r.id === highlightId ? 'bg-success-soft' : alertRowTint(highestSeverity(alerts))

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <DataTableShell>
        <DataTableScroll className="max-md:hidden">
          <DataTableRoot caption="Reservas">
            <DataTableHead>
              <tr>
                {groupByDay ? null : <DataTableHeader>Fecha</DataTableHeader>}
                <DataTableHeader>Hora</DataTableHeader>
                <DataTableHeader>Cliente</DataTableHeader>
                <DataTableHeader>Asistieron</DataTableHeader>
                <DataTableHeader>Servicio y zona</DataTableHeader>
                <DataTableHeader numeric>Seña $</DataTableHeader>
                <DataTableHeader>Gestor</DataTableHeader>
                <DataTableHeader>Estado</DataTableHeader>
                <DataTableHeader className="w-1">
                  <span className="sr-only">Acciones</span>
                </DataTableHeader>
              </tr>
            </DataTableHead>
            {groups.map((group) => (
              <DataTableBody key={group.key || 'all'}>
                <DataTableGroupRow label={<GroupLabel group={group} />} colSpan={columnCount} />
                {group.rows.map((r) => {
                  // Avisos: los de la reserva más los de la ficha del cliente.
                  const alerts = resolveReservationAlerts(
                    r.service_alerts,
                    r.customer?.service_alerts,
                  )
                  return (
                    <DataTableRow key={r.id} className={rowTint(r, alerts)}>
                      {groupByDay ? null : (
                        <DataTableCell>
                          <div className="flex flex-col">
                            <span className="font-medium tabular-nums">
                              {formatDayMonth(r.reservation_date)}
                            </span>
                            <span className="type-caption text-muted-foreground">
                              {weekdayName(r.reservation_date)}
                            </span>
                          </div>
                        </DataTableCell>
                      )}
                      <DataTableCell className="tabular-nums">
                        <div className="flex flex-col">
                          <span>{formatTime(r.reservation_time_local)}</span>
                          {r.reservation_end_time_local ? (
                            <span
                              className="type-caption text-muted-foreground"
                              title={
                                endsNextDay(r.reservation_time_local, r.reservation_end_time_local)
                                  ? 'Termina a la madrugada del día siguiente'
                                  : 'Hora de finalización'
                              }
                            >
                              hasta {formatTime(r.reservation_end_time_local)}
                            </span>
                          ) : null}
                        </div>
                      </DataTableCell>
                      <DataTableCell>
                        <GuestBlock r={r} alerts={alerts} showComment />
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
                        <PlaceBlock r={r} />
                      </DataTableCell>
                      <DataTableCell numeric>
                        <Amount
                          cents={r.deposit_cents > 0 ? r.deposit_cents : null}
                          decimals={0}
                          currency={false}
                          emptyText="—"
                          tone={r.deposit_cents > 0 ? 'neutral' : 'muted'}
                        />
                      </DataTableCell>
                      <DataTableCell>
                        <div className="flex flex-col">
                          <span>{r.primary_manager?.display_name ?? '—'}</span>
                          {r.assistant_manager ? (
                            <span className="type-caption text-muted-foreground">
                              + {r.assistant_manager.display_name}
                            </span>
                          ) : null}
                        </div>
                      </DataTableCell>
                      <DataTableCell>
                        <StatusPill status={r.status} />
                      </DataTableCell>
                      <DataTableCell align="end">
                        <ReservationQuickView tenantSlug={tenantSlug} reservation={r} />
                      </DataTableCell>
                    </DataTableRow>
                  )
                })}
              </DataTableBody>
            ))}
          </DataTableRoot>
        </DataTableScroll>

        {/* Celular: la misma agenda como tarjetas, por grupo. Nueve columnas no
            entran en 360 px y scrollear de costado para ver el estado era el
            peor caso de la anfitriona. */}
        <ul aria-label="Reservas" className="divide-y divide-border md:hidden">
          {groups.map((group) => (
            <li key={group.key || 'all'}>
              <div className="bg-muted/60 px-4 py-2.5">
                <GroupLabel group={group} />
              </div>
              <ul className="divide-y divide-border border-t border-border">
                {group.rows.map((r) => {
                  const alerts = resolveReservationAlerts(
                    r.service_alerts,
                    r.customer?.service_alerts,
                  )
                  const editable =
                    canRecordAttendance &&
                    r.reservation_date <= today &&
                    r.status !== 'cancelled' &&
                    r.status !== 'no_show'
                  return (
                    <li key={r.id} className={cn('grid gap-3 px-4 py-3', rowTint(r, alerts))}>
                      <div className="flex items-start gap-3">
                        <span className="w-12 shrink-0 tabular-nums">
                          <span className="block font-medium">
                            {formatTime(r.reservation_time_local)}
                          </span>
                          {groupByDay ? null : (
                            <span className="block type-caption text-muted-foreground">
                              {formatDayMonth(r.reservation_date)}
                            </span>
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <GuestBlock r={r} alerts={alerts} showComment />
                          <div className="mt-1 type-small text-muted-foreground">
                            <PlaceBlock r={r} />
                          </div>
                        </div>
                        <StatusPill status={r.status} className="shrink-0" />
                      </div>
                      {/* «Ver» queda siempre abajo a la derecha: con la seña al lado del
                          contador la fila envolvía y lo mandaba a la izquierda, debajo. */}
                      <div className="flex items-end justify-between gap-2 ps-15">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                          {editable ? (
                            <AttendanceCell
                              tenantSlug={tenantSlug}
                              reservationId={r.id}
                              status={r.status}
                              estimatedGuests={r.estimated_guests}
                              actualGuests={r.actual_guests}
                              canEdit={canRecordAttendance}
                              isPast={r.reservation_date <= today}
                            />
                          ) : (
                            <span className="inline-flex items-center gap-1 type-small tabular-nums text-muted-foreground">
                              <Users className="size-3.5" aria-hidden />
                              {r.actual_guests ?? r.estimated_guests}{' '}
                              {(r.actual_guests ?? r.estimated_guests) === 1
                                ? 'persona'
                                : 'personas'}
                            </span>
                          )}
                          {r.deposit_cents > 0 ? (
                            <span className="type-small text-muted-foreground">
                              Seña <Amount cents={r.deposit_cents} decimals={0} />
                            </span>
                          ) : null}
                        </div>
                        <ReservationQuickView tenantSlug={tenantSlug} reservation={r} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      </DataTableShell>

      {totalCount > pageSize ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={totalCount}
          hrefFor={makePageHref(`/${tenantSlug}/reservas`, searchParams)}
          label="Páginas de reservas"
        />
      ) : null}
    </div>
  )
}
