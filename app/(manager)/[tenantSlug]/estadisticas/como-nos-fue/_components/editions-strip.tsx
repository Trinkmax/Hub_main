'use client'

import { TrendingDown, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { eventInk } from '@/lib/salon/event-ink'
import {
  type EventMarketingRow,
  editionMarketingLine,
  type MarketingPhase,
  type PoolItem,
  pooledStripSummary,
} from '@/lib/salon/event-marketing'
import {
  type EditionSummary,
  editionDelta,
  type ReportMarketingByEvent,
  type TemplateReport,
} from '@/lib/salon/events-report'
import { cn } from '@/lib/utils'

/**
 * Todas las fechas de un evento, de la más nueva a la más vieja: la respuesta a
 * "¿este evento crece o se apaga?".
 *
 * La barra usa SU propia unidad (`--u` = una persona: 3px, 5px desde `sm`), no
 * la del muro de mesas. Son dos gráficos distintos: con el asiento del muro
 * (7px / 9px) las barras crecían un tercio y se salían de la fila en las fechas
 * grandes. Dentro de la tira sí es una sola unidad, así que un Ramen de 53 y
 * otro de 4 se comparan de un vistazo. Sin línea de tendencia ni proyección: con
 * dos a siete ediciones, una recta es adivinación con estética de dato.
 *
 * La pauta va como segunda línea de cada fecha, y el resumen agrupado arriba a
 * la derecha solo con 2 fechas o más con mensajes: con una sola, el "total" es
 * esa fecha con otro nombre. Todo el texto sale de `lib/salon/event-marketing`.
 */

const nf = new Intl.NumberFormat('es-AR')

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  const weekday = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' })
    .format(dt)
    .replace('.', '')
  return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')} ${weekday}`
}

function avgText(avg: number | null): string {
  if (avg === null) return '—'
  return avg.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/**
 * La fase de pauta de una edición sale de las MISMAS banderas que la tira ya
 * usa para "es esta noche" / "todavía no pasó": las dos lecturas del mismo día
 * no pueden contradecirse en la misma fila.
 */
function editionPhase(e: Pick<EditionSummary, 'isFuture' | 'isTonight'>): MarketingPhase {
  return e.isTonight ? 'tonight' : e.isFuture ? 'future' : 'past'
}

function rowOf(e: EditionSummary, marketing: ReportMarketingByEvent): EventMarketingRow | null {
  return marketing[e.eventId ?? e.key] ?? null
}

function Row({
  edition,
  delta,
  isBest,
  href,
  marketingLine,
}: {
  edition: EditionSummary
  delta: { diff: number; againstDate: string } | null
  isBest: boolean
  href: string
  marketingLine: { text: string; tone: 'muted' | 'warning' } | null
}) {
  const { guests, reservations, isFuture, isTonight } = edition
  // Hoy se dibuja como una fecha que todavía se está moviendo, no como historia.
  const enCurso = isFuture || isTonight
  return (
    <li>
      <Link
        href={href}
        className={cn(
          'flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-secondary/40',
          enCurso && 'opacity-80',
        )}
      >
        <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {dayLabel(edition.date)}
        </span>

        <span className="flex shrink-0 items-baseline gap-1">
          <span className="font-serif text-xl font-semibold tabular-nums leading-none">
            {nf.format(guests)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {guests === 1 ? 'persona' : 'personas'}
          </span>
        </span>

        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {reservations} {reservations === 1 ? 'reserva' : 'reservas'} · {avgText(edition.avg)} c/u
        </span>

        {/* Una unidad por persona, en la tinta del evento: la barra es la gente,
            no un porcentaje. */}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span
            aria-hidden
            style={{ width: `calc(var(--u) * ${guests})` }}
            className={cn(
              'h-3 shrink-0 rounded-sm border',
              enCurso
                ? 'border-dashed border-(--ev)/50 bg-(--ev)/10'
                : 'border-(--ev) bg-(--ev)/30',
            )}
          />
        </span>

        <span className="shrink-0 text-[11px] tabular-nums">
          {enCurso ? (
            <span className="text-muted-foreground">
              {isTonight ? 'es esta noche' : 'todavía no pasó'}
            </span>
          ) : delta === null ? (
            <span className="text-muted-foreground">{isBest ? 'la mejor' : 'primera fecha'}</span>
          ) : delta.diff === 0 ? (
            <span className="text-muted-foreground">igual que la anterior</span>
          ) : (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                delta.diff > 0 ? 'text-success' : 'text-muted-foreground',
              )}
            >
              {delta.diff > 0 ? (
                <TrendingUp className="size-3.5" />
              ) : (
                <TrendingDown className="size-3.5" />
              )}
              {delta.diff > 0 ? '+' : ''}
              {nf.format(delta.diff)} que el {dayLabel(delta.againstDate).slice(0, 5)}
            </span>
          )}
        </span>

        {/* Segunda línea: la pauta de esa fecha. Adentro del mismo Link, sin
            controles anidados; `pl-28` = la columna de la fecha + su gap, así
            arranca alineada con la gente. */}
        {marketingLine ? (
          <span
            className={cn(
              'basis-full pl-28 font-mono text-[11px]',
              marketingLine.tone === 'warning' ? 'text-warning-text' : 'text-muted-foreground',
            )}
          >
            {marketingLine.text}
          </span>
        ) : null}
      </Link>
    </li>
  )
}

