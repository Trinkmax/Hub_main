import { Check } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * Paso a paso: una pregunta por vez. Lo hecho se pliega con su resumen, lo
 * que toca está abierto y lo que falta espera atenuado. Es la forma de las
 * cargas a mano (el cierre del día, la primera compra, la puesta en marcha).
 *
 * El estado lo decide quien lo usa (una isla cliente con su `useState`, o la
 * URL con `#paso-N`): estas piezas solo dibujan y son server-safe.
 */

export type StepState = 'done' | 'current' | 'todo'

/** El círculo del paso: tilde si está hecho, número relleno si toca, número gris si falta. */
function StepMarker({ n, state }: { n: number; state: StepState }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
        state === 'done' && 'border-success/40 bg-success/12 text-success',
        state === 'current' &&
          'border-primary bg-primary text-primary-foreground ring-4 ring-primary/15',
        state === 'todo' && 'border-border bg-card text-muted-foreground',
      )}
    >
      {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : n}
    </span>
  )
}

const STATE_WORD: Readonly<Record<StepState, string>> = {
  done: 'Hecho',
  current: 'Te toca',
  todo: 'Falta',
}

/**
 * Un paso.
 *
 * - `done`: plegado, con `summary` (lo que se eligió, en una línea) y `action`
 *   (el «Cambiar»).
 * - `current`: abierto, con `children`.
 * - `todo`: atenuado, solo el título.
 *
 * Los `children` de un paso que no es el actual quedan MONTADOS pero ocultos
 * (`hidden`): los campos no pierden lo cargado y un `<form>` nativo los sigue
 * mandando. Ojo con `required` en un campo oculto: el navegador frena el envío
 * sin poder mostrar el cartel; validá al avanzar de paso. Con
 * `keepMounted={false}` no se dibujan.
 *
 * Con `open` el paso está SIEMPRE abierto, sea cual sea su estado: es para una
 * pantalla con todas las secciones a la vista que se van tildando solas (el
 * cierre del día), no para un asistente. Ahí el estado solo cambia el círculo
 * (tilde, número relleno, número gris); `summary` es la línea de abajo del
 * título en cualquier estado (la ayuda mientras falta, el resumen cuando está
 * hecho: así el título no cambia de alto al tildarse) y `action` se ve siempre.
 *
 * Cuándo NO: para una carga de un solo dato (es un campo, no un paso a paso),
 * para más de cinco o seis pasos (partilo en dos pantallas) ni para una guía
 * de lectura (eso es la guía, con su riel).
 */
