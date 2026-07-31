'use client'

import { Crown, Gift, QrCode, Sparkles } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { StorageImage } from '@/components/media/storage-image'
import { claimPendingRedemption } from '@/lib/wallet/actions'
import type { WalletData } from '@/lib/wallet/queries'
import { RedemptionTicket, type WalletTicket } from './redemption-ticket'

// Lo que el socio tiene para retirar. Dos cosas distintas, en este orden:
//
//  1. El canje con QR vivo (si hay uno) → arriba de todo, es LA acción del momento.
//  2. Los beneficios que nacen pendientes (regalo de bienvenida, beneficio de
//     nivel del cron, premio de una punch card completa). Hasta ahora no tenían
//     ningún camino de entrega y quedaban pendientes PARA SIEMPRE; ahora cada uno
//     tiene su botón para generar el QR con el que se retira.

type PendingBenefit = WalletData['pendingBenefits'][number]

const KIND_META: Record<PendingBenefit['kind'], { Icon: typeof Gift; label: string }> = {
  welcome: { Icon: Gift, label: 'Regalo de bienvenida' },
  tier: { Icon: Crown, label: 'Beneficio de tu nivel' },
  reward: { Icon: Gift, label: 'Recompensa' },
}

function BenefitRow({
  benefit,
  qrToken,
  blocked,
  onIssued,
}: {
  benefit: PendingBenefit
  qrToken: string
  /** Ya hay un canje activo: la RPC permite uno solo por vez. */
  blocked: boolean
  onIssued: (ticket: WalletTicket) => void
}) {
  const { Icon, label } = KIND_META[benefit.kind]
  const [busy, startClaim] = useTransition()

  const onClaim = () => {
    startClaim(async () => {
      const r = await claimPendingRedemption({ qrToken, redemptionId: benefit.redemptionId })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      onIssued(r.ticket)
    })
  }

  return (
    <li className="flex items-center gap-3 rounded-xl bg-(--brand-accent-foreground)/10 p-2.5">
      <div className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-(--brand-accent-foreground)/15">
        {benefit.imageUrl ? (
          <StorageImage src={benefit.imageUrl} sizes="44px">
            <Icon className="size-5" aria-hidden="true" />
          </StorageImage>
        ) : (
          <Icon className="size-5" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{benefit.rewardName}</p>
        <p className="text-xs opacity-80">{label}</p>
      </div>
      <button
        type="button"
        onClick={onClaim}
        disabled={busy || blocked}
        title={blocked ? 'Primero usá o cancelá el canje que ya tenés abierto' : undefined}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-(--brand-accent-foreground) px-3.5 text-xs font-semibold text-(--brand-accent) outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--brand-accent-foreground) focus-visible:ring-offset-2 focus-visible:ring-offset-(--brand-accent) disabled:opacity-50"
      >
        <QrCode className="size-3.5" aria-hidden="true" />
        {busy ? 'Generando…' : 'Mostrar QR'}
      </button>
    </li>
  )
}

export function PendingBenefits({
  benefits,
  active,
  qrToken,
  onIssued,
  onCleared,
}: {
  benefits: PendingBenefit[]
  /** El canje con QR vivo, si hay uno (nunca viene repetido en `benefits`). */
  active: WalletTicket | null
  qrToken: string
  onIssued: (ticket: WalletTicket) => void
  onCleared: (redemptionId: string) => void
}): React.JSX.Element | null {
  if (!active && benefits.length === 0) return null

  return (
    <div className="space-y-4">
      {active ? (
        <RedemptionTicket
          ticket={active}
          qrToken={qrToken}
          onCleared={onCleared}
          onReissued={onIssued}
        />
      ) : null}

      {benefits.length > 0 ? (
        <section
          aria-label="Beneficios para retirar"
          className="overflow-hidden rounded-2xl bg-(--brand-accent) p-5 text-(--brand-accent-foreground) shadow-glow"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 shrink-0" aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold tracking-tight">
              Tenés beneficios para retirar
            </h2>
          </div>
          <p className="mt-1 text-sm opacity-90">
            Generá el código y mostráselo al mozo cuando lo quieras usar.
          </p>

          <ul className="mt-4 space-y-2">
            {benefits.map((b) => (
              <BenefitRow
                key={b.redemptionId}
                benefit={b}
                qrToken={qrToken}
                blocked={active !== null}
                onIssued={onIssued}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
