'use client'

import { Maximize, Minus, Plus, Scan } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { GRID } from '@/lib/floor-plan/grid'
import type { PlanBox } from '@/lib/floor-plan/model'
import {
  fitTransform,
  type StageInset,
  type StageTransform,
} from '@/lib/floor-plan/stage-transform'

type TransformRef = React.RefObject<ReactZoomPanPinchRef | null>

const MIN_SCALE = 0.1
const MAX_SCALE = 4
/** Al encajar no se agranda más que esto: un sector chico no se infla. */
const MAX_FIT_SCALE = 1.4
const FIT_PADDING = 28
/** Con las herramientas flotando alrededor, el aire ya lo ponen ellas. */
const FIT_PADDING_INSET = 14
/** Por debajo de esto el tablero está oculto o todavía sin medir. */
const MIN_FRAME = 40
/** Tablero angosto (celular): el control de zoom ocupa casi todo el ancho. */
const NARROW_FRAME = 480
const ZOOM_BAR_SPACE = 52

export type EditorStageProps = {
  /** Tamaño lógico del piso del sector. */
  width: number
  height: number
  transformRef: TransformRef
  /** La caja de lo dibujado, para «Encajar las mesas». `null` = sector vacío. */
  content: PlanBox | null
  /** Cambia al cambiar de sector: se vuelve a mostrar el piso entero. */
  fitKey: string
  /** Tocaron el paño o el piso vacío (soltar la selección). */
  onBackground: () => void
  label: string
  /** Lo que flota sobre el lienzo sin agrandarse con el zoom. */
  overlay?: React.ReactNode
  /**
   * Las franjas del tablero que tapan las herramientas que flotan encima (la barra de agregar, la
   * paleta, el zoom): el piso se encaja en lo que queda libre. `null` = nada flota (celular).
   */
  inset?: StageInset | null
  children: React.ReactNode
}

/**
 * El lienzo del editor: el paño verde con el piso de cartón encima, que se
 * arrastra y se acerca (`react-zoom-pan-pinch`). Los elementos van adentro en
 * coordenadas lógicas del piso.
 *
 * Arranca mostrando el piso entero y lo mantiene encajado si cambia el tamaño
 * del tablero (se abre la maqueta, se achica la ventana) HASTA que el dueño
 * acomoda la vista a mano: de ahí en más no se la toca.
 *
 * Publica `--fpe-inv` (1 / zoom) en el piso para que el marco de selección y
 * las manijas midan lo mismo en pantalla con cualquier zoom.
 */
