'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { createReward, type LoyaltyActionState } from '@/lib/points/actions'
import { REWARD_CATEGORIES } from '@/lib/points/schemas'
import type { LoyaltyTier } from '@/lib/points/tiers'

const initial: LoyaltyActionState = { ok: true }

const SELECT_CLASS =
  'border-input h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

/** Etiquetas legibles para las categorías canónicas del catálogo. */
const CATEGORY_LABELS: Record<string, string> = {
  desayuno: 'Desayuno y merienda',
  almuerzo: 'Almuerzo',
  cena: 'Cena',
  evento: 'Eventos',
}

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} size="sm" className="gap-1.5">
      <Plus className="size-3.5" />
      {pending ? 'Creando…' : 'Crear recompensa'}
    </Button>
  )
}

export function NewRewardForm({ tenantSlug, tiers }: { tenantSlug: string; tiers: LoyaltyTier[] }) {
  const action = createReward.bind(null, tenantSlug)
  // Ordenamos los niveles por umbral de puntos de categoría para que el selector sea intuitivo.
  const sortedTiers = tiers
    .slice()
    .sort((a, b) => a.min_category_points - b.min_category_points || a.sort - b.sort)
  const [state, formAction] = useActionState(action, initial)
  const formRef = useRef<HTMLFormElement>(null)
  // La visibilidad viaja por un input hidden controlado ('true' | 'false').
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setVisible(true)
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
      <div className="grid gap-1.5">
        <Label htmlFor="rw-category" className="text-[11px] text-muted-foreground">
          Categoría
        </Label>
        <select id="rw-category" name="category" defaultValue="" className={SELECT_CLASS}>
          <option value="">Sin categoría</option>
          {REWARD_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat] ?? cat}
            </option>
          ))}
        </select>
      </div>
      {sortedTiers.length > 0 ? (
        <div className="grid gap-1.5">
          <Label htmlFor="rw-tier" className="text-[11px] text-muted-foreground">
            Disponibilidad por nivel
          </Label>
          <select id="rw-tier" name="min_tier_id" defaultValue="" className={SELECT_CLASS}>
            <option value="">Disponible para todos</option>
            {sortedTiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                Desde {tier.name}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            Si elegís un nivel, solo los clientes que lo hayan alcanzado podrán canjearla.
          </p>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
        <div className="grid gap-0.5">
          <Label htmlFor="rw-visible" className="text-xs font-medium">
            Mostrar en el catálogo de canje
          </Label>
          <p className="text-[11px] text-muted-foreground">
            Si la ocultás, sigue vigente pero no aparece en la carta pública.
          </p>
        </div>
        <Switch id="rw-visible" checked={visible} onCheckedChange={setVisible} />
      </div>
      <input type="hidden" name="visible_in_catalog" value={visible ? 'true' : 'false'} />
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
