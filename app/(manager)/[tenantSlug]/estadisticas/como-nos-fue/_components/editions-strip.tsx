'use client'

import { TrendingDown, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { type CSSProperties, useId } from 'react'
import { WEEKDAY_NAMES_SHORT } from '@/lib/dates/format'
import { formatNumber } from '@/lib/format/number-kind'
import { buildEventConversion } from '@/lib/salon/event-conversion'
import { eventInk } from '@/lib/salon/event-ink'
import type {
  EditionSummary,
  ReportMarketingByEvent,
  TemplateReport,
} from '@/lib/salon/events-report'
import { cn } from '@/lib/utils'
import { CuadroExportButton } from './cuadro-export-button'

/**
 * «Conversión» (02/10, antes «Todas las fechas»): todas las fechas de un
 * evento, de la más nueva a la más vieja, con la gente que trajo cada una y lo
 * que costó traerla. La respuesta a "¿este evento crece o se apaga?".
 *
 * La barra usa SU propia unidad (`--u` = una persona), no la del muro de mesas.
 * Sale del ancho de la TIRA (container query), no de la pantalla: al lado de
 * «Rentabilidad» la tira mide ~32rem en una pantalla de 1440, y con la unidad
 * por pantalla una fecha de 62 personas pisaba el texto de al lado. `--u` es el
 * menor entre 5px y lo que entra para la fecha más grande (`--max-guests`):
 * nunca se sale del renglón. Angosta (menos de 56rem), la barra baja a su
 * propio renglón. Dentro de la tira sigue siendo UNA sola unidad, así que un
 * Ramen de 53 y otro de 4 se comparan de un vistazo. Sin línea de tendencia ni
 * proyección: con dos a siete ediciones, una recta es adivinación con estética
 * de dato.
 *
 * Todo lo que se lee (filas, segunda línea de pauta, resumen agrupado, «la
 * mejor», las colapsadas) sale de `buildEventConversion`, la misma función que
 * arma su planilla (`eventConversionToCsv`): acá solo se dibuja.
 */

/**
 * `'2026-10-03'` → `'03/10 vie'`, armado a mano: el `Intl` del server y el del
 * navegador no siempre dan la misma abreviatura y rompían la hidratación.
 */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  const weekday = WEEKDAY_NAMES_SHORT[dt.getUTCDay()] ?? ''
  return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')} ${weekday}`
}

function avgText(avg: number | null): string {
  if (avg === null) return '—'
  return formatNumber(avg, 1)
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
        // Fila-link: hover sin transición (se recorre la lista con el mouse) y
        // foco «adentro». Lo que todavía no pasó lo dicen el texto y la barra
        // punteada, sin bajar la opacidad (bajaría el contraste del texto).
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 outline-(--ring) -outline-offset-2 hover:bg-hover focus-visible:outline-2 active:bg-active"
      >
        <span className="w-24 shrink-0 type-caption type-amount text-muted-foreground">
          {dayLabel(edition.date)}
        </span>

        <span className="flex shrink-0 items-baseline gap-1">
          <span className="text-xl leading-none font-semibold type-amount">
            {formatNumber(guests)}
          </span>
          <span className="type-caption text-muted-foreground">
            {guests === 1 ? 'persona' : 'personas'}
          </span>
        </span>

        <span className="shrink-0 type-caption type-amount text-muted-foreground">
          {reservations} {reservations === 1 ? 'reserva' : 'reservas'} · {avgText(edition.avg)} c/u
        </span>

        {/* Una unidad por persona, en la tinta del evento: la barra es la gente,
            no un porcentaje. */}
        <span className="flex min-w-0 flex-1 items-center gap-2 @max-4xl:order-1 @max-4xl:basis-full">
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

        <span className="shrink-0 type-caption tabular-nums">
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
                delta.diff > 0 ? 'text-success-text' : 'text-muted-foreground',
              )}
            >
              {delta.diff > 0 ? (
                <TrendingUp aria-hidden className="size-3.5" />
              ) : (
                <TrendingDown aria-hidden className="size-3.5" />
              )}
              {delta.diff > 0 ? '+' : ''}
              {formatNumber(delta.diff)} que el {dayLabel(delta.againstDate).slice(0, 5)}
            </span>
          )}
        </span>

        {/* Segunda línea: la pauta de esa fecha. Adentro del mismo Link, sin
            controles anidados; `pl-28` = la columna de la fecha + su gap, así
            arranca alineada con la gente. */}
        {marketingLine ? (
          <span
            className={cn(
              'basis-full pl-28 type-caption type-amount @max-4xl:order-2 @max-4xl:pl-0',
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
  exportAction,
}: {
  report: TemplateReport
  /** Pauta por `scheduled_event_id`. Sin fila = «Sin cargar». */
  marketing: ReportMarketingByEvent
  tenantSlug: string
  /** El «Exportar» del cuadro (`cuadroExport('conversion', …)`). */
  exportAction: { href: string; label: string; ariaLabel: string; title: string }
}) {
  const titleId = useId()
  // Filas, colapsadas, resumen y textos salen de `buildEventConversion`, la
  // misma función que arma la planilla del cuadro: pantalla = CSV.
  const data = buildEventConversion(report, marketing)

  // La tinta del template: el mismo tono que el muro de la ficha de arriba.
  const ink = eventInk(report.colorHex)

  return (
    <section
      aria-labelledby={titleId}
      style={
        {
          ...(ink ? { '--ev-l': ink.light, '--ev-d': ink.dark } : {}),
          '--max-guests': data.maxGuests,
        } as CSSProperties
      }
      className="ev-ink @container min-w-0 rounded-xl border border-border bg-card text-card-foreground"
    >
      {/* Cabecera (C4): igual que «Rentabilidad». Los dos resúmenes de
          siempre (la mejor y la pauta agrupada) bajan debajo del subtítulo,
          alineados a la izquierda: a la derecha va «Exportar». */}
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="type-subtitle text-foreground">
            {data.title}
            {/* Entero o nada: a 360 px baja de renglón sin partirse. */}
            <span className="ml-2 inline-block whitespace-nowrap type-caption font-normal text-muted-foreground">
              {data.countLabel}
            </span>
          </h2>
          <CuadroExportButton {...exportAction} />
        </div>
        <p className="mt-1 type-caption text-muted-foreground">{data.subtitle}</p>
        {data.bestText || data.summary ? (
          <div className="mt-2 space-y-0.5">
            {data.bestText ? (
              <p className="type-caption text-muted-foreground">{data.bestText}</p>
            ) : null}
            {data.summary ? (
              <p className="type-caption text-muted-foreground">
                {data.summary.text}
                {data.summary.pendingText ? (
                  <>
                    {' · '}
                    <span className="text-warning-text">{data.summary.pendingText}</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </header>

      <ul className="divide-y divide-border [--u:min(5px,calc((100cqw_-_2rem)/var(--max-guests)))] @4xl:[--u:min(5px,calc((100cqw_-_36rem)/var(--max-guests)))]">
        {data.rows.map((r) => (
          <Row
            key={r.edition.eventId ?? r.edition.key}
            edition={r.edition}
            delta={r.delta}
            isBest={r.isBest}
            href={`/${tenantSlug}/estadisticas/como-nos-fue?vista=dia&dia=${r.edition.date}`}
            marketingLine={r.marketingLine}
          />
        ))}
      </ul>

      {data.collapsedText ? (
        <p className="border-t border-border px-4 py-2.5 type-caption text-muted-foreground">
          {data.collapsedText}
        </p>
      ) : null}
    </section>
  )
}
