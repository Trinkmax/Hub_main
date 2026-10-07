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
  type NightMathStep,
  type NightResultReport,
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
 * Los tres números van en Fraunces pero un escalón por debajo de los tres de
 * gente: la ficha es de la gente que entró, la pauta es el costo de traerla.
 * Las oraciones van en Inter (Fraunces queda para nombres y números, kit §1.2)
 * y los rótulos en `type-label`, en minúscula normal. Todo con container
 * queries y no con breakpoints de pantalla: en una noche con dos eventos, cada
 * ficha mide lo mismo que un celular.
 */

const TILES: ReadonlyArray<{ kind: KpiTileKind; label: string }> = [
  { kind: 'costPerMessage', label: 'Por mensaje' },
  { kind: 'closingRate', label: 'De cierre' },
  { kind: 'costPerReservation', label: 'Por reserva' },
]

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

/**
 * Un pedazo de la cuenta con el número resaltado. El texto viene partido de
 * `lib/salon/event-marketing.ts` justamente para esto: acá no se corta ni se
 * arma ninguna frase.
 */
export function MathStep({ step }: { step: NightMathStep }) {
  return (
    <>
      {step.before}
      <span className="font-medium tabular-nums text-foreground">{step.value}</span>
      {step.after}
    </>
  )
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
          'outline-offset-2 outline-(--ring) hover:text-foreground focus-visible:outline-2',
          'pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform duration-(--duration-quick) ease-(--ease-ui) group-open:rotate-90 motion-reduce:transition-none"
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
      <p className="mt-2 max-w-prose text-pretty type-body">{sentence}</p>

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
              <dt className="col-start-2 row-start-1 type-label text-muted-foreground @xl:order-2 @xl:mt-2">
                {label}
              </dt>
              <dd
                className={cn(
                  'col-start-1 row-start-1 font-display text-2xl font-[520] leading-none tracking-[-0.01em] @xl:order-1 @xl:text-3xl',
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
              <dd className="col-start-2 row-start-2 type-caption text-muted-foreground @xl:order-3 @xl:mt-1">
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

      {/* «La cuenta de la noche» ya no vive acá: es una caja propia, SIEMPRE
          presente, debajo de toda la sección «Pauta en Meta» (regla 13,
          02/10). Ver `night-account-box.tsx`. */}
      {ret ? (
        <div className="mt-4 rounded-lg bg-secondary/40 p-3 @md:p-4">
          <p className="type-label text-muted-foreground">Retorno</p>
          <p className="mt-1.5 text-base leading-snug font-medium text-pretty">
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
          <p className="mt-1.5 type-caption text-muted-foreground">{RETURN_DISCLAIMER}</p>
        </div>
      ) : null}

      {row.notes ? <MarketingNote notes={row.notes} /> : null}

      <HowItsCalculated bullets={bullets} />
    </div>
  )
}

function MarketingNote({ notes }: { notes: string }) {
  return (
    <p className="mt-4 whitespace-pre-line break-words border-l-2 border-border pl-3 text-xs text-muted-foreground">
      <span className="sr-only">Nota: </span>
      {notes}
    </p>
  )
}

export function HowItsCalculated({ bullets }: { bullets: string[] }) {
  if (bullets.length === 0) return null
  return (
    <Disclosure summary="¿Cómo se calcula?" className="mt-3">
      <ul className="max-w-prose list-disc space-y-1 pl-4 leading-relaxed text-muted-foreground">
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </Disclosure>
  )
}

/**
 * El cuerpo de «La cuenta de la noche»: titular, la cuenta paso a paso, lo que
 * falta, el por persona, la base y la aclaración. La caja (título, estado y
 * botón) la pone `NightAccountBox`.
 */
export function NightAccountBody({ night }: { night: NightResultReport }) {
  return (
    <>
      {night.headline ? (
        <p
          className={cn(
            'mt-1.5 text-base leading-snug font-medium text-pretty',
            // En negativo el número NUNCA va solo: la frase ya dice «quedó
            // $ X abajo», y el ámbar se apoya en esas palabras.
            night.negative && 'text-warning-text',
          )}
        >
          {night.headline}
        </p>
      ) : null}

      {night.steps.length > 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {night.steps.map((step, i) => (
            <span key={`${step.before}|${step.after}`}>
              {i > 0 ? ' · ' : null}
              <MathStep step={step} />
            </span>
          ))}
          {night.result ? (
            <>
              {' → '}
              <MathStep step={night.result} />
            </>
          ) : null}
        </p>
      ) : null}

      {night.missing ? (
        <p className="mt-1.5 text-xs leading-snug text-warning-text">{night.missing}</p>
      ) : null}

      {night.perGuest || night.perGuestAfterAds ? (
        <p className="mt-2 text-xs leading-relaxed">
          {night.perGuest}
          {night.perGuest && night.perGuestAfterAds ? ' ' : null}
          {night.perGuestAfterAds ? (
            <span className="text-muted-foreground">{night.perGuestAfterAds}</span>
          ) : null}
        </p>
      ) : null}

      {night.basis || night.revenueNote ? (
        <p className="mt-1.5 type-caption text-muted-foreground">
          {night.basis}
          {night.basis && night.revenueNote ? ' ' : null}
          {night.revenueNote}
        </p>
      ) : null}

      {/* La aclaración acompaña a un número: si no se pudo calcular ni uno, no
          hay nada que aclarar. */}
      {night.headline ? (
        <p className="mt-1.5 type-caption text-muted-foreground">{night.disclaimer}</p>
      ) : null}
    </>
  )
}

export function MarketingNoteLine({ notes }: { notes: string }) {
  return <MarketingNote notes={notes} />
}
