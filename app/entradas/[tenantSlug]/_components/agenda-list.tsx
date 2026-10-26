import { ArrowRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { availabilityLabel } from '@/lib/ticketing/availability'
import type { AgendaMonth } from '@/lib/ticketing/catalog'
import { dayNumber, monthShort, relativeDay, weekdayShort } from '@/lib/ticketing/dates'
import { cn } from '@/lib/utils'

/**
 * «Por fecha»: para el que sabe CUÁNDO puede ir antes que QUÉ quiere ver.
 * Cada fila es una función; las agotadas quedan apagadas y no se tocan.
 */
export function AgendaList({
  months,
  tenantSlug,
  today,
}: {
  months: AgendaMonth[]
  tenantSlug: string
  today: string
}) {
  if (months.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-(--ent-line-strong) px-5 py-8 text-center text-(--ent-cream-2)">
        Todavía no hay fechas a la venta.
      </p>
    )
  }

  return (
    <div className="space-y-10">
      {months.map((month) => (
        <section key={month.key} aria-labelledby={`mes-${month.key}`}>
          <h3 id={`mes-${month.key}`} className="ent-mono mb-3 text-[0.7rem] text-(--ent-gold)">
            {month.label}
          </h3>
          <ul className="space-y-2.5">
            {month.rows.map(({ fn, experience }) => {
              const soldOut = fn.state === 'sold_out'
              const label = availabilityLabel(fn)
              const rel = relativeDay(fn.date, today)
              const content = (
                <>
                  <div className="ent-paper ent-notched flex w-[4.25rem] shrink-0 flex-col items-center rounded-xl py-2 [--notch:5px]">
                    <span className="ent-mono text-[0.58rem] font-semibold opacity-70">
                      {weekdayShort(fn.date)}
                    </span>
                    <span className="ent-display ent-num text-2xl leading-none">
                      {dayNumber(fn.date)}
                    </span>
                    <span className="ent-mono text-[0.58rem] font-semibold opacity-70">
                      {monthShort(fn.date)}
                    </span>
                  </div>
                  <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md bg-(--ent-surface-2)">
                    {experience.posterUrl ? (
                      <Image
                        src={experience.posterUrl}
                        alt=""
                        fill
                        sizes="44px"
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-(--ent-cream)">{experience.title}</p>
                    <p className="mt-0.5 text-xs text-(--ent-muted)">
                      {rel ? (
                        <span className="font-semibold text-(--ent-gold)">{rel} · </span>
                      ) : null}
                      {fn.time} hs
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs font-semibold">
                    {soldOut ? (
                      <span className="rounded-md border border-(--ent-red)/70 px-2 py-1 text-(--ent-red) ent-mono text-[0.6rem]">
                        Agotado
                      </span>
                    ) : label ? (
                      <span className="inline-flex items-center gap-1.5 text-(--ent-gold)">
                        <span className="ent-pulse" aria-hidden />
                        {label}
                      </span>
                    ) : null}
                    {!soldOut ? (
                      <ArrowRight className="size-4 text-(--ent-cream-2)" aria-hidden />
                    ) : null}
                  </div>
                </>
              )
              const rowClass = cn(
                'flex items-center gap-3 rounded-2xl border border-(--ent-line) bg-(--ent-bg-2) p-2.5 pr-4 sm:gap-4',
                soldOut
                  ? 'opacity-55'
                  : 'ent-press transition-colors hover:border-(--ent-line-strong) hover:bg-(--ent-surface)',
              )
              return (
                <li
                  key={fn.eventId}
                  style={{ '--accent': experience.accent } as React.CSSProperties}
                >
                  {soldOut ? (
                    <div className={rowClass}>{content}</div>
                  ) : (
                    <Link
                      href={`/entradas/${tenantSlug}/${experience.slug}?fecha=${fn.date}`}
                      className={rowClass}
                    >
                      {content}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
