'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { type ReactNode, useOptimistic, useTransition } from 'react'
import { Pill } from '@/components/administracion/kit/pill'
import {
  CASH_CHART_ACCOUNT_PARAM,
  CASH_CHART_ALL,
  CASH_CHART_DEFAULT_RANGE,
  CASH_CHART_RANGE_PARAM,
  type CashChartRangeKey,
  type CashChartRangeOption,
} from '@/lib/accounting/cash-daily'
import { cn } from '@/lib/utils'

/** Una caja del selector: «Todas las cajas» primero y después cada una, con el punto de su color. */
export type CajaOption = {
  /** `todas` o el id de la caja: lo que viaja en `?grafico=`. */
  value: string
  label: string
  /** La clase `bg-*` del color de la caja; `null` en «Todas las cajas». */
  swatch: string | null
}

/**
 * `?grafico=` en la URL sin pedir la página de nuevo: los dibujos de todas las
 * cajas ya vinieron. Next sincroniza `replaceState` con `useSearchParams`
 * (docs «Native History API») solo si el estado NO es el suyo: por eso va
 * `null` y no `window.history.state`.
 */
function syncAccountParam(value: string) {
  const url = new URL(window.location.href)
  if (value === CASH_CHART_ALL) url.searchParams.delete(CASH_CHART_ACCOUNT_PARAM)
  else url.searchParams.set(CASH_CHART_ACCOUNT_PARAM, value)
  window.history.replaceState(null, '', `${url.pathname}${url.search}`)
}

/** 44 px donde se toca con el dedo, 36 con mouse (el mismo corte que las vistas de la pantalla). */
const PILL_SIZE =
  'h-11 px-4 text-sm md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]'

/**
 * Qué caja y qué período se dibujan en «Cómo se movió la plata».
 *
 * - La caja se elige con píldoras (la elegida, rellena) y cambia el dibujo SIN
 *   ir al servidor: el server ya armó un dibujo por caja (`frames`) y acá solo
 *   se muestra el elegido. Queda en `?grafico=`, así «atrás» y un link
 *   compartido muestran la misma caja.
 * - El período (`?periodo=`) sí vuelve a pedir: mientras llega, se queda lo
 *   anterior, atenuado, sin saltos.
 *
 * En el celular la fila de cajas se desliza y se desvanece a la derecha, para
 * que se note que sigue.
 */
export function CajaSwitch({
  options,
  frames,
  ranges,
  rangeKey,
}: {
  options: readonly CajaOption[]
  /** El dibujo de cada caja, ya armado en el servidor, por `value`. */
  frames: Readonly<Record<string, ReactNode>>
  ranges: readonly CashChartRangeOption[]
  rangeKey: CashChartRangeKey
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  // La píldora cambia al tocarla; el dibujo, cuando llega el período nuevo.
  const [shownRange, setShownRange] = useOptimistic(rangeKey)

  // La URL manda. Una caja que ya no existe cae en «Todas las cajas».
  const requested = searchParams.get(CASH_CHART_ACCOUNT_PARAM) ?? CASH_CHART_ALL
  const selected = options.find((o) => o.value === requested) ?? options[0]

  function goToRange(next: CashChartRangeKey) {
    if (next === shownRange) return
    const params = new URLSearchParams(searchParams.toString())
    if (next === CASH_CHART_DEFAULT_RANGE) params.delete(CASH_CHART_RANGE_PARAM)
    else params.set(CASH_CHART_RANGE_PARAM, next)
    const qs = params.toString()
    startTransition(() => {
      setShownRange(next)
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }

  if (!selected) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* El margen negativo deja lugar al anillo de foco contra el borde del área que desliza. */}
        <fieldset className="-mx-1 min-w-0 max-w-full border-0 p-0">
          <legend className="sr-only">Qué caja se dibuja</legend>
          <div className="flex items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] max-sm:pr-10 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent)] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            {options.map((option) => (
              <Pill
                key={option.value}
                active={option.value === selected.value}
                onClick={() => syncAccountParam(option.value)}
                className={PILL_SIZE}
              >
                <span className="inline-flex max-w-48 items-center gap-1.5">
                  {option.swatch ? (
                    <span
                      aria-hidden
                      className={cn(
                        'size-2.5 shrink-0 rounded-full',
                        option.swatch,
                        option.value === selected.value && 'ring-2 ring-background/70',
                      )}
                    />
                  ) : null}
                  <span className="truncate">{option.label}</span>
                </span>
              </Pill>
            ))}
          </div>
        </fieldset>
        <fieldset className="min-w-0 border-0 p-0">
          <legend className="sr-only">Período</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {ranges.map((range) => (
              <Pill
                key={range.key}
                active={range.key === shownRange}
                onClick={() => goToRange(range.key)}
                className={PILL_SIZE}
              >
                {range.label}
              </Pill>
            ))}
          </div>
        </fieldset>
      </div>

      <div
        aria-busy={pending}
        className={cn(
          'transition-opacity duration-(--duration-fast) motion-reduce:transition-none',
          pending && 'opacity-60',
        )}
      >
        {frames[selected.value]}
      </div>
    </div>
  )
}

/**
 * El esqueleto de la vista que pide la URL: `loading.tsx` no recibe los
 * parámetros de búsqueda, y «Entró y salió» (`?tab=flujo`) no tiene la forma de
 * la billetera. Los dos esqueletos llegan armados del servidor; acá solo se
 * elige cuál se ve.
 */
export function TabSkeleton({ saldos, flujo }: { saldos: ReactNode; flujo: ReactNode }) {
  return useSearchParams().get('tab') === 'flujo' ? flujo : saldos
}
