'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createPerAmountRule, type LoyaltyActionState } from '@/lib/points/actions'

const initial: LoyaltyActionState = { ok: true }

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} size="sm" className="gap-1.5">
      <Plus className="size-3.5" />
      {pending ? 'Creando…' : 'Crear regla'}
    </Button>
  )
}

export function NewPerAmountForm({ tenantSlug }: { tenantSlug: string }) {
  const action = createPerAmountRule.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const [everyPesos, setEveryPesos] = useState<string>('1')
  const [points, setPoints] = useState<string>('1')

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message)
    else if (!state.ok) toast.error(state.message)
  }, [state])

  // Convertimos pesos → centavos solo al submit. El campo every_cents se envía
  // como hidden; el visible muestra pesos para que el owner razone en su moneda.
  const everyCents = Math.max(1, Math.floor(Number(everyPesos) * 100) || 0)
  const ptsNum = Math.max(1, Math.floor(Number(points) || 0))
  const isCanonical = everyCents === 100 && ptsNum === 1
  const previewLabel = isCanonical
    ? '1 punto por cada peso (recomendado).'
    : `${ptsNum} ${ptsNum === 1 ? 'punto' : 'puntos'} por cada $${Number(everyPesos || 0).toLocaleString('es-AR')} gastados.`

  return (
    <form action={formAction} className="card-hairline space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Por monto gastado
        </h3>
        <span className="text-[11px] text-muted-foreground">Más simple</span>
      </div>

      <input type="hidden" name="every_cents" value={everyCents} />
      <input type="hidden" name="active" value="true" />

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_100px_auto] sm:items-end">
        <div className="grid gap-1">
          <Label htmlFor="every-pesos" className="text-[11px] text-muted-foreground">
            Cada $ gastados
          </Label>
          <Input
            id="every-pesos"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            required
            value={everyPesos}
            onChange={(e) => setEveryPesos(e.target.value)}
            placeholder="1"
            className="tabular-nums"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="points" className="text-[11px] text-muted-foreground">
            Puntos
          </Label>
          <Input
            id="points"
            name="points"
            type="number"
            min={1}
            step={1}
            required
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder="1"
            className="tabular-nums"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="priority" className="text-[11px] text-muted-foreground">
            Prio.
          </Label>
          <Input
            id="priority"
            name="priority"
            type="number"
            defaultValue={100}
            className="tabular-nums"
          />
        </div>
        <SubmitBtn />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Vista previa: <span className="font-medium text-foreground">{previewLabel}</span>
      </p>
    </form>
  )
}
