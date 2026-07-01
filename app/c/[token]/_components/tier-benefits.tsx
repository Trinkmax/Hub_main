import { Gift, Handshake, Percent, Sparkles } from 'lucide-react'
import type { CSSProperties } from 'react'
import { BENEFIT_KIND_META, BENEFIT_KINDS, CADENCE_LABEL } from '@/lib/points/benefits'
import type { WalletData } from '@/lib/wallet/queries'
import { LucideByName } from './benefit-icon'

// Beneficios estructurados del nivel actual del cliente. Server component.
// Agrupa por tipo (ítems del mes / descuentos / perks / aliados) y los presenta
// con jerarquía. Los ítems del mes también aparecen en "para retirar" cuando el
// cron los emite; acá se muestra el derecho del nivel.

type Benefit = WalletData['benefits'][number]

const KIND_FALLBACK_ICON = { Gift, Percent, Sparkles, Handshake }

function accentStyle(color: string | null): CSSProperties {
  const isHex = color !== null && /^#[0-9a-fA-F]{6}$/.test(color)
  return {
    '--ben-accent': isHex ? color : 'var(--brand-accent, var(--primary))',
  } as CSSProperties
}

function RewardRow({ benefit, delay }: { benefit: Benefit; delay: number }) {
  return (
    <li
      className="animate-in fade-in slide-in-from-bottom-1 flex items-center gap-3 rounded-xl border border-[--ben-accent]/20 bg-[color-mix(in_oklch,var(--ben-accent)_6%,transparent)] px-3 py-2.5"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[--ben-accent]/15 text-[--ben-accent]">
        <LucideByName name={benefit.icon} fallback={Gift} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight">
          {benefit.quantity > 1 ? (
            <span className="mr-1 rounded bg-[--ben-accent]/15 px-1 text-xs font-bold tabular-nums text-[--ben-accent]">
              ×{benefit.quantity}
            </span>
          ) : null}
          {benefit.label}
        </p>
        <p className="text-[11px] text-muted-foreground">{CADENCE_LABEL[benefit.cadence]}</p>
      </div>
    </li>
  )
}

function DiscountRow({ benefit, delay }: { benefit: Benefit; delay: number }) {
  return (
    <li
      className="animate-in fade-in slide-in-from-bottom-1 flex items-center gap-3 px-1 py-1.5"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      {benefit.discountPct !== null ? (
        <span className="grid h-9 min-w-9 shrink-0 place-items-center rounded-full bg-success/10 px-1.5 text-xs font-bold tabular-nums text-success">
          {Math.round(benefit.discountPct)}%
        </span>
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/10 text-success">
          <Percent className="size-4" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{benefit.label}</p>
        {benefit.discountScope ? (
          <p className="text-[11px] text-muted-foreground">{benefit.discountScope}</p>
        ) : null}
      </div>
    </li>
  )
}

function PerkRow({ benefit, delay }: { benefit: Benefit; delay: number }) {
  return (
    <li
      className="animate-in fade-in slide-in-from-bottom-1 flex items-start gap-3 px-1 py-1.5"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[--ben-accent]/12 text-[--ben-accent]">
        <LucideByName name={benefit.icon} fallback={Sparkles} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{benefit.label}</p>
        {benefit.description ? (
          <p className="text-[11px] text-muted-foreground">{benefit.description}</p>
        ) : null}
      </div>
    </li>
  )
}

function PartnerCard({ benefit }: { benefit: Benefit }) {
  const p = benefit.partner
  const name = p?.name ?? benefit.label
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <li className="flex w-32 shrink-0 snap-start flex-col items-center gap-2 rounded-2xl border bg-card px-3 py-3 text-center">
      <span className="grid size-12 place-items-center overflow-hidden rounded-full bg-[--cream-tint]">
        {p?.logoUrl ? (
          // biome-ignore lint/performance/noImgElement: logos externos de aliados, dominios variables.
          <img src={p.logoUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="font-serif text-lg font-semibold text-muted-foreground">{initial}</span>
        )}
      </span>
      <span className="line-clamp-2 text-xs font-medium leading-tight">{name}</span>
      {p?.discountLabel ? (
        <span className="rounded-full bg-[--ben-accent]/12 px-2 py-0.5 text-[10px] font-semibold text-[--ben-accent]">
          {p.discountLabel}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground">Beneficio de socio</span>
      )}
    </li>
  )
}

export function TierBenefits({
  benefits,
  tierName,
  tierColor,
}: {
  benefits: Benefit[]
  tierName: string | null
  tierColor: string | null
}): React.JSX.Element | null {
  if (benefits.length === 0) return null

  const groups = BENEFIT_KINDS.map((kind) => ({
    kind,
    meta: BENEFIT_KIND_META[kind],
    items: benefits.filter((b) => b.kind === kind),
  })).filter((g) => g.items.length > 0)

  return (
    <section
      aria-labelledby="benefits-heading"
      style={accentStyle(tierColor)}
      className="space-y-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="benefits-heading" className="font-display text-lg font-semibold tracking-tight">
          Beneficios de tu nivel
        </h2>
        {tierName ? (
          <span className="text-[11px] font-medium uppercase tracking-wider text-[--ben-accent]">
            {tierName}
          </span>
        ) : null}
      </div>

      <div className="card-hairline space-y-5 rounded-2xl border bg-card p-4">
        {groups.map((group) => {
          const FallbackIcon =
            KIND_FALLBACK_ICON[group.meta.icon as keyof typeof KIND_FALLBACK_ICON] ?? Gift
          return (
            <div key={group.kind} className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <FallbackIcon className="size-3.5 text-[--ben-accent]" aria-hidden="true" />
                {group.meta.groupTitle}
              </div>

              {group.kind === 'partner' ? (
                <ul className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {group.items.map((b) => (
                    <PartnerCard key={b.id} benefit={b} />
                  ))}
                </ul>
              ) : (
                <ul className={group.kind === 'recurring_reward' ? 'space-y-2' : 'space-y-0.5'}>
                  {group.items.map((b, i) =>
                    group.kind === 'recurring_reward' ? (
                      <RewardRow key={b.id} benefit={b} delay={i * 60} />
                    ) : group.kind === 'discount' ? (
                      <DiscountRow key={b.id} benefit={b} delay={i * 60} />
                    ) : (
                      <PerkRow key={b.id} benefit={b} delay={i * 60} />
                    ),
                  )}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
