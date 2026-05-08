'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect } from 'react'
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

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message)
    else if (!state.ok) toast.error(state.message)
  }, [state])

  return (
    <form action={formAction} className="card-hairline rounded-xl border bg-card p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Por monto gastado
      </h3>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_100px_auto] sm:items-end">
        <div className="grid gap-1">
          <Label htmlFor="every-cents" className="text-[11px] text-muted-foreground">
            Cada (¢)
          </Label>
          <Input
            id="every-cents"
            name="every_cents"
            type="number"
            min={1}
            required
            placeholder="100000"
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
            required
            placeholder="10"
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
            defaultValue={0}
            className="tabular-nums"
          />
        </div>
        <input type="hidden" name="active" value="true" />
        <SubmitBtn />
      </div>
      <p className="text-[11px] text-muted-foreground">Ej: cada $1.000 (100.000 ¢) → 10 puntos.</p>
    </form>
  )
}
