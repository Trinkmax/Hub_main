'use client'

import { MapPin, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { UnplacedTable } from '@/lib/floor-plan/queries'

type UnplacedTrayProps = {
  tables: UnplacedTable[]
  onPlace: (tableId: string) => void
  /** Borra la mesa (y su QR) definitivamente. */
  onDelete: (tableId: string) => void
}

function TrayChip({
  table,
  onPlace,
  onAskDelete,
}: {
  table: UnplacedTable
  onPlace: (tableId: string) => void
  onAskDelete: (table: UnplacedTable) => void
}) {
  return (
    <li className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{table.label}</p>
        <p className="truncate text-muted-foreground text-xs">
          {table.capacity != null ? `${table.capacity} pers.` : 'Sin capacidad'} ·{' '}
          <code>{table.qr_token}</code>
        </p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        onClick={() => onAskDelete(table)}
        aria-label={`Eliminar mesa ${table.label}`}
        title="Eliminar mesa"
      >
        <Trash2 className="size-3.5" />
      </Button>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => onPlace(table.id)}>
        <MapPin className="size-3.5" />
        Colocar
      </Button>
    </li>
  )
}

export function UnplacedTray({ tables, onPlace, onDelete }: UnplacedTrayProps) {
  const [pending, setPending] = useState<UnplacedTable | null>(null)

  return (
    <section aria-label="Mesas no ubicadas" className="grid gap-2">
      <h2 className="font-display font-semibold text-sm">Mesas sin ubicar</h2>
      {tables.length === 0 ? (
        <p className="text-muted-foreground text-xs">No hay mesas activas pendientes de ubicar.</p>
      ) : (
        <ul className="grid gap-1.5">
          {tables.map((table) => (
            <TrayChip key={table.id} table={table} onPlace={onPlace} onAskDelete={setPending} />
          ))}
        </ul>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la mesa "{pending?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra la mesa y su QR de forma definitiva. Si la mesa tuvo sesiones, no se podrá
              borrar (desactivala en su lugar). Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) onDelete(pending.id)
                setPending(null)
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
