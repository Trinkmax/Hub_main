import { Cake, ChevronLeft, ChevronRight, GlassWater, Users } from 'lucide-react'
import Link from 'next/link'
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
import { MEAL_TYPE_LABELS, type ReservationWithJoins, ZONE_LABELS } from '@/lib/salon/types'
import { StatusPill } from './status-pill'

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

export function ReservationsTable({
  tenantSlug,
  rows,
  page,
  totalPages,
  totalCount,
  searchParams,
}: {
  tenantSlug: string
  rows: ReservationWithJoins[]
  page: number
  totalPages: number
  totalCount: number
  searchParams: Record<string, string | string[] | undefined>
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

  return (
    <DataTableShell>
      <DataTableScroll>
        <DataTableRoot>
          <DataTableHead>
            <tr>
              <DataTableHeader>Fecha</DataTableHeader>
              <DataTableHeader>Hora</DataTableHeader>
              <DataTableHeader>Cliente</DataTableHeader>
              <DataTableHeader>Personas</DataTableHeader>
              <DataTableHeader>Tipo</DataTableHeader>
              <DataTableHeader>Zona / Evento</DataTableHeader>
              <DataTableHeader>Gestor</DataTableHeader>
              <DataTableHeader>Estado</DataTableHeader>
              <DataTableHeader className="w-1 text-right">·</DataTableHeader>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {rows.map((r) => {
              const guestsLabel = r.actual_guests ?? r.estimated_guests
              const guestsHint =
                r.actual_guests !== null && r.actual_guests !== r.estimated_guests
                  ? ` (est ${r.estimated_guests})`
                  : ''
              return (
                <DataTableRow key={r.id}>
                  <DataTableCell>
                    <div className="flex flex-col leading-tight">
                      <span className="font-medium">{formatDate(r.reservation_date)}</span>
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {dayName(r.reservation_date)}
                      </span>
                    </div>
                  </DataTableCell>
                  <DataTableCell className="font-mono text-sm tabular-nums">
                    {formatTime(r.reservation_time_local)}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col leading-tight">
                        <span className="font-medium">{r.guest_name}</span>
                        {r.customer ? (
                          <span className="text-[11px] text-muted-foreground">
                            CRM · {r.customer.phone}
                          </span>
                        ) : r.guest_phone ? (
                          <span className="text-[11px] text-muted-foreground">{r.guest_phone}</span>
                        ) : null}
                      </div>
                      {r.cake_count > 0 ? (
                        <Cake
                          className="size-3.5 text-pink-500"
                          aria-label={`${r.cake_count} torta(s)`}
                        />
                      ) : null}
                      {r.champagne_count > 0 ? (
                        <GlassWater
                          className="size-3.5 text-amber-500"
                          aria-label={`${r.champagne_count} champagne`}
                        />
                      ) : null}
                    </div>
                  </DataTableCell>
                  <DataTableCell>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Users className="size-3.5 text-muted-foreground" />
                      <span className="font-semibold">{guestsLabel}</span>
                      <span className="text-[11px] text-muted-foreground">{guestsHint}</span>
                    </span>
                  </DataTableCell>
                  <DataTableCell className="text-[12px]">
                    {MEAL_TYPE_LABELS[r.meal_type]}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex items-center gap-2">
                      {r.scheduled_event?.template?.color_hex ? (
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: r.scheduled_event.template.color_hex }}
                          aria-hidden
                        />
                      ) : null}
                      <span className="text-sm">{zoneOrEvent(r)}</span>
                    </div>
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
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/${tenantSlug}/reservas/${r.id}`}>Ver</Link>
                    </Button>
                  </DataTableCell>
                </DataTableRow>
              )
            })}
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
