'use client'

import { useActionState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type TableActionState, updateTable } from '@/lib/tables/actions'

const initialState: TableActionState = { ok: false, message: '' }

export function EditTableDialog({
  tenantSlug,
  table,
  open,
  onClose,
}: {
  tenantSlug: string
  table: { id: string; label: string; capacity: number | null; active: boolean }
  open: boolean
  onClose: () => void
}) {
  const [state, action, pending] = useActionState(
    (prev: TableActionState, fd: FormData) => updateTable(tenantSlug, prev, fd),
    initialState,
  )

  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, onClose])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar mesa</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={table.id} />
          <div>
            <Label htmlFor="edit-label">Nombre</Label>
            <Input
              id="edit-label"
              name="label"
              defaultValue={table.label}
              required
              maxLength={40}
            />
            {!state.ok && state.fieldErrors?.label && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.label}</p>
            )}
          </div>
          <div>
            <Label htmlFor="edit-capacity">Capacidad</Label>
            <Input
              id="edit-capacity"
              name="capacity"
              type="number"
              min={1}
              max={50}
              defaultValue={table.capacity ?? ''}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="edit-active" name="active" defaultChecked={table.active} />
            <Label htmlFor="edit-active">Mesa activa</Label>
          </div>
          {!state.ok && state.message && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
