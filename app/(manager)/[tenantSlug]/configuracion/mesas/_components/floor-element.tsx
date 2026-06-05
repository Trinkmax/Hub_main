'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { type CSSProperties, useEffect, useState } from 'react'
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

  // Tamaño transitorio durante el gesto de resize (no afecta la firma de props).
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null)

  // Cuando el tamaño committeado cambia (después de onResizeEnd), descartamos el
  // estado transitorio para que el elemento se dibuje desde la geometría canónica.
  // biome-ignore lint/correctness/useExhaustiveDependencies: element.width/height son los triggers intencionales del reset; setLiveSize es estable pero no es el gatillo.
  useEffect(() => {
    setLiveSize(null)
  }, [element.width, element.height])

  const isTable = element.kind === 'table'
  const isCircle = element.shape === 'circle'

  const displayWidth = liveSize?.width ?? element.width
  const displayHeight = liveSize?.height ?? element.height

  // El stage está escalado; el elemento se posiciona en px lógicos. El transform
  // de dnd-kit es para el preview en vivo del drag (se descarta en dragEnd y el
  // editor re-aplica la geometría committeada).
  const wrapperStyle: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: displayWidth,
    height: displayHeight,
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
          width={displayWidth}
          height={displayHeight}
          scale={scale}
          onResize={setLiveSize}
          onResizeEnd={(size) => {
            // Limpiamos el estado transitorio y commiteamos el tamaño final.
            setLiveSize(null)
            onResizeEnd(element.id, size)
          }}
        />
      )}
    </div>
  )
}
