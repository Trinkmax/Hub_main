'use client'

import { CreditCard } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { updatePointsRedemptionConfigAction } from '@/lib/points/actions'

export function RedemptionConfigForm({
  tenantSlug,
  initial,
}: {
  tenantSlug: string
  initial: { enabled: boolean; ratePointsToCents: number; maxPct: number }
}) {
  const [enabled, setEnabled] = useState(initial.enabled)
  // El owner razona en PESOS por punto; a centavos (unidad de guardado) lo
  // convertimos recién al guardar. Aceptamos decimales (ej: $0,50 por punto).
  const [ratePesos, setRatePesos] = useState(
    String(initial.ratePointsToCents / 100).replace('.', ','),
  )
  const [maxPct, setMaxPct] = useState(String(initial.maxPct))
  const [pending, startTransition] = useTransition()

  const ratePointsToCents = Math.round(Number(ratePesos.replace(',', '.')) * 100)
  const ratePreview = (() => {
    if (!Number.isFinite(ratePointsToCents) || ratePointsToCents <= 0) return null
    return (ratePointsToCents / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })
  })()

  const save = () => {
    startTransition(async () => {
      const r = await updatePointsRedemptionConfigAction(tenantSlug, {
        enabled,
        ratePointsToCents,
        maxPct: Number.parseFloat(maxPct),
      })
      if (r.ok) {
        toast.success(r.message ?? 'Guardado')
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <section className="card-hairline rounded-xl border bg-card p-5">
      <header className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CreditCard className="size-4" aria-hidden />
        </div>
        <div className="grow">
          <h2 className="font-serif text-lg font-semibold tracking-tight">Pagar con puntos</h2>
          <p className="text-sm text-muted-foreground">
            Permitir que los clientes registrados usen su saldo como descuento al cobrar la mesa.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={pending} />
          <span className="text-xs text-muted-foreground">{enabled ? 'Activado' : 'Apagado'}</span>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="rate" className="text-xs uppercase tracking-wider">
            Pesos por punto
          </Label>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <Input
              id="rate"
              type="number"
              inputMode="decimal"
              min={0.01}
              max={1000}
              step={0.5}
              value={ratePesos}
              onChange={(e) => setRatePesos(e.target.value)}
              disabled={!enabled || pending}
              className="pl-7 tabular-nums"
            />
          </div>
          {ratePreview ? (
            <p className="mt-1 text-[11px] text-muted-foreground">1 punto = ${ratePreview}</p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="maxPct" className="text-xs uppercase tracking-wider">
            % máximo de la parte del cliente
          </Label>
          <Input
            id="maxPct"
            type="number"
            min={0}
            max={100}
            step={1}
            value={maxPct}
            onChange={(e) => setMaxPct(e.target.value)}
            disabled={!enabled || pending}
            className="mt-1 tabular-nums"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Cuánto puede cubrir con puntos como máximo. 100% = puede pagar todo, 0% = inhabilitado.
          </p>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </section>
  )
}
