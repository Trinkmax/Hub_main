/**
 * Primitivas visuales compartidas del plano (editor + vista en vivo, manager +
 * salón). Dibujan las sillas/banquetas en SVG alrededor del cuerpo de una mesa.
 *
 * El cuerpo (fondo/borde/sombra del estado) lo dibuja el componente contenedor
 * con CSS (mejor material y theming por token). Acá solo van las sillas, que
 * caen por fuera del cuerpo y necesitan `overflow: visible`.
 */

import { DoorOpen, type LucideIcon, Music } from 'lucide-react'
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

// ─── Decoración (vocabulario SevenRooms) ──────────────────────────────────────

const DECOR_ICON: Partial<Record<Kind, LucideIcon>> = {
  door: DoorOpen,
  stage: Music,
}

/** El texto se dibuja sin caja (solo etiqueta), como los rótulos del plano. */
export function isTextDecor(kind: Kind): boolean {
  return kind === 'text'
}

/** Estilo de fondo del cuerpo de decoración (el color del dueño tiene prioridad). */
export function decorSurfaceStyle(kind: Kind, color: string | null): React.CSSProperties {
  if (kind === 'text') return { backgroundColor: 'transparent', borderRadius: 6 }
  if (kind === 'stage') {
    return {
      backgroundColor: color ?? 'color-mix(in oklch, var(--wall) 78%, var(--card))',
      borderRadius: 'var(--radius-sm)',
    }
  }
  return { backgroundColor: color ?? 'var(--wall)', borderRadius: 'var(--radius-sm)' }
}

/** Clases de borde/texto del cuerpo de decoración por kind. */
export function decorSurfaceClass(kind: Kind): string {
  if (kind === 'text') return 'border border-dashed border-border/50 text-foreground/70'
  return 'border-2 border-wall-border text-wall-foreground'
}

/** Contenido interno de la decoración (ícono + etiqueta). */
export function DecorContent({ kind, label }: { kind: Kind; label: string | null }) {
  const Icon = DECOR_ICON[kind]
  if (kind === 'text') {
    return (
      <span className="pointer-events-none px-1 text-center font-medium text-[11px] uppercase tracking-wider">
        {label || 'Texto'}
      </span>
    )
  }
  const fallback = kind === 'stage' ? 'Escenario' : null
  return (
    <span className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-center">
      {Icon ? <Icon className="size-4" aria-hidden /> : null}
      {label || fallback ? (
        <span className="font-medium text-[10px] uppercase tracking-wide leading-tight">
          {label || fallback}
        </span>
      ) : null}
    </span>
  )
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
