'use client'

import { ScanLine, WifiOff } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { PageHeader } from '@/components/ui/page-header'
import { type Period, PeriodPicker, type PeriodPickerPreset } from '@/components/ui/period-picker'
import {
  addDays,
  capitalizeFirst,
  daysBetween,
  formatDayMonth,
  monthName,
  weekdayName,
} from '@/lib/dates'
import { cn } from '@/lib/utils'

type LiveState = 'connecting' | 'live' | 'offline'

/** Lo mismo que aceptaba el calendario nativo de antes. */
const MIN_DAY = '2020-01-01'
const MAX_DAY = '2100-12-31'

/** «Sábado 5 de septiembre» (con el año si no es el de hoy). A mano, sin `Intl`. */
function dayTitle(day: string, today: string): string {
  const base = `${weekdayName(day)} ${Number(day.slice(8, 10))} de ${monthName(Number(day.slice(5, 7)))}`
  return capitalizeFirst(
    day.slice(0, 4) === today.slice(0, 4) ? base : `${base} de ${day.slice(0, 4)}`,
  )
}

/** «Hoy», «Ayer», «Mañana», «Hace 3 días», «En 5 días». */
function relativeDay(day: string, today: string): string {
  const diff = daysBetween(today, day)
  if (diff === 0) return 'Hoy'
  if (diff === -1) return 'Ayer'
  if (diff === 1) return 'Mañana'
  return diff < 0 ? `Hace ${-diff} días` : `En ${diff} días`
}

/**
 * La cabecera del día: dónde estoy parado y cómo me muevo.
 *
 * - Título: el día, con todas las letras. "Hoy" es el día de SERVICIO (hasta
 *   las 5 AM sigue siendo la noche anterior), así que el contexto lo dice.
 * - El `PeriodPicker` del kit mueve de a un día con las flechas y abre un
 *   calendario (con atajos Hoy, Mañana, Ayer) para saltos largos.
 * - «En vivo» cuenta si Realtime está conectado: el único punto que respira en
 *   la pantalla.
 * - Mirando otro día que no es hoy, un aviso con «Volver a hoy»: es fácil
 *   marcar una llegada en la noche equivocada.
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
  live: LiveState
  tenantSlug: string
  canAward: boolean
}) {
  const isToday = date === today
  const presets: PeriodPickerPreset[] = [
    { label: 'Hoy', period: { kind: 'day', date: today } },
    { label: 'Mañana', period: { kind: 'day', date: addDays(today, 1) } },
    { label: 'Ayer', period: { kind: 'day', date: addDays(today, -1) } },
  ]

  return (
    <PageHeader
      title={dayTitle(date, today)}
      context={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn(isToday && 'font-medium text-primary')}>
            {relativeDay(date, today)}
          </span>
          <span aria-hidden="true">·</span>
          {/* Cortés: si se corta la conexión, el lector lo dice sin interrumpir. */}
          <span aria-live="polite" className="inline-flex">
            <LiveIndicator state={live} />
          </span>
        </span>
      }
      actions={
        <>
          <PeriodPicker
            aria-label="Día"
            kinds={['day']}
            value={{ kind: 'day', date }}
            onValueChange={(p: Period) => {
              if (p.kind === 'day' && p.date !== date) onChange(p.date)
            }}
            today={today}
            presets={presets}
            min={MIN_DAY}
            max={MAX_DAY}
          />
          {/* En el celular estas dos viven en la barra de búsqueda, a mano. */}
          {canAward ? (
            <Button asChild variant="secondary" className="max-sm:hidden">
              <Link href={`/${tenantSlug}/acreditar`} prefetch={false}>
                <ScanLine aria-hidden="true" />
                Escanear QR
              </Link>
            </Button>
          ) : null}
          <Button asChild className="max-sm:hidden">
            <Link href={`/${tenantSlug}/reservas/nuevo?date=${date}`} prefetch={false}>
              Nueva reserva
            </Link>
          </Button>
        </>
      }
    >
      {isToday ? null : (
        <Callout
          tone="warning"
          action={
            <Button type="button" variant="secondary" size="sm" onClick={() => onChange(today)}>
              Volver a hoy
            </Button>
          }
        >
          Estás viendo el{' '}
          <strong className="font-medium text-foreground">
            {weekdayName(date)} {formatDayMonth(date)}
          </strong>
          , no hoy
          {date > today ? ': todavía no se puede marcar llegadas.' : '.'}
        </Callout>
      )}
    </PageHeader>
  )
}

function LiveIndicator({ state }: { state: LiveState }) {
  if (state === 'offline') {
    return (
      <Badge tone="danger" icon={WifiOff}>
        Sin conexión
      </Badge>
    )
  }
  const live = state === 'live'
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={live ? 'Los cambios del salón aparecen solos' : undefined}
    >
      <span aria-hidden="true" className="relative flex size-2">
        {live ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60 [animation-duration:2.4s] motion-reduce:hidden" />
        ) : null}
        <span
          className={cn(
            'relative inline-flex size-2 rounded-full',
            live ? 'bg-success' : 'bg-subtle-foreground',
          )}
        />
      </span>
      {live ? 'En vivo' : 'Conectando…'}
    </span>
  )
}
