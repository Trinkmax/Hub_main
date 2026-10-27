import Link from 'next/link'
import { availabilityLabel } from '@/lib/ticketing/availability'
import { dayNumber, formatLongDate, monthShort, weekdayShort } from '@/lib/ticketing/dates'
import type { PublicFunction } from '@/lib/ticketing/types'
import { cn } from '@/lib/utils'

/**
 * El talón de una función: «MAR · 01 · DIC», con su disponibilidad.
 *
 * Tres formas: link (la cartelera lleva a la película con la fecha elegida),
 * botón (la película cambia la fecha de la entrada) o quieto (agotada: ni se
 * puede tocar, lleva el sello).
 */
export function FunctionStub({
  fn,
  href,
  onSelect,
  selected = false,
  showTime = false,
  compact = false,
  className,
}: {
  fn: PublicFunction
  href?: string
  onSelect?: () => void
  selected?: boolean
  showTime?: boolean
  /** La versión chica de la entrada (que entren 5 en una fila). */
  compact?: boolean
  className?: string
}) {
  const soldOut = fn.state === 'sold_out'
  const label = availabilityLabel(fn)
  const a11y = `${formatLongDate(fn.date)}, ${fn.time}${label ? `, ${label}` : ''}`

  const body = (
    <>
      <span className="ent-mono text-[0.6rem] font-semibold opacity-75">
        {weekdayShort(fn.date)}
      </span>
      <span
        className={cn(
          'ent-display ent-stub-day ent-num leading-none',
          compact ? 'text-[1.45rem]' : 'text-[1.9rem]',
        )}
      >
        {dayNumber(fn.date)}
      </span>
      <span className="ent-mono ent-stub-month text-[0.6rem] font-semibold opacity-75">
        {monthShort(fn.date)}
      </span>
      {showTime ? (
        <span className="ent-num mt-0.5 text-[0.7rem] font-semibold opacity-80">{fn.time}</span>
      ) : null}
      {fn.state === 'last' ? (
        <span className="ent-last mt-1 inline-flex items-center gap-1 text-[0.62rem] font-bold whitespace-nowrap">
          <span className="ent-pulse" aria-hidden />
          {label}
        </span>
      ) : null}
      {soldOut ? (
        <span className="ent-stamp" aria-hidden>
          Agotado
        </span>
      ) : null}
    </>
  )

  const classes = cn(
    'ent-stub ent-notched',
    !soldOut && !selected && 'ent-paper',
    compact && 'min-w-[3.6rem] px-1.5 py-1.5',
    className,
  )

  if (soldOut) {
    return (
      <span
        className={classes}
        data-state="sold_out"
        aria-disabled="true"
        aria-label={`${a11y}. Sin lugares.`}
        role="img"
      >
        {body}
      </span>
    )
  }

  if (href) {
    return (
      <Link
        href={href}
        className={classes}
        data-state={fn.state}
        data-interactive="true"
        aria-label={`${a11y}. Elegir esta fecha.`}
      >
        {body}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={classes}
      data-state={fn.state}
      data-interactive="true"
      data-selected={selected ? 'true' : 'false'}
      aria-pressed={selected}
      aria-label={a11y}
    >
      {body}
    </button>
  )
}
