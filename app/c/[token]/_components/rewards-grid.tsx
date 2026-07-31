import {
  Beer,
  Coffee,
  Gift,
  Lock,
  type LucideIcon,
  Sparkles,
  Ticket,
  UtensilsCrossed,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { StorageImage } from '@/components/media/storage-image'
import { cn } from '@/lib/utils'
import type { WalletData } from '@/lib/wallet/queries'
import { WalletCarousel } from './wallet-carousel'
import { formatPoints } from './wallet-format'
import { WalletMoreButton } from './wallet-more-button'

// Catálogo de canje: carrusel horizontal por daypart (foto-forward). Premium sin
// foto: tile con gradiente teñido + glifo. Estados: bloqueado > agotado > te
// faltan > canjeable (destacada).
//
// El canje pasó a ser AUTO-SERVICIO: la card no explica nada, se toca y abre el
// detalle (RewardDetail) donde el socio pide su código. La card mide 9.5rem en un
// carrusel — un botón adentro no entra ni se toca bien, así que el target táctil
// es la card entera.

type Reward = WalletData['rewards'][number]
type CatMeta = { label: string; glyph: LucideIcon; hue: string }

const CATEGORY_META: Record<string, CatMeta> = {
  desayuno: { label: 'Desayuno y merienda', glyph: Coffee, hue: '#C69749' },
  almuerzo: { label: 'Almuerzo', glyph: UtensilsCrossed, hue: '#7C9A6B' },
  cena: { label: 'Cena', glyph: Beer, hue: '#9B5B4A' },
  evento: { label: 'Eventos', glyph: Ticket, hue: '#7C6BAE' },
}
const CATEGORY_ORDER = ['desayuno', 'almuerzo', 'cena', 'evento'] as const
const OTHER_META: CatMeta = { label: 'Otras recompensas', glyph: Gift, hue: '#5B6B58' }

function metaFor(r: Reward): CatMeta {
  return (r.category ? CATEGORY_META[r.category] : undefined) ?? OTHER_META
}

/**
 * Canjeables primero (lo que ya puede pedir tiene que estar arriba), y dentro de
 * cada grupo manda el orden que el dueño armó arrastrando en el editor (ITEM 7).
 * El costo queda de desempate para las filas que nunca se reordenaron.
 */
const byAffordability = (a: Reward, b: Reward): number =>
  Number(b.affordable && !b.tierLocked) - Number(a.affordable && !a.tierLocked) ||
  a.sort - b.sort ||
  a.costPoints - b.costPoints

function RewardCard({
  reward,
  glyph,
  hue,
  pointsBalance,
  onSelect,
}: {
  reward: Reward
  glyph: LucideIcon
  hue: string
  pointsBalance: number
  onSelect: (reward: Reward) => void
}) {
  const { affordable, tierLocked } = reward
  const canRedeem = affordable && !tierLocked
  const missing = Math.max(0, reward.costPoints - pointsBalance)
  const soldOut = !tierLocked && reward.stock !== null && reward.stock <= 0
  const progressPct =
    reward.costPoints > 0
      ? Math.max(0, Math.min(100, Math.round((pointsBalance / reward.costPoints) * 100)))
      : 100
  const Glyph = glyph

  return (
    <button
      type="button"
      onClick={() => onSelect(reward)}
      style={{ '--cat': hue, '--acc': 'var(--brand-accent, var(--primary))' } as CSSProperties}
      className={cn(
        'press-lift w-[9.5rem] shrink-0 snap-start overflow-hidden rounded-2xl border bg-card text-left outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-foreground',
        canRedeem
          ? 'border-(--acc)/45 shadow-md ring-1 ring-(--acc)/15'
          : 'card-hairline border-border/70',
      )}
      aria-label={`Ver ${reward.name} — ${formatPoints(reward.costPoints)} puntos`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        {reward.imageUrl ? (
          <StorageImage
            src={reward.imageUrl}
            sizes="152px"
            className={cn(!canRedeem && 'saturate-[0.6]')}
          />
        ) : (
          <div
            className="grid size-full place-items-center"
            style={{
              background:
                'radial-gradient(125% 110% at 25% -10%, color-mix(in oklch, var(--cat) 24%, var(--card)), var(--card) 72%)',
            }}
          >
            <Glyph
              className="size-11 opacity-[0.3]"
              style={{ color: 'color-mix(in oklch, var(--cat) 70%, var(--foreground))' }}
              aria-hidden="true"
            />
          </div>
        )}

        <span className="absolute left-1.5 top-1.5 inline-flex items-center rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground shadow-sm ring-1 ring-border/50 backdrop-blur">
          {formatPoints(reward.costPoints)} pts
        </span>

        {tierLocked ? (
          <div className="absolute inset-0 grid place-items-center gap-1 bg-card/72 backdrop-blur-[2px]">
            <Lock className="size-4 text-foreground/70" aria-hidden="true" />
          </div>
        ) : soldOut ? (
          <div className="absolute inset-0 grid place-items-center bg-card/72 backdrop-blur-[2px]">
            <span className="rounded-full bg-card/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm">
              Agotado
            </span>
          </div>
        ) : canRedeem ? (
          <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-(--acc) px-1.5 py-0.5 text-[9px] font-semibold text-(--brand-accent-foreground) shadow-sm">
            <Sparkles className="size-2.5" aria-hidden="true" />
            Canjeable
          </span>
        ) : null}
      </div>

      <div className="p-2.5">
        {/* `span` y no `h3`: ahora la card ES el botón, y un heading adentro de un
            botón se aplana en los lectores de pantalla. El nombre accesible sale
            del aria-label. */}
        <span className="line-clamp-2 block min-h-[2.1rem] text-[12.5px] font-semibold leading-tight text-foreground">
          {reward.name}
        </span>
        <span className="mt-1 line-clamp-1 block text-[10px]">
          {tierLocked ? (
            <span className="text-muted-foreground">
              Desde{' '}
              <span className="font-medium text-foreground">
                {reward.minTierName ?? 'otro nivel'}
              </span>
            </span>
          ) : soldOut ? (
            <span className="text-muted-foreground">Sin stock por ahora</span>
          ) : !affordable ? (
            <span className="text-muted-foreground">
              Te faltan{' '}
              <span className="font-semibold tabular-nums text-foreground">
                {formatPoints(missing)} pts
              </span>
            </span>
          ) : (
            <span className="font-medium text-(--acc)">Tocá para canjear</span>
          )}
        </span>
        {/* Barra sólo cuando falta: ver "cuánto me falta" hace que el bloqueo se
            sienta alcanzable en vez de un no seco. */}
        {!tierLocked && !soldOut && !affordable ? (
          <div
            className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progreso hacia ${reward.name}`}
          >
            <div
              className="h-full rounded-full bg-(--acc)/70"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        ) : null}
      </div>
    </button>
  )
}

export function RewardsGrid({
  rewards,
  pointsBalance,
  onSelect,
  previewCount,
  onMore,
}: {
  rewards: Reward[]
  pointsBalance: number
  /** Abre el detalle donde se pide el canje (vista in-place de la wallet). */
  onSelect: (reward: Reward) => void
  /** Si está, muestra sólo N (carrusel plano) + CTA "ver todo" (wallet compacta). */
  previewCount?: number
  onMore?: () => void
}): React.JSX.Element | null {
  if (rewards.length === 0) return null

  // Preview (wallet compacta): top N canjeables-primero, un carrusel + "ver todo".
  if (previewCount) {
    const items = rewards.slice().sort(byAffordability).slice(0, previewCount)
    return (
      <section aria-labelledby="rewards-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="rewards-heading" className="font-display text-lg font-semibold tracking-tight">
            Canjeá tus puntos
          </h2>
          <p className="text-xs text-muted-foreground">
            Tenés{' '}
            <span className="font-medium text-foreground tabular-nums">
              {formatPoints(pointsBalance)} pts
            </span>{' '}
            para gastar. Tocá el que quieras y te damos el código.
          </p>
        </div>
        <WalletCarousel>
          {items.map((reward) => {
            const m = metaFor(reward)
            return (
              <RewardCard
                key={reward.id}
                reward={reward}
                glyph={m.glyph}
                hue={m.hue}
                pointsBalance={pointsBalance}
                onSelect={onSelect}
              />
            )
          })}
        </WalletCarousel>
        {onMore ? (
          <WalletMoreButton onClick={onMore}>Mirá todo lo que podés canjear</WalletMoreButton>
        ) : null}
      </section>
    )
  }

  // Catálogo completo: un carrusel por daypart (orden canónico + "Otras" al final).
  const byCategory = new Map<string, Reward[]>()
  for (const r of rewards) {
    const key = r.category && CATEGORY_META[r.category] ? r.category : '__other'
    const arr = byCategory.get(key)
    if (arr) arr.push(r)
    else byCategory.set(key, [r])
  }
  const sortItems = (items: Reward[]): Reward[] => items.slice().sort(byAffordability)

  const sections: { key: string; meta: CatMeta; items: Reward[] }[] = []
  for (const key of CATEGORY_ORDER) {
    const items = byCategory.get(key)
    if (items && items.length > 0)
      sections.push({ key, meta: CATEGORY_META[key] as CatMeta, items: sortItems(items) })
  }
  const other = byCategory.get('__other')
  if (other && other.length > 0)
    sections.push({ key: '__other', meta: OTHER_META, items: sortItems(other) })

  return (
    <section aria-labelledby="rewards-heading" className="space-y-6">
      <div className="space-y-1">
        <h2 id="rewards-heading" className="font-display text-lg font-semibold tracking-tight">
          Catálogo de canje
        </h2>
        <p className="text-xs text-muted-foreground">
          Usás tus{' '}
          <span className="font-medium text-foreground tabular-nums">
            {formatPoints(pointsBalance)} pts
          </span>{' '}
          en lo que se te cante. Tocá un beneficio para ver el detalle y canjearlo.
        </p>
      </div>

      {sections.map((section) => {
        const SectionGlyph = section.meta.glyph
        return (
          <div key={section.key} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span
                style={{
                  backgroundColor: `color-mix(in oklch, ${section.meta.hue} 16%, transparent)`,
                  color: `color-mix(in oklch, ${section.meta.hue} 78%, var(--foreground))`,
                }}
                className="grid size-6 place-items-center rounded-md"
              >
                <SectionGlyph className="size-3.5" aria-hidden="true" />
              </span>
              <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                {section.meta.label}
              </h3>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {section.items.length}
              </span>
            </div>
            <WalletCarousel>
              {section.items.map((reward) => (
                <RewardCard
                  key={reward.id}
                  reward={reward}
                  glyph={section.meta.glyph}
                  hue={section.meta.hue}
                  pointsBalance={pointsBalance}
                  onSelect={onSelect}
                />
              ))}
            </WalletCarousel>
          </div>
        )
      })}
    </section>
  )
}
