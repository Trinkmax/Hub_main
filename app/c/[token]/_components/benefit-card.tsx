import { Gift, Handshake, Lock, Percent, Sparkles } from 'lucide-react'
import Image from 'next/image'
import type { CSSProperties } from 'react'
import { BENEFIT_KIND_META } from '@/lib/points/benefits'
import { cn } from '@/lib/utils'
import type { WalletData } from '@/lib/wallet/queries'
import { LucideByName } from './benefit-icon'

// Card de beneficio para carrusel (foto-forward). Foto del reward si existe;
// si no, fallback "emplatado": % grande para descuentos, glifo tintado para el
// resto. `muted` = nivel aún no alcanzado (atenuado + candado).

type Benefit = WalletData['benefits'][number]

const KIND_FALLBACK = { Gift, Percent, Sparkles, Handshake }
const CADENCE: Record<Benefit['cadence'], string | null> = {
  none: null,
  monthly: 'Cada mes',
  birthday: 'En tu cumpleaños',
}

function subText(b: Benefit): string | null {
  switch (b.kind) {
    case 'discount':
      return b.discountScope
    case 'partner':
      return b.partner?.discountLabel ?? b.partner?.category ?? 'Beneficio de socio'
    case 'recurring_reward':
      return CADENCE[b.cadence]
    default:
      return b.description
  }
}

export function BenefitCard({
  benefit,
  muted = false,
}: {
  benefit: Benefit
  muted?: boolean
}): React.JSX.Element {
  const Fallback =
    KIND_FALLBACK[BENEFIT_KIND_META[benefit.kind].icon as keyof typeof KIND_FALLBACK] ?? Gift
  const isDiscount = benefit.kind === 'discount' && benefit.discountPct !== null
  const photo =
    benefit.imageUrl ?? (benefit.kind === 'partner' ? (benefit.partner?.logoUrl ?? null) : null)
  const sub = subText(benefit)

  return (
    <article className="w-[9.5rem] shrink-0 snap-start overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        {photo ? (
          <Image
            src={photo}
            alt=""
            fill
            sizes="152px"
            className={cn('object-cover', muted && 'saturate-[0.55]')}
            unoptimized
          />
        ) : (
          <div
            className="grid size-full place-items-center"
            style={
              muted
                ? { backgroundColor: 'var(--cream-tint)' }
                : ({
                    background:
                      'radial-gradient(120% 120% at 30% 0%, color-mix(in oklch, var(--acc) 22%, var(--card)), var(--card))',
                  } as CSSProperties)
            }
          >
            {isDiscount ? (
              <span
                className={cn(
                  'font-display text-2xl font-bold tabular-nums',
                  muted ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {Math.round(benefit.discountPct as number)}%
              </span>
            ) : (
              <LucideByName
                name={benefit.icon}
                fallback={Fallback}
                className={cn('size-8', muted ? 'text-muted-foreground/70' : 'text-(--acc)')}
              />
            )}
          </div>
        )}
        {muted ? (
          <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-card/85 shadow-sm backdrop-blur">
            <Lock className="size-3 text-muted-foreground" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 text-[12.5px] font-medium leading-tight text-foreground">
          {benefit.label}
        </p>
        {sub ? (
          <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{sub}</p>
        ) : null}
      </div>
    </article>
  )
}
