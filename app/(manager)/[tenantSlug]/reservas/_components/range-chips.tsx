'use client'

import { CalendarRange } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { DatePresetRange, ReservationDatePreset } from '@/lib/salon/date-presets'
import { cn } from '@/lib/utils'

/**
 * Chips de período arriba de la lista: Hoy · Esta semana · Este mes · Rango.
 *
 * Antes el único modo visible era "día" y el rango vivía escondido en el sheet
 * "Más" — el dueño no podía ver la agenda de la semana sin ir flecha por flecha.
 * Los presets se calculan en el server (`lib/salon/date-presets.ts`) y llegan
 * ya resueltos para que el chip y la query no puedan discrepar.
 */
export function ReservationRangeChips({
  tenantSlug,
  active,
  week,
  month,
  from,
  to,
}: {
  tenantSlug: string
  active: ReservationDatePreset
  week: DatePresetRange
  month: DatePresetRange
  from?: string
  to?: string
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [rangeOpen, setRangeOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from ?? '')
  const [draftTo, setDraftTo] = useState(to ?? '')

  function push(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp?.toString() ?? '')
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    // Cambiar de período siempre vuelve a la primera página.
    next.delete('page')
    const qs = next.toString()
    startTransition(() => router.push(`/${tenantSlug}/reservas${qs ? `?${qs}` : ''}`))
  }

  function applyRange(range: DatePresetRange) {
    // `servicio` se borra: el corte por servicio es una lectura del DÍA y en modo
    // rango no hay chips que lo muestren. Si sobrevive, la agenda del mes lista 8
    // reservas mientras la barra dice 130 y nada explica la diferencia.
    push({ from: range.from, to: range.to, day: null, servicio: null })
  }

  function applyDraft() {
    if (!draftFrom && !draftTo) return
    // Un solo extremo cargado: lo usamos para los dos, así el rango es un día
    // concreto en vez de una lista abierta que confunde.
    const nextFrom = draftFrom || draftTo
    const nextTo = draftTo || draftFrom
    if (nextFrom > nextTo) return
    setRangeOpen(false)
    applyRange({ from: nextFrom, to: nextTo })
  }

  const invalidDraft = Boolean(draftFrom && draftTo && draftFrom > draftTo)

  return (
    <div className="flex flex-wrap items-center gap-2" data-tour="reservas-periodo">
      <Chip
        label="Hoy"
        active={active === 'today'}
        disabled={pending}
        onClick={() => push({ from: null, to: null, day: null, servicio: null })}
      />
      <Chip
        label="Esta semana"
        active={active === 'week'}
        disabled={pending}
        onClick={() => applyRange(week)}
      />
      <Chip
        label="Este mes"
        active={active === 'month'}
        disabled={pending}
        onClick={() => applyRange(month)}
      />

      <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={pending}
            className={cn(
              'inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              active === 'range'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
            )}
          >
            <CalendarRange className="size-4" />
            {active === 'range' && from && to ? 'Rango elegido' : 'Rango'}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Rango de fechas</p>
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="range-from" className="text-xs text-muted-foreground">
                Desde
              </Label>
              <Input
                id="range-from"
                type="date"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="range-to" className="text-xs text-muted-foreground">
                Hasta
              </Label>
              <Input
                id="range-to"
                type="date"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
          {invalidDraft ? (
            <p className="text-xs text-destructive">La fecha "Desde" tiene que ser anterior.</p>
          ) : null}
          <Button
            type="button"
            className="h-11 w-full"
            disabled={invalidDraft || (!draftFrom && !draftTo)}
            onClick={applyDraft}
          >
            Ver ese rango
          </Button>
        </PopoverContent>
      </Popover>
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
