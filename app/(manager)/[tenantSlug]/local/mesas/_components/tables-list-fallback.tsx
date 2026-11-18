'use client'

import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Switch } from '@/components/ui/switch'
import { deleteTablePermanentlyAction, setTableActiveAction } from '@/lib/floor-plan/actions'
import type { ListedTable } from '@/lib/floor-plan/model'
import { cn } from '@/lib/utils'
import { PAPEL } from './papel'

type FallbackTable = ListedTable

type TablesListFallbackProps = {
  slug: string
  tables: FallbackTable[]
  /** La sucursal cuyas mesas se listan (solo si el bar tiene más de una). */
  branchName?: string | null
}

/**
 * Todas las mesas de la sucursal en una tabla de verdad, con sus acciones, sin
 * lienzo ni arrastre. Es el camino para quien usa teclado o lector de pantalla
 * (no un respaldo de segunda): la pestaña «Lista» del editor, y lo que queda en
 * pie si el editor visual falla. También es donde se reactiva una mesa
 * desactivada.
 */
export function TablesListFallback({ slug, tables, branchName }: TablesListFallbackProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const run = (
    table: FallbackTable,
    action: () => Promise<{ ok: true } | { ok: false; message: string }>,
    done: string,
  ) => {
    setBusyId(table.id)
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        toast.success(done)
        router.refresh()
      } else {
        toast.error(result.message)
      }
      setBusyId(null)
    })
  }

  const title = branchName ? `Las mesas de ${branchName}` : 'Todas las mesas'

  if (tables.length === 0) {
    return (
      <div className="fpe-paper fpe-list">
        <div className="fpe-list-head">
          <h2>{title}</h2>
        </div>
        <p className="fpe-hint">
          Todavía no hay mesas. Pasá a Editar y tocá «Agregar mesa» para dibujar la primera.
        </p>
      </div>
    )
  }

  return (
    <div className="fpe-paper fpe-list">
      <div className="fpe-list-head">
        <h2>{title}</h2>
        <p className="fpe-hint">
          {tables.length} {tables.length === 1 ? 'mesa' : 'mesas'}, con las mismas acciones que el
          plano.
        </p>
      </div>
      <table>
        <caption>
          Una mesa desactivada no aparece en el plano: se reactiva con su interruptor.
        </caption>
        <thead>
          <tr>
            <th scope="col">Mesa</th>
            <th scope="col">Lugares</th>
            <th scope="col">Sector</th>
            <th scope="col">Estado</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Acciones
            </th>
          </tr>
        </thead>
        <tbody>
          {tables.map((table) => {
            const busy = pending && busyId === table.id
            return (
              <tr key={table.id} className={cn(!table.active && 'is-off')}>
                <th scope="row" className="fpe-list-num">
                  {table.label}
                </th>
                <td>{table.capacity ?? 'Sin cargar'}</td>
                <td>{table.sector ?? (table.active ? 'Sin ubicar' : '—')}</td>
                <td>
                  <span className={cn('fpe-tag', table.active && 'is-on')}>
                    {table.active ? 'Activa' : 'Desactivada'}
                  </span>
                </td>
                <td>
                  <div className="fpe-list-actions">
                    <Switch
                      checked={table.active}
                      disabled={busy}
                      onCheckedChange={() =>
                        run(
                          table,
                          () => setTableActiveAction(slug, table.id, !table.active),
                          table.active
                            ? `Mesa ${table.label} desactivada.`
                            : `Mesa ${table.label} activa de nuevo: está en «Mesas sin ubicar».`,
                        )
                      }
                      aria-label={
                        table.active
                          ? `Desactivar la mesa ${table.label}`
                          : `Reactivar la mesa ${table.label}`
                      }
                    />

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          type="button"
                          className="fpe-btn fpe-btn-ghost fpe-btn-sm fpe-btn-icon"
                          disabled={busy}
                          aria-label={`Borrar la mesa ${table.label}`}
                          title="Borrar la mesa"
                        >
                          <Trash2 aria-hidden />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className={cn(PAPEL, 'fpe-dialog')}>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Borrar la mesa {table.label}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Se borra y no tiene vuelta. Solo se puede si nunca se usó en el salón:
                            si tiene historial, desactivala con el interruptor.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="fpe-btn fpe-btn-quiet">
                            Dejarla
                          </AlertDialogCancel>
                          <AlertDialogAction
                            className="fpe-btn fpe-btn-danger-solid"
                            onClick={() =>
                              run(
                                table,
                                () => deleteTablePermanentlyAction(slug, table.id),
                                `Mesa ${table.label} borrada.`,
                              )
                            }
                          >
                            Borrar la mesa
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
