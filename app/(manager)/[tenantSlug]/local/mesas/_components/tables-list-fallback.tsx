'use client'

import { RefreshCw, Table2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { TABLE_ACTIVE_STATUS, tableActiveStatus } from '@/components/floor-plan/status-meta'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
 * Camino accesible canónico (no solo respaldo del ErrorBoundary): una tabla
 * HTML real (`DataTable` del kit) con todas las acciones por mesa, sin canvas ni
 * drag. Se monta SIEMPRE como pestaña del editor y como fallback de render.
 * En el celular la misma lista se ve como tarjetas-fila.
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
          table.active ? `Mesa «${table.label}» desactivada.` : `Mesa «${table.label}» activada.`,
        )
        router.refresh()
      } else {
        toast.error(result.message)
      }
      setBusyId(null)
    })
  }

  // Confirmaciones: el diálogo espera la acción abierto («Regenerando…») y, si
  // falla, muestra el error adentro en vez de cerrarse.
  const handleRegenerate = async (table: FallbackTable): Promise<ConfirmResult> => {
    const result = await regenerateQrToken(slug, table.id)
    if (!result.ok) return result
    toast.success(`QR de «${table.label}» regenerado.`)
    router.refresh()
  }

  const handleDeletePermanently = async (table: FallbackTable): Promise<ConfirmResult> => {
    const result = await deleteTablePermanentlyAction(slug, table.id)
    if (!result.ok) return result
    toast.success(`Mesa «${table.label}» borrada.`)
    router.refresh()
  }

  const columns: DataTableColumn<FallbackTable>[] = [
    {
      id: 'mesa',
      header: 'Mesa',
      cell: (table) => table.label,
      mobile: 'primary',
    },
    {
      id: 'capacidad',
      header: 'Personas',
      numeric: true,
      width: '7rem',
      cell: (table) =>
        table.capacity != null ? (
          table.capacity
        ) : (
          <span className="text-muted-foreground">Sin definir</span>
        ),
    },
    {
      id: 'qr',
      header: 'Código QR',
      mobile: 'meta',
      hideBelow: 'lg',
      cell: (table) => (
        <code className="block max-w-[12rem] truncate font-mono type-caption text-muted-foreground">
          {table.qr_token}
        </code>
      ),
    },
    {
      id: 'estado',
      header: 'Estado',
      cell: (table) => (
        <span className="inline-flex items-center gap-2">
          <Switch
            checked={table.active}
            disabled={pending && busyId === table.id}
            pending={pending && busyId === table.id}
            onCheckedChange={() => handleToggleActive(table)}
            aria-label={
              table.active ? `Desactivar la mesa ${table.label}` : `Activar la mesa ${table.label}`
            }
          />
          <StatusBadge status={tableActiveStatus(table.active)} map={TABLE_ACTIVE_STATUS} />
        </span>
      ),
    },
    {
      id: 'acciones',
      header: 'Acciones',
      headerHidden: true,
      align: 'end',
      cell: (table) => (
        <span className="inline-flex items-center justify-end gap-1">
          <PrintQrButton qrToken={table.qr_token} tableLabel={table.label} />
          <ConfirmDialog
            tone="danger"
            icon={RefreshCw}
            title={`¿Regenerar el QR de «${table.label}»?`}
            description="El QR impreso deja de funcionar: vas a tener que imprimir el nuevo y pegarlo en la mesa. Los celulares que ya están conectados siguen andando."
            confirmLabel="Regenerar QR"
            pendingLabel="Regenerando…"
            onConfirm={() => handleRegenerate(table)}
            trigger={
              <IconAction
                label={`Regenerar el QR de la mesa ${table.label}`}
                tooltip="Regenerar QR"
              >
                <RefreshCw aria-hidden />
              </IconAction>
            }
          />
          <ConfirmDialog
            tone="danger"
            icon={Trash2}
            title={`¿Borrar la mesa «${table.label}»?`}
            description="Se borran la mesa y su QR para siempre. Solo se puede si nunca se usó: si tiene historial, apagala con el interruptor de «Estado»."
            confirmLabel="Borrar mesa"
            pendingLabel="Borrando…"
            onConfirm={() => handleDeletePermanently(table)}
            trigger={
              <IconAction label={`Borrar la mesa ${table.label}`} tooltip="Borrar mesa" danger>
                <Trash2 aria-hidden />
              </IconAction>
            }
          />
        </span>
      ),
    },
  ]

  return (
    <DataTable
      caption="Mesas del local"
      rows={tables}
      getRowId={(table) => table.id}
      columns={columns}
      empty={
        <EmptyState
          size="sm"
          icon={Table2}
          title="Todavía no hay mesas"
          description="Creá la primera desde «Editar plano»: cada mesa viene con su QR para imprimir y pegar."
        />
      }
    />
  )
}

/**
 * Botón de ícono de una fila que abre una confirmación. Recibe las props del
 * disparador del `ConfirmDialog` (`asChild`) y las pasa al botón.
 */
function IconAction({
  label,
  tooltip,
  danger,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; tooltip: string; danger?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={danger ? 'danger-ghost' : 'ghost'}
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
