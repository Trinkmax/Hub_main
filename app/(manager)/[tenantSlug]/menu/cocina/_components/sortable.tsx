'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Una lista que se ordena de dos maneras: arrastrando la manija (con el dedo, el mouse o el
 * teclado: Espacio levanta, las flechas mueven, Espacio suelta) o con los botones de subir y
 * bajar de cada renglón. Lo usan las estaciones, los grupos de aclaraciones y sus opciones.
 */
export function SortableList({
  id,
  ids,
  nameOf,
  onReorder,
  children,
}: {
  /** Estable entre el servidor y el navegador (los avisos para lectores cuelgan de él). */
  id: string
  ids: ReadonlyArray<string>
  /** Cómo se llama cada fila, para decirlo en voz alta. */
  nameOf: (id: string) => string
  onReorder: (next: string[]) => void
  children: ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const place = (rowId: string | number) => ids.indexOf(String(rowId)) + 1

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove([...ids], from, to))
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'Para cambiar el orden, apretá Espacio, mové con las flechas y soltá con Espacio. Escape cancela.',
        },
        announcements: {
          onDragStart: ({ active }) => `Levantaste ${nameOf(String(active.id))}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${nameOf(String(active.id))} quedaría en el lugar ${place(over.id)} de ${ids.length}.`
              : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `${nameOf(String(active.id))} quedó en el lugar ${place(over.id)} de ${ids.length}.`
              : `${nameOf(String(active.id))} quedó donde estaba.`,
          onDragCancel: ({ active }) => `${nameOf(String(active.id))} quedó donde estaba.`,
        },
      }}
    >
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

export type RowHandle = ReturnType<typeof useSortableRow>

/** Lo que un renglón necesita para moverse: dónde colgarse, su estilo y lo de la manija. */
export function useSortableRow(id: string) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Mientras se arrastra va por encima de sus vecinos.
    position: isDragging ? 'relative' : undefined,
    zIndex: isDragging ? 5 : undefined,
  }
  return { setNodeRef, style, dragging: isDragging, grip: { ...attributes, ...listeners } }
}

/** La manija: lo que se agarra para arrastrar. */
export function DragGrip({
  row,
  label,
  className,
}: {
  row: RowHandle
  /** «Reordenar Jugoso». */
  label: string
  className?: string
}) {
  return (
    <button
      {...row.grip}
      type="button"
      aria-label={label}
      // `touch-none`: sin esto, arrastrar con el dedo desliza la hoja en vez de mover la fila.
      className={cn(
        'flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing pointer-coarse:size-11',
        className,
      )}
    >
      <GripVertical aria-hidden className="size-4" />
    </button>
  )
}

/** Subir y bajar un lugar, para quien no quiere (o no puede) arrastrar. */
export function MoveButtons({
  name,
  canUp,
  canDown,
  onMove,
  className,
}: {
  name: string
  canUp: boolean
  canDown: boolean
  onMove: (delta: -1 | 1) => void
  className?: string
}) {
  const button =
    'flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-11'
  return (
    <span className={cn('flex shrink-0 items-center', className)}>
      <button
        type="button"
        aria-label={`Subir ${name}`}
        disabled={!canUp}
        onClick={() => onMove(-1)}
        className={button}
      >
        <ArrowUp aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        aria-label={`Bajar ${name}`}
        disabled={!canDown}
        onClick={() => onMove(1)}
        className={button}
      >
        <ArrowDown aria-hidden className="size-4" />
      </button>
    </span>
  )
}
