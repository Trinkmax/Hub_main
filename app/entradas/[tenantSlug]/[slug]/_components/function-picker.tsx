'use client'

import { formatLongDate } from '@/lib/ticketing/dates'
import { cn } from '@/lib/utils'
import { FunctionStub } from '../../../_components/function-stub'
import { useExperience } from './experience-context'

/**
 * Los talones de todas las funciones. `compact` es la versión de la entrada
 * (sin hora, más chicos); la grande del primer acto muestra la hora y dice
 * en una línea qué noche quedó elegida.
 */
export function FunctionPicker({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  const { functions, selected, select } = useExperience()

  return (
    <div className={className}>
      <ul
        className={cn(
          'flex gap-2.5',
          compact
            ? 'flex-wrap'
            : '-mx-5 snap-x snap-mandatory overflow-x-auto px-5 pt-1 pb-3 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0',
        )}
      >
        {functions.map((fn) => (
          <li key={fn.eventId} className="snap-start">
            <FunctionStub
              fn={fn}
              showTime={!compact}
              selected={selected?.eventId === fn.eventId}
              onSelect={() => select(fn.eventId)}
              compact={compact}
            />
          </li>
        ))}
      </ul>
      {!compact ? (
        <p className="mt-3 min-h-6 text-sm text-(--ent-cream-2)" aria-live="polite">
          {selected ? (
            <>
              Elegiste el{' '}
              <strong className="text-(--ent-cream)">{formatLongDate(selected.date)}</strong> a las{' '}
              {selected.time} hs.
            </>
          ) : (
            'Elegí una fecha.'
          )}
        </p>
      ) : null}
    </div>
  )
}
