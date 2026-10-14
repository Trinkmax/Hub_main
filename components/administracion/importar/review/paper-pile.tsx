import type { LucideIcon, LucideProps } from 'lucide-react'
import { forwardRef, type ReactNode } from 'react'
import type { ReviewTally } from '@/lib/imports/ui/review-copy'
import { cn } from '@/lib/utils'

/**
 * La pila del archivo, dibujada: una hojita por comprobante, agrupadas en un
 * orden fijo (cargados · listos · con una pregunta · ya estaban cargados · no
 * van). Cada grupo lleva su signo adentro, nunca solo el color.
 *
 * Por qué hojitas y no una torta: el comprobante es la unidad que el dueño
 * reparte, y se cuenta con el ojo (como las sillas del muro de mesas). Con más
 * de 120, cada hoja vale varios y se dice.
 *
 * Es un dibujo (`aria-hidden`): los números los dan el título de al lado y las
 * vistas de abajo, que llevan la misma hojita como ícono (`PILE_ICONS`): la
 * leyenda ES el filtro. Server-safe.
 */

/** Hasta cuántas hojitas se dibujan antes de que cada una valga varios. */
export const PILE_MAX_SHEETS = 120
/** Hasta cuántas hojitas se dibujan en grande. */
const PILE_BIG_UP_TO = 40

export type PileGroup = 'posted' | 'ready' | 'questions' | 'already' | 'out'

const ORDER: readonly PileGroup[] = ['posted', 'ready', 'questions', 'already', 'out']

/** El papel de cada grupo: relleno y borde. */
const PAPER: Readonly<Record<PileGroup, string>> = {
  posted: 'fill-adm-s1',
  ready: 'fill-adm-s1/25 stroke-adm-s1',
  questions: 'fill-warning/25 stroke-warning',
  already: 'fill-adm-neutral',
  out: 'fill-transparent stroke-muted-foreground/60',
}

/** La tinta del signo de cada grupo. */
const INK: Readonly<Record<PileGroup, string>> = {
  posted: 'text-adm-hero-fg',
  ready: 'text-adm-s1',
  questions: 'text-warning-text',
  already: 'text-card',
  out: 'text-muted-foreground',
}

/** El signo de cada grupo, en un lienzo de 14 × 18. */
const SIGN: Readonly<Record<PileGroup, ReactNode>> = {
  posted: <path d="m3.6 9.4 2.3 2.4 4.5-5" />,
  ready: <circle cx="7" cy="9" r="1.5" fill="currentColor" stroke="none" />,
  questions: (
    <>
      <path d="M5.2 7.2a1.8 1.8 0 1 1 2.6 1.6c-.5.3-.8.7-.8 1.3" />
      <path d="M7 12.7v.1" />
    </>
  ),
  already: <path d="M4.2 7.6h5.6M4.2 10.4h5.6" />,
  out: <path d="m3.8 13.4 6.4-8.8" />,
}

function SheetArt({ group }: { group: PileGroup }) {
  return (
    <>
      <rect
        x="0.75"
        y="0.75"
        width="12.5"
        height="16.5"
        rx="2.5"
        strokeWidth={1.2}
        strokeDasharray={group === 'out' ? '2.2 1.8' : undefined}
        className={PAPER[group]}
      />
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={INK[group]}
      >
        {SIGN[group]}
      </g>
    </>
  )
}

/** El dibujo de UNA hojita. */
export function PileSheet({ group, className }: { group: PileGroup; className?: string }) {
  return (
    <svg
      viewBox="0 0 14 18"
      aria-hidden="true"
      className={cn('h-[18px] w-3.5 shrink-0', className)}
    >
      <SheetArt group={group} />
    </svg>
  )
}

/** La hojita como ícono (misma forma que un ícono de lucide), para las píldoras de las vistas. */
function sheetIcon(group: PileGroup): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function SheetIcon({ className }, ref) {
    return (
      <svg ref={ref} viewBox="0 0 14 18" aria-hidden="true" className={cn('shrink-0', className)}>
        <SheetArt group={group} />
      </svg>
    )
  })
  return Icon as LucideIcon
}

/** La hojita de cada grupo, lista para pasarla donde se espera un ícono. */
export const PILE_ICONS: Readonly<Record<PileGroup, LucideIcon>> = {
  posted: sheetIcon('posted'),
  ready: sheetIcon('ready'),
  questions: sheetIcon('questions'),
  already: sheetIcon('already'),
  out: sheetIcon('out'),
}

/**
 * Cuántas hojitas se dibujan de cada grupo. Hasta 120, una por comprobante; con
 * más, cada hoja vale `each` y ningún grupo con algo se queda sin su hoja.
 */
export function pileSheets(tally: Pick<ReviewTally, PileGroup | 'total'>): {
  each: number
  groups: Array<{ group: PileGroup; sheets: number; count: number }>
} {
  const each = tally.total > PILE_MAX_SHEETS ? Math.ceil(tally.total / PILE_MAX_SHEETS) : 1
  return {
    each,
    groups: ORDER.map((group) => {
      const n = Math.max(0, tally[group])
      return { group, count: n, sheets: n === 0 ? 0 : Math.max(1, Math.round(n / each)) }
    }),
  }
}

/** ¿Son pocas hojas (hasta 40)? Entonces se dibujan grandes y entran al lado del número. */
export function pileIsFew(tally: Pick<ReviewTally, PileGroup | 'total'>): boolean {
  return pileSheets(tally).groups.reduce((sum, g) => sum + g.sheets, 0) <= PILE_BIG_UP_TO
}

export function PaperPile({
  tally,
  unit,
  beside = false,
  className,
}: {
  tally: ReviewTally
  /** «comprobantes» / «movimientos». */
  unit: string
  /**
   * La pila va AL LADO del número también en pantallas angostas (el celular):
   * ahí se dibuja chica y contra el borde derecho, y recién con lugar (`lg`)
   * pasa al tamaño grande. Solo tiene sentido con pocas hojas (`pileIsFew`).
   */
  beside?: boolean
  className?: string
}) {
  if (tally.total <= 0) return null
  const { each, groups } = pileSheets(tally)
  // Con pocas hojas (lo normal en un archivo semanal) se dibujan más grandes: se cuentan de un vistazo.
  const few = pileIsFew(tally)
  return (
    <div className={cn('space-y-2', className)}>
      <div
        aria-hidden
        className={cn(
          'flex flex-wrap',
          beside
            ? 'content-start justify-end gap-[3px] lg:justify-start lg:gap-1'
            : few
              ? 'gap-1'
              : 'gap-[3px]',
        )}
      >
        {groups.flatMap((g) =>
          Array.from({ length: g.sheets }, (_, i) => (
            <PileSheet
              // biome-ignore lint/suspicious/noArrayIndexKey: hojitas idénticas de un mismo grupo, sin reordenar
              key={`${g.group}-${i}`}
              group={g.group}
              className={beside ? 'lg:h-[26px] lg:w-5' : few ? 'h-[26px] w-5' : undefined}
            />
          )),
        )}
      </div>
      {each > 1 ? (
        <p className="text-xs text-muted-foreground">
          Cada hoja son {each} {unit}.
        </p>
      ) : null}
    </div>
  )
}
