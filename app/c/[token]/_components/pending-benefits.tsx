import { Crown, Gift, Sparkles } from 'lucide-react'
import { StorageImage } from '@/components/media/storage-image'
import type { WalletData } from '@/lib/wallet/queries'

// Banner de beneficios pendientes de retiro. Alta jerarquía → cerca del tope.
// Mensaje accionable: "Mostrá esto en la caja".

type PendingBenefit = WalletData['pendingBenefits'][number]

const KIND_META: Record<PendingBenefit['kind'], { Icon: typeof Gift; label: string }> = {
  welcome: { Icon: Gift, label: 'Regalo de bienvenida' },
  tier: { Icon: Crown, label: 'Beneficio de nivel' },
  reward: { Icon: Gift, label: 'Recompensa' },
}

function BenefitRow({ benefit }: { benefit: PendingBenefit }) {
  const { Icon, label } = KIND_META[benefit.kind]
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
    </li>
  )
}

export function PendingBenefits({
  benefits,
}: {
  benefits: PendingBenefit[]
}): React.JSX.Element | null {
  if (benefits.length === 0) return null

  return (
    <section
      aria-label="Beneficios para retirar"
      className="overflow-hidden rounded-2xl bg-(--brand-accent) p-5 text-(--brand-accent-foreground) shadow-glow"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-5" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Tenés beneficios para retirar
        </h2>
      </div>
      <p className="mt-1 text-sm opacity-90">Mostrá esto en la caja para retirarlos.</p>

      <ul className="mt-4 space-y-2">
        {benefits.map((b) => (
          <BenefitRow key={b.redemptionId} benefit={b} />
        ))}
      </ul>
    </section>
  )
}
