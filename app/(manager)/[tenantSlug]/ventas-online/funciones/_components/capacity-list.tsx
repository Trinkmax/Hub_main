'use client'

import { CalendarPlus, Loader2, Minus, Pencil, Plus, TriangleAlert, Users } from 'lucide-react'
import Link from 'next/link'
import { type CSSProperties, type FormEvent, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { eventInk } from '@/lib/salon/event-ink'
import { setFunctionCapacity } from '@/lib/ticketing/actions'
import {
  type CapacityTone,
  capacityBelowReserved,
  capacityPercent,
  capacityView,
  FUNCTION_CAPACITY_MAX,
  filmsOf,
  groupByMonth,
  parseCapacityDraft,
} from '@/lib/ticketing/capacity'
import { formatShortDate } from '@/lib/ticketing/dates'
import type { CapacityFunction } from '@/lib/ticketing/queries'
import { cn } from '@/lib/utils'
import { RetryButton } from '../../_components/retry-button'

export type CapacityResult = { ok: true; functions: CapacityFunction[] } | { ok: false }

const TONE_CLASS: Record<CapacityTone, string> = {
  open: 'text-muted-foreground',
  last: 'font-medium text-warning-text',
  full: 'font-medium text-destructive',
  over: 'font-medium text-destructive',
}

/**
 * Las funciones que vienen, mes por mes, con su cupo a un toque. Arriba, una película por chip
 * para ver solo esa (`?pelicula=`). Cada cupo se guarda solo y la página se vuelve a pedir con
 * los números nuevos.
 */
export function CapacityList({
  tenantSlug,
  result,
  film,
}: {
  tenantSlug: string
  result: CapacityResult
  /** El slug de la película elegida en los chips, si hay. */
  film: string | null
}) {
  if (!result.ok) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="No pudimos cargar las funciones"
        description="Suele ser algo de un momento. Probá de nuevo."
        action={<RetryButton />}
        className="py-10"
      />
    )
  }

  if (result.functions.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No hay funciones por delante"
        description="Cuando una película tenga fechas en el calendario, aparecen acá con su cupo."
        action={
          <Button asChild variant="outline" className="h-11 sm:h-9">
            <Link href={`/${tenantSlug}/eventos/programados`}>
              <CalendarPlus className="size-4" aria-hidden />
              Ir al calendario
            </Link>
          </Button>
        }
        className="py-10"
      />
    )
  }

  const films = filmsOf(result.functions)
  const chosen = films.find((f) => f.slug === film) ?? null
  const shown = chosen ? result.functions.filter((fn) => fn.slug === chosen.slug) : result.functions
  const base = `/${tenantSlug}/ventas-online/funciones`

  return (
    <div className="space-y-4">
      {films.length > 1 ? (
        <nav aria-label="Ver por película" className="-mx-1 flex flex-wrap gap-2 px-1">
          <FilmChip href={base} active={!chosen}>
            Todas
            <span className="tabular-nums opacity-70">{result.functions.length}</span>
          </FilmChip>
          {films.map((f) => (
            <FilmChip
              key={f.slug}
              href={`${base}?pelicula=${encodeURIComponent(f.slug)}`}
              active={chosen?.slug === f.slug}
            >
              {f.title}
              <span className="tabular-nums opacity-70">{f.count}</span>
            </FilmChip>
          ))}
        </nav>
      ) : null}

      {groupByMonth(shown).map((month) => {
        const headingId = `mes-${month.key}`
        return (
          <section
            key={month.key}
            aria-labelledby={headingId}
            className="card-hairline overflow-hidden rounded-xl border bg-card"
          >
            <header className="flex items-baseline justify-between gap-4 border-b border-border/60 px-4 py-3 sm:px-5">
              <h2 id={headingId} className="font-serif text-lg font-semibold tracking-tight">
                {month.title}
              </h2>
              <p className="text-sm text-muted-foreground tabular-nums">
                {month.functions.length === 1 ? '1 función' : `${month.functions.length} funciones`}
              </p>
            </header>
            <ul className="divide-y divide-border/60">
              {month.functions.map((fn) => (
                <li key={fn.eventId}>
                  <FunctionRow tenantSlug={tenantSlug} fn={fn} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function FilmChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors sm:h-9',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
      )}
    >
      {children}
    </Link>
  )
}

/** «Hay 48 reservados y 2 pagando ahora.» / «Todavía no hay reservas.» */
function reservedHint(fn: Pick<CapacityFunction, 'reserved' | 'paying'>): string {
  const paying = fn.paying > 0 ? ` y ${fn.paying} pagando ahora` : ''
  if (fn.reserved === 0) {
    return fn.paying > 0
      ? `Todavía no hay reservas, y ${fn.paying} están pagando ahora.`
      : 'Todavía no hay reservas.'
  }
  const reserved = fn.reserved === 1 ? 'Hay 1 reservado' : `Hay ${fn.reserved} reservados`
  return `${reserved}${paying}.`
}

/** «Sáb 15 nov · 20:30» */
function whenLabel(fn: Pick<CapacityFunction, 'date' | 'time'>): string {
  return `${formatShortDate(fn.date)} · ${fn.time}`
}

/**
 * Una función: cuándo, qué película, la barrita de lo reservado con la tinta de la película, y
 * el cupo a la derecha, que se toca para cambiarlo.
 */
function FunctionRow({ tenantSlug, fn }: { tenantSlug: string; fn: CapacityFunction }) {
  const view = capacityView(fn)
  const ink = eventInk(fn.accent)
  return (
    <div
      style={ink ? ({ '--ev-l': ink.light, '--ev-d': ink.dark } as CSSProperties) : undefined}
      className="ev-ink flex items-start justify-between gap-4 px-4 py-3.5 sm:px-5"
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div>
          <p className="text-sm font-semibold tabular-nums">{whenLabel(fn)}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-(--ev)" />
            <span className="truncate">{fn.title}</span>
            {fn.published ? null : (
              <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] font-medium uppercase leading-4 tracking-wide">
                Apagada
              </span>
            )}
          </p>
        </div>
        <div className="flex max-w-sm items-center gap-2.5">
          <div aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full',
                view.tone === 'full' || view.tone === 'over' ? 'bg-destructive' : 'bg-(--ev)',
              )}
              style={{ width: `${capacityPercent(fn)}%` }}
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{fn.reserved}</span> reservados
          </span>
        </div>
        <p className={cn('text-xs tabular-nums', TONE_CLASS[view.tone])}>{view.label}</p>
      </div>

      <CapacityEditor tenantSlug={tenantSlug} fn={fn} />
    </div>
  )
}

/**
 * El cupo, a un toque: un popover con el número, menos y más, y Guardar. No baja de lo
 * reservado (lo dice antes de mandar, y la action lo vuelve a mirar).
 */
function CapacityEditor({ tenantSlug, fn }: { tenantSlug: string; fn: CapacityFunction }) {
  const ids = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(String(fn.capacity))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const inputId = `${ids}-cupo`
  const hintId = `${ids}-ayuda`
  const errorId = `${ids}-error`
  const min = Math.max(1, fn.reserved)
  const parsed = parseCapacityDraft(draft)
  const dirty = !parsed.ok || parsed.capacity !== fn.capacity

  function onOpenChange(next: boolean) {
    if (pending) return
    if (next) {
      setDraft(String(fn.capacity))
      setError(null)
    }
    setOpen(next)
  }

  function step(delta: number) {
    const current = parsed.ok ? parsed.capacity : fn.capacity
    const next = Math.min(FUNCTION_CAPACITY_MAX, Math.max(min, current + delta))
    setDraft(String(next))
    setError(null)
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    const below = capacityBelowReserved(parsed.capacity, fn.reserved)
    if (below) {
      setError(below)
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await setFunctionCapacity(tenantSlug, {
        event_id: fn.eventId,
        capacity: parsed.capacity,
      })
      if (result.ok) {
        setOpen(false)
        toast.success(`${fn.title}, ${whenLabel(fn)}`, { description: result.message })
      } else {
        setError(result.message)
      }
    })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex h-14 min-w-[4.75rem] shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-background px-3 transition-[transform,background-color] duration-150 ease-out hover:bg-secondary active:scale-[0.97] sm:h-12"
          aria-label={`Cupo de ${fn.title}, ${whenLabel(fn)}: ${fn.capacity}. Cambiar`}
        >
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Cupo
          </span>
          <span className="flex items-center gap-1.5 font-mono text-lg font-semibold leading-tight tabular-nums">
            {fn.capacity}
            <Pencil
              className="size-3 text-muted-foreground transition-colors group-hover:text-foreground"
              aria-hidden
            />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-4">
        <form onSubmit={save} className="space-y-3">
          <div>
            <p className="font-serif text-base font-semibold leading-tight">{fn.title}</p>
            <p className="text-xs text-muted-foreground tabular-nums">{whenLabel(fn)}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={inputId}>¿Cuántas personas entran?</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0 sm:size-9"
                onClick={() => step(-1)}
                disabled={pending || (parsed.ok && parsed.capacity <= min)}
                aria-label="Uno menos"
              >
                <Minus className="size-4" aria-hidden />
              </Button>
              <Input
                id={inputId}
                type="number"
                inputMode="numeric"
                min={min}
                max={FUNCTION_CAPACITY_MAX}
                step={1}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setError(null)
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                disabled={pending}
                className="h-11 min-w-0 flex-1 text-center font-mono text-lg font-semibold tabular-nums sm:h-9"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0 sm:size-9"
                onClick={() => step(1)}
                disabled={pending || (parsed.ok && parsed.capacity >= FUNCTION_CAPACITY_MAX)}
                aria-label="Uno más"
              >
                <Plus className="size-4" aria-hidden />
              </Button>
            </div>
            <p id={hintId} className="text-xs text-muted-foreground tabular-nums">
              {reservedHint(fn)} La cartelera se actualiza sola.
            </p>
            {error ? (
              <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <Button type="submit" className="h-11 w-full sm:h-9" disabled={pending || !dirty}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
