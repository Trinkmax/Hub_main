'use client'

import { useId } from 'react'
import { FilterChip } from '@/components/ui/filter-chip'
import {
  PARTY_SIZE_ALL_LABEL,
  PARTY_SIZE_BUCKETS,
  PARTY_SIZE_LABELS,
  PARTY_SIZE_LEGEND,
  type PartySizeBucket,
  type PartySizeTally,
  partySizeAllAria,
  partySizeChipAria,
  partySizeCountLabel,
  totalPartySizes,
} from '@/lib/salon/party-size'
import { cn } from '@/lib/utils'

/**
 * "Personas por mesa": cuántas mesas de 2, de 3, de 4… hay, y filtrar por una.
 *
 * Lo pidieron los encargados (23/09/2026) para armar el salón: seis mesas de 2
 * no se acomodan como dos de 6. La misma fila la usan la lista /reservas (los
 * conteos salen del día o del período entero, no de la página cargada) y el
 * tablero operativo (ahí salen de las filas ya cargadas).
 *
 * Presentacional y sin estado: quién decide qué pasa al tocar es la pantalla —
 * la lista empuja `?mesa=` a la URL, el tablero mueve su estado local.
 *
 * Son los `FilterChip` del kit: el elegido lleva contorno verde y un tilde
 * (forma, no solo color), el número es el de MESAS. Un grupo sin mesas se
 * dibuja igual pero apagado y sin tocar: "de 5 no hay ninguna" es una
 * respuesta, y que los chips no cambien de lugar de un día para el otro es lo
 * que deja encontrar el 4 sin leer. Envuelve en varias líneas en vez de
 * scrollear: a 360 px entran todos y la pregunta es justamente comparar los
 * siete de un vistazo.
 */
export function PartySizeChips({
  tally,
  active,
  onSelect,
  disabled = false,
  className,
  'data-tour': dataTour,
}: {
  tally: PartySizeTally
  active: PartySizeBucket | null
  /** `null` saca el filtro (el chip "Todas", o volver a tocar el activo). */
  onSelect: (bucket: PartySizeBucket | null) => void
  disabled?: boolean
  className?: string
  'data-tour'?: string
}) {
  const legendId = useId()
  const total = totalPartySizes(tally)

  return (
    <fieldset aria-labelledby={legendId} className={cn('min-w-0', className)} data-tour={dataTour}>
      {/* Rótulo visible en un <p> y no en <legend>: el legend no se deja
          maquetar con flex. El nombre del grupo lo da aria-labelledby. */}
      <p id={legendId} className="mb-2 type-label text-muted-foreground">
        {PARTY_SIZE_LEGEND}
      </p>
      <div className="flex flex-wrap gap-2">
        <FilterChip
          pressed={active === null}
          count={total.reservations}
          aria-label={partySizeAllAria(total)}
          title={partySizeCountLabel(total, { all: true })}
          disabled={disabled}
          onClick={() => onSelect(null)}
        >
          {PARTY_SIZE_ALL_LABEL}
        </FilterChip>
        {PARTY_SIZE_BUCKETS.map((bucket) => {
          const count = tally[bucket]
          const isActive = active === bucket
          return (
            <FilterChip
              key={bucket}
              pressed={isActive}
              count={count.reservations}
              aria-label={partySizeChipAria(bucket, count)}
              title={partySizeCountLabel(count)}
              // Un grupo vacío no filtra nada: se muestra, no se toca. El
              // activo siempre se puede tocar aunque haya quedado en 0, si no
              // no habría manera de sacar el filtro sin editar la URL.
              disabled={disabled || (count.reservations === 0 && !isActive)}
              onClick={() => onSelect(isActive ? null : bucket)}
            >
              {PARTY_SIZE_LABELS[bucket]}
            </FilterChip>
          )
        })}
      </div>
    </fieldset>
  )
}
