'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createReward, type LoyaltyActionState } from '@/lib/points/actions'

const initial: LoyaltyActionState = { ok: true }

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} size="sm" className="gap-1.5">
      <Plus className="size-3.5" />
      {pending ? 'Creando…' : 'Crear recompensa'}
    </Button>
  )
}

export function NewRewardForm({ tenantSlug }: { tenantSlug: string }) {
  const action = createReward.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
    } else if (!state.ok) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      className="card-hairline rounded-xl border bg-card p-4 space-y-3"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Nueva recompensa
      </h3>
      <div className="grid gap-1.5">
        <Label htmlFor="rw-name" className="text-[11px] text-muted-foreground">
          Nombre
        </Label>
        <Input id="rw-name" name="name" required maxLength={80} placeholder="Trago gratis" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rw-desc" className="text-[11px] text-muted-foreground">
          Descripción
        </Label>
        <Textarea
          id="rw-desc"
          name="description"
          maxLength={300}
          rows={2}
          className="resize-none"
          placeholder="Detalles que ve el cajero al canjear…"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="rw-cost" className="text-[11px] text-muted-foreground">
            Costo (puntos)
          </Label>
          <Input
            id="rw-cost"
            name="cost_points"
            type="number"
            min={1}
            required
            placeholder="100"
            className="tabular-nums"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rw-stock" className="text-[11px] text-muted-foreground">
            Stock
          </Label>
          <Input
            id="rw-stock"
            name="stock"
            type="number"
            min={0}
            placeholder="Ilimitado"
            className="tabular-nums"
          />
        </div>
        <SubmitBtn />
      </div>
    </form>
  )
}
