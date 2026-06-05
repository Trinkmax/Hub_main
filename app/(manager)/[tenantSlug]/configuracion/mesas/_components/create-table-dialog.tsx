'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createTableInPlanAction } from '@/lib/floor-plan/actions'
import { suggestNextLabel } from '@/lib/floor-plan/numbering'

type CreateTableDialogProps = {
  slug: string
  areaId: string
  areaNumberStart: number
  existingLabels: string[]
  centerX: number
  centerY: number
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}

export function CreateTableDialog({
  slug,
  areaId,
  areaNumberStart,
  existingLabels,
  centerX,
  centerY,
  open,
  onOpenChange,
  onCreated,
}: CreateTableDialogProps) {
  const [label, setLabel] = useState('')
  const [shape, setShape] = useState<'rect' | 'circle'>('rect')
  const [capacity, setCapacity] = useState('')
  const [pending, start] = useTransition()

  // Al abrir, autosugerimos el próximo número libre del área (editable).
  useEffect(() => {
    if (open) {
      setLabel(suggestNextLabel(areaNumberStart, existingLabels))
      setShape('rect')
      setCapacity('')
    }
  }, [open, areaNumberStart, existingLabels])

  const onSubmit = () => {
    const name = label.trim()
    if (name.length === 0) {
      toast.error('Poné un nombre para la mesa.')
      return
    }
    const cap = capacity.trim().length > 0 ? Number(capacity) : null
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 50)) {
      toast.error('La capacidad debe ser un número entre 1 y 50.')
      return
    }
    start(async () => {
      const result = await createTableInPlanAction(slug, {
        area_id: areaId,
        label: name,
        capacity: cap,
        shape,
        x: centerX,
        y: centerY,
      })
      if (result.ok) {
        toast.success('Mesa creada.')
        onOpenChange(false)
        onCreated()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva mesa</DialogTitle>
          <DialogDescription>
            Se crea una mesa con su QR y se ubica en el centro del área activa.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ct-label">Nombre / número</Label>
            <Input
              id="ct-label"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="1, 2, Barra 1…"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ct-shape">Forma</Label>
            <Select value={shape} onValueChange={(v) => setShape(v as 'rect' | 'circle')}>
              <SelectTrigger id="ct-shape" aria-label="Forma de la mesa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rect">Rectangular</SelectItem>
                <SelectItem value="circle">Redonda</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ct-capacity">Capacidad (opcional)</Label>
            <Input
              id="ct-capacity"
              type="number"
              min={1}
              max={50}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Sin definir"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={pending || label.trim().length === 0}>
            {pending ? 'Creando…' : 'Crear mesa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
