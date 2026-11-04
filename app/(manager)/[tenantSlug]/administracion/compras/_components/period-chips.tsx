'use client'

import { CalendarRange } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatRange } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { PeriodChip } from '../_lib/period'
import { SEGMENT_LIST, segmentOption } from './segment'

/** Lo que se borra al cambiar de período: la página y los períodos viejos. */
const RESET_PARAMS = ['despues', 'mes', 'desde', 'hasta', 'pagina']

/**
 * El período de una lista de Compras (Este mes · Mes pasado · … · Rango), como un segmento chico de
 * la barra. Con un rango elegido a mano, las fechas SON el control: «01/08 – 13/10/2026» abre el
 * selector. Qué fechas abarca lo elegido queda en el `title` (y para lectores).
 *
 * El período viaja en `?periodo=` como siempre (la URL se comparte y «atrás» funciona); cambiarlo
 * vuelve a la primera página.
 */
export function PeriodChips({
  chips,
  active,
  from,
  to,
  label,
  max,
}: {
  chips: readonly PeriodChip[]
  /** El valor del chip activo, o `null` si es un rango elegido a mano. */
  active: string | null
  from: string
  to: string
  /** «Del 01/10/2026 al 31/10/2026»: qué fechas abarca la píldora elegida. */
  label: string
  /** Último día que se puede elegir (hoy). */
  max?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const uid = useId()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const custom = active === null

  const go = (value: string) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const key of RESET_PARAMS) next.delete(key)
    next.set('periodo', value)
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }))
  }

  const invalid = Boolean(draftFrom && draftTo && draftFrom > draftTo)
  const applyRange = () => {
    if (!draftFrom && !draftTo) return
    const a = draftFrom || draftTo
    const b = draftTo || draftFrom
    if (a > b) return
    setOpen(false)
    go(`${a}..${b}`)
  }

  return (
    <div
      className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-busy={pending}
    >
      <div className={SEGMENT_LIST}>
        {chips.map((chip) => {
          const on = active === chip.value
          return (
            <button
              key={chip.key}
              type="button"
              aria-pressed={on}
              title={on ? label : undefined}
              disabled={pending}
              onClick={() => go(chip.value)}
              className={cn(segmentOption(on), 'not-first:border-l not-first:border-border/70')}
            >
              {chip.label}
            </button>
          )
        })}
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (next) {
              setDraftFrom(from)
              setDraftTo(to)
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={pending}
              className={cn(
                segmentOption(custom),
                'border-l border-border/70',
                custom && 'tabular-nums',
              )}
            >
              <CalendarRange aria-hidden className="size-3.5" />
              {custom ? (
                <>
                  <span className="sr-only">Rango elegido: </span>
                  {formatRange(from, to)}
                </>
              ) : (
                'Rango'
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Rango de fechas</p>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor={`${uid}-desde`} className="text-xs text-muted-foreground">
                  Desde
                </Label>
                <Input
                  id={`${uid}-desde`}
                  type="date"
                  value={draftFrom}
                  max={max}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className="h-11 text-base md:text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${uid}-hasta`} className="text-xs text-muted-foreground">
                  Hasta
                </Label>
                <Input
                  id={`${uid}-hasta`}
                  type="date"
                  value={draftTo}
                  max={max}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className="h-11 text-base md:text-sm"
                />
              </div>
            </div>
            {invalid ? (
              <p role="alert" className="text-xs text-destructive">
                El «hasta» no puede ser anterior al «desde».
              </p>
            ) : null}
            <Button
              type="button"
              className="h-11 w-full"
              disabled={invalid || (!draftFrom && !draftTo)}
              onClick={applyRange}
            >
              Ver ese rango
            </Button>
          </PopoverContent>
        </Popover>
      </div>
      {custom ? null : <span className="sr-only">{label}</span>}
    </div>
  )
}
