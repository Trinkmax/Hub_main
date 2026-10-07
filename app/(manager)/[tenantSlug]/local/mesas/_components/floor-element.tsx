'use client'

import { type CSSProperties, memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import {
  bodyRadius,
  ChairsSvg,
  DecorContent,
  decorSurfaceClass,
  decorSurfaceStyle,
} from '@/components/floor-plan/table-glyph'
import { clampToAreaRotated, freeDragPosition, snapToGrid } from '@/lib/floor-plan/grid'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { type Box, computeSnap, type Guide } from '@/lib/floor-plan/snap'
import { cn } from '@/lib/utils'
import { readStageTransform } from './pan-zoom-stage'
import { ResizeHandles } from './resize-handles'
import { RotateHandle } from './rotate-handle'

type TransformRef = React.RefObject<ReactZoomPanPinchRef | null>

export type FloorElementProps = {
  element: ElementRow
  selected: boolean
  transformRef: TransformRef
  /** Dimensiones lógicas del área (para clampToArea durante el drag). */
  areaWidth: number
  areaHeight: number
  /** Selección (additive = shift/cmd para multi-selección). */
  onSelect: (id: string, additive: boolean) => void
  /** Cajas de los hermanos (para snap-a-objeto) al iniciar el gesto. */
  getSiblings: (id: string) => Box[]
  /** Registra el nodo DOM (para que el editor mueva los pares en grupo). */
  registerNode: (id: string, node: HTMLDivElement | null) => void
  /** Delta lógico vivo durante el drag (el editor mueve los pares seleccionados). */
  onMoveLive: (id: string, dx: number, dy: number) => void
  /** Commit del move al SOLTAR: delta lógico (el editor aplica al grupo + persiste). */
  onMoveEnd: (id: string, dx: number, dy: number) => void
  onResizeEnd: (id: string, size: { width: number; height: number }) => void
  /** Commit de la rotación al soltar el handle (grados 0..359). */
  onRotateEnd: (id: string, rotation: number) => void
  /** Guías de alineación vivas (se dibujan en el stage); [] al terminar. */
  onGuides: (guides: Guide[]) => void
  /** Inicio/fin de gesto: el editor frena el re-seed del RSC y asegura la selección. */
  onDragStart?: (id: string) => void
  onDragEnd?: () => void
}

// Etiquetas es-AR por tipo (para aria-label de decoración).
const KIND_LABELS: Record<ElementRow['kind'], string> = {
  table: 'Mesa',
  wall: 'Pared',
  pillar: 'Columna',
  island: 'Isla',
  bar: 'Barra',
  door: 'Puerta',
  text: 'Texto',
  stage: 'Escenario',
  booth: 'Box',
}

// Umbral (px de pantalla) para distinguir click (selección) de drag (mover).
const DRAG_THRESHOLD = 4

type DragState = {
  startClientX: number
  startClientY: number
  origX: number
  origY: number
  scale: number
  moved: boolean
  lastDx: number
  lastDy: number
  siblings: Box[]
}

function FloorElementImpl({
  element,
  selected,
  transformRef,
  areaWidth,
  areaHeight,
  onSelect,
  getSiblings,
  registerNode,
  onMoveLive,
  onMoveEnd,
  onResizeEnd,
  onRotateEnd,
  onGuides,
  onDragStart,
  onDragEnd,
}: FloorElementProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Etiqueta (número/rótulo): se contra-rota para quedar derecha; durante el gesto
  // de rotación se actualiza imperativamente para no quedar inclinada.
  const labelRef = useRef<HTMLSpanElement>(null)
  const drag = useRef<DragState | null>(null)
  const rafRef = useRef<number | null>(null)
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null)

  // Callback ref: setea el wrapper local + registra el nodo en el editor.
  const setWrapper = useCallback(
    (node: HTMLDivElement | null) => {
      wrapperRef.current = node
      registerNode(element.id, node)
    },
    [registerNode, element.id],
  )

  const lastCommittedRef = useRef({ width: element.width, height: element.height })
  if (
    lastCommittedRef.current.width !== element.width ||
    lastCommittedRef.current.height !== element.height
  ) {
    lastCommittedRef.current = { width: element.width, height: element.height }
    if (liveSize) setLiveSize(null)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync sólo cuando cambia la posición canónica del elemento
  useLayoutEffect(() => {
    if (wrapperRef.current) wrapperRef.current.style.transform = ''
  }, [element.x, element.y])

  useLayoutEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const isTable = element.kind === 'table'
  const isBanquette = element.shape === 'banquette'

  const displayWidth = liveSize?.width ?? element.width
  const displayHeight = liveSize?.height ?? element.height
  const rotation = element.rotation ?? 0
  const radius = bodyRadius(
    element.shape,
    isTable ? element.corner_radius || 8 : element.corner_radius,
  )

  // Posición imantada vigente (free + snap-a-objeto). Devuelve {x,y,guides}.
  const resolveSnap = (state: DragState) => {
    const free = freeDragPosition(
      state.origX,
      state.origY,
      state.lastDx,
      state.lastDy,
      state.scale,
      element.width,
      element.height,
      areaWidth,
      areaHeight,
      rotation,
    )
    return computeSnap(
      { x: free.x, y: free.y, width: element.width, height: element.height },
      state.siblings,
    )
  }

  const applyLiveTransform = () => {
    rafRef.current = null
    const state = drag.current
    const node = wrapperRef.current
    if (!state || !node) return
    const snap = resolveSnap(state)
    node.style.transform = `translate3d(${snap.x - state.origX}px, ${snap.y - state.origY}px, 0)`
    onGuides(snap.guides)
    onMoveLive(element.id, snap.x - state.origX, snap.y - state.origY)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    onDragStart?.(element.id)
    drag.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: element.x,
      origY: element.y,
      scale: readStageTransform(transformRef).scale,
      moved: false,
      lastDx: 0,
      lastDy: 0,
      siblings: getSiblings(element.id),
    }
    if (wrapperRef.current) wrapperRef.current.style.willChange = 'transform'
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    if (!state) return
    const dx = e.clientX - state.startClientX
    const dy = e.clientY - state.startClientY
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    state.moved = true
    state.lastDx = dx
    state.lastDy = dy
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(applyLiveTransform)
  }

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    drag.current = null
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    const node = wrapperRef.current
    if (state?.moved) {
      // Snap final: por eje, gana el snap-a-objeto; si no, snap-a-grilla
      // (Alt = libre). Luego clamp al área.
      const free = freeDragPosition(
        state.origX,
        state.origY,
        state.lastDx,
        state.lastDy,
        state.scale,
        element.width,
        element.height,
        areaWidth,
        areaHeight,
        rotation,
      )
      const snap = computeSnap(
        { x: free.x, y: free.y, width: element.width, height: element.height },
        state.siblings,
      )
      const hasV = snap.guides.some((g) => g.axis === 'v')
      const hasH = snap.guides.some((g) => g.axis === 'h')
      const fx = hasV ? snap.x : e.altKey ? Math.round(free.x) : snapToGrid(free.x)
      const fy = hasH ? snap.y : e.altKey ? Math.round(free.y) : snapToGrid(free.y)
      const c = clampToAreaRotated(
        fx,
        fy,
        element.width,
        element.height,
        rotation,
        areaWidth,
        areaHeight,
      )
      if (node) {
        node.style.transform = `translate3d(${c.x - state.origX}px, ${c.y - state.origY}px, 0)`
      }
      onGuides([])
      onMoveEnd(element.id, c.x - state.origX, c.y - state.origY)
    } else if (state) {
      onSelect(element.id, e.shiftKey || e.metaKey || e.ctrlKey)
    }
    if (node) node.style.willChange = 'auto'
    onDragEnd?.()
  }

  const wrapperStyle: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: displayWidth,
    height: displayHeight,
    zIndex: selected ? element.z_index + 1000 : element.z_index,
    touchAction: 'none',
  }

  const decorStyle: CSSProperties = isTable
    ? { borderRadius: radius }
    : {
        ...decorSurfaceStyle(element.kind, element.color),
        // La decoración redonda (columna, isla circular) se dibuja como círculo
        // también en el editor (espejo de la vista en vivo).
        ...(element.shape === 'circle' ? { borderRadius: '50%' } : null),
      }

  const ariaLabel = isTable
    ? `Mesa ${element.table?.label ?? element.label ?? ''}`.trim()
    : `${KIND_LABELS[element.kind]}${element.label ? ` ${element.label}` : ''}`

  return (
    <div ref={setWrapper} className="floor-element" style={wrapperStyle}>
      {/* Capa que rota: cuerpo + sillas giran juntos; el número se contra-rota. */}
      <div
        ref={contentRef}
        className="relative h-full w-full"
        style={{ transform: `rotate(${rotation}deg)`, transformOrigin: 'center' }}
      >
        {(isTable || element.kind === 'bar') && (
          <ChairsSvg
            shape={element.shape}
            kind={element.kind}
            width={displayWidth}
            height={displayHeight}
            capacity={element.table?.capacity ?? null}
          />
        )}

        {isBanquette && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-0 right-1 left-1 h-1.5 rounded-full bg-primary/45"
          />
        )}

        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-label={ariaLabel}
          style={decorStyle}
          className={cn(
            'absolute inset-0 flex cursor-grab touch-none items-center justify-center overflow-hidden text-center transition-shadow active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isTable
              ? 'border border-primary/35 bg-card text-card-foreground shadow-sm'
              : decorSurfaceClass(element.kind),
            selected && 'shadow-[var(--shadow-glow)]',
          )}
        >
          {isTable ? (
            <span
              ref={labelRef}
              className="flex flex-col items-center justify-center gap-0.5 px-1 leading-none"
              style={rotation ? { transform: `rotate(${-rotation}deg)` } : undefined}
            >
              <span className="font-serif text-sm font-semibold tabular-nums">
                {element.table?.label ?? element.label ?? '—'}
              </span>
              {element.table?.capacity != null && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {element.table.capacity}
                </span>
              )}
            </span>
          ) : (
            <span
              ref={labelRef}
              style={rotation ? { transform: `rotate(${-rotation}deg)` } : undefined}
            >
              <DecorContent kind={element.kind} label={element.label} />
            </span>
          )}
        </button>

        {/* Ring + handles DENTRO de la capa que rota → siguen la rotación del
            elemento (antes quedaban desalineados con el cuerpo rotado). */}
        {selected && (
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-px rounded-[10px] ring-2 ring-primary"
          />
        )}

        {selected && (
          <>
            <ResizeHandles
              width={displayWidth}
              height={displayHeight}
              transformRef={transformRef}
              rotation={rotation}
              onResize={setLiveSize}
              onResizeEnd={(size) => {
                setLiveSize(null)
                onResizeEnd(element.id, size)
              }}
            />
            <RotateHandle
              boxRef={wrapperRef}
              onRotate={(deg) => {
                if (contentRef.current) contentRef.current.style.transform = `rotate(${deg}deg)`
                // Mantener la etiqueta derecha durante el gesto (contra-rotación viva).
                if (labelRef.current) labelRef.current.style.transform = `rotate(${-deg}deg)`
              }}
              onRotateEnd={(deg) => onRotateEnd(element.id, deg)}
            />
          </>
        )}
      </div>
    </div>
  )
}

