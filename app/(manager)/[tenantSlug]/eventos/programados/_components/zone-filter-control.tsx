'use client'

import { useId } from 'react'
import { ZONE_FILTERS, type ZoneFilter } from '@/lib/salon/segments'
import { ZONE_FILTER_GROUP_LABEL, zoneFilterLabel } from '@/lib/salon/segments-copy'
import { cn } from '@/lib/utils'

const OPTIONS: ReadonlyArray<ZoneFilter | null> = [null, ...ZONE_FILTERS]

/**
 * El filtro de planta del calendario: Todo · Planta alta · Planta baja · Sin
 * ubicar (decisión del dueño, 22/09/2026).
 *
 * Radios nativos escondidos detrás de cada rótulo, no botones con `role`: el
 * navegador ya da el grupo con nombre, las flechas para moverse, un solo tab
 * stop y el «seleccionado» para el lector de pantalla. Un `role="tablist"`
 * (como SlidingTabs) prometía paneles que acá no existen.
 *
 * Mide ~280 px con los cuatro rótulos en una línea: entra en la agenda de un
 * celu de 360 px (304 px útiles adentro de la card) sin scroll horizontal. En
 * el celu ocupa todo el ancho y cada opción crece parejo.
 */
export function ZoneFilterControl({
  value,
  onChange,
  className,
}: {
  value: ZoneFilter | null
  onChange: (next: ZoneFilter | null) => void
  className?: string
}) {
  const name = useId()
  return (
    <fieldset
      className={cn(
        'flex w-full gap-0.5 rounded-lg border border-border/60 bg-secondary/60 p-0.5 sm:inline-flex sm:w-auto',
        className,
      )}
    >
      <legend className="sr-only">{ZONE_FILTER_GROUP_LABEL}</legend>
      {OPTIONS.map((option) => {
        const checked = option === value
        return (
          <label
            key={option ?? 'todo'}
            className={cn(
              'flex min-h-8 flex-auto cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors',
              // El foco del radio (escondido) se ve en su rótulo.
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
              checked
                ? 'bg-card text-foreground shadow-sm ring-1 ring-border/50'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option ?? 'todo'}
              checked={checked}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {zoneFilterLabel(option)}
          </label>
        )
      })}
    </fieldset>
  )
}
