'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FormActions } from '@/components/ui/field'
import { MoneyField } from '@/components/ui/money-field'
import { awardPointsByAmount } from '@/lib/points/actions'
import type { EarnRate } from '@/lib/points/earn-rate'
import { previewPoints } from '@/lib/points/preview'
import { AwardPreview, awardButtonLabel } from './award-preview'

export type AwardResultData = {
  customer_id: string
  points_awarded: number
  amount_cents: number
  new_balance: number
}

/**
 * "¿Cuánto gastó?" → puntos. El paso que faltaba en el salón.
 *
 * Estaba implementado SOLO en /acreditar (workspace manager), al que el proxy
 * rebota a cualquier mozo: el mozo escaneaba el QR del socio, veía el saldo y
 * las tarjetas de sellos, y no tenía dónde cargar el consumo. Los permisos
 * siempre estuvieron bien (`awardPointsByAmount` autoriza waiter, y la RPC
 * también) — lo que no existía era el camino.
 *
 * Lo usa la caja del panel (/acreditar). El salón tiene su copia congelada en
 * `components/legacy/loyalty` (mismo flujo, el kit viejo).
 *
 * El monto se pide en PESOS con el `MoneyField` del kit (acepta `12.000`,
 * `12000`, `12.000,50`) y viaja en centavos: la DB guarda centavos y al
 * mostrador los centavos no le sirven para nada.
 */
export function AwardForm({
  tenantSlug,
  customerId,
  customerFirstName,
  earnRate,
  onAwarded,
  onCancel,
}: {
  tenantSlug: string
  customerId: string
  customerFirstName: string
  /** Tasa vigente del tenant. `null` = no se puede enunciar sin mentir. */
  earnRate: EarnRate | null
  onAwarded: (result: AwardResultData) => void
  onCancel: () => void
}) {
  const [cents, setCents] = useState<number | null>(null)
  const [busy, startAward] = useTransition()

  // Cero no es un consumo: no hay nada que acreditar.
  const amount = cents !== null && cents > 0 ? cents : null
  const points = previewPoints(amount ?? 0, earnRate)
  const noRules = earnRate === null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (amount === null) {
      toast.error('Poné el monto que pagó, en pesos.')
      return
    }
    startAward(async () => {
      const r = await awardPointsByAmount(tenantSlug, {
        customer_id: customerId,
        amount_cents: amount,
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      onAwarded({
        customer_id: r.customer_id,
        points_awarded: r.points_awarded,
        amount_cents: r.amount_cents,
        new_balance: r.new_balance,
      })
    })
  }

  return (
    <Card asChild>
      <form onSubmit={submit}>
        <Field
          label={`¿Cuánto pagó ${customerFirstName}?`}
          hint={<AwardPreview points={points} earnRate={earnRate} />}
        >
          <MoneyField
            size="lg"
            decimals="auto"
            required
            autoFocus
            onCentsChange={(next) => setCents(next)}
          />
        </Field>

        <FormActions sticky={false}>
          <Button type="button" variant="secondary" size="lg" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="submit"
            size="lg"
            loading={busy}
            loadingText="Sumando…"
            disabled={!busy && (amount === null || noRules)}
          >
            {awardButtonLabel(points)}
          </Button>
        </FormActions>
      </form>
    </Card>
  )
}