export const FloorElement = memo(FloorElementImpl, (a, b) => {
  const ea = a.element
  const eb = b.element
  return (
    a.selected === b.selected &&
    a.areaWidth === b.areaWidth &&
    a.areaHeight === b.areaHeight &&
    a.transformRef === b.transformRef &&
    a.onSelect === b.onSelect &&
    a.getSiblings === b.getSiblings &&
    a.registerNode === b.registerNode &&
    a.onMoveLive === b.onMoveLive &&
    a.onMoveEnd === b.onMoveEnd &&
    a.onResizeEnd === b.onResizeEnd &&
    a.onRotateEnd === b.onRotateEnd &&
    a.onGuides === b.onGuides &&
    a.onDragStart === b.onDragStart &&
    a.onDragEnd === b.onDragEnd &&
    ea.id === eb.id &&
    ea.x === eb.x &&
    ea.y === eb.y &&
    ea.width === eb.width &&
    ea.height === eb.height &&
    ea.rotation === eb.rotation &&
    ea.corner_radius === eb.corner_radius &&
    ea.z_index === eb.z_index &&
    ea.kind === eb.kind &&
    ea.shape === eb.shape &&
    ea.color === eb.color &&
    ea.label === eb.label &&
    (ea.table?.active ?? null) === (eb.table?.active ?? null) &&
    (ea.table?.label ?? null) === (eb.table?.label ?? null) &&
    (ea.table?.capacity ?? null) === (eb.table?.capacity ?? null)
  )
})
