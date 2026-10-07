'use client'

import { Cake } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { FilterChip } from '@/components/ui/filter-chip'
import { formatNumber } from '@/lib/format/number-kind'
import { MEAL_TYPE_LABELS, type MealType } from '@/lib/salon/types'

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
 *
 * Son los `FilterChip` del kit: el elegido lleva contorno verde y un tilde.
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

  // Con un solo servicio en el día no hay nada que separar… salvo que el filtro
  // YA esté puesto: ahí esconder los chips esconde la única manera de sacarlo.
  // Pasaba de verdad — filtrás "Merienda" y pasás al día siguiente, que es todo
  // cena: la lista quedaba vacía y no había cómo volver.
  if (chips.length < 2 && active === undefined) return null

  function push(meal: MealType | null) {
    const next = new URLSearchParams(sp?.toString() ?? '')
    if (meal) next.set('servicio', meal)
    else next.delete('servicio')
    next.delete('page')
    const qs = next.toString()
    startTransition(() => router.push(`/${tenantSlug}/reservas${qs ? `?${qs}` : ''}`))
  }

  const shown =
    chips.some((c) => c.mealType === active) || active === undefined
      ? chips
      : [
          // El servicio filtrado no tiene reservas este día: igual se dibuja
          // (en 0) para que se pueda desmarcar sin tocar la URL.
          ...chips,
          { mealType: active, label: MEAL_TYPE_LABELS[active], count: 0, covers: 0, cakes: 0 },
        ]

  return (
    <fieldset className="flex min-w-0 flex-wrap items-center gap-2" data-tour="reservas-servicios">
      <legend className="sr-only">Filtrar por servicio</legend>
      <FilterChip
        pressed={active === undefined}
        count={totalCount}
        disabled={pending}
        onClick={() => push(null)}
      >
        Todo el día
      </FilterChip>
      {shown.map((c) => (
        <FilterChip
          key={c.mealType}
          pressed={active === c.mealType}
          // Sin `count`: el chip lo dibuja al final, y con la torta en el medio
          // se leía «Merienda 🎂1 1». Acá va pegado al nombre (mismo estilo) y
          // la torta después, separada por un pelo.
          count={c.cakes > 0 ? undefined : c.count}
          disabled={pending}
          title={`${c.covers} cubiertos`}
          onClick={() => push(c.mealType)}
        >
          {c.label}
          {c.cakes > 0 ? (
            <>
              <span data-slot="filter-chip-count" className="type-caption type-amount">
                {formatNumber(c.count)}
              </span>
              {/* La torta se anuncia desde el chip: es producción del bar, no una
                  preferencia del cliente, y llegar tarde a enterarse es el moco. */}
              <span className="inline-flex items-center gap-0.5 border-s border-border ps-1.5 text-brand-text">
                <Cake className="size-3.5" aria-hidden />
                <span className="type-caption tabular-nums">{c.cakes}</span>
                <span className="sr-only">{c.cakes === 1 ? 'torta' : 'tortas'}</span>
              </span>
            </>
          ) : null}
        </FilterChip>
      ))}
    </fieldset>
  )
}
