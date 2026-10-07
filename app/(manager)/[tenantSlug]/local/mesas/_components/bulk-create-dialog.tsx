'use client'

import { Rows3 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
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
import { bulkCreateTablesAction } from '@/lib/floor-plan/actions'
import { cn } from '@/lib/utils'

type Preset = 'round' | 'square' | 'rect' | 'banquette'

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'square', label: 'Cuadrada' },
  { value: 'round', label: 'Redonda' },
  { value: 'rect', label: 'Rectangular' },
  { value: 'banquette', label: 'Banquette' },
]

export function BulkCreateDialog({
  slug,
  areaId,
  onCreated,
}: {
  slug: string
  areaId: string
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(6)
  const [capacity, setCapacity] = useState(4)
  const [preset, setPreset] = useState<Preset>('square')
  const [pending, start] = useTransition()

  const submit = () => {
    start(async () => {
      const r = await bulkCreateTablesAction(slug, {
        area_id: areaId,
        count,
        capacity: capacity > 0 ? capacity : null,
        preset,
      })
      if (r.ok) {
        toast.success(
          `${r.data.created} ${r.data.created === 1 ? 'mesa creada' : 'mesas creadas'}.`,
        )
        setOpen(false)
        onCreated()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Rows3 className="size-4" aria-hidden />
          Varias mesas
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif">Crear varias mesas</DialogTitle>
          <DialogDescription>
            Se crean en grilla, auto-numeradas desde el inicio del área, cada una con su propio QR.
            Después las acomodás arrastrando.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-count">Cantidad</Label>
              <Input
                id="bulk-count"
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-capacity">Capacidad c/u</Label>
              <Input
                id="bulk-capacity"
                type="number"
                min={1}
                max={50}
                value={capacity}
                onChange={(e) =>
                  setCapacity(Math.max(0, Math.min(50, Number(e.target.value) || 0)))
                }
                placeholder="Sin definir"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Forma</Label>
            <div className="grid grid-cols-4 gap-1 rounded-lg border border-border/60 bg-muted/40 p-0.5">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPreset(p.value)}
                  aria-pressed={preset === p.value}
                  className={cn(
                    'rounded-md px-2 py-1.5 text-center text-xs transition-colors',
                    preset === p.value
                      ? 'bg-card font-medium shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? 'Creando…' : `Crear ${count} ${count === 1 ? 'mesa' : 'mesas'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
