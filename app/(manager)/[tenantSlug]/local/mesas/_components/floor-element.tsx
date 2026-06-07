'use client'

import { type CSSProperties, memo, useLayoutEffect, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { commitDragPosition, freeDragPosition } from '@/lib/floor-plan/grid'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { cn } from '@/lib/utils'
import { readStageTransform } from './pan-zoom-stage'
import { ResizeHandles } from './resize-handles'

type TransformRef = React.RefObject<ReactZoomPanPinchRef | null>

export type FloorElementProps = {
  element: ElementRow
  selected: boolean
  transformRef: TransformRef
  /** Dimensiones lógicas del área (para clampToArea durante el drag). */
  areaWidth: number
  areaHeight: number
  onSelect: (id: string) => void
  /** Commit del move al SOLTAR (una vez por gesto); el editor encola la persistencia. */
  onMove: (id: string, x: number, y: number) => void
  onResizeEnd: (id: string, size: { width: number; height: number }) => void
  /** Avisos de inicio/fin de gesto (el editor frena el re-seed del RSC mientras se arrastra). */
  onDragStart?: () => void
  onDragEnd?: () => void
}

// Etiquetas es-AR por tipo (para aria-label de decoración).
const KIND_LABELS: Record<ElementRow['kind'], string> = {
  table: 'Mesa',
  wall: 'Pared',
  pillar: 'Columna',
  island: 'Isla',
  bar: 'Barra',
}

// Umbral (px de pantalla) para distinguir click (selección) de drag (mover).
const DRAG_THRESHOLD = 4

type DragState = {
  startClientX: number
  startClientY: number
  origX: number
  origY: number
  /** Scale del stage capturado al iniciar el gesto (sin re-leer cada frame). */
  scale: number
  moved: boolean
  /** Último delta de pantalla (para el commit en up/cancel sin depender del evento). */
  lastDx: number
  lastDy: number
}

function FloorElementImpl({
  element,
  selected,
  transformRef,
  areaWidth,
  areaHeight,
  onSelect,
  onMove,
  onResizeEnd,
  onDragStart,
  onDragEnd,
}: FloorElementProps) {
  // Nodo posicionado (left/top = ancla committeada). El move vivo se pinta acá con
  // translate3d, SIN tocar el estado de React (capa GPU, 0 re-render por frame).
  const wrapperRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  // rAF pendiente que aplica el transform (deduplicado: a lo sumo uno encolado).
  const rafRef = useRef<number | null>(null)
  // Tamaño transitorio durante el gesto de resize.
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null)

  // Si la geometría committeada cambia (post onResizeEnd), descartamos el
  // tamaño transitorio para dibujar desde la geometría canónica.
  const lastCommittedRef = useRef({ width: element.width, height: element.height })
  if (
    lastCommittedRef.current.width !== element.width ||
    lastCommittedRef.current.height !== element.height
  ) {
    lastCommittedRef.current = { width: element.width, height: element.height }
    if (liveSize) setLiveSize(null)
  }

  // Cuando React aplica la posición committeada nueva (left/top = element.x/y),
  // zeramos el translate3d DESPUÉS de la mutación del DOM y antes del paint
  // (mismo commit) → la mesa "cae" en su lugar sin parpadeo. Durante el drag
  // element.x/y NO cambia, así que este efecto no corre mid-gesto.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync sólo cuando cambia la posición canónica del elemento
  useLayoutEffect(() => {
    if (wrapperRef.current) wrapperRef.current.style.transform = ''
  }, [element.x, element.y])

  // Cancelar cualquier rAF huérfano al desmontar.
  useLayoutEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const isTable = element.kind === 'table'
  const isCircle = element.shape === 'circle'

  const displayWidth = liveSize?.width ?? element.width
  const displayHeight = liveSize?.height ?? element.height

  // Pinta la posición libre vigente (sin snap) como delta respecto al ancla left/top.
  const applyLiveTransform = () => {
    rafRef.current = null
    const state = drag.current
    const node = wrapperRef.current
    if (!state || !node) return
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
    )
    node.style.transform = `translate3d(${free.x - state.origX}px, ${free.y - state.origY}px, 0)`
  }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // No iniciamos drag con botón secundario.
    if (e.button !== 0) return
    // Detener la propagación → el pan del stage no agarra el gesto.
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: element.x,
      origY: element.y,
      // Scale congelado al agarrar (evita drift por lecturas stale post centerOnInit).
      // Leído vía readStageTransform: el ref de rzpp NO tiene `.state` en runtime.
      scale: readStageTransform(transformRef).scale,
      moved: false,
      lastDx: 0,
      lastDy: 0,
    }
    if (wrapperRef.current) wrapperRef.current.style.willChange = 'transform'
    onDragStart?.()
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
    // Batcheo: a lo sumo un transform por frame (deduplicado).
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
      // Snap al soltar (Alt = libre, sin snap). Mantener el nodo en el lugar final
      // con un transform snappeado hasta que React re-renderice con el nuevo left/top.
      const commit = commitDragPosition(
        state.origX,
        state.origY,
        state.lastDx,
        state.lastDy,
        state.scale,
        element.width,
        element.height,
        areaWidth,
        areaHeight,
        !e.altKey,
      )
      if (node) {
        node.style.transform = `translate3d(${commit.x - state.origX}px, ${commit.y - state.origY}px, 0)`
      }
      onMove(element.id, commit.x, commit.y)
    } else if (state) {
      // Click sin drag → seleccionar (abre inspector).
      onSelect(element.id)
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

  // Fill de decoración: hex del dueño o el token estructural "poche" (sólido, dark-safe).
  const decorStyle: CSSProperties | undefined = isTable
    ? undefined
    : { backgroundColor: element.color ?? 'var(--wall)' }

  const ariaLabel = isTable
    ? `Mesa ${element.table?.label ?? element.label ?? ''}`.trim()
    : `${KIND_LABELS[element.kind]}${element.label ? ` ${element.label}` : ''}`

  return (
    // className="floor-element" → react-zoom-pan-pinch EXCLUYE el pan sobre este nodo.
    <div ref={wrapperRef} className="floor-element" style={wrapperStyle}>
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label={ariaLabel}
        style={decorStyle}
        className={cn(
          // touch-none también en el botón: touch-action NO se hereda del wrapper,
          // sin esto el navegador toma el drag como scroll y corta el gesto en tablet.
          'relative flex h-full w-full cursor-grab touch-none items-center justify-center overflow-hidden text-center transition-shadow active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isCircle ? 'rounded-full' : 'rounded-md',
          isTable
            ? 'border border-primary/40 bg-card text-card-foreground shadow-sm'
            : 'border-2 border-wall-border text-wall-foreground',
          selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        )}
      >
        {isTable ? (
          <span className="flex flex-col items-center justify-center gap-0.5 px-1 leading-none">
            <span className="font-serif text-sm font-semibold tabular-nums">
              {element.table?.label ?? element.label ?? '—'}
            </span>
            {element.table?.capacity != null && (
              <span className="text-[10px] text-muted-foreground">
                {element.table.capacity} pers.
              </span>
            )}
          </span>
        ) : element.label ? (
          <span className="px-1 text-[10px] font-medium uppercase tracking-wide">
            {element.label}
          </span>
        ) : null}
      </button>

      {selected && (
        <ResizeHandles
          width={displayWidth}
          height={displayHeight}
          transformRef={transformRef}
          onResize={setLiveSize}
          onResizeEnd={(size) => {
            setLiveSize(null)
            onResizeEnd(element.id, size)
          }}
        />
      )}
    </div>
  )
}

// Memoizado: el editor re-renderiza al seleccionar/cambiar de área o al commitear un
// move; sin memo se re-renderizarían los N elementos. Comparamos por todo lo que
// afecta el render (geometría + selección + identidad de los handlers).
export const FloorElement = memo(FloorElementImpl, (a, b) => {
  const ea = a.element
  const eb = b.element
  return (
    a.selected === b.selected &&
    a.areaWidth === b.areaWidth &&
    a.areaHeight === b.areaHeight &&
    a.transformRef === b.transformRef &&
    a.onSelect === b.onSelect &&
    a.onMove === b.onMove &&
    a.onResizeEnd === b.onResizeEnd &&
    a.onDragStart === b.onDragStart &&
    a.onDragEnd === b.onDragEnd &&
    ea.id === eb.id &&
    ea.x === eb.x &&
    ea.y === eb.y &&
    ea.width === eb.width &&
    ea.height === eb.height &&
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
