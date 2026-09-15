import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  computeMarketingKpis,
  type EventMarketingRow,
  fichaItems,
  howItsCalculated,
  type KpiTileKind,
  kpiHint,
  type MarketingBlock,
  type MarketingPhase,
  marketingSentence,
  RETURN_DISCLAIMER,
  returnDetails,
  returnSentence,
} from '@/lib/salon/event-marketing'
import { cn } from '@/lib/utils'

/**
 * La pauta leída: lo que los socios abren para saber cuánto costó traer a la
 * gente de una fecha.
 *
 * Se lee como un informe, de arriba abajo: una oración que cuenta lo que pasó,
 * tres números con SU cuenta a la vista (nadie tiene que confiar en un número
 * que no puede rehacer), la ficha técnica en chico, el retorno aparte y con la
 * aclaración de que facturar no es ganar. Las cuentas y los textos salen
 * enteros de `lib/salon/event-marketing.ts`: acá solo se dibujan.
 *
 * Los tres números van en serif pero un escalón por debajo de los tres de
 * gente (4xl/5xl): la ficha es de la gente que entró, la pauta es el costo de
 * traerla. Todo con container queries y no con breakpoints de pantalla: en una
 * noche con dos eventos, cada ficha mide lo mismo que un celular.
 */

const TILES: ReadonlyArray<{ kind: KpiTileKind; label: string }> = [
  { kind: 'costPerMessage', label: 'Por mensaje' },
  { kind: 'closingRate', label: 'De cierre' },
  { kind: 'costPerReservation', label: 'Por reserva' },
]

const EYEBROW = 'text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground'

// Espacio duro armado por código: un NBSP literal en el fuente es invisible y
// cualquier editor lo puede cambiar por un espacio común sin que nadie lo note.
const NBSP = String.fromCharCode(0xa0)
const USD_PREFIX = `US$${NBSP}`
const PERCENT_SUFFIX = `${NBSP}%`

/**
 * La unidad va chica y gris al lado del número: `US$` adelante, `%` atrás. El
 * número es lo que se compara de una fecha a otra; la unidad ya se sabe.
 */
function KpiNumber({ value }: { value: string }) {
  if (value.startsWith(USD_PREFIX)) {
    return (
      <>
        <span className="mr-1 font-sans text-xs font-normal tracking-normal text-muted-foreground">
          US$
        </span>
        {value.slice(USD_PREFIX.length)}
      </>
    )
  }
  if (value.endsWith(PERCENT_SUFFIX)) {
    return (
      <>
        {value.slice(0, -PERCENT_SUFFIX.length)}
        <span className="ml-0.5 font-sans text-sm font-normal tracking-normal text-muted-foreground">
          %
        </span>
      </>
    )
  }
  return <>{value}</>
}

/** Un `<details>` de la casa: chevron que gira, sin el triángulo nativo. */
export function Disclosure({
  summary,
  children,
  className,
}: {
  summary: string
  children: ReactNode
  className?: string
}) {
  return (
    <details className={cn('group text-xs', className)}>
      <summary
        className={cn(
          'inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-muted-foreground',
          'outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
          'pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform duration-(--duration-fast) ease-(--ease-out) group-open:rotate-90 motion-reduce:transition-none"
        />
        {summary}
      </summary>
      <div className="mt-2 pl-[1.125rem]">{children}</div>
    </details>
  )
}

export function MarketingReport({
  block,
  row,
  phase,
  className,
}: {
  block: MarketingBlock
  row: EventMarketingRow
  phase: MarketingPhase
  className?: string
}) {
  const sentence = marketingSentence(block, row, phase)
  const ficha = fichaItems(block, row)
  const ret = returnSentence(computeMarketingKpis(block, row))
  const details = returnDetails(block, row)
  const bullets = howItsCalculated(row)

  return (
    <div className={className}>
      <p className="mt-2 max-w-prose text-sm leading-relaxed">{sentence}</p>

      {/* Tres fichas en un `dl`: el lector de pantalla lee etiqueta, número y
          cuenta; a la vista va primero el número. Abajo de @xl cada ficha es
          una fila (número a la izquierda en 7.5rem, etiqueta y cuenta a la
          derecha) porque tres columnas en 328px parten "US$ 175,26 ÷ 11
          reservas en pie" en cuatro renglones. */}
      <dl className="mt-3 grid gap-y-3 @xl:grid-cols-3 @xl:gap-y-0 @xl:divide-x @xl:divide-border/60">
        {TILES.map(({ kind, label }) => {
          const tile = kpiHint(kind, block, row)
          return (
            <div
              key={kind}
              className="grid grid-cols-[7.5rem_1fr] items-baseline gap-x-3 @xl:flex @xl:flex-col @xl:items-start @xl:gap-x-0 @xl:px-4 @xl:first:pl-0 @xl:last:pr-0"
            >
              <dt className={cn(EYEBROW, 'col-start-2 row-start-1 @xl:order-2 @xl:mt-2')}>
                {label}
              </dt>
              <dd
                className={cn(
                  'col-start-1 row-start-1 font-serif text-2xl font-semibold leading-none tracking-tight tabular-nums @xl:order-1 @xl:text-3xl',
                  tile.value === null && 'text-muted-foreground',
                )}
              >
                {tile.value === null ? (
                  <>
                    <span className="sr-only">{tile.srReason}</span>
                    <span aria-hidden>—</span>
                  </>
                ) : (
                  <KpiNumber value={tile.value} />
                )}
              </dd>
              <dd className="col-start-2 row-start-2 text-[11px] leading-snug text-muted-foreground @xl:order-3 @xl:mt-1">
                {tile.hint}
              </dd>
            </div>
          )
        })}
      </dl>

      {ficha.length > 0 ? (
        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {ficha.map((item) => (
            <div key={item.label} className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="font-medium tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {ret ? (
        <div className="mt-4 rounded-lg bg-secondary/40 p-3 @md:p-4">
          <p className={EYEBROW}>Retorno</p>
          <p className="mt-1.5 font-serif text-base leading-snug tracking-tight @md:text-lg">
            {ret.lead}
            {ret.warning ? (
              <>
                {' '}
                <span className="text-warning-text">{ret.warning}</span>
              </>
            ) : null}
          </p>
          {details.length > 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {details.map((d, i) => (
                <span key={`${d.before}|${d.after}`}>
                  {i > 0 ? ' · ' : null}
                  {d.before}
                  <span className="font-medium tabular-nums text-foreground">{d.value}</span>
                  {d.after}
                </span>
              ))}
            </p>
          ) : null}
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {RETURN_DISCLAIMER}
          </p>
        </div>
      ) : null}

      {row.notes ? (
        <p className="mt-4 whitespace-pre-line break-words border-l-2 border-border pl-3 text-xs text-muted-foreground">
          <span className="sr-only">Nota: </span>
          {row.notes}
        </p>
      ) : null}

      <Disclosure summary="¿Cómo se calcula?" className="mt-3">
        <ul className="max-w-prose list-disc space-y-1 pl-4 leading-relaxed text-muted-foreground">
          {bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </Disclosure>
    </div>
  )
}
