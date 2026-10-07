'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'
import { type Period, PeriodPicker } from '@/components/ui/period-picker'
import type { CommissionPeriod } from '@/lib/commissions/period'
import { endOfMonth, periodRange, startOfMonth } from '@/lib/dates/period'
import { cn } from '@/lib/utils'

/**
 * El rango que resolvió el server, como lo entiende el `PeriodPicker`: un solo
 * día, un mes entero o un rango libre. Así el disparador dice «Septiembre 2026»
 * cuando es el mes completo, y las flechas ‹ › corren de a mes; con «del 15 al
 * 15» corren el rango su propio largo, sin huecos ni solapes.
 */
export function commissionPeriodValue(period: Pick<CommissionPeriod, 'from' | 'to'>): Period {
  const { from, to } = period
  if (from === to) return { kind: 'day', date: from }
  if (from === startOfMonth(from) && to === endOfMonth(from)) {
    return { kind: 'month', month: from.slice(0, 7) }
  }
  return { kind: 'range', from, to }
}

/**
 * La query que se navega al elegir un período: siempre `?from=&to=` (lo que
 * lee `resolveCommissionPeriod`), mergeada con lo que ya hay para no perder el
 * `?as=` con el que el dueño mira los números de otro gestor. El `?month=`
 * viejo sigue sirviendo al ENTRAR, pero una vez elegido un rango no tiene nada
 * que hacer en la URL que se guarda como favorito.
 */
export function commissionPeriodSearch(search: string, period: Period): string {
  const { from, to } = periodRange(period)
  const params = new URLSearchParams(search)
  params.set('from', from)
  params.set('to', to)
  params.delete('month')
  return `?${params.toString()}`
}

/**
 * Filtro de período de la liquidación (kit §3.2, `PeriodPicker`): día, mes o
 * rango libre, con atajos («Este mes», «Mes pasado», «Últimos 30 días») y las
 * flechas de período anterior y siguiente.
 *
 * Vive en `/components` y no en el `_components` de una pantalla porque lo usan
 * dos rutas distintas —la liquidación del dueño y «Mis números» de la gestora— y
 * dos copias del mismo filtro terminan divergiendo justo en el borde que
 * importa (qué día entra y qué día no).
 *
 * No calcula el rango que se mira: ese lo resuelve el server con
 * `resolveCommissionPeriod` (da vuelta el rango si vino al revés, lo recorta a
 * 400 días y traduce los `?month=` viejos). Acá se elige y se empuja a la URL,
 * que es como el dueño se guarda «del 15 al 15» en un favorito. Mientras navega,
 * el disparador ya muestra lo elegido (optimista) y vuelve a lo que diga el
 * server cuando llega.
 */
export function CommissionPeriodFilter({
  period,
  className,
}: {
  period: CommissionPeriod
  className?: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [shown, setShown] = useOptimistic(commissionPeriodValue(period))

  function apply(next: Period) {
    const href = commissionPeriodSearch(searchParams.toString(), next)
    startTransition(() => {
      setShown(next)
      router.push(href, { scroll: false })
    })
  }

  return (
    <div
      data-slot="commission-period-filter"
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}
    >
      <PeriodPicker
        value={shown}
        kinds={['day', 'month', 'range']}
        onValueChange={apply}
        aria-label="Período"
      />
      {/* Qué se está mirando, en castellano y con los días: el `label` del
          server ya avisa si el rango se recortó, así que un total parcial nunca
          pasa por total. */}
      <p aria-live="polite" className="type-small text-pretty text-muted-foreground">
        {pending ? (
          'Actualizando…'
        ) : (
          <>
            Mostrando <span className="font-medium text-foreground">{period.label}</span> ·{' '}
            <span className="type-amount">{period.days}</span> {period.days === 1 ? 'día' : 'días'}
          </>
        )}
      </p>
    </div>
  )
}
