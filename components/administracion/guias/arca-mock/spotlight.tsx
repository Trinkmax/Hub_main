import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * «Tocá acá» (diseño §5.1.2): envuelve el control de la maqueta con un anillo rojo, un número
 * opcional, un globito con la indicación y una flecha roja curva, como las capturas de los
 * tutoriales. El halo late suave y se queda quieto con `prefers-reduced-motion`
 * (`motion-safe:`). Vive adentro del lienzo escalado: las medidas son las del dibujo (720 px).
 *
 * Es un dibujo (la maqueta entera va con `aria-hidden`): la misma indicación está siempre en
 * el texto del paso.
 */

export type SpotlightSide = 'left' | 'right' | 'top' | 'bottom'

const RED = '#e5262a'

type ArrowGeometry = {
  readonly box: CSSProperties
  readonly width: number
  readonly height: number
  readonly path: string
  readonly head: string
}

/** Flechas a mano alzada (una por lado): van del globito al anillo. */
const ARROWS: Readonly<Record<SpotlightSide, ArrowGeometry>> = {
  right: {
    box: { left: 'calc(100% + 4px)', top: '50%', transform: 'translateY(-50%)' },
    width: 40,
    height: 32,
    path: 'M38 8 C26 2 12 6 8 22',
    head: 'M14 16.8 L8 22 L5.1 14.5',
  },
  left: {
    box: { right: 'calc(100% + 4px)', top: '50%', transform: 'translateY(-50%)' },
    width: 40,
    height: 32,
    path: 'M2 8 C14 2 28 6 32 22',
    head: 'M26 16.8 L32 22 L34.9 14.5',
  },
  bottom: {
    box: { top: 'calc(100% + 2px)', left: '50%' },
    width: 24,
    height: 40,
    path: 'M6 38 C4 26 8 16 16 6',
    head: 'M8.3 8.2 L16 6 L15.5 14',
  },
  top: {
    box: { bottom: 'calc(100% + 2px)', left: '50%' },
    width: 24,
    height: 40,
    path: 'M6 2 C4 14 8 24 16 34',
    head: 'M8.3 31.8 L16 34 L15.5 26',
  },
}

const BUBBLE: Readonly<Record<SpotlightSide, CSSProperties>> = {
  right: { left: 'calc(100% + 46px)', top: '50%', transform: 'translateY(-50%)' },
  left: { right: 'calc(100% + 46px)', top: '50%', transform: 'translateY(-50%)' },
  bottom: { top: 'calc(100% + 42px)', left: '50%', transform: 'translateX(-12%)' },
  top: { bottom: 'calc(100% + 42px)', left: '50%', transform: 'translateX(-12%)' },
}

export function Spotlight({
  label,
  n,
  side = 'right',
  children,
  className,
  rounded = 'rounded-[6px]',
  inset = 5,
  bubbleStyle,
}: {
  /** El globito: «Tocá acá», «Elegí la SAS», «Copiá este número». Sin texto, solo el anillo. */
  label?: string
  /** El número en la esquina del anillo (cuando hay varios en la misma pantalla). */
  n?: number
  side?: SpotlightSide
  children: ReactNode
  className?: string
  /** La forma del anillo (`rounded-full` para los íconos redondos). */
  rounded?: string
  /** Cuánto se separa el anillo del control, en px. */
  inset?: number
  /** Para correr el globito si choca con el borde del dibujo. */
  bubbleStyle?: CSSProperties
}) {
  const arrow = ARROWS[side]
  const ringInset = { inset: -inset }
  return (
    // `data-spotlight`: «Ampliar» centra la vista ampliada en lo resaltado (scaled-mock).
    <span data-spotlight="" className={cn('relative z-10 inline-flex', className)}>
      {children}
      <span
        className={cn('pointer-events-none absolute border-[3px]', rounded)}
        style={{ ...ringInset, borderColor: RED }}
      />
      <span
        className={cn('pointer-events-none absolute motion-safe:animate-pulse', rounded)}
        style={{ ...ringInset, boxShadow: `0 0 0 5px rgba(229, 38, 42, 0.28)` }}
      />
      {n !== undefined ? (
        <span
          className="pointer-events-none absolute flex size-[22px] items-center justify-center rounded-full text-[12px] font-bold text-white shadow-[0_2px_4px_rgba(0,0,0,0.3)] ring-2 ring-white"
          style={{ backgroundColor: RED, left: -inset - 11, top: -inset - 11 }}
        >
          {n}
        </span>
      ) : null}
      {label ? (
        <>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute overflow-visible"
            style={arrow.box}
            width={arrow.width}
            height={arrow.height}
            viewBox={`0 0 ${arrow.width} ${arrow.height}`}
            fill="none"
          >
            <path
              d={arrow.path}
              stroke={RED}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={arrow.head}
              stroke={RED}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span
            data-spotlight-label=""
            className="pointer-events-none absolute z-20 whitespace-nowrap rounded-[8px] px-2.5 py-[5px] text-[15px] font-bold leading-tight text-white shadow-[0_4px_12px_rgba(0,0,0,0.28)]"
            style={{
              backgroundColor: RED,
              fontFamily: 'Arial, Helvetica, sans-serif',
              ...BUBBLE[side],
              ...bubbleStyle,
            }}
          >
            {label}
          </span>
        </>
      ) : null}
    </span>
  )
}

/** Una cruz roja de «esta no»: marca la opción equivocada (MTXCA, por ejemplo). */
export function WrongMark({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn('relative inline-flex items-center', className)}>
      {children}
      <span
        className="pointer-events-none absolute -inset-[3px] rounded-[4px] border-2 border-dashed"
        style={{ borderColor: '#b42318' }}
      />
      <span
        className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-[6px] bg-[#b42318] px-2 py-[3px] text-[12px] font-bold text-white"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        ✕ {label}
      </span>
    </span>
  )
}
