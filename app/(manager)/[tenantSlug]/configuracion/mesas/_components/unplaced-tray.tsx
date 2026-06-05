'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UnplacedTable } from '@/lib/floor-plan/queries'

type UnplacedTrayProps = {
  tables: UnplacedTable[]
  onPlace: (tableId: string) => void
}

// id de draggable de bandeja, distinguible de los elementos del plano por el prefijo.
export const TRAY_DRAG_PREFIX = 'tray:'

function TrayChip({
  table,
  onPlace,
}: {
  table: UnplacedTable
  onPlace: (tableId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${TRAY_DRAG_PREFIX}${table.id}`,
    data: { kind: 'tray-table', tableId: table.id },
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), touchAction: 'none' }}
      className={`flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5 ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground"
        aria-label={`Arrastrar mesa ${table.label} al plano`}
        {...listeners}
        {...attributes}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{table.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {table.capacity != null ? `${table.capacity} pers.` : 'Sin capacidad'} ·{' '}
          <code>{table.qr_token}</code>
        </p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => onPlace(table.id)}>
        <MapPin className="size-3.5" />
        Colocar
      </Button>
    </li>
  )
}

export function UnplacedTray({ tables, onPlace }: UnplacedTrayProps) {
  return (
    <section aria-label="Mesas no ubicadas" className="grid gap-2">
      <h2 className="font-display text-sm font-semibold">Mesas sin ubicar</h2>
      {tables.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay mesas activas pendientes de ubicar.</p>
      ) : (
        <ul className="grid gap-1.5">
          {tables.map((table) => (
            <TrayChip key={table.id} table={table} onPlace={onPlace} />
          ))}
        </ul>
      )}
    </section>
  )
}
