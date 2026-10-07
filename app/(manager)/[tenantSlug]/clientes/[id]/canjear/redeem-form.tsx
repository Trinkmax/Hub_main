'use client'

import { Gift, Lock, PackageX, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { validateRedeem } from '@/lib/points/engine'
import type { Reward } from '@/lib/points/queries'
import { redeemReward } from '@/lib/visits/actions'

export function RedeemForm({
  tenantSlug,
  customerId,
  balance,
  rewards,
}: {
  tenantSlug: string
  customerId: string
  balance: number
  rewards: Reward[]
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<Reward | null>(null)
  const [pending, start] = useTransition()

  if (rewards.length === 0) {
    return (
      <EmptyState
        icon={Gift}
        title="Sin recompensas activas"
        description="Pedile al owner que cargue recompensas en Configuración → Puntos."
      />
    )
  }

  const onConfirm = () => {
    if (!confirming) return
    start(async () => {
      const r = await redeemReward(tenantSlug, {
        customer_id: customerId,
        reward_id: confirming.id,
      })
      if (r.ok) {
        toast.success(`Canje OK · balance ahora: ${r.balance_after} pts`)
        setConfirming(null)
        router.push(`/${tenantSlug}/clientes/${customerId}`)
        router.refresh()
      } else {
        toast.error(r.message)
        setConfirming(null)
      }
    })
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {rewards.map((r) => {
          const validation = validateRedeem({
            balance,
            reward: { cost_points: r.cost_points, active: r.active, stock: r.stock },
          })
          const disabled = !validation.ok
          const reason = !validation.ok ? validation.error : null
          return (
            <div
              key={r.id}
              className={`card-hairline relative flex flex-col rounded-xl border bg-card p-5 transition-all ${disabled ? 'opacity-70' : 'hover:border-primary/40'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Gift className="size-5" />
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold tabular-nums">
                  {r.cost_points} pts
                </span>
              </div>
              <h3 className="mt-3 font-display text-base font-semibold tracking-tight">{r.name}</h3>
              {r.description ? (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{r.description}</p>
              ) : null}
              <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{r.stock === null ? 'Stock ilimitado' : `Stock: ${r.stock}`}</span>
              </div>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => setConfirming(r)}
                className="mt-4 w-full gap-1.5"
                variant={disabled ? 'outline' : 'default'}
              >
                {reason === 'insufficient_balance' ? (
                  <>
                    <Lock className="size-3.5" />
                    Faltan {r.cost_points - balance}
                  </>
                ) : reason === 'out_of_stock' ? (
                  <>
                    <PackageX className="size-3.5" />
                    Sin stock
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    Canjear
                  </>
                )}
              </Button>
            </div>
          )
        })}
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar canje</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming
                ? `Vas a descontar ${confirming.cost_points} puntos por "${confirming.name}".`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm} disabled={pending}>
              {pending ? 'Canjeando…' : 'Confirmar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