export function EditionsStrip({
  report,
  marketing,
  tenantSlug,
}: {
  report: TemplateReport
  /** Pauta por `scheduled_event_id`. Sin fila = «Sin cargar». */
  marketing: ReportMarketingByEvent
  tenantSlug: string
}) {
  const conPauta = (e: EditionSummary) => (rowOf(e, marketing)?.adSpendUsdCents ?? 0) > 0
  // Una fecha colapsa al pie solo si no tuvo reservas NI plata gastada: la pauta
  // de una fecha que nadie reservó es justamente la que el dueño tiene que ver.
  const listables = report.editions.filter((e) => e.reservations > 0 || conPauta(e))
  const vacias = report.editions.filter((e) => e.reservations === 0 && !conPauta(e))
  // Cuando TODAS están en cero no se colapsan: son todo lo que hay, y un cero
  // es información distinta de un hueco.
  const listadas = listables.length > 0 ? listables : report.editions
  const colapsadas = listables.length > 0 ? vacias : []

  // La segunda línea aparece solo si el evento tiene al menos una fila de pauta:
  // un evento que nunca se pautó no tiene por qué llenarse de "Pauta sin cargar".
  const hayPauta = report.editions.some((e) => rowOf(e, marketing) !== null)
  const items: PoolItem[] = report.editions.map((e) => ({
    phase: editionPhase(e),
    reservations: e.reservations,
    guests: e.guests,
    // La gente con la que se multiplica la plata (ver `MarketingBlock`): la
    // suma del mes la necesita para poder totalizar el resultado.
    billableGuests: e.billableGuests,
    row: rowOf(e, marketing),
  }))
  const resumen = hayPauta ? pooledStripSummary(items) : null

  // La tinta del template: el mismo tono que el muro de la ficha de arriba.
  const ink = eventInk(report.colorHex)

  return (
    <div
      style={ink ? ({ '--ev-l': ink.light, '--ev-d': ink.dark } as CSSProperties) : undefined}
      className="ev-ink card-hairline rounded-xl border bg-card [--u:3px] sm:[--u:5px]"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-4 py-3">
        <h2 className="font-serif text-base font-semibold tracking-tight">
          Todas las fechas
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {report.editions.length} en el calendario
          </span>
        </h2>
        {report.best || resumen ? (
          <div className="space-y-0.5 sm:text-right">
            {report.best ? (
              <p className="text-[11px] text-muted-foreground">
                La mejor: {dayLabel(report.best.date).slice(0, 5)} con{' '}
                {nf.format(report.best.guests)} personas
                {report.reference
                  ? ` · promedio ${nf.format(report.reference.avgGuests)} en ${report.reference.editions} fechas`
                  : ''}
              </p>
            ) : null}
            {resumen ? (
              <p className="text-[11px] text-muted-foreground">
                {resumen.text}
                {resumen.pendingText ? (
                  <>
                    {' · '}
                    <span className="text-warning-text">{resumen.pendingText}</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </header>

      <ul className="divide-y divide-border/60">
        {listadas.map((e) => {
          const index = report.editions.indexOf(e)
          return (
            <Row
              key={e.eventId}
              edition={e}
              delta={editionDelta(report.editions, index)}
              isBest={report.best?.date === e.date}
              href={`/${tenantSlug}/estadisticas/como-nos-fue?vista=dia&dia=${e.date}`}
              marketingLine={
                hayPauta ? editionMarketingLine(e, rowOf(e, marketing), editionPhase(e)) : null
              }
            />
          )
        })}
      </ul>

      {colapsadas.length > 0 ? (
        <p className="border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
          {colapsadas.length} {colapsadas.length === 1 ? 'fecha más' : 'fechas más'} sin ninguna
          reserva: {colapsadas.map((e) => dayLabel(e.date).slice(0, 5)).join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
