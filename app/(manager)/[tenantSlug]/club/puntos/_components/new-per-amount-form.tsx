'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { MoneyField } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
import { SubmitButton } from '@/components/ui/submit-button'
import { formatNumber } from '@/lib/format/number-kind'
import { formatCents } from '@/lib/money/format'
import { createPerAmountRule, type LoyaltyActionState } from '@/lib/points/actions'

const initial: LoyaltyActionState = { ok: true }

/** Un peso, en centavos: la regla recomendada es 1 punto por cada peso. */
const ONE_PESO_CENTS = 100

export function NewPerAmountForm({ tenantSlug }: { tenantSlug: string }) {
  const action = createPerAmountRule.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)
  // Solo para la vista previa: los campos son del formulario (y vuelven a su
  // valor de arranque cuando se crea la regla).
  const [everyCents, setEveryCents] = useState<number | null>(ONE_PESO_CENTS)
  const [points, setPoints] = useState<number | null>(1)

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message)
    else if (!state.ok) toast.error(state.message)
  }, [state])

  // La plata se ve en pesos y viaja en centavos (`every_cents`), como guarda la base.
  const previewLabel =
    everyCents === null || points === null
      ? 'Completá cada cuántos pesos y cuántos puntos.'
      : everyCents === ONE_PESO_CENTS && points === 1
        ? '1 punto por cada peso (recomendado).'
        : `${formatNumber(points)} ${points === 1 ? 'punto' : 'puntos'} por cada ${formatCents(
            everyCents,
            { decimals: everyCents % 100 === 0 ? 0 : 2 },
          )} gastados.`

  return (
    <Card asChild>
      <form action={formAction} aria-labelledby="per-amount-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 id="per-amount-title" className="type-subtitle text-foreground">
            Por monto gastado
          </h3>
          <span className="type-caption text-muted-foreground">Lo más simple</span>
        </div>

        <input type="hidden" name="active" value="true" />

        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
          <Field label="Cada cuántos pesos" name="every_cents" required>
            <MoneyField
              decimals="auto"
              minCents={ONE_PESO_CENTS}
              defaultCents={ONE_PESO_CENTS}
              onCentsChange={setEveryCents}
              placeholder="1"
            />
          </Field>
          <Field label="Puntos" name="points" required>
            <NumberField min={1} defaultValue={1} onValueChange={setPoints} />
          </Field>
          <Field label="Prioridad" name="priority">
            <NumberField min={0} defaultValue={100} steppers={false} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="type-small text-muted-foreground" aria-live="polite">
            Vista previa: <span className="font-medium text-foreground">{previewLabel}</span>
          </p>
          <SubmitButton pendingText="Creando…">
            <Plus aria-hidden="true" />
            Crear regla
          </SubmitButton>
        </div>
      </form>
    </Card>
  )
}
