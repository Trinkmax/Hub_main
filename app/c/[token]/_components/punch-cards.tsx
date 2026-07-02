import { Check, Stamp } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import type { WalletData } from '@/lib/wallet/queries'

// Tarjetas de sellos. Cada tarjeta = una fila de puntos (sellos completados de
// `threshold`). Renderiza TODAS. Se oculta la sección si no hay ninguna.

type PunchCard = WalletData['punchCards'][number]

function StampDots({ current, threshold }: { current: number; threshold: number }) {
  const dots = Array.from({ length: threshold }, (_, i) => i < current)
  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="img"
      aria-label={`${current} de ${threshold} sellos completados`}
    >
      {dots.map((filled, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: los sellos son una progresión visual de tamaño fijo; el índice es estable
          key={i}
          aria-hidden="true"
          className={cn(
            'grid size-6 place-items-center rounded-full transition-colors',
            filled
              ? 'bg-(--brand-accent) text-(--brand-accent-foreground) shadow-sm'
              : 'border border-dashed border-border bg-secondary/40',
          )}
        >
          {filled ? <Check className="size-3.5" /> : null}
        </span>
      ))}
    </div>
  )
}

function PunchCardRow({ card }: { card: PunchCard }) {
  const complete = card.currentStamps >= card.threshold
  return (
    <article className="card-hairline rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-(--cream-tint)">
          {card.imageUrl ? (
            <Image
              src={card.imageUrl}
              alt=""
              width={40}
              height={40}
              className="size-full object-cover"
              unoptimized
            />
          ) : (
            <Stamp className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-tight">{card.templateName}</h3>
          <p className="text-xs text-muted-foreground tabular-nums">
            {card.currentStamps} de {card.threshold} sellos
          </p>
        </div>
      </div>

      <div className="mt-3">
        <StampDots current={card.currentStamps} threshold={card.threshold} />
      </div>

      {card.rewardName ? (
        <p
          className={cn(
            'mt-3 text-xs',
            complete ? 'font-medium text-(--brand-accent)' : 'text-muted-foreground',
          )}
        >
          {complete
            ? `¡Listo! Pedí "${card.rewardName}" en la caja.`
            : `Completá para: ${card.rewardName}`}
        </p>
      ) : null}
    </article>
  )
}

export function PunchCards({ cards }: { cards: PunchCard[] }): React.JSX.Element | null {
  if (cards.length === 0) return null

  return (
    <section aria-labelledby="punch-heading" className="space-y-3">
      <h2 id="punch-heading" className="font-display text-lg font-semibold tracking-tight">
        Tus tarjetas
      </h2>
      <div className="space-y-3">
        {cards.map((card) => (
          <PunchCardRow key={card.id} card={card} />
        ))}
      </div>
    </section>
  )
}
