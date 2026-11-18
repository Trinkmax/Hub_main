/**
 * Primitivas visuales del plano. Dibujan las sillas/banquetas en SVG alrededor
 * del cuerpo de una mesa.
 *
 * El cuerpo (fondo/borde/sombra del estado) lo dibuja el componente contenedor
 * con CSS (mejor material y theming por token). Acá solo van las sillas, que
 * caen por fuera del cuerpo y necesitan `overflow: visible`.
 */

import {
  CHAIR_H,
  CHAIR_MARGIN,
  CHAIR_RADIUS,
  CHAIR_W,
  computeBarStools,
  computeChairs,
  STOOL_RADIUS,
} from '@/lib/floor-plan/chairs'

type Shape = 'rect' | 'circle' | 'banquette'
type Kind = 'table' | 'wall' | 'pillar' | 'island' | 'bar' | 'door' | 'text' | 'stage' | 'booth'

/** border-radius CSS del cuerpo según forma. circle → elipse/círculo. */
export function bodyRadius(shape: Shape, cornerRadius: number): string {
  if (shape === 'circle') return '50%'
  if (shape === 'banquette') return '6px'
  return `${Math.max(2, cornerRadius)}px`
}

export type ChairsSvgProps = {
  shape: Shape
  kind: Kind
  width: number
  height: number
  capacity: number | null | undefined
}

/**
 * SVG absoluto con las sillas alrededor del cuerpo (`width×height`). Se extiende
 * `CHAIR_MARGIN` por cada lado y no recibe eventos (la mesa se agarra por el cuerpo).
 * El fill se controla con la custom property `--fp-seat` del contenedor.
 */
export function ChairsSvg({ shape, kind, width, height, capacity }: ChairsSvgProps) {
  const isBar = kind === 'bar'
  const chairs = isBar ? [] : computeChairs(shape, kind, width, height, capacity)
  const stools = isBar ? computeBarStools(width, height) : []
  if (chairs.length === 0 && stools.length === 0) return null

  const m = CHAIR_MARGIN
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: -m,
        top: -m,
        width: width + m * 2,
        height: height + m * 2,
        overflow: 'visible',
      }}
    >
      <title>Sillas</title>
      <g transform={`translate(${m},${m})`}>
        {chairs.map((c, i) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: sillas derivadas, orden estable por geometría
            key={i}
            className="fp-chair"
            x={c.cx - CHAIR_W / 2}
            y={c.cy - CHAIR_H / 2}
            width={CHAIR_W}
            height={CHAIR_H}
            rx={CHAIR_RADIUS}
            transform={`rotate(${c.angle} ${c.cx} ${c.cy})`}
          />
        ))}
        {stools.map((s, i) => (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: banquetas derivadas, orden estable por geometría
            key={i}
            className="fp-stool"
            cx={s.cx}
            cy={s.cy}
            r={STOOL_RADIUS}
          />
        ))}
      </g>
    </svg>
  )
}
