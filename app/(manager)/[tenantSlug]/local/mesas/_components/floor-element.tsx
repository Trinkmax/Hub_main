'use client'

import { type CSSProperties, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { clampToArea, snapToGrid } from '@/lib/floor-plan/grid'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { cn } from '@/lib/utils'
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
  /** Move optimista durante el drag; el editor encola la persistencia. */
  onMove: (id: string, x: number, y: number) => void
  onResizeEnd: (id: string, size: { width: number; height: number }) => void
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
  moved: boolean
}

export function FloorElement({
  element,
  selected,
  transformRef,
  areaWidth,
  areaHeight,
  onSelect,
  onMove,
  onResizeEnd,
}: FloorElementProps) {
  const drag = useRef<DragState | null>(null)
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

  const isTable = element.kind === 'table'
  const isCircle = element.shape === 'circle'

  const displayWidth = liveSize?.width ?? element.width
  const displayHeight = liveSize?.height ?? element.height

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
      moved: false,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    if (!state) return
    const dx = e.clientX - state.startClientX
    const dy = e.clientY - state.startClientY
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    state.moved = true
    const scale = transformRef.current?.state.scale ?? 1
    const logicalX = snapToGrid(state.origX + dx / scale)
    const logicalY = snapToGrid(state.origY + dy / scale)
    const clamped = clampToArea(
      logicalX,
      logicalY,
      element.width,
      element.height,
      areaWidth,
      areaHeight,
    )
    onMove(element.id, clamped.x, clamped.y)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // Click sin drag → seleccionar (abre inspector). El move ya quedó persistido
    // por el editor a través de onMove (que encola); no hay commit extra acá.
    if (state && !state.moved) onSelect(element.id)
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

  // Fill de decoración: hex del dueño o token neutro (dark-mode safe).
  const decorStyle: CSSProperties | undefined = isTable
    ? undefined
    : { backgroundColor: element.color ?? 'var(--muted)' }

  const ariaLabel = isTable
    ? `Mesa ${element.table?.label ?? element.label ?? ''}`.trim()
    : `${KIND_LABELS[element.kind]}${element.label ? ` ${element.label}` : ''}`

  return (
    // className="floor-element" → react-zoom-pan-pinch EXCLUYE el pan sobre este nodo.
    <div className="floor-element" style={wrapperStyle}>
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={ariaLabel}
        style={decorStyle}
        className={cn(
          'relative flex h-full w-full cursor-grab items-center justify-center overflow-hidden border text-center transition-shadow active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isCircle ? 'rounded-full' : 'rounded-md',
          isTable
            ? 'border-primary/40 bg-card text-card-foreground shadow-sm'
            : 'border-border/70 text-muted-foreground',
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
          <span className="px-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
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
