import { cn } from '@/lib/utils'

/**
 * El casillero de la planilla de gastos fijos: la columna «Pagado ✓» de la
 * planilla de los socios. Cuatro caras: vacío (falta pagar), tildado (pago), a
 * medias (pagaste una parte) y con raya (este mes no se paga, o está en pausa).
 *
 * Es un DIBUJO: no se toca ni se enfoca. Quien lo usa decide si lo envuelve en
 * un botón (en la planilla, vacío y pagable, es un atajo de «Pagar»). `label`
 * es lo que escucha un lector («Sin pagar», «Pagado»).
 *
 * `animate` dibuja el tilde trazo a trazo: solo cuando el renglón pasa a pago
 * en esta visita, nunca en reposo. Con movimiento reducido el tilde queda entero.
 *
 * Cuándo NO: para elegir entre opciones (eso es un checkbox de verdad) ni para
 * un estado que no es «hecho / no hecho» (eso es `StatusPill`).
 */

export type TickState = 'empty' | 'done' | 'half' | 'skip'

const FACE: Readonly<Record<TickState, string>> = {
  empty: 'border-foreground/35 bg-card',
  done: 'border-success bg-success/12 text-success',
  half: 'border-warning bg-card',
  skip: 'border-border bg-secondary',
}

export function TickBox({
  state,
  animate = false,
  label,
  className,
}: {
  state: TickState
  animate?: boolean
  /** Para lectores: «Sin pagar», «Pagado», «Pagaste una parte», «Este mes no se paga». */
  label: string
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={label}
      data-tick={state}
      className={cn(
        'relative inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border-[1.5px]',
        FACE[state],
        className,
      )}
    >
      {state === 'done' ? (
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 8.5l3 3 6-7" className={cn('adm-tick', animate && 'adm-tick-draw')} />
        </svg>
      ) : null}
      {state === 'half' ? (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-warning/40" />
      ) : null}
      {state === 'skip' ? (
        <span aria-hidden className="h-0.5 w-3 rounded-full bg-muted-foreground/60" />
      ) : null}
    </span>
  )
}