export function StepCard({
  n,
  title,
  state,
  summary,
  action,
  children,
  id,
  keepMounted = true,
  open = false,
  className,
}: {
  n: number
  title: ReactNode
  state: StepState
  /** Con `done`: lo que quedó cargado, en una línea («Sábado 11/10 · turno noche»). */
  summary?: ReactNode
  /** Con `done`: el «Cambiar». Con `current`: una ayuda a la derecha del título. */
  action?: ReactNode
  children?: ReactNode
  /** Ancla (`paso-2`). Deja aire arriba para la barra pegajosa. */
  id?: string
  keepMounted?: boolean
  /** Siempre abierto: todas las secciones a la vista, que se tildan solas. */
  open?: boolean
  className?: string
}) {
  const headingId = useId()
  const current = state === 'current'

  if (open) {
    return (
      <section
        id={id}
        aria-labelledby={headingId}
        aria-current={current ? 'step' : undefined}
        data-state={state}
        className={cn(
          'card-hairline scroll-mt-28 rounded-2xl border bg-card p-4 shadow-xs sm:p-5',
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <StepMarker n={n} state={state} />
          <div className="min-w-0 flex-1 pt-0.5">
            {/* `action` comparte renglón solo con el título: el resumen usa todo el ancho. */}
            <div className="flex items-start justify-between gap-3">
              <h2
                id={headingId}
                className="min-w-0 font-serif text-lg font-semibold leading-snug tracking-tight text-balance"
              >
                <span className="sr-only">
                  Paso {n}, {STATE_WORD[state].toLowerCase()}:{' '}
                </span>
                {title}
              </h2>
              {action ? <div className="shrink-0">{action}</div> : null}
            </div>
            {summary ? (
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground text-pretty">
                {summary}
              </p>
            ) : null}
          </div>
        </div>
        {children ? <div className="mt-4">{children}</div> : null}
      </section>
    )
  }

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      aria-current={current ? 'step' : undefined}
      data-state={state}
      className={cn(
        'scroll-mt-28 rounded-2xl border',
        current &&
          'card-hairline border-primary/35 bg-card p-4 shadow-sm ring-4 ring-primary/8 sm:p-5',
        state === 'done' && 'border-border/70 bg-card/60 px-4 py-3',
        state === 'todo' && 'border-dashed border-border bg-transparent px-4 py-3',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <StepMarker n={n} state={state} />
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            className={cn(
              'text-balance',
              current && 'font-serif text-lg font-semibold leading-snug tracking-tight',
              state === 'done' && 'text-xs leading-snug text-muted-foreground',
              state === 'todo' && 'text-sm font-medium text-muted-foreground',
            )}
          >
            <span className="sr-only">
              Paso {n}, {STATE_WORD[state].toLowerCase()}:{' '}
            </span>
            {title}
          </h2>
          {state === 'done' && summary ? (
            <p className="mt-0.5 text-sm font-medium leading-snug text-pretty">{summary}</p>
          ) : null}
        </div>
        {action && state !== 'todo' ? <div className="shrink-0">{action}</div> : null}
      </div>
      {current ? (
        <div className="mt-4">{children}</div>
      ) : keepMounted && children ? (
        <div hidden>{children}</div>
      ) : null}
    </section>
  )
}

export type StepRailItem = {
  title: ReactNode
  state: StepState
  /** Lo que quedó cargado, debajo del título (solo en compu). */
  summary?: ReactNode
  /** Si el paso se puede visitar: `#paso-2`. */
  href?: string
}

/**
 * La lista de pasos, para saber dónde estás y cuánto falta: riel vertical en
 * compu (al costado) y una fila de puntos con «Paso 2 de 4» en el celular
 * (arriba). El paso actual va relleno; el color nunca va solo: lo hecho lleva
 * tilde y cada paso su número.
 *
 * `orientation` fuerza una de las dos formas (`auto` cambia en `lg`).
 *
 * Cuándo NO: con un solo paso, ni como menú de la sección (eso es la barra de
 * Administración). Va JUNTO a las `StepCard`, no en su lugar.
 */
export function StepRail({
  steps,
  label = 'Pasos',
  orientation = 'auto',
  className,
}: {
  steps: readonly StepRailItem[]
  /** Para lectores: «Pasos del cierre del día». */
  label?: string
  orientation?: 'auto' | 'vertical' | 'horizontal'
  className?: string
}) {
  const currentIndex = steps.findIndex((s) => s.state === 'current')
  const currentStep = currentIndex >= 0 ? steps[currentIndex] : undefined
  // Clases completas por forma (Tailwind no ve clases armadas por partes).
  const v = orientation === 'vertical'
  const auto = orientation === 'auto'

  return (
    <nav aria-label={label} className={className}>
      <ol
        className={cn(
          'flex items-center',
          v && 'flex-col items-stretch',
          auto && 'lg:flex-col lg:items-stretch',
        )}
      >
        {steps.map((step, index) => {
          const last = index === steps.length - 1
          const wrapperClass = cn(
            'group/step flex min-w-0 flex-1 items-center rounded-lg',
            v && 'items-stretch gap-3',
            auto && 'lg:items-stretch lg:gap-3',
            step.href && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )
          const body = (
            <>
              <span
                className={cn(
                  'flex items-center',
                  !last && 'flex-1',
                  v && 'flex-none flex-col',
                  auto && 'lg:flex-none lg:flex-col',
                )}
              >
                <StepMarker n={index + 1} state={step.state} />
                {last ? null : (
                  <span
                    aria-hidden
                    className={cn(
                      'mx-1.5 h-0.5 min-w-3 flex-1 rounded-full',
                      v && 'mx-0 my-1 h-auto min-h-4 w-0.5 min-w-0',
                      auto && 'lg:mx-0 lg:my-1 lg:h-auto lg:min-h-4 lg:w-0.5 lg:min-w-0',
                      step.state === 'done' ? 'bg-success/45' : 'bg-adm-track',
                    )}
                  />
                )}
              </span>
              <span
                className={cn(
                  v ? 'block min-w-0 pt-1 pb-4' : 'sr-only',
                  auto && 'lg:not-sr-only lg:block lg:min-w-0 lg:pt-1 lg:pb-4',
                )}
              >
                <span className="sr-only">{STATE_WORD[step.state]}: </span>
                <span
                  className={cn(
                    'block text-sm leading-snug',
                    step.state === 'current' && 'font-semibold text-foreground',
                    step.state === 'done' && 'text-foreground',
                    step.state === 'todo' && 'text-muted-foreground',
                    step.href && 'group-hover/step:underline group-hover/step:underline-offset-4',
                  )}
                >
                  {step.title}
                </span>
                {step.summary && step.state === 'done' ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground text-pretty">
                    {step.summary}
                  </span>
                ) : null}
              </span>
            </>
          )
          return (
            <li
              // Los pasos son una lista fija y ordenada: el índice ES la identidad.
              // biome-ignore lint/suspicious/noArrayIndexKey: lista fija, sin reordenar
              key={index}
              aria-current={step.state === 'current' ? 'step' : undefined}
              className={cn('flex', !last && 'flex-1', v && 'flex-none', auto && 'lg:flex-none')}
            >
              {step.href ? (
                <Link href={step.href} className={wrapperClass}>
                  {body}
                </Link>
              ) : (
                <div className={wrapperClass}>{body}</div>
              )}
            </li>
          )
        })}
      </ol>
      {/* En el celular los títulos no entran al lado de los puntos: se dice
          solo el del paso actual, debajo. */}
      {v ? null : (
        <p aria-hidden className={cn('mt-2.5 text-sm text-muted-foreground', auto && 'lg:hidden')}>
          {currentStep ? (
            <>
              <span className="tabular-nums">
                Paso {currentIndex + 1} de {steps.length}
              </span>
              {' · '}
              <span className="font-medium text-foreground">{currentStep.title}</span>
            </>
          ) : (
            <span className="tabular-nums">
              {steps.filter((s) => s.state === 'done').length} de {steps.length} pasos hechos
            </span>
          )}
        </p>
      )}
    </nav>
  )
}
