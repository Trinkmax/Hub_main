'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createTable, type TableActionState } from '@/lib/tables/actions'

const initialState: TableActionState = { ok: false, message: '' }

export function NewTableDialog({ tenantSlug }: { tenantSlug: string }) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(
    (prev: TableActionState, fd: FormData) => createTable(tenantSlug, prev, fd),
    initialState,
  )

  useEffect(() => {
    if (state.ok) setOpen(false)
  }, [state.ok])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 size-4" />
          Nueva mesa
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva mesa</DialogTitle>
          <DialogDescription>
            La mesa nace con un QR único. Lo podés imprimir desde la lista.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <div>
            <Label htmlFor="label">Nombre</Label>
            <Input
              id="label"
              name="label"
              autoFocus
              required
              maxLength={40}
              placeholder="Ej: Mesa 5, Barra 1, VIP"
            />
            {!state.ok && state.fieldErrors?.label && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.label}</p>
            )}
          </div>
          <div>
            <Label htmlFor="capacity">Capacidad (opcional)</Label>
            <Input id="capacity" name="capacity" type="number" min={1} max={50} />
            {!state.ok && state.fieldErrors?.capacity && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.capacity}</p>
            )}
          </div>
          {!state.ok && state.message && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creando…' : 'Crear mesa'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
