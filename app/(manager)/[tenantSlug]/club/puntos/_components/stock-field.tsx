'use client'

import { Infinity as InfinityIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  /** Valor crudo del input (string, para no pelear con el vacío intermedio). */
  value: string
  onValueChange: (value: string) => void
}): React.JSX.Element {
  const stockId = `${idPrefix}-stock`
  const switchId = `${idPrefix}-stock-unlimited`
  const soldOut = !unlimited && value.trim() === '0'

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={unlimited ? switchId : stockId}
          className="text-[11px] text-muted-foreground"
        >
          Stock
        </Label>
        <div className="flex items-center gap-1.5">
          <Label htmlFor={switchId} className="text-[11px] font-normal text-muted-foreground">
            Ilimitado
          </Label>
          <Switch id={switchId} checked={unlimited} onCheckedChange={onUnlimitedChange} />
        </div>
      </div>

      {unlimited ? (
        // Placeholder de la misma altura que el input: sin esto la fila salta
        // cada vez que tocás el switch.
        <p className="flex h-9 items-center gap-1.5 rounded-md border border-dashed px-3 text-xs text-muted-foreground">
          <InfinityIcon className="size-3.5 shrink-0" aria-hidden="true" />
          Sin límite de canjes
        </p>
      ) : (
        <Input
          id={stockId}
          name="stock"
          type="number"
          min={0}
          required
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="0"
          className="tabular-nums"
        />
      )}

      {soldOut ? (
        <p className="text-[11px] text-warning">
          Con stock 0 la recompensa se muestra agotada y nadie puede canjearla.
        </p>
      ) : null}
    </div>
  )
}
