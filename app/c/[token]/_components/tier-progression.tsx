import { Lock, Sparkles } from 'lucide-react'
import type { WalletData } from '@/lib/wallet/queries'
import { BenefitCard } from './benefit-card'
import { LucideByName } from './benefit-icon'
import { tierAccent } from './tier-accent'
import { WalletCarousel } from './wallet-carousel'
import { formatPoints } from './wallet-format'
import { WalletMoreButton } from './wallet-more-button'

// Beneficios por categoría, aspiracionales: tu nivel actual + los siguientes
// (con "te faltan X pts"). Cada nivel = header + carrusel horizontal de cards de
// beneficio (foto-forward). Concepto central del dueño (los « » del mockup).

type Step = WalletData['progression'][number]

function TierSection({ step }: { step: Step }) {
  const isCurrent = step.current
  return (
    <div style={tierAccent(step.color)} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-(--acc)/15 text-(--acc)">
            <LucideByName name={step.badgeIcon} fallback={Sparkles} className="size-4" />
          </span>
          <h3 className="truncate font-display text-lg font-semibold tracking-tight text-foreground">
            {step.name}
          </h3>
        </div>
        {isCurrent ? (
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-(--acc)/35 bg-(--acc)/14 px-2.5 py-1 text-[11px] font-semibold text-foreground">
            <span className="size-1.5 rounded-full bg-(--acc)" aria-hidden="true" />
            Tu nivel
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-(--cream-tint) px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            Te faltan{' '}
            <span className="font-semibold tabular-nums text-foreground">
              {formatPoints(step.pointsToReach)}
            </span>{' '}
            pts
          </span>
        )}
      </div>
      {step.benefits.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
          Este nivel todavía no tiene beneficios cargados.
        </p>
      ) : (
        <WalletCarousel>
          {step.benefits.map((b) => (
            <BenefitCard key={b.id} benefit={b} muted={!isCurrent} />
          ))}
        </WalletCarousel>
      )}
    </div>
  )
}

export function TierProgression({
  progression,
  variant = 'full',
  onMore,
}: {
  progression: Step[]
  /** `current` = solo tu nivel (wallet compacta); `full` = actual + siguientes. */
  variant?: 'full' | 'current'
  /** Si está, muestra un CTA "ver todas las categorías" al pie (cambia de vista). */
  onMore?: () => void
}): React.JSX.Element | null {
  if (progression.length === 0) return null
  const currentIndex = Math.max(
    0,
    progression.findIndex((s) => s.current),
  )
  const visible =
    variant === 'current'
      ? progression.slice(currentIndex, currentIndex + 1)
      : progression.slice(currentIndex)

  return (
    <section aria-labelledby="beneficios-heading" className="space-y-6">
      <div className="space-y-1">
        <h2 id="beneficios-heading" className="font-display text-lg font-semibold tracking-tight">
          {variant === 'current' ? 'Beneficios de tu nivel' : 'Beneficios por categoría'}
        </h2>
        <p className="text-xs text-muted-foreground">
          {variant === 'current'
            ? 'Los que tenés disponibles ahora.'
            : 'Lo que tenés ahora y lo que sumás al subir de nivel.'}
        </p>
      </div>
      {visible.map((step) => (
        <TierSection key={step.id} step={step} />
      ))}
      {onMore ? (
        <WalletMoreButton onClick={onMore}>Mirá los beneficios de cada categoría</WalletMoreButton>
      ) : null}
    </section>
  )
}
