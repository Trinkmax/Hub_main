'use client'

import { Sparkles } from 'lucide-react'
import { useCallback, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  computeRedemption,
  maxRedeemablePoints,
  type PointsRedemptionConfig,
} from '@/lib/points/redemption'
import { markSessionPaid } from '@/lib/sessions-waiter/actions'
import type { CobroBreakdown } from '@/lib/sessions-waiter/queries'

export type CustomerBalance = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  points_balance: number
}

function fmt(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function CobrarDialog({
  tenantSlug,
  sessionId,
  breakdown,
  redemptionConfig,
  customerBalances,
  open,
  onClose,
  onPaid,
}: {
  tenantSlug: string
  sessionId: string
  breakdown: CobroBreakdown
  redemptionConfig: PointsRedemptionConfig
  customerBalances: CustomerBalance[]
  open: boolean
  onClose: () => void
  onPaid: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // customer_id → puntos a redimir (string para input controlado)
  const [redemptions, setRedemptions] = useState<Map<string, string>>(new Map())

  const balanceByCustomer = useMemo(() => {
    const m = new Map<string, CustomerBalance>()
    for (const c of customerBalances) m.set(c.customer_id, c)
    return m
  }, [customerBalances])

  // Guests con cliente registrado, balance > 0 y share > 0 (los que pueden redimir).
  const redeemableGuests = useMemo(() => {
    if (!redemptionConfig.enabled) return []
    return breakdown.guests.filter((g) => {
      if (!g.customer_id) return false
      const bal = balanceByCustomer.get(g.customer_id)
      if (!bal || bal.points_balance <= 0) return false
      return g.total_cents > 0
    })
  }, [breakdown, balanceByCustomer, redemptionConfig.enabled])

  type LineCalc = {
    guest_id: string
    customer_id: string
    shareCents: number
    pointsInput: string
    pointsValid: number
    redeemCents: number
    cappedMax: number
    error: string | null
  }

  const lineCalcs = useMemo((): LineCalc[] => {
    return redeemableGuests.map((g) => {
      if (!g.customer_id) {
        return {
          guest_id: g.guest_id,
          customer_id: '',
          shareCents: g.total_cents,
          pointsInput: '',
          pointsValid: 0,
          redeemCents: 0,
          cappedMax: 0,
          error: null,
        }
      }
      const bal = balanceByCustomer.get(g.customer_id)
      const balance = bal?.points_balance ?? 0
      const cappedMax = maxRedeemablePoints(balance, g.total_cents, redemptionConfig)
      const raw = redemptions.get(g.customer_id) ?? ''
      const parsed = Number.parseInt(raw, 10)
      const pts = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
      if (pts === 0) {
        return {
          guest_id: g.guest_id,
          customer_id: g.customer_id,
          shareCents: g.total_cents,
          pointsInput: raw,
          pointsValid: 0,
          redeemCents: 0,
          cappedMax,
          error: null,
        }
      }
      const calc = computeRedemption({
        pointsToRedeem: pts,
        balance,
        shareCents: g.total_cents,
        config: redemptionConfig,
      })
      if (calc.ok) {
        return {
          guest_id: g.guest_id,
          customer_id: g.customer_id,
          shareCents: g.total_cents,
          pointsInput: raw,
          pointsValid: calc.pointsUsed,
          redeemCents: calc.redeemCents,
          cappedMax,
          error: null,
        }
      }
      const err =
        calc.reason === 'insufficient_balance'
          ? 'Saldo insuficiente'
          : calc.reason === 'exceeds_cap'
            ? `Máximo ${cappedMax} pts (${redemptionConfig.maxPct}% del total)`
            : calc.reason === 'exceeds_share'
              ? 'Excede la parte del cliente'
              : 'Valor inválido'
      return {
        guest_id: g.guest_id,
        customer_id: g.customer_id,
        shareCents: g.total_cents,
        pointsInput: raw,
        pointsValid: 0,
        redeemCents: 0,
        cappedMax,
        error: err,
      }
    })
  }, [redeemableGuests, balanceByCustomer, redemptions, redemptionConfig])

  const totalRedeemed = lineCalcs.reduce((sum, l) => sum + l.redeemCents, 0)
  const totalFinal = Math.max(0, breakdown.total_cents - totalRedeemed)
  const hasInputError = lineCalcs.some((l) => l.error !== null)
  const hasValidRedemption = lineCalcs.some((l) => l.pointsValid > 0)

  const handleInput = useCallback((customerId: string, raw: string) => {
    setRedemptions((prev) => {
      const next = new Map(prev)
      const cleaned = raw.replace(/[^0-9]/g, '')
      if (cleaned.length === 0) next.delete(customerId)
      else next.set(customerId, cleaned)
      return next
    })
  }, [])

  const handleConfirm = () => {
    if (hasInputError) return
    startTransition(async () => {
      setError(null)
      const payload = lineCalcs
        .filter((l) => l.pointsValid > 0)
        .map((l) => ({ customerId: l.customer_id, pointsToRedeem: l.pointsValid }))
      const r = await markSessionPaid(tenantSlug, sessionId, payload)
      if (r.ok) {
        const lines: string[] = []
        if (r.totalRedeemedCents > 0) lines.push(`descuento ${fmt(r.totalRedeemedCents)}`)
        if (r.totalPoints > 0) lines.push(`+${r.totalPoints} pts`)
        toast.success(lines.length > 0 ? `Cobrada · ${lines.join(' · ')}` : 'Cobrada.')
        onPaid()
      } else {
        setError(r.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cobrar mesa</DialogTitle>
          <DialogDescription>
            Total a cobrar: <strong>{fmt(breakdown.total_cents)}</strong>. Confirmá cuando hayas
            recibido el pago — esto cierra la sesión y suma puntos a los comensales registrados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {breakdown.guests.map((g) => (
            <div key={g.guest_id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {g.display_name ?? `Guest #${g.guest_id.slice(0, 4)}`}
                  {g.customer_id && (
                    <span className="ml-1.5 text-xs text-primary">· suma puntos ✓</span>
                  )}
                </p>
                <p className="font-semibold">{fmt(g.total_cents)}</p>
              </div>
              {g.items.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                  {g.items.map((it) => (
                    <li key={`${g.guest_id}-${it.name}-${it.line_total_cents}`}>
                      {it.quantity}× {it.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {breakdown.shared_items.length > 0 && (
            <div className="rounded-lg border border-dashed p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-muted-foreground">Compartido / mozo (sin puntos)</p>
                <p className="font-semibold">{fmt(breakdown.shared_total_cents)}</p>
              </div>
              <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                {breakdown.shared_items.map((it) => (
                  <li key={`shared-${it.name}-${it.line_total_cents}`}>
                    {it.quantity}× {it.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {redemptionConfig.enabled && redeemableGuests.length > 0 ? (
          <section className="rounded-xl border border-primary/30 bg-primary/5 p-3">
            <header className="mb-2 flex items-center gap-1.5">
              <Sparkles className="size-4 text-primary" aria-hidden />
              <h4 className="font-semibold">Aplicar puntos como descuento</h4>
              <Badge variant="outline" className="ml-auto text-[10px]">
                hasta {redemptionConfig.maxPct}% de la parte
              </Badge>
            </header>
            <ul className="space-y-2">
              {lineCalcs.map((l) => {
                const bal = balanceByCustomer.get(l.customer_id)
                const guest = breakdown.guests.find((g) => g.guest_id === l.guest_id)
                if (!bal || !guest) return null
                return (
                  <li key={l.guest_id} className="rounded-lg bg-card/85 p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 grow truncate text-sm font-medium">
                        {guest.display_name ?? `Guest #${l.guest_id.slice(0, 4)}`}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        saldo: <strong>{bal.points_balance} pts</strong>
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={l.pointsInput}
                        onChange={(e) => handleInput(l.customer_id, e.target.value)}
                        placeholder={`0 (máx ${l.cappedMax})`}
                        disabled={pending}
                        className="h-8 max-w-[120px] text-sm"
                      />
                      <span className="text-xs text-muted-foreground">pts =</span>
                      <span className="text-sm font-semibold tabular-nums">
                        {fmt(l.redeemCents)}
                      </span>
                    </div>
                    {l.error ? (
                      <p className="mt-1 text-[11px] text-destructive">{l.error}</p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            {hasValidRedemption ? (
              <p className="mt-2 text-sm">
                Descuento total: <strong className="tabular-nums">−{fmt(totalRedeemed)}</strong>
              </p>
            ) : null}
          </section>
        ) : null}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={pending || hasInputError}>
            {pending ? 'Cobrando…' : `Confirmar cobro · ${fmt(totalFinal)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
