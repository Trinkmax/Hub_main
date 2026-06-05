'use client'

import { Power, RefreshCw, Trash2 } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { deleteTablePermanentlyAction, setTableActiveAction } from '@/lib/floor-plan/actions'
import { regenerateQrToken } from '@/lib/tables/actions'
import { PrintQrButton } from './print-qr-button'

type FallbackTable = {
  id: string
  label: string
  capacity: number | null
  qr_token: string
  active: boolean
}

type TablesListFallbackProps = {
  slug: string
  tables: FallbackTable[]
}

/**
 * Camino accesible canónico (no solo respaldo del ErrorBoundary): una <table>
 * HTML real con todas las acciones por mesa, sin canvas ni drag. Se monta SIEMPRE
 * como tab secundaria del editor y como fallback de render.
 */
export function TablesListFallback({ slug, tables }: TablesListFallbackProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const handleToggleActive = (table: FallbackTable) => {
    setBusyId(table.id)
    startTransition(async () => {
      const result = await setTableActiveAction(slug, table.id, !table.active)
      if (result.ok) {
        toast.success(
          table.active ? `Mesa "${table.label}" desactivada` : `Mesa "${table.label}" activada`,
        )
        router.refresh()
      } else {
        toast.error(result.message)
      }
      setBusyId(null)
    })
  }

  const handleRegenerate = (table: FallbackTable) => {
    setBusyId(table.id)
    startTransition(async () => {
      const result = await regenerateQrToken(slug, table.id)
      if (result.ok) {
        toast.success(`QR de "${table.label}" regenerado`)
        router.refresh()
      } else {
        toast.error(result.message)
      }
      setBusyId(null)
    })
  }

  const handleDeletePermanently = (table: FallbackTable) => {
    setBusyId(table.id)
    startTransition(async () => {
      const result = await deleteTablePermanentlyAction(slug, table.id)
      if (result.ok) {
        toast.success(`Mesa "${table.label}" eliminada`)
        router.refresh()
      } else {
        toast.error(result.message)
      }
      setBusyId(null)
    })
  }

  if (tables.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay mesas"
        description="Creá la primera mesa desde el editor de plano para imprimir su QR y empezar a recibir pedidos."
      />
    )
  }

  return (
    <Table>
      <TableCaption>
        Lista accesible de todas las mesas físicas. Cada mesa conserva su QR y sus acciones.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Mesa</TableHead>
          <TableHead scope="col">Capacidad</TableHead>
          <TableHead scope="col">QR</TableHead>
          <TableHead scope="col">Estado</TableHead>
          <TableHead scope="col" className="text-right">
            Acciones
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tables.map((table) => {
          const rowBusy = pending && busyId === table.id
          return (
            <TableRow key={table.id}>
              <TableCell className="font-medium">{table.label}</TableCell>
              <TableCell className="text-muted-foreground">
                {table.capacity ?? 'sin definir'}
              </TableCell>
              <TableCell>
                <code className="block max-w-[12rem] overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {table.qr_token}
                </code>
              </TableCell>
              <TableCell>
                {table.active ? (
                  <Badge variant="success">Activa</Badge>
                ) : (
                  <Badge variant="secondary">Inactiva</Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1.5">
                  <PrintQrButton qrToken={table.qr_token} />

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={rowBusy}
                        aria-label={`Regenerar QR de ${table.label}`}
                      >
                        <RefreshCw className="size-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Regenerar QR de "{table.label}"</AlertDialogTitle>
                        <AlertDialogDescription>
                          El QR actual queda inservible. Tenés que reimprimir y reemplazar el QR
                          físico de la mesa. Las sesiones abiertas siguen funcionando para los
                          celulares ya conectados.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleRegenerate(table)}>
                          Sí, regenerar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={table.active}
                      disabled={rowBusy}
                      onCheckedChange={() => handleToggleActive(table)}
                      aria-label={
                        table.active
                          ? `Desactivar mesa ${table.label}`
                          : `Activar mesa ${table.label}`
                      }
                    />
                    <Power className="size-3.5 text-muted-foreground" aria-hidden />
                  </div>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={rowBusy}
                        aria-label={`Eliminar permanentemente la mesa ${table.label}`}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Eliminar "{table.label}"</AlertDialogTitle>
                        <AlertDialogDescription>
                          Solo se puede borrar definitivamente una mesa sin historial de sesiones.
                          Si la mesa tiene historial, la acción se bloquea y conviene desactivarla
                          con el interruptor.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeletePermanently(table)}>
                          Eliminar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
