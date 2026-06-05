'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties } from 'react'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { cn } from '@/lib/utils'
import { ResizeHandles } from './resize-handles'

type FloorElementProps = {
  element: ElementRow
  selected: boolean
  scale: number
  onSelect: (id: string) => void
  onResizeEnd: (id: string, size: { width: number; height: number }) => void
}

// Etiquetas es-AR por tipo (para aria-label de decoración). No exportado: detalle de UI.
const KIND_LABELS: Record<ElementRow['kind'], string> = {
  table: 'Mesa',
  wall: 'Pared',
  pillar: 'Columna',
  island: 'Isla',
  bar: 'Barra',
}

export function FloorElement({
  element,
  selected,
  scale,
  onSelect,
  onResizeEnd,
}: FloorElementProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: element.id })

  const isTable = element.kind === 'table'
  const isCircle = element.shape === 'circle'

  // El stage está escalado; el elemento se posiciona en px lógicos. El transform
  // de dnd-kit es para el preview en vivo del drag (se descarta en dragEnd y el
  // editor re-aplica la geometría committeada).
  const wrapperStyle: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    transform: CSS.Translate.toString(transform),
    zIndex: selected ? element.z_index + 1000 : element.z_index,
    touchAction: 'none',
  }

  // Fill de decoración: hex del dueño, o token neutro si color is null (dark-mode safe).
  const decorStyle: CSSProperties | undefined = isTable
    ? undefined
    : { backgroundColor: element.color ?? 'var(--muted)' }

  const ariaLabel = isTable
    ? `Mesa ${element.table?.label ?? element.label ?? ''}`.trim()
    : `${KIND_LABELS[element.kind]}${element.label ? ` ${element.label}` : ''}`

  return (
    <div ref={setNodeRef} style={wrapperStyle}>
      {/* Body = activator del drag (NO los handles). Click sin drag selecciona. */}
      <button
        ref={setActivatorNodeRef}
        type="button"
        onClick={() => onSelect(element.id)}
        {...listeners}
        {...attributes}
        aria-label={ariaLabel}
        style={decorStyle}
        className={cn(
          'relative flex h-full w-full cursor-grab items-center justify-center overflow-hidden border text-center transition-shadow active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isCircle ? 'rounded-full' : 'rounded-md',
          isTable
            ? 'border-primary/40 bg-card text-card-foreground shadow-sm'
            : 'border-border/70 text-muted-foreground',
          selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
          isDragging && 'opacity-70 shadow-lg',
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
          width={element.width}
          height={element.height}
          scale={scale}
          onResize={() => {
            // Preview live: el editor maneja la geometría transitoria; acá no
            // re-renderizamos width/height locales para no pelear con el stage.
            // (El editor pasa onResizeEnd para committear; el live preview de
            // tamaño lo aplica el editor sobre el element prop.)
          }}
          onResizeEnd={(size) => onResizeEnd(element.id, size)}
        />
      )}
    </div>
  )
}
