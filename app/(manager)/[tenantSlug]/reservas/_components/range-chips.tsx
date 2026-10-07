'use client'

import { CalendarRange } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Field, FieldRow } from '@/components/ui/field'
import { FilterChip } from '@/components/ui/filter-chip'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { formatRange } from '@/lib/dates/format'
import type { DatePresetRange, ReservationDatePreset } from '@/lib/salon/date-presets'

/**
 * Chips de período arriba de la lista: Hoy · Esta semana · Este mes · Rango.
 *
 * Antes el único modo visible era "día" y el rango vivía escondido en el sheet
 * "Más" — el dueño no podía ver la agenda de la semana sin ir flecha por flecha.
 * Los presets se calculan en el server (`lib/salon/date-presets.ts`) y llegan
 * ya resueltos para que el chip y la query no puedan discrepar.
 *
 * Son los `FilterChip` del kit (el elegido lleva contorno verde y un tilde);
 * «Rango» abre un popover con dos `DatePicker` (se tipea «15/9» o se elige en
 * el calendario) en lugar de los `type="date"` del navegador.
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
    <fieldset className="flex min-w-0 flex-wrap items-center gap-2" data-tour="reservas-periodo">
      <legend className="sr-only">Período</legend>
      <FilterChip
        pressed={active === 'today'}
        disabled={pending}
        onClick={() => push({ from: null, to: null, day: null, servicio: null })}
      >
        Hoy
      </FilterChip>
      <FilterChip pressed={active === 'week'} disabled={pending} onClick={() => applyRange(week)}>
        Esta semana
      </FilterChip>
      <FilterChip pressed={active === 'month'} disabled={pending} onClick={() => applyRange(month)}>
        Este mes
      </FilterChip>

      <Popover
        open={rangeOpen}
        onOpenChange={(open) => {
          // Al abrir arranca con el rango que se está viendo.
          if (open) {
            setDraftFrom(from ?? '')
            setDraftTo(to ?? '')
          }
          setRangeOpen(open)
        }}
      >
        <PopoverTrigger asChild>
          <FilterChip pressed={active === 'range'} icon={CalendarRange} disabled={pending}>
            {active === 'range' && from && to ? formatRange(from, to) : 'Rango'}
          </FilterChip>
        </PopoverTrigger>
        <PopoverContent align="start" size="lg" className="grid gap-4">
          <PopoverHeader>
            <PopoverTitle>Rango de fechas</PopoverTitle>
            <PopoverDescription>Con una sola fecha se ve ese día.</PopoverDescription>
          </PopoverHeader>
          <FieldRow>
            <Field
              label="Desde"
              error={invalidDraft ? 'Tiene que ser antes de «Hasta».' : undefined}
            >
              <DatePicker
                value={draftFrom || null}
                onValueChange={(iso) => setDraftFrom(iso ?? '')}
              />
            </Field>
            <Field label="Hasta">
              <DatePicker
                value={draftTo || null}
                min={draftFrom || undefined}
                onValueChange={(iso) => setDraftTo(iso ?? '')}
              />
            </Field>
          </FieldRow>
          <Button
            type="button"
            className="w-full"
            disabled={invalidDraft || (!draftFrom && !draftTo)}
            onClick={applyDraft}
          >
            Ver ese rango
          </Button>
        </PopoverContent>
      </Popover>
    </fieldset>
  )
}
