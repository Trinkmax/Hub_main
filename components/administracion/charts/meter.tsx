import type { ReactNode } from 'react'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { pct, percentLabel } from './scale'

/**
 * Avance contra un total: cuánto se lleva pagado de una cuota, cuánto se
 * vendió del objetivo.
 *
 * - El riel va en el MISMO tono que el relleno, más claro (verde sobre verde):
 *   así se lee como una sola cosa que se va llenando, no como dos series.
 * - `markerCents`: una marca fina sobre el riel (dónde habría que estar hoy).
 * - Base recta a la izquierda, extremo redondeado. Si el valor pasa el total,
 *   el riel se llena y el `aria-label` dice por cuánto se pasó.
 * - Es una figura, no un gráfico con marcas: no lleva globito. El número va al
 *   lado, escrito por la pantalla.
 * - Sin total (cero o negativo) no hay avance que medir: queda el riel
 *   punteado y, si llega, el `emptyHint`.
 */

export type MeterTone = 'default' | 'gold' | 'in' | 'out' | 'neutral' | 'onHero'

export type MeterProps = {
  valueCents: number
  totalCents: number
  /** Marca de referencia en la misma escala (el objetivo a hoy). */
  markerCents?: number | null
  tone?: MeterTone
  /** Alto del riel en px (8 por defecto; hasta 24). */
  height?: number
  /** Qué se mide, para el `aria-label`: «Vendido del objetivo». */
  label?: string
  /** Cómo se llama la marca: «objetivo a hoy». */
  markerLabel?: string
  emptyHint?: ReactNode
  ariaLabel?: string
  className?: string
}

/** El color de cada tono; el riel es el mismo color al 22 %. */
const TONE_COLOR: Readonly<Record<MeterTone, string>> = {
  default: 'var(--adm-s1)',
  gold: 'var(--adm-s2)',
  in: 'var(--adm-in)',
  out: 'var(--adm-out)',
  neutral: 'var(--adm-neutral)',
  onHero: 'var(--adm-gold)',
}

function track(color: string): string {
  return `color-mix(in oklch, ${color} 22%, transparent)`
}

export function Meter({
  valueCents,
  totalCents,
  markerCents,
  tone = 'default',
  height = 8,
  label = 'Avance',
  markerLabel = 'marca',
  emptyHint,
  ariaLabel,
  className,
}: MeterProps) {
  const color = TONE_COLOR[tone]
  const railHeight = Math.min(24, Math.max(4, Math.round(height)))
  const total = Number.isFinite(totalCents) ? totalCents : 0
  const value = Number.isFinite(valueCents) ? Math.max(0, valueCents) : 0

  if (total <= 0) {
    return (
      <div className={cn('min-w-0 space-y-1.5', className)}>
        <div
          role="img"
          aria-label={`${label}: todavía sin un total contra el que medir`}
          className="rounded-full border border-dashed border-adm-neutral/70"
          style={{ height: railHeight }}
        />
        {emptyHint ? (
          typeof emptyHint === 'object' ? (
            emptyHint
          ) : (
            <p
              className={cn(
                'text-xs',
                tone === 'onHero' ? 'text-adm-hero-muted' : 'text-muted-foreground',
              )}
            >
              {emptyHint}
            </p>
          )
        ) : null}
      </div>
    )
  }

  const fill = pct(value, total)
  const marker =
    typeof markerCents === 'number' && Number.isFinite(markerCents) && markerCents > 0
      ? markerCents
      : null
  const over = value > total
  const summary =
    ariaLabel ??
    [
      `${label}: ${formatCentsShort(value)} de ${formatCentsShort(total)}`,
      over
        ? `, ${formatCentsShort(value - total)} por encima`
        : ` (${percentLabel(Math.round(fill), value > 0)})`,
      marker !== null ? `. La ${markerLabel} está en ${formatCentsShort(marker)}` : '',
      '.',
    ].join('')

  return (
    <div
      role="img"
      aria-label={summary}
      className={cn('relative min-w-0', className)}
      style={{ height: railHeight }}
    >
      <div
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{ backgroundColor: track(color) }}
      >
        {value > 0 ? (
          <div
            className="rail-grow h-full min-w-[3px] rounded-r-full"
            style={{ width: `${fill}%`, backgroundColor: color }}
          />
        ) : null}
      </div>
      {marker !== null ? (
        <span
          className={cn(
            'absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full',
            tone === 'onHero'
              ? 'bg-adm-hero-fg shadow-[0_0_0_1px_var(--adm-hero)]'
              : 'bg-foreground/75 shadow-[0_0_0_1px_var(--card)]',
          )}
          style={{ left: `${pct(marker, total)}%` }}
        />
      ) : null}
    </div>
  )
}
