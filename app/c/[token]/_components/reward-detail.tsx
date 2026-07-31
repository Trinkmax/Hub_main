'use client'

import { Gift, Lock, Sparkles, Ticket } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { StorageImage } from '@/components/media/storage-image'
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
import { requestRedemption } from '@/lib/wallet/actions'
import type { WalletData } from '@/lib/wallet/queries'
import type { WalletTicket } from './redemption-ticket'
import { formatPoints } from './wallet-format'

// Detalle de una recompensa + el canje auto-servicio.
//
// Es una VISTA in-place, no un modal portalizado: la wallet vive dentro de un
// subtree con `force-light` y `--brand-accent` inyectados por BrandAccent, y un
// portal a <body> se queda sin esas variables (el mismo problema que ya nos comió
// tiempo en el clon de WhatsApp). La única excepción es el AlertDialog de
// confirmación, que sí se portaliza y por eso lleva `force-light` explícito.

type Reward = WalletData['rewards'][number]

export function RewardDetail({
  reward,
  pointsBalance,
  qrToken,
  hasActiveRedemption,
  onIssued,
}: {
  reward: Reward
  pointsBalance: number
  qrToken: string
  /** Ya hay un canje esperando: la RPC sólo permite uno por vez. */
  hasActiveRedemption: boolean
  onIssued: (ticket: WalletTicket) => void
}): React.JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, startRedeem] = useTransition()

  const soldOut = !reward.tierLocked && reward.stock !== null && reward.stock <= 0
  const missing = Math.max(0, reward.costPoints - pointsBalance)
  const canRedeem = reward.affordable && !reward.tierLocked && !soldOut
  const progressPct =
    reward.costPoints > 0
      ? Math.max(0, Math.min(100, Math.round((pointsBalance / reward.costPoints) * 100)))
      : 100

  const onConfirm = () => {
    startRedeem(async () => {
      const r = await requestRedemption({ qrToken, rewardId: reward.id })
      setConfirmOpen(false)
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      onIssued(r.ticket)
    })
  }

  return (
    <div className="space-y-5">
      <div className="card-hairline overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-(--cream-tint)">
          {reward.imageUrl ? (
            <StorageImage src={reward.imageUrl} sizes="(max-width: 448px) 100vw, 448px" priority />
          ) : (
            <div className="grid size-full place-items-center">
              <Gift className="size-14 text-muted-foreground/40" aria-hidden="true" />
            </div>
          )}
          <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-card/92 px-3 py-1 text-sm font-bold tabular-nums text-foreground shadow-sm ring-1 ring-border/50 backdrop-blur">
            {formatPoints(reward.costPoints)} pts
          </span>
        </div>

        <div className="space-y-2 p-5">
          <h2 className="font-display text-xl font-semibold leading-tight tracking-tight">
            {reward.name}
          </h2>
          {reward.description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{reward.description}</p>
          ) : null}
          {reward.stock !== null && reward.stock > 0 && reward.stock <= 5 ? (
            <p className="text-xs font-medium text-(--brand-accent)">
              Quedan {reward.stock} — no lo dejes pasar.
            </p>
          ) : null}
        </div>
      </div>

      {reward.tierLocked ? (
        <div className="card-hairline rounded-2xl border border-dashed bg-card p-5 text-center">
          <Lock className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold">
            Se desbloquea en {reward.minTierName ?? 'un nivel más alto'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground text-balance">
            Seguí viniendo y en cuanto subas de nivel te aparece acá para canjear.
          </p>
        </div>
      ) : soldOut ? (
        <div className="card-hairline rounded-2xl border border-dashed bg-card p-5 text-center">
          <Ticket className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold">Se agotó por ahora</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Volvé a mirar en unos días: lo reponemos seguido.
          </p>
        </div>
      ) : !reward.affordable ? (
        <div className="card-hairline space-y-2.5 rounded-2xl border bg-card p-5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">
              Te faltan{' '}
              <span className="tabular-nums text-(--brand-accent)">
                {formatPoints(missing)} pts
              </span>
            </p>
            <p className="text-[11px] tabular-nums text-muted-foreground">
              {formatPoints(pointsBalance)} / {formatPoints(reward.costPoints)} pts
            </p>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progreso hacia ${reward.name}`}
          >
            <div
              className="h-full rounded-full bg-(--brand-accent) transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">Ya estás al {progressPct}%. Falta poco.</p>
        </div>
      ) : hasActiveRedemption ? (
        <div className="card-hairline rounded-2xl border bg-card p-5 text-center">
          <p className="text-sm font-semibold">Ya tenés un canje esperando</p>
          <p className="mt-1 text-xs text-muted-foreground text-balance">
            Usalo o cancelalo desde el inicio de tu billetera y después volvé por este.
          </p>
        </div>
      ) : (
        <Button
          type="button"
          size="xl"
          className="h-14 w-full gap-2 text-base"
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
        >
          <Sparkles className="size-5" aria-hidden="true" />
          Canjeá este beneficio
        </Button>
      )}

      {canRedeem && !hasActiveRedemption ? (
        <p className="text-center text-xs text-muted-foreground text-balance">
          Te generamos un código para mostrarle al mozo. Los puntos se descuentan recién cuando te
          lo entregan.
        </p>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !busy && setConfirmOpen(open)}>
        <AlertDialogContent className="force-light">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Canjeamos {reward.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a usar {formatPoints(reward.costPoints)} pts de los {formatPoints(pointsBalance)}{' '}
              que tenés. Te damos un código para mostrar en el bar y podés cancelarlo si cambiás de
              idea.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Mejor no</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Sin esto Radix cierra el diálogo antes de que la action responda
                // y el socio se queda sin ver el error si algo falla.
                e.preventDefault()
                onConfirm()
              }}
              disabled={busy}
            >
              {busy ? 'Generando…' : 'Sí, canjear'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
