import { ArrowRight, Banknote, CalendarCheck, Clock3, UsersRound } from 'lucide-react'
import Link from 'next/link'
import { formatCentsShort } from '@/lib/money/format'
import type { SalesDay } from '@/lib/pos/today/types'
import type { TodaySalonOverview as Overview } from '@/lib/salon/queries'
import { MEAL_TYPE_LABELS, type MealType } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

/** «Miércoles 18 de noviembre»: solo la primera letra en mayúscula. */
function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const text = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace(',', '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/**
 * «Hoy»: una sola ficha con lo del día. Las reservas, la gente y la hora pico; y, en un bar con
 * punto de venta, lo vendido en el salón (que abre «Hoy en vivo», el detalle cobro por cobro).
 *
 * Antes lo vendido era otra pantalla con su entrada en el menú, y acá arriba otra ficha: dos lugares
 * para la misma pregunta («¿cómo viene hoy?»).
 */
export function TodaySalonOverview({
  tenantSlug,
  overview,
  sales,
}: {
  tenantSlug: string
  overview: Overview
  /**
   * Lo vendido hoy en el salón. `undefined` = el bar no usa el punto de venta (la columna no se
   * dibuja); `null` = lo usa y todavía no hubo cobros.
   */
  sales?: SalesDay | null
}) {
  const { reservationsCount, estimatedGuests, peak, byStatus, byMeal, date } = overview
  const hasReservations = reservationsCount > 0
  const hasSales = sales !== undefined
  const activeMeals = MEAL_ORDER.filter((m) => byMeal[m].count > 0)

  return (
    <section
      aria-label="Hoy"
      className="card-hairline relative overflow-hidden rounded-2xl border bg-card"
    >
      <header className="flex items-baseline justify-between gap-3 px-5 pt-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Hoy
          </p>
          <h2 className="font-serif text-lg font-semibold">{formatDateLong(date)}</h2>
        </div>
        {/* El tablero de la noche del panel (antes llevaba a la pantalla del mozo). */}
        <Link
          href={`/${tenantSlug}/operativo`}
          className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Operativo
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </header>

      {hasReservations || hasSales ? (
        <>
          <div
            className={cn(
              'grid gap-4 px-5 py-4 sm:gap-6',
              hasSales ? 'grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3',
            )}
          >
            <Stat
              icon={CalendarCheck}
              label="Reservas"
              value={reservationsCount}
              hint={hasReservations ? arrivedLine(byStatus) : 'Todavía no hay ninguna'}
            />
            <Stat
              icon={UsersRound}
              label="Personas"
              value={estimatedGuests}
              hint={
                estimatedGuests > 0 && reservationsCount > 0
                  ? `${(estimatedGuests / reservationsCount).toLocaleString('es-AR', { maximumFractionDigits: 1 })} por reserva, en promedio`
                  : null
              }
            />
            <Stat
              icon={Clock3}
              label="Hora pico"
              value={peak ? `${peak.startHHMM}–${peak.endHHMM}` : '—'}
              valueAsString
              hint={
                peak
                  ? `${peak.guests} personas a la vez (calculando 1 h 30 por mesa)`
                  : hasReservations
                    ? 'Todavía no se puede calcular'
                    : null
              }
            />
            {hasSales ? (
              <Link
                href={`/${tenantSlug}/local/hoy`}
                aria-label="Vendido hoy en el salón: ver el día cobro por cobro"
                className="group -m-2 rounded-xl p-2 transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none"
              >
                <Stat
                  icon={Banknote}
                  label="Vendido en el salón"
                  value={formatCentsShort(sales?.salesCents ?? 0)}
                  valueAsString
                  hint={
                    <span className="inline-flex items-center gap-1">
                      {sales && sales.payments > 0
                        ? `${count(sales.payments, 'cobro', 'cobros')} de ${count(sales.tables, 'mesa', 'mesas')}`
                        : 'Todavía no se cobró nada'}
                      <ArrowRight
                        className="size-3 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  }
                />
              </Link>
            ) : null}
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
        <div className="px-5 pt-2 pb-5">
          <p className="text-sm text-muted-foreground">
            Todavía no hay reservas para hoy. Cuando alguien cargue una, aparece acá y en el
            Operativo.
          </p>
        </div>
      )}
    </section>
  )
}

/** «18 por llegar · 6 llegaron», sin los pasos que ya nadie marca (sentada, cerrada). */
function arrivedLine(byStatus: Overview['byStatus']): string | null {
  const inside = byStatus.arrived + byStatus.seated + byStatus.closed
  const parts: string[] = []
  if (byStatus.pending > 0) parts.push(`${byStatus.pending} por llegar`)
  if (inside > 0) parts.push(`${inside} ${inside === 1 ? 'llegó' : 'llegaron'}`)
  return parts.length > 0 ? parts.join(' · ') : null
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
