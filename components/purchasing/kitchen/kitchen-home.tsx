import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { formatDayMonth, WEEKDAY_NAMES, weekdayOf } from '@/lib/dates'
import { relativeDayLabel, weekdaysText } from '@/lib/purchasing/dates'
import type { KitchenHome as KitchenHomeData } from '@/lib/purchasing/queries'
import { COUNT_KIND_LABELS } from '@/lib/purchasing/types'
import { cn } from '@/lib/utils'

/**
 * El inicio de la cocina: qué llega hoy, contar el stock y los eventos de la semana. Tres tarjetas y nada
 * más: se abre con las manos ocupadas.
 */
export function KitchenHome({
  slug,
  data,
  firstName,
}: {
  slug: string
  data: KitchenHomeData
  firstName: string | null
}) {
  const { today } = data
  const suppliers = new Map(data.suppliers.map((s) => [s.id, s.name]))
  const name = (supplierId: string | null) =>
    supplierId ? (suppliers.get(supplierId) ?? 'Proveedor') : 'Sin proveedor'
  const dueToday = data.receivable.filter((o) => !o.expectedDate || o.expectedDate <= today)
  const later = data.receivable.filter((o) => o.expectedDate && o.expectedDate > today)
  const count = data.openCount
  const countDays = weekdaysText(data.settings.countWeekdays)
  const week = data.week.filter((e) => e.status !== 'no_recipe' || e.notice)

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 pt-2 pb-6">
      <header className="space-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {WEEKDAY_NAMES[weekdayOf(today)]} {formatDayMonth(today)}
        </p>
        <h1 className="font-serif text-[2rem] font-semibold leading-tight tracking-[-0.015em] text-primary">
          {firstName ? `Hola, ${firstName}` : 'Hola'}
        </h1>
      </header>

      <Link
        href={`/${slug}/salon/stock/recibir`}
        className={cn(
          'group block rounded-3xl p-5 shadow-sm transition-transform active:scale-[0.99]',
          dueToday.length
            ? 'bg-primary text-primary-foreground'
            : 'card-hairline bg-card text-foreground',
        )}
      >
        <p
          className={cn(
            'text-xs font-semibold uppercase tracking-[0.16em]',
            dueToday.length ? 'text-primary-foreground/75' : 'text-muted-foreground',
          )}
        >
          Recibir mercadería
        </p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-serif text-[1.75rem] font-semibold leading-tight">
              {dueToday.length === 0
                ? later.length
                  ? 'Hoy no llega nada'
                  : 'No hay pedidos en camino'
                : dueToday.length === 1
                  ? '1 pedido llega hoy'
                  : `${dueToday.length} pedidos llegan hoy`}
            </p>
            {dueToday.length ? (
              <p className="mt-1 text-base">
                {dueToday.map((o) => name(o.supplierId)).join(' · ')}
              </p>
            ) : null}
            {later.length ? (
              <p
                className={cn(
                  'mt-1 text-sm',
                  dueToday.length ? 'text-primary-foreground/80' : 'text-muted-foreground',
                )}
              >
                {dueToday.length ? 'Después: ' : 'Próximos: '}
                {later
                  .slice(0, 4)
                  .map(
                    (o) =>
                      `${name(o.supplierId)} (${relativeDayLabel(o.expectedDate ?? today, today)})`,
                  )
                  .join(' · ')}
                {later.length > 4 ? ` y ${later.length - 4} más` : ''}
              </p>
            ) : null}
          </div>
          {data.receivable.length ? (
            <ChevronRight
              className="size-6 shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          ) : null}
        </div>
      </Link>

      <Link
        href={
          count ? `/${slug}/salon/stock/conteo/${count.id}` : `/${slug}/salon/stock/conteo/nuevo`
        }
        className="card-hairline group block rounded-3xl bg-card p-5 shadow-xs transition-transform active:scale-[0.99]"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Contar stock
        </p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-serif text-[1.75rem] font-semibold leading-tight">
              {count ? 'Seguir el conteo' : 'Nuevo conteo'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {count
                ? `${COUNT_KIND_LABELS[count.kind]} · ${relativeDayLabel(count.countDate, today)} · ${count.countedByName} · ${count.counted} contados`
                : countDays
                  ? `Se cuenta ${countDays}`
                  : 'Contá por zona y armamos el pedido'}
            </p>
          </div>
          <ChevronRight
            className="size-6 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </div>
      </Link>

      <section className="rounded-3xl border border-border/70 bg-muted/40 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Esta semana
        </h2>
        {week.length ? (
          <ul className="mt-2 space-y-1.5 text-[0.95rem]">
            {week.map((e) => (
              <li key={e.event.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-muted-foreground">
                  {relativeDayLabel(e.event.date, today)}
                </span>
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
                <span className="font-medium">{e.event.name}</span>
                {e.status === 'needs_variant' ? (
                  <span className="text-xs text-warning-text">falta elegir la variante</span>
                ) : e.notice && e.status === 'notice_only' ? (
                  <span className="text-xs text-muted-foreground">{e.notice}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No hay eventos con receta en los próximos 7 días.
          </p>
        )}
      </section>
    </div>
  )
}
