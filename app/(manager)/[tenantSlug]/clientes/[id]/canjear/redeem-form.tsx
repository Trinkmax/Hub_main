'use client'

import { Gift, Lock, PackageX, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { formatNumber } from '@/lib/format/number-kind'
import { validateRedeem } from '@/lib/points/engine'
import type { Reward } from '@/lib/points/queries'
import { redeemReward } from '@/lib/visits/actions'

export function RedeemForm({
  tenantSlug,
  customerId,
  customerName,
  balance,
  rewards,
}: {
  tenantSlug: string
  customerId: string
  customerName: string
  balance: number
  rewards: Reward[]
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<Reward | null>(null)

  if (rewards.length === 0) {
    return (
      <EmptyState
        icon={Gift}
        title="Todavía no hay recompensas activas"
        description="Las recompensas se cargan en Club de beneficios › Puntos y niveles. Cuando haya alguna activa, aparece acá para canjear."
      />
    )
  }

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Recompensas para canjear">
        {rewards.map((r) => {
          const validation = validateRedeem({
            balance,
            reward: { cost_points: r.cost_points, active: r.active, stock: r.stock },
          })
          const disabled = !validation.ok
          const reason = !validation.ok ? validation.error : null
          return (
            <li key={r.id} className="flex">
              <Card padding="md" className="w-full gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gold-soft text-gold-text">
                    <Gift aria-hidden="true" className="size-5" />
                  </div>
                  <Badge size="md" className="type-amount">
                    {formatNumber(r.cost_points)} pts
                  </Badge>
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="type-subtitle">{r.name}</h3>
                  {r.description ? (
                    <p className="line-clamp-2 type-small text-muted-foreground">{r.description}</p>
                  ) : null}
                  <p className="type-caption text-muted-foreground">
                    {r.stock === null ? 'Stock ilimitado' : `Stock: ${formatNumber(r.stock)}`}
                  </p>
                </div>
                <Button
                  disabled={disabled}
                  onClick={() => setConfirming(r)}
                  variant={disabled ? 'secondary' : 'primary'}
                  className="mt-auto w-full"
                >
                  {reason === 'insufficient_balance' ? (
                    <>
                      <Lock aria-hidden="true" />
                      Le faltan {formatNumber(r.cost_points - balance)} pts
                    </>
                  ) : reason === 'out_of_stock' ? (
                    <>
                      <PackageX aria-hidden="true" />
                      Sin stock
                    </>
                  ) : (
                    <>
                      <Sparkles aria-hidden="true" />
                      Canjear
                    </>
                  )}
                </Button>
              </Card>
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title={confirming ? `¿Canjear «${confirming.name}»?` : 'Canjear'}
        description={
          confirming
            ? `Se le descuentan ${formatNumber(confirming.cost_points)} puntos a ${customerName}. Le quedan ${formatNumber(balance - confirming.cost_points)}.`
            : undefined
        }
        confirmLabel="Canjear"
        pendingLabel="Canjeando…"
        onConfirm={async () => {
          if (!confirming) return
          const r = await redeemReward(tenantSlug, {
            customer_id: customerId,
            reward_id: confirming.id,
          })
          if (!r.ok) return { ok: false, error: r.message }
          toast.success(`Canje hecho · le quedan ${formatNumber(r.balance_after)} pts`)
          router.push(`/${tenantSlug}/clientes/${customerId}`)
          router.refresh()
        }}
      />
    </>
  )
}
