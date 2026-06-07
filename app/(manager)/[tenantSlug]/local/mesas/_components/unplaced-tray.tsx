'use client'

import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UnplacedTable } from '@/lib/floor-plan/queries'

type UnplacedTrayProps = {
  tables: UnplacedTable[]
  onPlace: (tableId: string) => void
}

function TrayChip({
  table,
  onPlace,
}: {
  table: UnplacedTable
  onPlace: (tableId: string) => void
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5">
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
