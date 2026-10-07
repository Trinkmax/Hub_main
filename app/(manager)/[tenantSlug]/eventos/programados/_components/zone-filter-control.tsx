'use client'

import { SegmentedControl } from '@/components/ui/segmented-control'
import { ZONE_FILTERS, type ZoneFilter } from '@/lib/salon/segments'
import { ZONE_FILTER_GROUP_LABEL, zoneFilterLabel } from '@/lib/salon/segments-copy'
import { cn } from '@/lib/utils'

/** «Todo» no es una planta: viaja como este valor en el radio y vuelve como `null`. */
const ALL = 'todo'
type Option = ZoneFilter | typeof ALL

const OPTIONS: ReadonlyArray<Option> = [ALL, ...ZONE_FILTERS]

/**
 * El filtro de planta del calendario: Todo · Planta alta · Planta baja · Sin
 * ubicar (decisión del dueño, 22/09/2026).
 *
 * Es el `SegmentedControl` del kit en modo radio: un grupo con nombre, las
 * flechas mueven y eligen, un solo tab stop y el «seleccionado» para el lector
 * de pantalla. No es un `role="tablist"`: no hay paneles. Tampoco va en modo
 * link: cambiar la planta reemplaza la URL con `history.replaceState` (lo hace
 * el mes) y no le pide nada al server.
 *
 * Mide ~300 px con los cuatro rótulos en una línea: entra en la agenda de un
 * celu de 360 px sin scroll horizontal. En el celu ocupa todo el ancho y cada
 * opción crece parejo.
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
  return (
    <SegmentedControl<Option>
      aria-label={ZONE_FILTER_GROUP_LABEL}
      size="sm"
      fullWidth
      items={OPTIONS.map((option) => ({
        value: option,
        label: zoneFilterLabel(option === ALL ? null : option),
      }))}
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? null : next)}
      // En la compu, a su medida: las opciones vuelven a su ancho natural.
      className={cn(
        'sm:inline-flex sm:w-auto sm:[&>[data-slot=segmented-option]]:flex-none',
        className,
      )}
    />
  )
}
