'use client'

import { Infinity as InfinityIcon, TriangleAlert } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { NumberField } from '@/components/ui/number-field'
import { Switch } from '@/components/ui/switch'

// Stock con switch "Ilimitado" explícito.
//
// Antes la única forma de decir "ilimitado" era dejar el campo vacío: una
// convención invisible que nadie podía adivinar mirando el formulario. Ahora el
// estado es una decisión que se ve y se toca, y el 0 queda para lo que
// realmente significa — agotado, no se puede canjear.
//
// Controlado desde el padre a propósito: el alta resetea el form entero después
// de crear y el diálogo de edición se resincroniza con la recompensa que abrís,
// así que el estado tiene que vivir donde viven esos ciclos.

export function StockField({
  idPrefix,
  unlimited,
  onUnlimitedChange,
  value,
  onValueChange,
}: {
  /** Prefijo de los `id` (el alta y la edición conviven en la misma página). */
  idPrefix: string
  unlimited: boolean
  onUnlimitedChange: (unlimited: boolean) => void
  /** Unidades disponibles, o `null` mientras el campo está vacío. */
  value: number | null
  onValueChange: (value: number | null) => void
}): React.JSX.Element {
  const stockId = `${idPrefix}-stock`
  const switchId = `${idPrefix}-stock-unlimited`
  const hintId = `${idPrefix}-stock-hint`
  const soldOut = !unlimited && value === 0

  return (
    <div className="grid gap-2">
      <div className="flex min-h-[1.125rem] items-center justify-between gap-2">
        <Label htmlFor={unlimited ? switchId : stockId}>Stock</Label>
        <div className="flex items-center gap-2">
          <Label htmlFor={switchId} className="font-normal text-muted-foreground">
            Ilimitado
          </Label>
          <Switch id={switchId} size="sm" checked={unlimited} onCheckedChange={onUnlimitedChange} />
        </div>
      </div>

      {unlimited ? (
        // Del mismo alto que el campo: sin esto la fila salta cada vez que se
        // toca el interruptor.
        <p className="flex h-(--control-md) items-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 type-small text-muted-foreground">
          <InfinityIcon className="size-4 shrink-0" aria-hidden="true" />
          Sin límite de canjes
        </p>
      ) : (
        <NumberField
          id={stockId}
          name="stock"
          min={0}
          required
          value={value}
          onValueChange={onValueChange}
          placeholder="0"
          aria-describedby={soldOut ? hintId : undefined}
        />
      )}

      {soldOut ? (
        <p id={hintId} className="flex items-start gap-1 type-caption text-warning-text">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Con stock 0 la recompensa se ve agotada y nadie puede canjearla.
        </p>
      ) : null}
    </div>
  )
}
