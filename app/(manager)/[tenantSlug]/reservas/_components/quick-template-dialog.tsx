'use client'

import { Loader2, Plus } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { quickCreateScheduledTemplate } from '@/lib/salon/actions'
import { MEAL_TYPE_LABELS, type MealType, type ScheduledEventTemplateRow } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

const MEALS: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']
const PALETTE = ['#7c3aed', '#0ea5e9', '#16a34a', '#f59e0b', '#ef4444', '#ec4899'] as const

export function QuickTemplateDialog({
  tenantSlug,
  defaultMealType,
  onCreated,
}: {
  tenantSlug: string
  defaultMealType: MealType
  onCreated: (template: ScheduledEventTemplateRow) => void
}) {
  const nameId = useId()
  const capId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('')
  const [mealType, setMealType] = useState<MealType>(defaultMealType)
  const [color, setColor] = useState<string>(PALETTE[0])
  const [pending, startTransition] = useTransition()

  function reset() {
    setName('')
    setCapacity('')
    setMealType(defaultMealType)
    setColor(PALETTE[0])
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Poné un nombre')
      return
    }
    startTransition(async () => {
      const result = await quickCreateScheduledTemplate(tenantSlug, {
        name: name.trim(),
        default_capacity: capacity === '' ? '' : Number(capacity),
        default_meal_type: mealType,
        color_hex: color,
      })
      if (result.ok && result.data?.template) {
        toast.success('Formato creado.')
        onCreated(result.data.template as ScheduledEventTemplateRow)
        setOpen(false)
        reset()
      } else {
        toast.error(result.ok ? 'No se pudo crear el formato.' : result.message)
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Plus className="size-3.5" />
          Crear formato nuevo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Nuevo formato</DialogTitle>
          <DialogDescription>
            Sushi Libre, Pizza Libre, Ramen… Queda guardado en el catálogo para reusarlo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={nameId}>Nombre</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Pizza Libre"
              maxLength={80}
              autoFocus
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Tipo de servicio</Label>
            <Select value={mealType} onValueChange={(v) => setMealType(v as MealType)}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEALS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MEAL_TYPE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={capId}>Cupo sugerido (opcional)</Label>
            <Input
              id={capId}
              type="number"
              min={1}
              max={9999}
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Ej. 40"
              className="tabular-nums"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-7 rounded-full border-2 transition-transform',
                    color === c ? 'scale-110 border-foreground' : 'border-transparent',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Crear y usar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
