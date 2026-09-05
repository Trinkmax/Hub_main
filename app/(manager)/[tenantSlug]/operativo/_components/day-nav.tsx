'use client'

import { CalendarDays, ChevronLeft, ChevronRight, ScanLine, Wifi, WifiOff } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta))
  return dt.toISOString().slice(0, 10)
}

function parseIso(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

/** "sábado 5 de septiembre" */
function longLabel(day: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(parseIso(day))
}

/** "sáb 5 sep" */
function shortLabel(day: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(parseIso(day))
    .replace(/\./g, '')
}

function relativeDay(date: string, today: string): 'today' | 'yesterday' | 'tomorrow' | null {
  if (date === today) return 'today'
  if (date === shiftDay(today, -1)) return 'yesterday'
  if (date === shiftDay(today, 1)) return 'tomorrow'
  return null
}

/**
 * La cabecera del día: dónde estoy parado y cómo me muevo.
 *
 * "Hoy" es el día de SERVICIO (hasta las 5 AM sigue siendo la noche
 * anterior), así que cuando no coincide con el calendario se dice con todas las
 * letras. Las flechas mueven de a un día; el título abre un calendario nativo
 * para saltos largos. El punto "en vivo" cuenta si Realtime está conectado.
 */
export function DayNav({
  date,
  today,
  onChange,
  live,
  tenantSlug,
  canAward,
}: {
  date: string
  today: string
  onChange: (date: string) => void
  live: 'connecting' | 'live' | 'offline'
  tenantSlug: string
  canAward: boolean
}) {
  const [open, setOpen] = useState(false)
  const rel = relativeDay(date, today)
  const eyebrow =
    rel === 'today'
      ? 'Hoy'
      : rel === 'yesterday'
        ? 'Ayer'
        : rel === 'tomorrow'
          ? 'Mañana'
          : date < today
            ? 'Pasado'
            : 'Próximamente'

  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span>Operativo</span>
            <span aria-hidden>·</span>
            <span className={cn(rel === 'today' && 'text-primary')}>{eyebrow}</span>
            <LiveDot state={live} />
          </p>

          <div className="mt-1 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 rounded-full"
              aria-label="Día anterior"
              onClick={() => onChange(shiftDay(date, -1))}
            >
              <ChevronLeft className="size-5" aria-hidden />
            </Button>

            <h1 className="min-w-0 truncate font-serif text-2xl font-semibold capitalize leading-none tracking-tight sm:text-3xl">
              {longLabel(date)}
            </h1>

            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 rounded-full text-muted-foreground"
                  aria-label={`Elegir otro día (viendo ${longLabel(date)})`}
                >
                  <CalendarDays className="size-5" aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Ir a un día
                </p>
                <Input
                  type="date"
                  defaultValue={date}
                  className="h-11"
                  aria-label="Fecha"
                  min="2020-01-01"
                  max="2100-12-31"
                  onChange={(e) => {
                    const v = e.target.value
                    // Mientras se tipea el año en desktop el valor pasa por
                    // fechas absurdas ("0002-09-05"): esperar a un año real.
                    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2020) {
                      setOpen(false)
                      onChange(v)
                    }
                  }}
                />
                {rel !== 'today' ? (
                  <Button
                    variant="secondary"
                    className="h-11 w-full"
                    onClick={() => {
                      setOpen(false)
                      onChange(today)
                    }}
                  >
                    Volver a hoy · {shortLabel(today)}
                  </Button>
                ) : null}
              </PopoverContent>
            </Popover>

            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 rounded-full"
              aria-label="Día siguiente"
              onClick={() => onChange(shiftDay(date, 1))}
            >
              <ChevronRight className="size-5" aria-hidden />
            </Button>
          </div>
        </div>

        {/* Acciones globales, siempre a mano. En mobile el buscador las repite. */}
        <div className="hidden items-center gap-2 sm:flex">
          {canAward ? (
            <Button asChild variant="outline" className="h-11 gap-2 rounded-full px-4">
              <Link href={`/${tenantSlug}/acreditar`} prefetch={false}>
                <ScanLine className="size-4" aria-hidden />
                Escanear QR
              </Link>
            </Button>
          ) : null}
          <Button asChild className="h-11 gap-2 rounded-full px-4">
            <Link href={`/${tenantSlug}/reservas/nuevo?date=${date}`} prefetch={false}>
              Nueva reserva
            </Link>
          </Button>
        </div>
      </div>

      {rel !== 'today' ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span>
            Estás viendo <strong className="capitalize">{shortLabel(date)}</strong>
            {date > today ? ' · todavía no se puede marcar llegadas.' : '.'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => onChange(today)}
          >
            Volver a hoy
          </Button>
        </div>
      ) : null}
    </header>
  )
}

function LiveDot({ state }: { state: 'connecting' | 'live' | 'offline' }) {
  if (state === 'offline') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-destructive">
        <WifiOff className="size-3" aria-hidden />
        Sin conexión
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 normal-case tracking-normal"
      title={state === 'live' ? 'En vivo: los cambios del salón aparecen solos' : 'Conectando…'}
    >
      <span className="relative flex size-2">
        {state === 'live' ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60 [animation-duration:2.4s] motion-reduce:hidden" />
        ) : null}
        <span
          className={cn(
            'relative inline-flex size-2 rounded-full',
            state === 'live' ? 'bg-success' : 'bg-muted-foreground/40',
          )}
        />
      </span>
      <Wifi className="size-3 text-muted-foreground" aria-hidden />
      <span className="sr-only">{state === 'live' ? 'En vivo' : 'Conectando'}</span>
    </span>
  )
}
