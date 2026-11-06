'use client'

import { WEEKDAY_NAMES, WEEKDAY_NAMES_MIN } from '@/lib/dates'
import { WEEKDAYS_MONDAY_FIRST, weekdaysText } from '@/lib/purchasing/dates'
import { cn } from '@/lib/utils'

/** «Lu», «Ma», … «Sá», «Do» (0 = domingo). */
function shortName(day: number): string {
  const name = WEEKDAY_NAMES_MIN[day] ?? ''
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Los siete días de lunes a domingo, rellenos los que entrega. Solo para leer: lo que entiende un
 * lector de pantalla es la frase («Entrega lunes y jueves»). Todo `span`: va adentro de botones.
 */
export function WeekdayDots({ days, className }: { days: readonly number[]; className?: string }) {
  const text = weekdaysText(days)
  return (
    <span className={cn('flex items-center gap-1', className)}>
      <span className="sr-only">{text ? `Entrega ${text}.` : 'Sin días de entrega.'}</span>
      {WEEKDAYS_MONDAY_FIRST.map((day) => {
        const on = days.includes(day)
        return (
          <span
            key={day}
            aria-hidden
            className={cn(
              'flex size-7 items-center justify-center rounded-full text-[11px] font-semibold',
              on
                ? 'bg-primary text-primary-foreground'
                : 'border border-dashed border-border text-muted-foreground/80',
            )}
          >
            {shortName(day)}
          </span>
        )
      })}
    </span>
  )
}

/** Los siete días para elegir: cada uno se prende y se apaga (relleno = entrega ese día). */
export function WeekdayToggles({
  value,
  onChange,
  legend,
  describedById,
}: {
  value: readonly number[]
  onChange: (days: number[]) => void
  legend: string
  describedById?: string
}) {
  const toggle = (day: number) =>
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day])
  return (
    <fieldset aria-describedby={describedById} className="min-w-0 space-y-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS_MONDAY_FIRST.map((day) => {
          const on = value.includes(day)
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              aria-label={WEEKDAY_NAMES[day]}
              onClick={() => toggle(day)}
              className={cn(
                'flex h-11 min-w-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors md:h-10',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                on
                  ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                  : 'border-border bg-card/70 hover:bg-secondary',
              )}
            >
              {shortName(day)}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
