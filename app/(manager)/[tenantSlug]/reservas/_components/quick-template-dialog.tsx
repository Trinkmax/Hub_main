'use client'

import { Check, Plus } from 'lucide-react'
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
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
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
const PALETTE_NAMES: Record<(typeof PALETTE)[number], string> = {
  '#7c3aed': 'Violeta',
  '#0ea5e9': 'Celeste',
  '#16a34a': 'Verde',
  '#f59e0b': 'Ámbar',
  '#ef4444': 'Rojo',
  '#ec4899': 'Rosa',
}

/**
 * «Crear formato nuevo» desde el alta de una reserva: el atajo para el cumple
 * que pide un formato que todavía no existe en el catálogo.
 */
export function QuickTemplateDialog({
  tenantSlug,
  defaultMealType,
  onCreated,
}: {
  tenantSlug: string
  defaultMealType: MealType
  onCreated: (template: ScheduledEventTemplateRow) => void
}) {
  const colorLabelId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState<number | null>(null)
  const [mealType, setMealType] = useState<MealType>(defaultMealType)
  const [color, setColor] = useState<string>(PALETTE[0])
  const [nameError, setNameError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setName('')
    setCapacity(null)
    setMealType(defaultMealType)
    setColor(PALETTE[0])
    setNameError(null)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // El form vive adentro del form de la reserva (por portal): que el envío no suba.
    e.preventDefault()
    e.stopPropagation()
    if (!name.trim()) {
      setNameError('Poné un nombre para el formato.')
      return
    }
    startTransition(async () => {
      const result = await quickCreateScheduledTemplate(tenantSlug, {
        name: name.trim(),
        default_capacity: capacity === null ? '' : capacity,
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
        <Button type="button" variant="secondary" size="sm">
          <Plus aria-hidden />
          Crear formato nuevo
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Nuevo formato</DialogTitle>
          <DialogDescription>
            Sushi Libre, Pizza Libre, Ramen… Queda guardado en el catálogo para reusarlo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <Field label="Nombre" error={nameError}>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (nameError) setNameError(null)
              }}
              placeholder="Pizza Libre"
              maxLength={80}
              autoFocus
            />
          </Field>
          <Field label="Tipo de servicio">
            <Select value={mealType} onValueChange={(v) => setMealType(v as MealType)}>
              <SelectTrigger>
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
          </Field>
          <Field label="Cupo sugerido" optional hint="Se puede cambiar en cada fecha.">
            <NumberField
              value={capacity}
              onValueChange={setCapacity}
              min={1}
              max={9999}
              steppers={false}
              placeholder="40"
              suffix="personas"
            />
          </Field>
          <div className="grid gap-2">
            <span id={colorLabelId} className="type-label text-foreground">
              Color
            </span>
            <div role="radiogroup" aria-labelledby={colorLabelId} className="flex flex-wrap gap-2">
              {PALETTE.map((c) => {
                const selected = color === c
                return (
                  // biome-ignore lint/a11y/useSemanticElements: muestras de color; un input radio no se deja pintar así
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={PALETTE_NAMES[c]}
                    onClick={() => setColor(c)}
                    className={cn(
                      'relative hit-area flex size-8 items-center justify-center rounded-full border border-border-strong',
                      'outline-offset-2 outline-(--ring) focus-visible:outline-2',
                      selected && 'outline-2 outline-foreground',
                    )}
                    style={{ backgroundColor: c }}
                  >
                    {selected ? <Check className="size-4 text-white" aria-hidden /> : null}
                  </button>
                )
              })}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" loading={pending} loadingText="Creando…">
              Crear y usar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
