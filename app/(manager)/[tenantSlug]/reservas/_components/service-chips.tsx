'use client'

import { Cake } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import type { MealType } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

export type ServiceChip = {
  mealType: MealType
  label: string
  /** Reservas que ocupan mesa en ese servicio. */
  count: number
  covers: number
  cakes: number
}

/**
 * Filtro por servicio: Todo el día · Desayuno · Almuerzo · Merienda · Cena.
 *
 * El dueño lo pidió textual: "necesito que muestres las reservas filtrado por
 * desayuno, almuerzo, merienda y cena … actualmente está todo junto y se mezcla
 * para poder leerlo".
 *
 * Los contadores NO salen de la página cargada sino del día entero: si salieran
 * de la página, filtrar por Cena dejaría los otros chips en 0 y no habría forma
 * de darse cuenta de que la merienda existe. Solo se listan los servicios que
 * ese día tienen algo — el HUB sirve 144 cenas por cada 2 desayunos, y un chip
 * "Desayuno 0" todos los días es ruido.
 */
export function ServiceChips({
  tenantSlug,
  chips,
  active,
  totalCount,
}: {
  tenantSlug: string
  chips: ServiceChip[]
  active: MealType | undefined
  /** Reservas activas del día, para el chip "Todo el día". */
  totalCount: number
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  // Con un solo servicio en el día no hay nada que separar: el filtro sería un
  // botón que no cambia nada.
  if (chips.length < 2) return null

  function push(meal: MealType | null) {
    const next = new URLSearchParams(sp?.toString() ?? '')
    if (meal) next.set('servicio', meal)
    else next.delete('servicio')
    next.delete('page')
    const qs = next.toString()
    startTransition(() => router.push(`/${tenantSlug}/reservas${qs ? `?${qs}` : ''}`))
  }

  return (
    <fieldset
      className="-mx-1 flex snap-x gap-2 overflow-x-auto border-0 px-1 pb-1"
      data-tour="reservas-servicios"
    >
      <legend className="sr-only">Filtrar por servicio</legend>
      <Chip
        label="Todo el día"
        count={totalCount}
        active={active === undefined}
        disabled={pending}
        onClick={() => push(null)}
      />
      {chips.map((c) => (
        <Chip
          key={c.mealType}
          label={c.label}
          count={c.count}
          covers={c.covers}
          cakes={c.cakes}
          active={active === c.mealType}
          disabled={pending}
          onClick={() => push(c.mealType)}
        />
      ))}
    </fieldset>
  )
}

function Chip({
  label,
  count,
  covers,
  cakes = 0,
  active,
  disabled,
  onClick,
}: {
  label: string
  count: number
  covers?: number
  cakes?: number
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={covers !== undefined ? `${covers} cubiertos` : undefined}
      className={cn(
        'inline-flex h-11 shrink-0 snap-start items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:opacity-60',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-px font-mono text-[11px] tabular-nums',
          active ? 'bg-primary-foreground/20' : 'bg-secondary text-foreground',
        )}
      >
        {count}
      </span>
      {/* La torta se anuncia desde el chip: es producción del bar, no una
          preferencia del cliente, y llegar tarde a enterarse es el moco. */}
      {cakes > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-[11px]">
          <Cake className={cn('size-3', active ? '' : 'text-primary')} aria-hidden />
          {cakes}
        </span>
      ) : null}
    </button>
  )
}
