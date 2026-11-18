import { cn } from '@/lib/utils'

/**
 * El toldito: la marca de una sucursal en todo el sistema (la píldora de arriba, las etiquetas de cada renglón,
 * las opciones para elegir). Es el mismo toldo de la vidriera de Sucursales, en chico.
 *
 * - Una sucursal: franjas de su color y crema.
 * - Varias («Todas»): franjas de los colores de cada una.
 * - `muted`: una sección de todo el bar (el toldo sin color).
 *
 * Es un dibujo: el nombre siempre va escrito al lado, así que va oculto para los lectores de pantalla.
 */

const STRIPES = 5
const TOP = { y: 2.6, left: 1.6, right: 18.4 }
const BOTTOM = { y: 9.4, left: 0.6, right: 19.4 }

const SHAPES = Array.from({ length: STRIPES }, (_, index) => {
  const topStep = (TOP.right - TOP.left) / STRIPES
  const bottomStep = (BOTTOM.right - BOTTOM.left) / STRIPES
  const t0 = TOP.left + index * topStep
  const t1 = t0 + topStep
  const b0 = BOTTOM.left + index * bottomStep
  const b1 = b0 + bottomStep
  return {
    index,
    d: `M${t0} ${TOP.y}H${t1}L${b1} ${BOTTOM.y}Q${(b0 + b1) / 2} ${BOTTOM.y + 3.4} ${b0} ${BOTTOM.y}Z`,
  }
})

/** Los colores de cada franja: con una sucursal, color y crema; con varias, sus colores en ronda. */
export function awningStripeColors(colors: ReadonlyArray<string>, muted = false): string[] {
  if (muted || colors.length === 0) {
    return SHAPES.map((shape) =>
      shape.index % 2 === 0 ? 'var(--awning-muted)' : 'var(--awning-cream)',
    )
  }
  if (colors.length === 1) {
    const [only] = colors
    return SHAPES.map((shape) =>
      shape.index % 2 === 0 ? (only ?? 'var(--awning-muted)') : 'var(--awning-cream)',
    )
  }
  return SHAPES.map((shape) => colors[shape.index % colors.length] ?? 'var(--awning-muted)')
}

export function BranchAwning({
  colors,
  muted = false,
  className,
}: {
  /** `#rrggbb` de la sucursal, o de todas («Todas»). */
  colors: ReadonlyArray<string>
  muted?: boolean
  className?: string
}) {
  const fills = awningStripeColors(colors, muted)
  return (
    <svg
      viewBox="0 0 20 13"
      aria-hidden="true"
      focusable="false"
      className={cn('branch-awning shrink-0', className)}
      data-muted={muted ? '' : undefined}
    >
      <rect x="0.4" y="0.4" width="19.2" height="2.3" rx="1.15" className="branch-awning-rail" />
      {SHAPES.map((shape) => (
        <path key={shape.index} d={shape.d} fill={fills[shape.index]} />
      ))}
    </svg>
  )
}
