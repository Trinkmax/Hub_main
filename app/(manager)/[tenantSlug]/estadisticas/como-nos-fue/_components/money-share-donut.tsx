'use client'

import { useId, useState } from 'react'
import {
  donutArcs,
  type MoneyShare,
  type MoneyShareKey,
  type MoneyShareSlice,
} from '@/lib/salon/money-share'
import { cn } from '@/lib/utils'

/**
 * «Cómo se repartió el ingreso»: la dona de pauta / costo / resultado (C5 en
 * «Por evento», C6 en la pestaña «Pauta»). Todo lo que se lee sale armado de
 * `lib/salon/money-share.ts`; acá solo se dibuja.
 *
 * - **La leyenda es la tabla**: cada renglón dice etiqueta, % y monto, así el
 *   dato nunca depende del color ni del mouse. Solo el dibujo va `aria-hidden`:
 *   el lector oye el centro (el ingreso, que en «Por evento» no está escrito en
 *   ningún otro lado), la leyenda y la oración del `figcaption`.
 * - **Colores con tokens propios** (`--viz-pauta`, `--viz-costo`,
 *   `--viz-resultado`, validados con el validador de la skill dataviz en claro
 *   y oscuro contra `--card`): el texto nunca va en el color de la porción.
 * - **2 px de hueco entre porciones** (se ve la tarjeta) y aro fino (16 px).
 * - **SVG a mano, sin recharts y sin animación**: un `<circle>` por porción con
 *   `stroke-dasharray`, así la dona sale entera en el HTML del server. Con
 *   recharts el server mandaba solo el riel gris (recharts 3 mide el gráfico en
 *   un efecto y no dibuja nada hasta hidratar), y hasta entonces toda dona se
 *   veía como el aro vacío de «quedó abajo». Las medidas salen de sumas y
 *   productos redondeados, sin seno ni coseno: el server y el navegador
 *   escriben los mismos atributos.
 * - **Pasar el mouse** por una porción o por su renglón los resalta a los dos
 *   (la porción crece 3 px hacia afuera y el renglón se tiñe): no hay tooltip,
 *   porque todo lo que diría ya está escrito al lado.
 * - **Cuenta abajo** (`state: 'abajo'`): el aro queda vacío (solo el riel) y el
 *   centro dice cuánto faltó, en ámbar y con la palabra «abajo».
 */

const STROKE: Readonly<Record<MoneyShareKey, string>> = {
  pauta: 'var(--viz-pauta)',
  costo: 'var(--viz-costo)',
  resultado: 'var(--viz-resultado)',
}

const SWATCH: Readonly<Record<MoneyShareKey, string>> = {
  pauta: 'bg-(--viz-pauta)',
  costo: 'bg-(--viz-costo)',
  resultado: 'bg-(--viz-resultado)',
}

/** 9rem: el aro mide lo mismo en el celular y en la compu. */
const SIZE = 144
const OUTER = 70
const INNER = 54
const CENTER = SIZE / 2
/** El trazo va por el medio del aro: radio 62 y 16 px de ancho (de 54 a 70). */
const RING_R = (OUTER + INNER) / 2
const RING_W = OUTER - INNER
/** El hueco entre porciones, en px sobre el radio del trazo. */
const GAP = 2
/** Lo que crece hacia afuera la porción resaltada (el borde de adentro no se mueve). */
const GROW = 3