export function EditorStage({
  width,
  height,
  transformRef,
  content,
  fitKey,
  onBackground,
  label,
  overlay,
  inset = null,
  children,
}: EditorStageProps) {
  const frameRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<HTMLSpanElement>(null)
  // Qué se está mostrando: el piso entero, lo dibujado, o lo que el dueño acomodó a mano.
  const fitModeRef = useRef<'floor' | 'content' | 'manual'>('floor')
  const sizeRef = useRef({ width, height })
  sizeRef.current = { width, height }
  const contentRef = useRef(content)
  contentRef.current = content
  const insetRef = useRef(inset)
  insetRef.current = inset
  // El lienzo se monta ya encajado: primero se mide el tablero (sin pintar nada).
  const [initial, setInitial] = useState<StageTransform | null>(null)

  const measure = useCallback((mode: 'floor' | 'content'): StageTransform | null => {
    const frame = frameRef.current
    if (!frame) return null
    const rect = frame.getBoundingClientRect()
    if (rect.width < MIN_FRAME || rect.height < MIN_FRAME) return null
    const floor = { x: 0, y: 0, width: sizeRef.current.width, height: sizeRef.current.height }
    const box = mode === 'content' ? (contentRef.current ?? floor) : floor
    const free = insetRef.current
    if (free) {
      return fitTransform({ width: rect.width, height: rect.height }, box, {
        padding: FIT_PADDING_INSET,
        inset: free,
        minScale: MIN_SCALE,
        maxScale: MAX_FIT_SCALE,
      })
    }
    // En un tablero angosto (celular) se deja libre la franja de abajo, donde va el control de zoom.
    const reserve = rect.width < NARROW_FRAME ? ZOOM_BAR_SPACE : 0
    return fitTransform({ width: rect.width, height: rect.height - reserve }, box, {
      padding: reserve ? 14 : FIT_PADDING,
      minScale: MIN_SCALE,
      maxScale: MAX_FIT_SCALE,
    })
  }, [])

  const fitTo = useCallback(
    (mode: 'floor' | 'content', animateMs: number) => {
      const ref = transformRef.current
      const next = measure(mode)
      if (!ref || !next) return
      ref.setTransform(next.positionX, next.positionY, next.scale, animateMs, 'easeOut')
      fitModeRef.current = mode
    },
    [transformRef, measure],
  )

  useLayoutEffect(() => {
    setInitial(measure('floor') ?? { scale: 0.5, positionX: 0, positionY: 0 })
  }, [measure])

  // Otro sector, u otro tamaño de piso: de vuelta al piso entero.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitKey/width/height son los disparadores
  useEffect(() => {
    fitTo('floor', 0)
  }, [fitTo, fitKey, width, height])

  // Cambió lo que flota encima (de celular a pantalla grande): se vuelve a encajar, igual que abajo.
  const insetKey = inset ? `${inset.top}:${inset.right}:${inset.bottom}:${inset.left}` : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: insetKey es el disparador
  useEffect(() => {
    const mode = fitModeRef.current
    if (mode !== 'manual') fitTo(mode, 0)
  }, [fitTo, insetKey])

  // Cambió el tamaño del tablero: se mantiene encajado mientras nadie lo haya acomodado a mano.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const observer = new ResizeObserver(() => {
      const mode = fitModeRef.current
      if (mode !== 'manual') fitTo(mode, 0)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [fitTo])

  const publish = useCallback((scale: number) => {
    if (zoomRef.current) zoomRef.current.textContent = `${Math.round(scale * 100)} %`
    stageRef.current?.style.setProperty('--fpe-inv', String(1 / scale))
  }, [])

  const manual = useCallback(() => {
    fitModeRef.current = 'manual'
  }, [])

  return (
    <section
      ref={frameRef}
      className="fpe-canvas"
      aria-label={label}
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest('.floor-element, .fpe-ui')) onBackground()
      }}
    >
      {initial ? (
        <TransformWrapper
          ref={transformRef}
          initialScale={initial.scale}
          initialPositionX={initial.positionX}
          initialPositionY={initial.positionY}
          minScale={MIN_SCALE}
          maxScale={MAX_SCALE}
          limitToBounds={false}
          // Arrastrar un elemento no mueve el lienzo: cada uno hace su propio arrastre.
          panning={{ excluded: ['floor-element'], velocityDisabled: true }}
          doubleClick={{ disabled: true }}
          wheel={{ step: 0.2 }}
          pinch={{ step: 5 }}
          onInit={(ref) => publish(ref.instance.transformState.scale)}
          onTransformed={(_ref, state) => publish(state.scale)}
          onPanningStart={manual}
          onWheelStart={manual}
          onPinchingStart={manual}
        >
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ width, height }}
          >
            <div
              ref={stageRef}
              className="fpe-stage"
              style={
                {
                  width,
                  height,
                  '--fp-grid': `${GRID}px`,
                  '--fp-grid-major': `${GRID * 5}px`,
                  '--fpe-inv': String(1 / initial.scale),
                } as React.CSSProperties
              }
            >
              {children}
            </div>
          </TransformComponent>
        </TransformWrapper>
      ) : null}

      {overlay}

      <div className="fpe-zoom fpe-ui">
        <button
          type="button"
          aria-label="Alejar"
          title="Alejar"
          onClick={() => {
            manual()
            transformRef.current?.zoomOut(0.3)
          }}
        >
          <Minus aria-hidden />
        </button>
        <span ref={zoomRef} className="fpe-zoom-value" aria-hidden>
          {initial ? `${Math.round(initial.scale * 100)} %` : ''}
        </span>
        <button
          type="button"
          aria-label="Acercar"
          title="Acercar"
          onClick={() => {
            manual()
            transformRef.current?.zoomIn(0.3)
          }}
        >
          <Plus aria-hidden />
        </button>
        <span className="fpe-zoom-sep" aria-hidden />
        <button
          type="button"
          aria-label="Encajar las mesas"
          title="Encajar las mesas"
          disabled={!content}
          onClick={() => fitTo('content', 260)}
        >
          <Scan aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Ver todo el piso"
          title="Ver todo el piso"
          onClick={() => fitTo('floor', 260)}
        >
          <Maximize aria-hidden />
        </button>
      </div>
    </section>
  )
}
