'use client'

import { type FormEvent, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { MoneyField } from '@/components/ui/money-field'
import { Switch } from '@/components/ui/switch'
import { upsertBonusRule } from '@/lib/salon/actions'
import type { CommissionBonusRuleRow } from '@/lib/salon/types'

/** Lo que acepta la action (`bonusRuleSchema`): hasta $ 999.999,99 por persona. */
const MAX_BONUS_CENTS = 99_999_999

export function BonusRuleCard({
  tenantSlug,
  initial,
}: {
  tenantSlug: string
  initial: CommissionBonusRuleRow | null
}) {
  // Vacío mientras se escribe (`null`): se guarda como $ 0, igual que antes.
  const [bonus, setBonus] = useState<number | null>(initial?.bonus_per_guest_cents ?? 20000)
  const [active, setActive] = useState(initial?.active ?? true)
  const [pending, startTransition] = useTransition()
  const titleId = useId()

  // Un importe que no se entiende frena el envío antes de llegar acá (el campo
  // muestra por qué).
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const r = await upsertBonusRule(tenantSlug, {
        scope: 'scheduled_event_full',
        bonus_per_guest_cents: bonus ?? 0,
        active,
      } as Record<string, unknown>)
      if (r.ok) toast.success('Bonus guardado.')
      else toast.error(r.message)
    })
  }

  return (
    <Card role="group" aria-labelledby={titleId} className="max-w-2xl">
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="type-subtitle">
          Bonus por evento lleno
        </h2>
        <p className="max-w-prose text-pretty type-small text-muted-foreground">
          Cuando un evento programado llega al 100 % del cupo, cada gestor cobra este extra por
          persona reservada, además de su tarifa.
        </p>
      </div>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Extra por persona" className="sm:max-w-56">
          <MoneyField
            cents={bonus}
            onCentsChange={(cents) => setBonus(cents)}
            decimals="auto"
            maxCents={MAX_BONUS_CENTS}
          />
        </Field>
        <Field layout="toggle" label="Activo">
          <Switch checked={active} onCheckedChange={setActive} />
        </Field>
        <FormActions sticky={false}>
          <Button type="submit" loading={pending} loadingText="Guardando…">
            Guardar bonus
          </Button>
        </FormActions>
      </form>
    </Card>
  )
}
