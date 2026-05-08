'use client'

import { Pencil, RefreshCw, Trash2 } from 'lucide-react'
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
import { deleteTable, regenerateQrToken } from '@/lib/tables/actions'
import { EditTableDialog } from './edit-table-dialog'
import { PrintQrButton } from './print-qr-button'

export type TableRow = {
  id: string
  label: string
  capacity: number | null
  qr_token: string
  active: boolean
  created_at: string
}

export function TablesList({ tenantSlug, tables }: { tenantSlug: string; tables: TableRow[] }) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<TableRow | null>(null)

  const handleDelete = (id: string, label: string) => {
    startTransition(async () => {
      const result = await deleteTable(tenantSlug, id)
      if (result.ok) toast.success(`Mesa "${label}" eliminada`)
      else toast.error(result.message)
    })
  }

  const handleRegenerate = (id: string, label: string) => {
    startTransition(async () => {
      const result = await regenerateQrToken(tenantSlug, id)
      if (result.ok) toast.success(`QR de "${label}" regenerado`)
      else toast.error(result.message)
    })
  }

  if (tables.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay mesas"
        description="Creá la primera mesa para imprimir su QR y empezar a recibir pedidos."
      />
    )
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((t) => (
          <div key={t.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">{t.label}</h3>
                <p className="text-xs text-muted-foreground">
                  Capacidad: {t.capacity ?? 'sin definir'}
                </p>
              </div>
              {!t.active && <Badge variant="secondary">Inactiva</Badge>}
            </div>

            <code className="block overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {t.qr_token}
            </code>

            <div className="flex flex-wrap gap-1.5">
              <PrintQrButton qrToken={t.qr_token} />
              <Button size="sm" variant="ghost" onClick={() => setEditing(t)} disabled={pending}>
                <Pencil className="size-3.5" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={pending}>
                    <RefreshCw className="size-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerar QR de "{t.label}"</AlertDialogTitle>
                    <AlertDialogDescription>
                      El QR actual va a quedar inservible. Tenés que reimprimir y reemplazar el QR
                      físico de la mesa. Las sesiones abiertas siguen funcionando para los celulares
                      ya conectados.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleRegenerate(t.id, t.label)}>
                      Sí, regenerar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={pending}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Eliminar "{t.label}"</AlertDialogTitle>
                    <AlertDialogDescription>
                      Si la mesa tiene sesiones históricas, esta acción podría fallar. Considerá
                      desactivarla en lugar de borrarla.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleDelete(t.id, t.label)}>
                      Eliminar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EditTableDialog
          tenantSlug={tenantSlug}
          table={editing}
          open={Boolean(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
