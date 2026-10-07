'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldRow } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { MoneyField } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
import { Switch } from '@/components/ui/switch'
import { formatCents } from '@/lib/money/format'
import { updatePointsRedemptionConfigAction } from '@/lib/points/actions'

/** Los bordes del schema: de 1 centavo a $ 1.000 por punto. */
const MIN_RATE_CENTS = 1
const MAX_RATE_CENTS = 100_000

export function RedemptionConfigForm({
  tenantSlug,
  initial,
}: {
  tenantSlug: string
  initial: { enabled: boolean; ratePointsToCents: number; maxPct: number }
}) {
  const [enabled, setEnabled] = useState(initial.enabled)
  // El dueño razona en PESOS por punto; se guarda en centavos. Acepta
  // centavos (ej: $ 0,50 por punto).
  const [rateCents, setRateCents] = useState<number | null>(initial.ratePointsToCents)
  const [maxPct, setMaxPct] = useState<number | null>(initial.maxPct)
  const [pending, startTransition] = useTransition()

  const ratePreview =
    rateCents !== null && rateCents > 0
      ? formatCents(rateCents, { decimals: rateCents % 100 === 0 ? 0 : 2 })
      : null

  // Un <form> para que los campos frenen lo ilegible o fuera de rango antes de
  // mandar. Con la función apagada los campos no se editan: viaja lo último que
  // había.
  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    startTransition(async () => {
      const r = await updatePointsRedemptionConfigAction(tenantSlug, {
        enabled,
        ratePointsToCents: rateCents ?? initial.ratePointsToCents,
        maxPct: maxPct ?? initial.maxPct,
      })
      if (r.ok) {
        toast.success(r.message ?? 'Guardado.')
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <Card asChild>
      <form onSubmit={save} aria-label="Pagar con puntos">
        <Field
          label="Pagar con puntos"
          layout="toggle"
          hint="Los clientes registrados usan su saldo como descuento al cobrar la mesa."
        >
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={pending} />
        </Field>

        <FieldRow>
          <Field
            label="Pesos por punto"
            required={enabled}
            disabled={!enabled}
            hint={ratePreview ? `1 punto = ${ratePreview}` : 'Cuánto vale cada punto al pagar.'}
          >
            <MoneyField
              decimals="auto"
              minCents={MIN_RATE_CENTS}
              maxCents={MAX_RATE_CENTS}
              cents={rateCents}
              onCentsChange={setRateCents}
            />
          </Field>
          <Field
            label="% máximo de la parte del cliente"
            required={enabled}
            disabled={!enabled}
            hint="Cuánto puede cubrir con puntos como máximo. 100 % = puede pagar todo; 0 % = no puede usarlos."
          >
            <NumberField
              min={0}
              max={100}
              decimals={2}
              step={5}
              suffix="%"
              value={maxPct}
              onValueChange={setMaxPct}
            />
          </Field>
        </FieldRow>

        <FormActions sticky={false}>
          <Button type="submit" loading={pending} loadingText="Guardando…">
            Guardar
          </Button>
        </FormActions>
      </form>
    </Card>
  )
}
