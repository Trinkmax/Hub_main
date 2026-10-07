import { ChevronRight, CircleCheck } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  type DayCloses,
  type DayStatus,
  dayStatus,
} from '@/components/administracion/cajas-ventas/closes'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import {
  capitalizeFirst,
  formatDayLabel,
  formatLongDate,
  WEEKDAY_NAMES,
  WEEKDAY_NAMES_SHORT,
} from '@/lib/dates'
import { calendarWeeks } from '@/lib/dates/calendar-grid'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'

/** Lunes primero, como el cierre de Thinkeon y el resto del panel. */
const HEADERS = [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
  short: capitalizeFirst(WEEKDAY_NAMES_SHORT[weekday] ?? ''),
  long: WEEKDAY_NAMES[weekday] ?? '',
}))

type CalendarProps = {
  /** `yyyy-MM`. */
  month: string
  closes: ReadonlyMap<string, DayCloses>
  booksStart: string
  serviceDay: string
  today: string
  base: string
  canWrite: boolean
  exportHref: string
  exportFileName: string
}

/** Lo que se dice de un día, para el link y para lectores de pantalla. */
function describe(day: string, status: DayStatus): string {
  const label = capitalizeFirst(formatLongDate(day))
  switch (status.kind) {
    case 'closed':
      return `${label}: cierre cargado, ${formatCentsShort(status.closes.totalCents)}`
    case 'missing':
      return `${label}: falta el cierre`
    case 'in-progress':
      return `${label}: día en curso`
    default:
      return label
  }
}

/**
 * Los cierres del mes (H.9): cada día «✓ $ 1.325.000» o «● Falta». En la
 * compu es un calendario; en el celular, una lista de días (del más nuevo al
 * más viejo). Un día cargado lleva a su comprobante; uno que falta, a cargarlo.
 */
export function ClosesCalendar(props: CalendarProps) {
  const { month, closes, booksStart, serviceDay, base, canWrite, exportHref, exportFileName } =
    props
  const weeks = calendarWeeks(month, { fixedWeeks: false })
  const ctx = { closes, booksStart, serviceDay }
  const listDays = weeks
    .flat()
    .filter((d) => d.inMonth && d.iso >= booksStart && d.iso <= serviceDay)
    .map((d) => d.iso)
    .reverse()

  const hrefFor = (day: string, status: DayStatus): string | null => {
    if (status.kind === 'closed') return `${base}/comprobantes/${status.closes.documentIds[0]}`
    if (!canWrite) return null
    if (status.kind === 'missing' || status.kind === 'in-progress') {
      return `${base}/ventas/cierre?fecha=${day}`
    }
    return null
  }

  return (
    <section
      aria-labelledby="cierres-del-dia"
      className="card-hairline overflow-hidden rounded-xl border bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <h2 id="cierres-del-dia" className="font-serif text-lg font-semibold tracking-tight">
            Cierres del día
          </h2>
          <p className="text-xs text-muted-foreground">
            Lo vendido cada día, copiado del cierre de caja.
          </p>
        </div>
        <ExportButton
          href={exportHref}
          fileName={exportFileName}
          label="Exportar subdiario de ventas"
          size="sm"
          className="h-11 md:h-8"
        />
      </header>

      {/* Compu y tablet: calendario */}
      <div className="hidden p-3 sm:block">
        <table className="w-full table-fixed border-separate border-spacing-1.5">
          <caption className="sr-only">Cierres del día del mes</caption>
          <thead>
            <tr>
              {HEADERS.map((h) => (
                <th
                  key={h.long}
                  scope="col"
                  abbr={h.long}
                  className="pb-1 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {h.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]?.iso}>
                {week.map((d) => {
                  if (!d.inMonth) return <td key={d.iso} aria-hidden="true" />
                  const status = dayStatus(d.iso, ctx)
                  const href = hrefFor(d.iso, status)
                  return (
                    <td key={d.iso} className="align-top">
                      <DayCell
                        day={d.day}
                        isToday={d.iso === props.today}
                        status={status}
                        href={href}
                        label={describe(d.iso, status)}
                        canWrite={canWrite}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Celular: lista de días */}
      {listDays.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground sm:hidden">
          Este mes todavía no tiene días para cargar.
        </p>
      ) : (
        <ul aria-label="Cierres del día del mes" className="divide-y divide-border/60 sm:hidden">
          {listDays.map((day) => {
            const status = dayStatus(day, ctx)
            const href = hrefFor(day, status)
            const content = (
              <>
                <span className="text-sm font-medium tabular-nums">{formatDayLabel(day)}</span>
                <span className="flex items-center gap-2">
                  <StatusText status={status} canWrite={canWrite} />
                  {href ? (
                    <ChevronRight className="size-4 text-muted-foreground/60" aria-hidden />
                  ) : null}
                </span>
              </>
            )
            return (
              <li key={day}>
                {href ? (
                  <Link
                    href={href}
                    aria-label={describe(day, status)}
                    className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 outline-none hover:bg-cream-tint focus-visible:bg-cream-tint"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
                    {content}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function StatusText({ status, canWrite }: { status: DayStatus; canWrite: boolean }): ReactNode {
  switch (status.kind) {
    case 'closed':
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium tabular-nums">
          <CircleCheck className="size-3.5 text-success" aria-hidden />
          {formatCentsShort(status.closes.totalCents)}
          {status.closes.documentIds.length > 1 ? (
            <span className="text-[11px] font-normal text-muted-foreground">
              · {status.closes.documentIds.length} turnos
            </span>
          ) : null}
        </span>
      )
    case 'missing':
      return status.recent ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning-text">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
          Falta
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Sin cierre</span>
      )
    case 'in-progress':
      return (
        <span className="text-xs text-muted-foreground">
          {canWrite ? 'En curso · Cargar' : 'En curso'}
        </span>
      )
    default:
      return null
  }
}

function DayCell({
  day,
  isToday,
  status,
  href,
  label,
  canWrite,
}: {
  day: number
  isToday: boolean
  status: DayStatus
  href: string | null
  label: string
  canWrite: boolean
}) {
  const tone =
    status.kind === 'closed'
      ? 'border-success/30 bg-success/5'
      : status.kind === 'missing' && status.recent
        ? 'border-warning/40 bg-warning/10'
        : status.kind === 'before' || status.kind === 'future'
          ? 'border-border/40 opacity-50'
          : 'border-border/60'
  const body = (
    <>
      <span
        className={cn(
          'text-xs tabular-nums',
          isToday ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
      >
        {day}
        {isToday ? <span className="ml-1 font-normal text-muted-foreground">Hoy</span> : null}
      </span>
      <StatusText status={status} canWrite={canWrite} />
    </>
  )
  const className = cn(
    'flex min-h-[4.5rem] flex-col justify-between gap-1 rounded-lg border p-2 transition-colors',
    tone,
  )
  if (!href) return <div className={className}>{body}</div>
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        className,
        'outline-none hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {body}
    </Link>
  )
}