/** 3 decimales: el mismo atributo en el server y en el navegador, y un HTML corto. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function toneClass(tone: MoneyShareSlice['tone']): string {
  if (tone === 'warning') return 'text-warning-text'
  if (tone === 'muted') return 'text-muted-foreground'
  return 'text-foreground'
}

export function MoneyShareDonut({
  data,
  headingLevel = 'h2',
  className,
}: {
  data: MoneyShare
  /** `h2` en «Por evento» (al lado de los dos cuadros), `h3` en la pestaña «Pauta». */
  headingLevel?: 'h2' | 'h3'
  className?: string
}) {
  const titleId = useId()
  const [active, setActive] = useState<MoneyShareKey | null>(null)
  const arcs = donutArcs(data.slices)
  // Con una sola porción no hay nada que separar: va el aro entero, sin hueco.
  const whole = arcs.length === 1
  // El hueco en fracción de vuelta: el mismo ángulo también en el aro resaltado.
  const gapTurn = whole ? 0 : GAP / (2 * Math.PI * RING_R)
  const Heading = headingLevel

  return (
    <section
      aria-labelledby={titleId}
      className={cn('@container card-hairline min-w-0 rounded-xl border bg-card', className)}
    >
      <header className="border-b border-border/60 px-4 py-3">
        <Heading id={titleId} className="font-serif text-base font-semibold tracking-tight">
          {data.title}
        </Heading>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{data.base}</p>
      </header>

      {/* Angosto (el celular): el aro arriba y centrado, la leyenda a lo
          ancho. Desde 30rem de tarjeta (la columna de «Rentabilidad»): el aro
          a la izquierda y la leyenda al lado, cada renglón en una línea. Desde
          52rem (la pestaña Pauta en la compu): la oración pasa a una tercera
          columna y la leyenda no se estira más de 26rem (los números quedan
          cerca de su etiqueta). */}
      <figure className="grid gap-x-5 gap-y-4 px-4 py-4 @min-[30rem]:grid-cols-[9rem_minmax(0,1fr)] @min-[30rem]:items-center @min-[52rem]:grid-cols-[9rem_minmax(0,26rem)_minmax(0,1fr)]">
        <div className="relative mx-auto size-36 @min-[30rem]:mx-0">
          {/* `overflow-visible`: la porción resaltada llega a 73 px de radio y
              pasa 1 px del cuadro. */}
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="absolute inset-0 size-full overflow-visible"
          >
            {arcs.length === 0 ? (
              <circle
                cx={CENTER}
                cy={CENTER}
                r={RING_R}
                fill="none"
                stroke="var(--muted)"
                strokeWidth={RING_W}
              />
            ) : (
              // El trazo de un círculo arranca a las 3; girado, arranca a las 12.
              <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
                {arcs.map((a) => {
                  const on = a.key === active
                  const r = on ? RING_R + GROW / 2 : RING_R
                  const turn = 2 * Math.PI * r
                  const dash = Math.max(a.size - gapTurn, 0) * turn
                  return (
                    // biome-ignore lint/a11y/noStaticElementInteractions: resaltado decorativo; el dato ya está escrito en la leyenda
                    <circle
                      key={a.key}
                      cx={CENTER}
                      cy={CENTER}
                      r={r}
                      fill="none"
                      stroke={STROKE[a.key]}
                      strokeWidth={on ? RING_W + GROW : RING_W}
                      strokeDasharray={whole ? undefined : `${round3(dash)} ${round3(turn - dash)}`}
                      strokeDashoffset={whole ? undefined : round3(-(a.start + gapTurn / 2) * turn)}
                      onMouseEnter={() => setActive(a.key)}
                      onMouseLeave={() => setActive(null)}
                    />
                  )
                })}
              </g>
            )}
          </svg>
          {/* El texto no pasa del agujero (108 px): 18 px de aire por lado. Un
              monto de más de 12 caracteres ($ 120.483.000) baja un escalón. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[1.125rem] text-center">
            <span
              className={cn(
                'whitespace-nowrap font-serif font-semibold leading-tight tabular-nums',
                data.center.value.length > 12 ? 'text-xs' : 'text-sm',
                data.center.tone === 'warning' && 'text-warning-text',
              )}
            >
              {data.center.value}
            </span>
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {data.center.label}
            </span>
          </div>
        </div>

        {/* La leyenda ES la tabla de la dona: etiqueta, % y monto. */}
        <dl className="min-w-0 divide-y divide-border/60">
          {data.slices.map((s) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: resaltado decorativo; el dato ya está escrito en el renglón
            <div
              key={s.key}
              onMouseEnter={() => setActive(s.arc > 0 ? s.key : null)}
              onMouseLeave={() => setActive(null)}
              className={cn(
                '-mx-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(5.5rem,auto)] items-baseline gap-x-3 rounded-md px-2 py-1.5 transition-colors duration-(--duration-fast) motion-reduce:transition-none',
                active === s.key && 'bg-secondary/60',
              )}
            >
              <dt className="flex min-w-0 items-center gap-2 text-xs">
                <span
                  aria-hidden
                  className={cn(
                    'size-2.5 shrink-0 rounded-[3px]',
                    s.tone === 'default' ? SWATCH[s.key] : 'border border-muted-foreground/50',
                  )}
                />
                <span className="truncate">{s.label}</span>
              </dt>
              <dd className="text-right text-sm font-medium tabular-nums">
                {s.share === '—' ? (
                  <>
                    <span className="sr-only">sin reparto</span>
                    <span aria-hidden className="text-muted-foreground">
                      —
                    </span>
                  </>
                ) : (
                  s.share
                )}
              </dd>
              <dd className={cn('text-right text-xs tabular-nums', toneClass(s.tone))}>
                {s.amount}
              </dd>
            </div>
          ))}
        </dl>

        <figcaption
          className={cn(
            'text-sm leading-snug @min-[30rem]:col-span-2 @min-[52rem]:col-span-1 @min-[52rem]:pl-3',
            data.state === 'abajo' && 'text-warning-text',
          )}
        >
          {data.sentence}
        </figcaption>
      </figure>

      <div className="space-y-0.5 border-t border-border/60 px-4 py-3 text-[11px] leading-snug text-muted-foreground">
        {data.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
        <p>{data.disclaimer}</p>
      </div>
    </section>
  )
}
