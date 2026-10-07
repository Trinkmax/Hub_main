'use client'

import { CalendarRange } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { PeriodChip } from '../_lib/period'

/** Lo que se borra al cambiar de período: la página y los períodos viejos. */
const RESET_PARAMS = ['despues', 'mes', 'desde', 'hasta']

/**
 * Chips de período arriba de una lista (Este mes · Mes pasado · … · Rango),
 * con el estilo de los de Reservas. El período viaja en `?periodo=` (la URL se
 * comparte y «atrás» funciona); cambiarlo vuelve a la primera página.
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
  /** «Del 01/10/2026 al 31/10/2026». */
  label: string
  /** Último día que se puede elegir (hoy). */
  max?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)

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
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          label={chip.label}
          active={active === chip.value}
          disabled={pending}
          onClick={() => go(chip.value)}
        />
      ))}
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
            aria-pressed={active === null}
            className={cn(
              'inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:opacity-60',
              active === null
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
            )}
          >
            <CalendarRange className="size-4" aria-hidden />
            {active === null ? 'Rango elegido' : 'Rango'}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Rango de fechas</p>
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="periodo-desde" className="text-xs text-muted-foreground">
                Desde
              </Label>
              <Input
                id="periodo-desde"
                type="date"
                value={draftFrom}
                max={max}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="periodo-hasta" className="text-xs text-muted-foreground">
                Hasta
              </Label>
              <Input
                id="periodo-hasta"
                type="date"
                value={draftTo}
                max={max}
                onChange={(e) => setDraftTo(e.target.value)}
                className="h-11"
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
      <span className="text-xs tabular-nums text-muted-foreground">{label}</span>
    </div>
  )
}

function Chip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string
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
      className={cn(
        'inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:opacity-60',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
      )}
    >
      {label}
    </button>
  )
}
