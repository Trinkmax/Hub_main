'use client'

import { CheckCircle2, Loader2, UtensilsCrossed } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { registerLunchVisit } from '@/lib/punch-cards/actions'
import { cn } from '@/lib/utils'

export type LunchCardPanelData = {
  template_id: string
  template_name: string
  current_stamps: number
  threshold: number
  reward_name: string | null
  hours_from: string | null
  hours_to: string | null
}

export function LunchCardPanel({
  tenantSlug,
  customerId,
  initial,
}: {
  tenantSlug: string
  customerId: string
  initial: LunchCardPanelData
}) {
  const [state, setState] = useState(initial)
  const [pending, start] = useTransition()
  const completed = state.current_stamps >= state.threshold

  const onMark = () => {
    start(async () => {
      const r = await registerLunchVisit(tenantSlug, {
        customer_id: customerId,
        template_id: state.template_id,
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      setState((prev) => ({
        ...prev,
        current_stamps: r.current_stamps,
        threshold: r.threshold,
      }))
      if (r.completed) {
        toast.success('¡Tarjeta completa! Recompensa lista.')
      } else {
        toast.success('Almuerzo marcado.')
      }
    })
  }

  const stamps = Array.from({ length: state.threshold }, (_, i) => i < state.current_stamps)

  return (
    <div className="card-hairline rounded-xl border bg-card p-5">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold tracking-tight">
            {state.template_name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {completed
              ? `¡Completa! Recompensa: ${state.reward_name ?? 'pendiente'}.`
              : `${state.current_stamps} de ${state.threshold} almuerzos${
                  state.reward_name ? ` · al ${state.threshold}° llega ${state.reward_name}` : ''
                }`}
          </p>
        </div>
        <UtensilsCrossed className="size-4 text-primary" />
      </header>

      <div className="flex flex-wrap gap-2">
        {stamps.map((filled, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: stamps are a fixed visual progress
            key={i}
            role="img"
            aria-label={filled ? 'Almuerzo marcado' : 'Pendiente'}
            className={cn(
              'size-7 rounded-full',
              filled
                ? 'bg-primary shadow-sm'
                : 'border border-dashed border-border bg-secondary/40',
            )}
          />
        ))}
      </div>

      {state.hours_from && state.hours_to ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Válido de {state.hours_from.slice(0, 5)} a {state.hours_to.slice(0, 5)} hs.
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <Button onClick={onMark} disabled={pending || completed} size="sm" className="gap-2">
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : completed ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <UtensilsCrossed className="size-3.5" />
          )}
          {completed
            ? 'Tarjeta lista para canjear'
            : pending
              ? 'Marcando…'
              : 'Marcar almuerzo de hoy'}
        </Button>
      </div>
    </div>
  )
}
