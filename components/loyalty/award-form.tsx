'use client'

import { Loader2, Sparkles, TriangleAlert } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { awardPointsByAmount } from '@/lib/points/actions'
import type { EarnRate } from '@/lib/points/earn-rate'
import { describeEarnRate, pesosToCents, previewPoints } from '@/lib/points/preview'

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
 * Ahora vive acá y lo consumen las DOS cajas (salón y /acreditar), como ya pasa
 * con PunchStamper y RedemptionPanel: el mozo con el celular y el cajero con la
 * tablet tienen que ver exactamente lo mismo.
 *
 * El monto se pide en PESOS y se convierte a centavos en el borde (la DB guarda
 * centavos; al mostrador los centavos no le sirven para nada).
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
  const [amount, setAmount] = useState('')
  const [busy, startAward] = useTransition()

  const cents = useMemo(() => pesosToCents(amount), [amount])
  const points = useMemo(() => previewPoints(cents ?? 0, earnRate), [cents, earnRate])
  const rateLabel = describeEarnRate(earnRate)
  const noRules = earnRate === null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (cents === null) {
      toast.error('Poné el monto que pagó, en pesos.')
      return
    }
    startAward(async () => {
      const r = await awardPointsByAmount(tenantSlug, {
        customer_id: customerId,
        amount_cents: cents,
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
    <form onSubmit={submit} className="card-hairline space-y-4 rounded-2xl border bg-card p-5">
      <div className="space-y-2">
        <Label htmlFor="award-amount" className="text-sm font-semibold">
          ¿Cuánto pagó {customerFirstName}?
        </Label>
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-2xl font-semibold text-muted-foreground"
          >
            $
          </span>
          <Input
            id="award-amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="0"
            aria-describedby="award-hint"
            // md:text-3xl además de text-3xl: <Input> baja a text-sm en md y la tablet de
            // la caja quedaba con el monto en letra chica.
            className="h-16 pl-10 font-display text-3xl font-semibold tabular-nums md:text-3xl"
          />
        </div>

        {/* La devolución en vivo: el mozo ve cuántos puntos suma ANTES de tocar
            nada, así puede decírselo al cliente mientras cobra. */}
        <div
          id="award-hint"
          aria-live="polite"
          className="flex min-h-[1.75rem] items-center gap-2 text-sm"
        >
          {noRules ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-warning-foreground">
              <TriangleAlert className="size-4 text-warning" aria-hidden />
              Este bar todavía no configuró cómo se suman puntos.
            </span>
          ) : points !== null && points > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
              <Sparkles className="size-4" aria-hidden />
              Suma {points.toLocaleString('es-AR')} {points === 1 ? 'punto' : 'puntos'}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {rateLabel ?? 'Los puntos salen de las reglas del Club.'}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="xl"
          onClick={onCancel}
          disabled={busy}
          className="h-14"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          size="xl"
          disabled={busy || cents === null || noRules}
          className="h-14 flex-1 gap-2 text-base"
        >
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
          {busy
            ? 'Sumando…'
            : points !== null && points > 0
              ? `Sumar ${points.toLocaleString('es-AR')} ${points === 1 ? 'punto' : 'puntos'}`
              : 'Sumar puntos'}
        </Button>
      </div>
    </form>
  )
}
