'use client'

import { ArrowDownToLine, ArrowUpToLine, Copy, RefreshCw, Trash2, X } from 'lucide-react'
import { useActionState, useEffect, useState, useTransition } from 'react'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  mergeTablesAction,
  removeFromPlanAction,
  setElementShapeAction,
  setElementZIndexAction,
  setTableActiveAction,
  splitTableAction,
} from '@/lib/floor-plan/actions'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { regenerateQrToken, updateTable } from '@/lib/tables/actions'
import { PrintQrButton } from './print-qr-button'

type TableInspectorProps = {
  slug: string
  element: ElementRow
  allTables: { id: string; label: string }[]
  onChanged: () => void
  onClose: () => void
}

const initialUpdate = { ok: false as const, message: '' }

export function TableInspector({
  slug,
  element,
  allTables,
  onChanged,
  onClose,
}: TableInspectorProps) {
  const tableId = element.physical_table_id as string
  const meta = element.table
  const [active, setActive] = useState(meta?.active ?? true)
  const [mergeTarget, setMergeTarget] = useState<string>('')
  const [pending, start] = useTransition()

  // Editar nombre/capacidad → updateTable (FormData id,label,capacity; NUNCA active).
  const [updateState, updateAction, updatePending] = useActionState(
    (prev: Awaited<ReturnType<typeof updateTable>>, fd: FormData) => updateTable(slug, prev, fd),
    initialUpdate,
  )

  useEffect(() => {
    if (updateState.ok && updateState.tableId) {
      toast.success('Mesa actualizada.')
      onChanged()
    } else if (!updateState.ok && updateState.message) {
      toast.error(updateState.message)
    }
  }, [updateState, onChanged])

  // Sincroniza el switch local si cambia la mesa seleccionada.
  useEffect(() => {
    setActive(meta?.active ?? true)
  }, [meta?.active])

  const onToggleActive = (next: boolean) => {
    const prev = active
    setActive(next)
    start(async () => {
      const r = await setTableActiveAction(slug, tableId, next)
      if (r.ok) {
        toast.success(next ? 'Mesa activada.' : 'Mesa desactivada.')
        onChanged()
      } else {
        setActive(prev)
        toast.error(r.message)
      }
    })
  }

  const onRegenerate = () => {
    start(async () => {
      const r = await regenerateQrToken(slug, tableId)
      if (r.ok) {
        toast.success('QR regenerado.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onSplit = () => {
    start(async () => {
      const r = await splitTableAction(slug, element.id)
      if (r.ok) {
        toast.success('Mesa dividida.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onMerge = () => {
    if (!mergeTarget) return
    start(async () => {
      const r = await mergeTablesAction(slug, tableId, mergeTarget)
      if (r.ok) {
        toast.success('Mesas combinadas.')
        setMergeTarget('')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onRemove = () => {
    start(async () => {
      const r = await removeFromPlanAction(slug, element.id)
      if (r.ok) {
        toast.success('Mesa quitada del plano.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onZIndex = (zIndex: number) => {
    start(async () => {
      const r = await setElementZIndexAction(slug, element.id, zIndex)
      if (r.ok) onChanged()
      else toast.error(r.message)
    })
  }

  const onSetShape = (shape: 'rect' | 'circle' | 'banquette') => {
    if (shape === element.shape) return
    start(async () => {
      const r = await setElementShapeAction(slug, element.id, shape)
      if (r.ok) onChanged()
      else toast.error(r.message)
    })
  }

  const busy = pending || updatePending
  const mergeOptions = allTables.filter((t) => t.id !== tableId)

  return (
    <aside
      aria-label="Panel de mesa"
      className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">Mesa</h2>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Cerrar panel">
          <X className="size-4" />
        </Button>
      </div>

      {/* Editar nombre / capacidad */}
      <form action={updateAction} className="grid gap-3">
        <input type="hidden" name="id" value={tableId} />
        <div className="grid gap-1.5">
          <Label htmlFor="ti-label">Nombre</Label>
          <Input
            id="ti-label"
            name="label"
            required
            maxLength={40}
            defaultValue={meta?.label ?? ''}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ti-capacity">Capacidad</Label>
          <Input
            id="ti-capacity"
            name="capacity"
            type="number"
            min={1}
            max={50}
            defaultValue={meta?.capacity ?? ''}
            placeholder="Sin definir"
          />
        </div>
        <Button type="submit" size="sm" disabled={busy}>
          {updatePending ? 'Guardando…' : 'Guardar'}
        </Button>
      </form>

      <Separator />

      {/* Forma de la mesa (las sillas se redibujan según forma + capacidad) */}
      <div className="grid gap-1.5">
        <Label>Forma</Label>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-muted/40 p-0.5">
          {(
            [
              { value: 'circle', label: 'Redonda' },
              { value: 'rect', label: 'Rectangular' },
              { value: 'banquette', label: 'Banquette' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={busy}
              onClick={() => onSetShape(opt.value)}
              aria-pressed={element.shape === opt.value}
              className={
                element.shape === opt.value
                  ? 'rounded-md bg-card px-2 py-1.5 text-center font-medium text-xs shadow-sm'
                  : 'rounded-md px-2 py-1.5 text-center text-muted-foreground text-xs transition-colors hover:text-foreground'
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* QR */}
      <div className="grid gap-2">
        <Label>Código QR</Label>
        <code className="block truncate rounded-md bg-muted px-2 py-1 text-xs">
          {meta?.qr_token}
        </code>
        <div className="flex items-center gap-1">
          <PrintQrButton qrToken={meta?.qr_token ?? ''} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" disabled={busy}>
                <RefreshCw className="size-3.5" />
                Regenerar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Regenerar el QR?</AlertDialogTitle>
                <AlertDialogDescription>
                  El QR impreso anterior dejará de funcionar. Vas a tener que imprimir y pegar el
                  nuevo en la mesa.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onRegenerate}>Regenerar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Separator />

      {/* Activar / desactivar (RPC-only, NUNCA updateTable) */}
      <div className="flex items-center justify-between">
        <Label htmlFor="ti-active">Mesa activa</Label>
        <Switch id="ti-active" checked={active} onCheckedChange={onToggleActive} disabled={busy} />
      </div>

      <Separator />

      {/* Dividir / combinar */}
      <div className="grid gap-2">
        <Button size="sm" variant="outline" onClick={onSplit} disabled={busy}>
          <Copy className="size-3.5" />
          Dividir
        </Button>

        {mergeOptions.length > 0 ? (
          <div className="grid gap-2">
            <Select value={mergeTarget} onValueChange={setMergeTarget} disabled={busy}>
              <SelectTrigger aria-label="Mesa a absorber">
                <SelectValue placeholder="Combinar con…" />
              </SelectTrigger>
              <SelectContent>
                {mergeOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy || !mergeTarget}>
                  Combinar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Combinar las mesas?</AlertDialogTitle>
                  <AlertDialogDescription>
                    La mesa seleccionada absorbe a la otra. El QR de la mesa absorbida se desactiva
                    (no se pierde el historial). Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onMerge}>Combinar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </div>

      <Separator />

      {/* z-index */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index + 1)}
          disabled={busy}
        >
          <ArrowUpToLine className="size-3.5" />
          Al frente
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index - 1)}
          disabled={busy}
        >
          <ArrowDownToLine className="size-3.5" />
          Al fondo
        </Button>
      </div>

      <Separator />

      {/* Quitar del plano (la mesa sigue activa; vuelve a la bandeja) */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={busy}>
            <Trash2 className="size-3.5" />
            Quitar del plano
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar la mesa del plano?</AlertDialogTitle>
            <AlertDialogDescription>
              La mesa sigue activa y se puede volver a colocar desde la bandeja. Si tiene una sesión
              abierta no se podrá quitar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onRemove}>Quitar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
