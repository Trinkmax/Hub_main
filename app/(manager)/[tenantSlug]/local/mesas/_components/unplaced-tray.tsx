'use client'

import { MapPin, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import type { UnplacedTable } from '@/lib/floor-plan/queries'

type UnplacedTrayProps = {
  tables: UnplacedTable[]
  onPlace: (tableId: string) => void
  /** Borra la mesa (y su QR) definitivamente. Si falla, el diálogo queda abierto con el error. */
  onDelete: (tableId: string) => Promise<ConfirmResult>
}

function TrayRow({
  table,
  onPlace,
  onAskDelete,
}: {
  table: UnplacedTable
  onPlace: (tableId: string) => void
  onAskDelete: (table: UnplacedTable) => void
}) {
  return (
    <li className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate type-body font-medium text-foreground">{table.label}</p>
        {/* Puede bajar un renglón: truncado, el código del QR quedaba en «mesa…». */}
        <p className="break-words type-caption text-muted-foreground">
          {table.capacity != null ? `${table.capacity} personas` : 'Sin capacidad'} ·{' '}
          <code className="font-mono">{table.qr_token}</code>
        </p>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="danger-ghost"
        onClick={() => onAskDelete(table)}
        aria-label={`Borrar la mesa ${table.label}`}
      >
        <Trash2 aria-hidden />
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => onPlace(table.id)}>
        <MapPin aria-hidden />
        Colocar
      </Button>
    </li>
  )
}

/**
 * Bandeja del costado cuando no hay nada elegido: las mesas activas que no
 * están en ningún plano. «Colocar» la pone en el centro del área.
 */
export function UnplacedTray({ tables, onPlace, onDelete }: UnplacedTrayProps) {
  // La mesa a borrar queda guardada al cerrar: el título no cambia durante la salida.
  const [target, setTarget] = useState<UnplacedTable | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const askDelete = (table: UnplacedTable) => {
    setTarget(table)
    setConfirmOpen(true)
  }

  return (
    <section aria-labelledby="unplaced-tray-title" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h2 id="unplaced-tray-title" className="type-subtitle text-foreground">
          Mesas sin ubicar
        </h2>
        <p className="type-small text-pretty text-muted-foreground">
          {tables.length === 0
            ? 'No hay ninguna. Las mesas que quites del plano aparecen acá, con su QR.'
            : 'Tocá «Colocar» para ponerla en el centro del área y después arrastrala.'}
        </p>
      </div>
      {tables.length > 0 ? (
        <ul className="divide-y divide-border">
          {tables.map((table) => (
            <TrayRow key={table.id} table={table} onPlace={onPlace} onAskDelete={askDelete} />
          ))}
        </ul>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        icon={Trash2}
        title={`¿Borrar la mesa «${target?.label ?? ''}»?`}
        description="Se borran la mesa y su QR para siempre. Si ya se usó alguna vez, no se puede borrar: desactivala desde «Lista de mesas»."
        confirmLabel="Borrar mesa"
        pendingLabel="Borrando…"
        onConfirm={() => (target ? onDelete(target.id) : undefined)}
      />
    </section>
  )
}
