'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, useEffect, useId, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CommissionPeriod } from '@/lib/commissions/period'

/**
 * Filtro de período de la liquidación: dos fechas y listo.
 *
 * Vive en `/components` y no en el `_components` de una pantalla porque lo usan
 * dos rutas distintas —la liquidación del dueño y "Mis números" de la gestora— y
 * dos copias del mismo filtro terminan divergiendo justo en el borde que
 * importa (qué día entra y qué día no).
 *
 * No calcula fechas: el rango que se muestra siempre es el que resolvió el
 * server con `resolveCommissionPeriod`. Acá sólo se tipea y se empuja a la URL,
 * que es como el dueño se guarda "del 15 al 15" en un favorito.
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
  const fromId = useId()
  const toId = useId()
  const [from, setFrom] = useState(period.from)
  const [to, setTo] = useState(period.to)

  // El server tiene la última palabra sobre qué rango se está mirando: da vuelta
  // el rango si vino al revés, lo recorta a 400 días y traduce los links viejos
  // `?month=`. Si lo que devolvió no es lo que hay tipeado, los campos se
  // sincronizan — si no, quedarían mostrando un rango que nadie está viendo.
  useEffect(() => {
    setFrom(period.from)
    setTo(period.to)
  }, [period.from, period.to])

  const incomplete = from === '' || to === ''

  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Un campo vacío pediría medio rango: mejor no navegar que mostrar un
    // período que el dueño no eligió.
    if (incomplete || pending) return
    // Se mergea con lo que ya hay en la URL para no perder el `?as=` con el que
    // el dueño mira los números de otro gestor.
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', from)
    params.set('to', to)
    // El `?month=` viejo sigue funcionando al ENTRAR, pero una vez que se elige
    // un rango no tiene nada que hacer en la URL que se guarda como favorito.
    params.delete('month')
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false })
    })
  }

  return (
    <form
      onSubmit={apply}
      className={`card-hairline rounded-xl border bg-card/60 p-4 ${className ?? ''}`}
    >
      {/* En el celular los campos van uno debajo del otro y a lo ancho: el
          dueño abre esto con una mano. En desktop entran los tres en línea. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-[190px]">
          <Label htmlFor={fromId} className="text-xs uppercase tracking-wide text-muted-foreground">
            Desde
          </Label>
          <Input
            id={fromId}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-10 w-full"
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-[190px]">
          <Label htmlFor={toId} className="text-xs uppercase tracking-wide text-muted-foreground">
            Hasta
          </Label>
          <Input
            id={toId}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-10 w-full"
          />
        </div>
        {/* `type="submit"`: así Enter dentro de cualquiera de los dos campos
            aplica el filtro sin tener que ir hasta el botón. */}
        <Button type="submit" disabled={pending || incomplete} className="h-10 w-full sm:w-auto">
          {pending ? 'Aplicando…' : 'Aplicar'}
        </Button>
      </div>

      {/* Qué se está mirando, en castellano. `period.label` ya avisa si el rango
          se recortó, así que un total parcial nunca pasa por total. */}
      <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">
        Mostrando <span className="font-medium text-foreground">{period.label}</span> ·{' '}
        {period.days} {period.days === 1 ? 'día' : 'días'}
      </p>
    </form>
  )
}
