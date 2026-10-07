'use client'

import { CircleCheck, UtensilsCrossed } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber } from '@/lib/format/number-kind'
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
        toast.success('¡Tarjeta completa! La recompensa está lista.')
      } else {
        toast.success('Almuerzo marcado.')
      }
    })
  }

  const stamps = Array.from({ length: state.threshold }, (_, i) => i < state.current_stamps)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{state.template_name}</h2>
        </CardTitle>
        <CardDescription className="type-amount">
          {completed
            ? `¡Completa! Recompensa: ${state.reward_name ?? 'a definir'}.`
            : `${formatNumber(state.current_stamps)} de ${formatNumber(state.threshold)} almuerzos${
                state.reward_name ? ` · al ${state.threshold}.º llega ${state.reward_name}` : ''
              }`}
        </CardDescription>
        <CardAction>
          <UtensilsCrossed aria-hidden="true" className="size-4 text-muted-foreground" />
        </CardAction>
      </CardHeader>

      <div
        role="img"
        aria-label={`${state.current_stamps} de ${state.threshold} almuerzos marcados`}
        className="flex flex-wrap gap-2"
      >
        {stamps.map((filled, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: los sellos son un progreso fijo, posicional
            key={i}
            aria-hidden="true"
            className={cn(
              'size-7 rounded-full',
              filled ? 'bg-primary' : 'border border-dashed border-input bg-secondary',
            )}
          />
        ))}
      </div>

      {state.hours_from && state.hours_to ? (
        <p className="type-caption text-muted-foreground">
          Vale de {state.hours_from.slice(0, 5)} a {state.hours_to.slice(0, 5)} h.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          onClick={onMark}
          disabled={completed}
          loading={pending}
          loadingText="Marcando…"
          size="sm"
        >
          {completed ? <CircleCheck aria-hidden="true" /> : <UtensilsCrossed aria-hidden="true" />}
          {completed ? 'Tarjeta lista para canjear' : 'Marcar el almuerzo de hoy'}
        </Button>
      </div>
    </Card>
  )
}
