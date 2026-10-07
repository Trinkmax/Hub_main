import { ArrowRight, CalendarCheck, Clock3, UsersRound } from 'lucide-react'
import Link from 'next/link'
import type { TodaySalonOverview as Overview } from '@/lib/salon/queries'
import { MEAL_TYPE_LABELS, type MealType } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dt)
}

export function TodaySalonOverview({
  tenantSlug,
  overview,
}: {
  tenantSlug: string
  overview: Overview
}) {
  const { reservationsCount, estimatedGuests, peak, byStatus, byMeal, date } = overview
  const hasReservations = reservationsCount > 0
  const activeMeals = MEAL_ORDER.filter((m) => byMeal[m].count > 0)

  return (
    <section
      aria-label="Hoy en el salón"
      className="card-hairline relative overflow-hidden rounded-2xl border bg-card"
    >
      <header className="flex items-baseline justify-between gap-3 px-5 pt-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Hoy en el salón
          </p>
          <h2 className="font-serif text-lg font-semibold capitalize">{formatDateLong(date)}</h2>
        </div>
        <Link
          href={`/${tenantSlug}/salon/reservas-operativo?date=${date}`}
          className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Operativo
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </header>

      {hasReservations ? (
        <>
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-3 sm:gap-6">
            <Stat
              icon={CalendarCheck}
              label="Reservas esperadas"
              value={reservationsCount}
              hint={
                <span className="space-x-1.5">
                  {byStatus.pending > 0 ? (
                    <span className="text-amber-700 dark:text-amber-300">
                      {byStatus.pending} pend
                    </span>
                  ) : null}
                  {byStatus.arrived > 0 ? (
                    <span className="text-blue-600 dark:text-blue-400">
                      · {byStatus.arrived} llegó
                    </span>
                  ) : null}
                  {byStatus.seated > 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      · {byStatus.seated} sent
                    </span>
                  ) : null}
                  {byStatus.closed > 0 ? (
                    <span className="text-slate-500">· {byStatus.closed} cerr</span>
                  ) : null}
                </span>
              }
            />
            <Stat
              icon={UsersRound}
              label="Personas estimadas"
              value={estimatedGuests}
              hint={
                estimatedGuests > 0 && reservationsCount > 0
                  ? `${(estimatedGuests / reservationsCount).toFixed(1)} promedio por reserva`
                  : null
              }
            />
            <Stat
              icon={Clock3}
              label="Pico estimado"
              value={peak ? `${peak.startHHMM}–${peak.endHHMM}` : '—'}
              valueAsString
              hint={
                peak
                  ? `${peak.guests} simultáneas · asume 1h30 por reserva`
                  : 'Sin datos suficientes'
              }
            />
          </div>

          {activeMeals.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 bg-card/40 px-5 py-3 text-[11px]">
              <span className="text-muted-foreground">Por servicio:</span>
              {activeMeals.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary/60 px-2 py-0.5 font-medium text-foreground"
                >
                  {MEAL_TYPE_LABELS[m]}
                  <span className="text-muted-foreground tabular-nums">
                    {byMeal[m].count} · {byMeal[m].guests}p
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex items-center justify-between gap-4 px-5 py-6">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              No hay reservas cargadas para hoy todavía.
            </p>
            <p className="text-xs text-muted-foreground">
              Cuando alguien las cargue aparecerán acá y en el panel operativo.
            </p>
          </div>
          <Link
            href={`/${tenantSlug}/reservas/nuevo`}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Nueva reserva
          </Link>
        </div>
      )}
    </section>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  valueAsString,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | string
  valueAsString?: boolean
  hint?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div
        className={cn(
          'font-display font-semibold leading-tight tabular-nums',
          valueAsString ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl',
        )}
      >
        {value}
      </div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}
