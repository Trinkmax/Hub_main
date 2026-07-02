import { Gift, Handshake, Lock, Percent, Sparkles } from 'lucide-react'
import type { CSSProperties } from 'react'
import { BENEFIT_KIND_META } from '@/lib/points/benefits'
import type { WalletData } from '@/lib/wallet/queries'
import { LucideByName } from './benefit-icon'
import { formatPoints } from './wallet-format'

// Beneficios por categoría, con aspiración: tu nivel actual (desbloqueado, a todo
// color) + los niveles siguientes (bloqueados, "te faltan X pts") para que veas
// qué ganás si seguís sumando. Concepto central del dueño. Server component.

type Step = WalletData['progression'][number]
type Benefit = WalletData['benefits'][number]

const KIND_FALLBACK = { Gift, Percent, Sparkles, Handshake }

const CADENCE_TEXT: Record<Benefit['cadence'], string> = {
  none: '',
  monthly: 'Cada mes',
  birthday: 'En tu cumpleaños',
}

function accent(color: string | null): CSSProperties {
  const isHex = color !== null && /^#[0-9a-fA-F]{6}$/.test(color)
  return { '--acc': isHex ? color : 'var(--brand-accent, var(--primary))' } as CSSProperties
}

function benefitSub(b: Benefit): string | null {
  switch (b.kind) {
    case 'recurring_reward': {
      const cad = CADENCE_TEXT[b.cadence]
      return b.quantity > 1 ? `${cad} · ${b.quantity} por período`.trim() : cad || null
    }
    case 'discount':
      return b.discountScope
    case 'partner':
      return b.partner?.discountLabel ?? b.partner?.category ?? 'Beneficio de socio'
    default:
      return b.description
  }
}

function BenefitItem({
  benefit,
  locked,
  delay,
}: {
  benefit: Benefit
  locked: boolean
  delay: number
}) {
  const FallbackIcon =
    KIND_FALLBACK[BENEFIT_KIND_META[benefit.kind].icon as keyof typeof KIND_FALLBACK] ?? Gift
  const sub = benefitSub(benefit)
  return (
    <li
      className="animate-in fade-in slide-in-from-bottom-1 flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <span
        className={[
          'grid size-9 shrink-0 place-items-center rounded-full',
          locked ? 'bg-[--cream-tint] text-muted-foreground' : 'bg-[--acc]/14 text-[--acc]',
        ].join(' ')}
      >
        {benefit.kind === 'discount' && benefit.discountPct !== null ? (
          <span className="text-[11px] font-bold tabular-nums">
            {Math.round(benefit.discountPct)}%
          </span>
        ) : (
          <LucideByName name={benefit.icon} fallback={FallbackIcon} className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{benefit.label}</p>
        {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
      </div>
    </li>
  )
}

function TierBlock({ step }: { step: Step }) {
  const locked = !step.current
  return (
    <div style={accent(step.color)} className={locked ? 'opacity-95' : undefined}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-serif text-lg font-semibold tracking-tight text-[--acc]">
          {step.name}
        </h3>
        {step.current ? (
          <span className="rounded-full bg-[--acc]/14 px-2.5 py-0.5 text-[11px] font-semibold text-[--acc]">
            Tu nivel
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-[--cream-tint] px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            Faltan {formatPoints(step.pointsToReach)} pts
          </span>
        )}
      </div>
      {step.benefits.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-3 py-3 text-center text-xs text-muted-foreground">
          Este nivel todavía no tiene beneficios cargados.
        </p>
      ) : (
        <ul className="grid gap-2">
          {step.benefits.map((b, i) => (
            <BenefitItem key={b.id} benefit={b} locked={locked} delay={i * 50} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function TierProgression({
  progression,
}: {
  progression: Step[]
}): React.JSX.Element | null {
  if (progression.length === 0) return null
  const currentIndex = Math.max(
    0,
    progression.findIndex((s) => s.current),
  )
  // Nivel actual + los siguientes (aspiración). Los anteriores quedan subsumidos.
  const visible = progression.slice(currentIndex)

  return (
    <section id="niveles" aria-labelledby="niveles-heading" className="scroll-mt-4 space-y-4">
      <div className="space-y-1">
        <h2 id="niveles-heading" className="font-display text-lg font-semibold tracking-tight">
          Beneficios por categoría
        </h2>
        <p className="text-xs text-muted-foreground">
          Estos son tus beneficios ahora y lo que sumás al subir de categoría.
        </p>
      </div>
      <div className="space-y-6">
        {visible.map((step) => (
          <TierBlock key={step.id} step={step} />
        ))}
      </div>
    </section>
  )
}
