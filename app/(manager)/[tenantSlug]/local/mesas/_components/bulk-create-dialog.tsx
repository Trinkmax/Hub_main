'use client'

import { Rows3 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldRow } from '@/components/ui/field'
import { NumberField } from '@/components/ui/number-field'
import { bulkCreateTablesAction } from '@/lib/floor-plan/actions'
import { type ShapePreset, TableShapeChips } from './table-shape-chips'

const PRESETS: { value: ShapePreset; label: string }[] = [
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
  const [count, setCount] = useState<number | null>(6)
  const [capacity, setCapacity] = useState<number | null>(4)
  const [preset, setPreset] = useState<ShapePreset>('square')
  const [pending, start] = useTransition()

  // El formulario ya validó (Cantidad obligatoria, rangos): acá solo se manda.
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (count === null) return
    start(async () => {
      const r = await bulkCreateTablesAction(slug, {
        area_id: areaId,
        count,
        capacity: capacity !== null && capacity > 0 ? capacity : null,
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

  const confirmLabel =
    count === null ? 'Crear mesas' : `Crear ${count} ${count === 1 ? 'mesa' : 'mesas'}`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <Rows3 aria-hidden />
          Varias mesas
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear varias mesas</DialogTitle>
          <DialogDescription>
            Se crean en grilla, numeradas desde el número inicial del área y cada una con su QR.
            Después las acomodás arrastrando.
          </DialogDescription>
        </DialogHeader>

        {/* `contents`: el formulario no arma caja, así cuerpo y pie siguen siendo
            hijos del diálogo (el cuerpo scrollea y el pie queda fijo). */}
        <form className="contents" onSubmit={submit}>
          <DialogBody className="flex flex-col gap-4">
            {/* Un número fuera de rango queda escrito, con su error, y el estado
                pasa a null (no hay número que valga). */}
            <FieldRow>
              <Field label="Cantidad" required>
                <NumberField min={1} max={50} value={count} onValueChange={setCount} />
              </Field>
              <Field label="Personas por mesa" optional hint="Vacío: sin definir.">
                <NumberField
                  min={1}
                  max={50}
                  value={capacity}
                  onValueChange={setCapacity}
                  placeholder="Sin definir"
                />
              </Field>
            </FieldRow>
            <TableShapeChips
              legend="Forma"
              options={PRESETS}
              value={preset}
              onValueChange={setPreset}
            />
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!pending) setOpen(false)
              }}
              aria-disabled={pending || undefined}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={pending} loadingText="Creando…">
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
