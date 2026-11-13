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
import type { UnplacedTable } from '@/lib/floor-plan/queries'
import { cn } from '@/lib/utils'
import { PAPEL } from './papel'

type UnplacedTrayProps = {
  tables: UnplacedTable[]
  /** El sector donde caen al ubicarlas. */
  areaName: string
  /** Ubica la mesa en el sector. Termina cuando el servidor contestó (bien o mal). */
  onPlace: (tableId: string) => Promise<void>
  /** Borra la mesa (y su QR) definitivamente. */
  onDelete: (tableId: string) => void
}

/**
 * Mesas que existen pero no están dibujadas en ningún sector de la sucursal
 * (se las quitó del plano, o se reactivaron). «Ubicar» las apoya en el centro
 * del sector que se está mirando.
 */
export function UnplacedTray({ tables, areaName, onPlace, onDelete }: UnplacedTrayProps) {
  const [doomed, setDoomed] = useState<UnplacedTable | null>(null)
  // La que se está ubicando: su botón lo dice mientras viaja al servidor.
  const [placing, setPlacing] = useState<string | null>(null)

  const place = async (tableId: string) => {
    setPlacing(tableId)
    try {
      await onPlace(tableId)
    } finally {
      setPlacing(null)
    }
  }

  if (tables.length === 0) return null

  return (
    <div className="fpe-group">
      <h3 className="fpe-group-title">
        {tables.length === 1 ? '1 mesa sin ubicar' : `${tables.length} mesas sin ubicar`}
      </h3>
      <ul className="fpe-tray">
        {tables.map((table) => (
          <li key={table.id} className="fpe-tray-item">
            {/* El número y los lugares van juntos: si el nombre es largo, los lugares bajan a un
                segundo renglón en vez de pisar los botones. */}
            <span className="fpe-tray-main">
              <span className="fpe-numchip" title={`Mesa ${table.label}`}>
                {table.label}
              </span>
              <span className="fpe-tray-meta">
                {table.capacity != null
                  ? `${table.capacity} ${table.capacity === 1 ? 'lugar' : 'lugares'}`
                  : 'Sin lugares'}
              </span>
            </span>
            <button
              type="button"
              className="fpe-btn fpe-btn-ghost fpe-btn-sm fpe-btn-icon"
              onClick={() => setDoomed(table)}
              aria-label={`Borrar la mesa ${table.label}`}
              title="Borrar la mesa"
            >
              <Trash2 aria-hidden />
            </button>
            <button
              type="button"
              className="fpe-btn fpe-btn-primary fpe-btn-sm"
              disabled={placing !== null}
              onClick={() => void place(table.id)}
              aria-label={`Ubicar la mesa ${table.label} en ${areaName}`}
            >
              <MapPin aria-hidden />
              {placing === table.id ? 'Ubicando…' : 'Ubicar'}
            </button>
          </li>
        ))}
      </ul>
      <p className="fpe-hint">«Ubicar» la apoya en el centro de {areaName}.</p>

      <AlertDialog
        open={doomed !== null}
        onOpenChange={(open) => {
          if (!open) setDoomed(null)
        }}
      >
        <AlertDialogContent className={cn(PAPEL, 'fpe-dialog')}>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la mesa {doomed?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra la mesa y no tiene vuelta. Si alguna vez se usó en el salón no se va a poder
              borrar: en ese caso desactivala desde Lista.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="fpe-btn fpe-btn-quiet">Dejarla</AlertDialogCancel>
            <AlertDialogAction
              className="fpe-btn fpe-btn-danger-solid"
              onClick={() => {
                if (doomed) onDelete(doomed.id)
                setDoomed(null)
              }}
            >
              Borrar la mesa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
