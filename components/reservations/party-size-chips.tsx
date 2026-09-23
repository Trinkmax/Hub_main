'use client'

import {
  PARTY_SIZE_ALL_LABEL,
  PARTY_SIZE_BUCKETS,
  PARTY_SIZE_LABELS,
  PARTY_SIZE_LEGEND,
  type PartySizeBucket,
  type PartySizeCount,
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
 * El número del chip son MESAS. Un grupo sin mesas se dibuja igual pero
 * apagado y sin tocar: "de 5 no hay ninguna" es una respuesta, y que los chips
 * no cambien de lugar de un día para el otro es lo que deja encontrar el 4
 * sin leer. Envuelve en varias líneas en vez de scrollear: a 360 px entran
 * todos y la pregunta es justamente comparar los siete de un vistazo.
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
  const total = totalPartySizes(tally)

  return (
    <fieldset className={cn('border-0 p-0', className)} data-tour={dataTour}>
      <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {PARTY_SIZE_LEGEND}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        <Chip
          label={PARTY_SIZE_ALL_LABEL}
          aria={partySizeAllAria(total)}
          count={total}
          all
          active={active === null}
          disabled={disabled}
          onClick={() => onSelect(null)}
        />
        {PARTY_SIZE_BUCKETS.map((bucket) => {
          const count = tally[bucket]
          const isActive = active === bucket
          return (
            <Chip
              key={bucket}
              label={PARTY_SIZE_LABELS[bucket]}
              aria={partySizeChipAria(bucket, count)}
              count={count}
              active={isActive}
              // Un grupo vacío no filtra nada: se muestra, no se toca. El
              // activo siempre se puede tocar aunque haya quedado en 0, si no
              // no habría manera de sacar el filtro sin editar la URL.
              disabled={disabled || (count.reservations === 0 && !isActive)}
              onClick={() => onSelect(isActive ? null : bucket)}
            />
          )
        })}
      </div>
    </fieldset>
  )
}

function Chip({
  label,
  aria,
  count,
  all,
  active,
  disabled,
  onClick,
}: {
  label: string
  aria: string
  count: PartySizeCount
  /** El chip que saca el filtro: su título aclara qué no está contando. */
  all?: boolean
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  const empty = count.reservations === 0
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={aria}
      title={partySizeCountLabel(count, { all })}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
        // Apagado, no invisible: sigue diciendo "de este tamaño no hay".
        !active && empty && 'opacity-50',
        'disabled:cursor-default disabled:hover:bg-card/40',
      )}
    >
      {label}
      <span
        aria-hidden
        className={cn(
          'rounded-full px-1.5 py-px font-mono text-[11px] tabular-nums',
          active ? 'bg-primary-foreground/20' : 'bg-secondary text-foreground',
        )}
      >
        {count.reservations}
      </span>
    </button>
  )
}
