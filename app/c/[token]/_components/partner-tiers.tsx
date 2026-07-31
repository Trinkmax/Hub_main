import { Check, Handshake, Lock, Sparkles } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import type { WalletData } from '@/lib/wallet/queries'
import { LucideByName } from './benefit-icon'
import { tierAccent } from './tier-accent'
import { WalletCarousel } from './wallet-carousel'
import { formatPoints } from './wallet-format'

// "Aliados por categoría": el espejo exacto de TierProgression, pero con marcas.
// Mismo lenguaje visual a propósito — el socio ya aprendió a leer esa pantalla y
// acá tiene que entender lo mismo de un vistazo: qué me da cada marca HOY y qué
// se me abre si subo. Check en mi nivel, candado en los que todavía no alcancé.

type Step = WalletData['progression'][number]
type TierEntries = NonNullable<WalletData['partnerTiers']>[number]
type Entry = TierEntries['entries'][number]

function PartnerBenefitCard({ entry, muted }: { entry: Entry; muted: boolean }) {
  const initial = entry.partnerName.trim()[0]?.toUpperCase() ?? '·'
  const { benefit } = entry
  return (
    <article className="w-[9.5rem] shrink-0 snap-start overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-(--cream-tint)">
        <div className="grid size-full place-items-center p-3">
          {entry.logoUrl ? (
            <Image
              src={entry.logoUrl}
              alt=""
              width={120}
              height={90}
              className={cn(
                'max-h-full w-full object-contain',
                muted && 'opacity-55 saturate-[0.5]',
              )}
              unoptimized
            />
          ) : (
            <span
              className={cn(
                'font-display text-3xl font-semibold',
                muted ? 'text-muted-foreground/60' : 'text-foreground/70',
              )}
            >
              {initial}
            </span>
          )}
        </div>
        {benefit.discountPct !== null ? (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground shadow-sm ring-1 ring-border/50 backdrop-blur">
            {Math.round(benefit.discountPct)}%
          </span>
        ) : null}
        <span
          className={cn(
            'absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full shadow-sm backdrop-blur',
            muted ? 'bg-card/85' : 'bg-(--acc) text-(--brand-accent-foreground)',
          )}
        >
          {muted ? (
            <Lock className="size-3 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Check className="size-3.5" aria-hidden="true" />
          )}
        </span>
      </div>
      <div className="p-2.5">
        <p className="line-clamp-1 text-[12.5px] font-semibold leading-tight text-foreground">
          {entry.partnerName}
        </p>
        <p className="mt-0.5 line-clamp-2 min-h-[1.9rem] text-[10px] text-muted-foreground">
          {benefit.label}
        </p>
      </div>
    </article>
  )
}

function TierSection({ step, entries }: { step: Step; entries: Entry[] }) {
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
      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
          Este nivel todavía no tiene aliados cargados.
        </p>
      ) : (
        <WalletCarousel>
          {entries.map((entry) => (
            <PartnerBenefitCard key={entry.benefit.id} entry={entry} muted={!isCurrent} />
          ))}
        </WalletCarousel>
      )}
    </div>
  )
}

export function PartnerTiers({
  progression,
  partnerTiers,
}: {
  progression: Step[]
  partnerTiers: WalletData['partnerTiers']
}): React.JSX.Element | null {
  if (!partnerTiers || partnerTiers.length === 0) return null

  const byTier = new Map(partnerTiers.map((t) => [t.tierId, t.entries]))
  // Igual que en beneficios: desde tu nivel para arriba. Mirar hacia abajo no
  // aporta nada (ya lo tenés) y alarga la pantalla.
  const currentIndex = Math.max(
    0,
    progression.findIndex((s) => s.current),
  )
  const visible = progression.slice(currentIndex)
  if (visible.every((s) => (byTier.get(s.id) ?? []).length === 0)) return null

  return (
    <section aria-labelledby="aliados-categoria-heading" className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Handshake className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2
            id="aliados-categoria-heading"
            className="font-display text-lg font-semibold tracking-tight"
          >
            Aliados por categoría
          </h2>
        </div>
        <p className="text-xs text-muted-foreground text-balance">
          En cada marca vale el beneficio de tu nivel: al subir, cambia el que te toca.
        </p>
      </div>
      {visible.map((step) => (
        <TierSection key={step.id} step={step} entries={byTier.get(step.id) ?? []} />
      ))}
    </section>
  )
}
