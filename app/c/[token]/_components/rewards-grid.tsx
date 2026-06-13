import { Gift, Lock } from 'lucide-react'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { WalletData } from '@/lib/wallet/queries'
import { formatPoints } from './wallet-format'

// Grilla de recompensas canjeables. El canje lo hace el staff → NO hay botón de
// auto-canje; sólo se invita a mostrar el QR en la caja.
// Estados: tierLocked > affordable=false > affordable+unlocked (destacada).

type Reward = WalletData['rewards'][number]

function RewardCard({ reward, pointsBalance }: { reward: Reward; pointsBalance: number }) {
  const { affordable, tierLocked } = reward
  const canRedeem = affordable && !tierLocked
  const missing = Math.max(0, reward.costPoints - pointsBalance)

  return (
    <article
      className={cn(
        'card-hairline relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-shadow',
        canRedeem ? 'border-[--brand-accent,var(--primary)]/40 shadow-md' : 'opacity-95',
      )}
      aria-label={`Recompensa: ${reward.name}`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[--cream-tint]">
        {reward.imageUrl ? (
          <Image
            src={reward.imageUrl}
            alt=""
            fill
            sizes="(max-width: 448px) 50vw, 224px"
            className={cn('object-cover', !canRedeem && 'saturate-50')}
            unoptimized
          />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground/60">
            <Gift className="size-9" aria-hidden="true" />
          </div>
        )}

        {tierLocked ? (
          <div className="absolute inset-0 grid place-items-center bg-card/70 backdrop-blur-[1px]">
            <Lock className="size-6 text-foreground/70" aria-hidden="true" />
          </div>
        ) : canRedeem ? (
          <Badge className="absolute left-2 top-2 bg-[--brand-accent,var(--primary)] text-[--brand-accent-foreground,var(--primary-foreground)]">
            Canjeable
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="text-balance text-sm font-semibold leading-tight">{reward.name}</h3>
        {reward.description ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{reward.description}</p>
        ) : null}

        <div className="mt-auto pt-2">
          <p className="font-display text-base font-semibold tabular-nums">
            {formatPoints(reward.costPoints)}{' '}
            <span className="text-xs font-medium text-muted-foreground">pts</span>
          </p>

          {tierLocked && reward.minTierName ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Disponible desde <span className="font-medium">{reward.minTierName}</span>
            </p>
          ) : !affordable ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Te faltan{' '}
              <span className="font-medium tabular-nums">{formatPoints(missing)} pts</span>
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-[--brand-accent,var(--primary)]">
              Mostrá tu QR en la caja para canjear
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

export function RewardsGrid({
  rewards,
  pointsBalance,
}: {
  rewards: Reward[]
  pointsBalance: number
}): React.JSX.Element | null {
  if (rewards.length === 0) return null

  return (
    <section aria-labelledby="rewards-heading" className="space-y-3">
      <h2 id="rewards-heading" className="font-display text-lg font-semibold tracking-tight">
        Canjeables
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {rewards.map((reward) => (
          <RewardCard key={reward.id} reward={reward} pointsBalance={pointsBalance} />
        ))}
      </div>
    </section>
  )
}
