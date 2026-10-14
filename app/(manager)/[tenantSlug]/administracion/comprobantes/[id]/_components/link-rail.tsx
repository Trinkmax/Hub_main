import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { cn } from '@/lib/utils'
import type { LinkHow, LinkState } from '../../_lib/document-story'

/**
 * El mapa de vínculos de UNA cosa: de un papel baja una espina y de la espina
 * sale un tramo hacia cada cosa que tiene unida, o que le falta. Es el dibujo
 * de la guía («Cómo se vincula cada cosa»), con los mismos dos trazos, pero
 * con los datos de este comprobante:
 *
 *   entero y verde = se une solo · de a rayitas = lo unís vos
 *
 * Al final de cada tramo va una cajita con el nombre fijo de la unión («Pago»,
 * «Foto», «Libro IVA») y, al lado, lo unido: a dónde lleva, en qué estado está
 * y UNA acción. Una unión que falta es una cajita punteada y hueca con la
 * píldora «Falta»; una que no aplica y vale decirlo, una cajita gris.
 *
 * Vive en la ficha del comprobante y no en el kit: hoy es la única pantalla
 * que la usa. Server-safe.
 *
 * Cuándo NO: para una lista de cosas sueltas (eso es `LedgerList`), para los
 * pasos de una carga (`StepRail`) ni para explicar las uniones en abstracto
 * (eso es la guía).
 */

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Los dos trazos de la guía (`guias/uso/links.tsx`), más el gris de lo que no es una unión. */
const WIRE: Readonly<Record<LinkHow, string>> = {
  auto: 'border-adm-s1',
  you: 'border-dashed border-foreground/45',
  none: 'border-border',
}

const HOW_WORDS: Readonly<Record<LinkHow, string | null>> = {
  auto: 'se une solo',
  you: 'lo unís vos',
  none: null,
}

const BOX: Readonly<Record<LinkState, string>> = {
  linked: 'border-border/80 bg-card text-foreground shadow-2xs',
  missing: 'border-dashed border-foreground/35 text-muted-foreground',
  ask: 'border-dashed border-foreground/35 text-muted-foreground',
  off: 'border-border/60 text-muted-foreground',
}

/**
 * La espina con sus tramos. `origin` es la cabeza del dibujo: el papel del que
 * sale todo, dicho en dos palabras. `aside` va a su derecha (la leyenda).
 */
export function LinkRail({
  label,
  origin,
  aside,
  children,
  className,
}: {
  /** Para lectores: «Con qué está unido este comprobante». */
  label: string
  origin?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {origin || aside ? (
        <div className="flex items-center justify-between gap-3">
          {origin ? (
            <p
              aria-hidden
              className="force-light inline-flex h-7 min-w-0 items-center rounded-sm border border-adm-paper-rule bg-adm-paper px-2 font-mono text-[10px] font-semibold tracking-[0.14em] text-adm-paper-ink uppercase shadow-2xs"
            >
              <span className="truncate">{origin}</span>
            </p>
          ) : (
            <span />
          )}
          {aside}
        </div>
      ) : null}
      <ol aria-label={label}>{children}</ol>
    </div>
  )
}

/**
 * Un tramo de la espina con su cajita y su cuerpo. En el celular la cajita va
 * arriba y el cuerpo debajo, a todo el ancho; desde `sm`, al costado.
 */
export function LinkNode({
  what,
  icon: Icon,
  how,
  state,
  limitHref,
  id,
  children,
}: {
  /** El nombre fijo de la unión: «Pago», «Foto», «Libro IVA». */
  what: string
  icon?: LucideIcon
  how: LinkHow
  state: LinkState
  /** El ancla de la guía que explica lo que hoy no se puede con esta unión. */
  limitHref?: string
  /** Ancla (`#foto`, `#arca`). */
  id?: string
  children: ReactNode
}) {
  const words = HOW_WORDS[how]
  return (
    <li
      id={id}
      className="group/node relative grid scroll-mt-28 grid-cols-[1rem_minmax(0,1fr)] gap-x-2.5 pt-3 pb-2 pl-3 last:pb-0 sm:grid-cols-[1.25rem_10.5rem_minmax(0,1fr)] sm:gap-x-3"
    >
      {/* La espina: baja del papel y corta a la altura de la última cajita. */}
      <span
        aria-hidden
        className="absolute top-0 left-3 h-full border-l-2 border-border group-last/node:h-[1.9375rem]"
      />
      {/* El tramo que sale hacia esta cosa. */}
      <span aria-hidden className={cn('mt-[1.0625rem] h-0 border-t-2', WIRE[how])} />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 self-start">
        <span
          className={cn(
            'inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[13px] leading-tight font-medium whitespace-nowrap',
            BOX[state],
          )}
        >
          {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" /> : null}
          {what}
          {words ? <span className="sr-only"> ({words})</span> : null}
        </span>
        {state === 'missing' ? <StatusPill tone="warn">Falta</StatusPill> : null}
      </div>
      <div className="col-start-2 min-w-0 pt-2 text-sm sm:col-start-3 sm:pt-1.5">
        {children}
        {limitHref ? (
          <p className="mt-2">
            <Link
              href={limitHref}
              className={cn('inline-flex rounded-full pointer-coarse:py-2.5', FOCUS)}
            >
              <StatusPill tone="info">Con un límite</StatusPill>
              <span className="sr-only">: ver en la guía qué no se puede hoy con esta unión</span>
            </Link>
          </p>
        ) : null}
      </div>
    </li>
  )
}

/** Cómo leer las líneas: «── Se une solo · ╌╌ Lo unís vos». Desde `sm`; en el celular lo dicen los lectores. */
export function LinkLegend({ className }: { className?: string }) {
  return (
    <ul
      aria-label="Cómo leer las líneas"
      className={cn('hidden items-center gap-4 text-xs text-muted-foreground sm:flex', className)}
    >
      <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="w-6 border-t-2 border-adm-s1" />
        Se une solo
      </li>
      <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="w-6 border-t-2 border-dashed border-foreground/45" />
        Lo unís vos
      </li>
    </ul>
  )
}
