'use client'

import { Check, Lock, PartyPopper, QrCode, Stamp } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { StorageImage } from '@/components/media/storage-image'
import { formatRequiredTiers } from '@/lib/punch-cards/tier-gate'
import { cn } from '@/lib/utils'
import { claimPendingRedemption } from '@/lib/wallet/actions'
import type { WalletData } from '@/lib/wallet/queries'
import { LucideByName } from './benefit-icon'
import type { WalletTicket } from './redemption-ticket'

// Tarjetas de sellos del bar. Parten de los templates ACTIVOS (ver
// lib/wallet/punch-cards.ts), así que también se ven en cero: el socio que
// todavía no consumió tiene que enterarse de que la tarjeta existe — es
// exactamente para eso que sirve una punch card.
//
// Cuando se completa, el premio queda como canje pendiente y desde acá se genera
// el QR con el que se retira (mismo flujo que el resto de los beneficios).

type PunchCard = WalletData['punchCards'][number]

/**
 * Sellos en grilla pareja. Con flex-wrap, 7 u 8 sellos dejaban una última fila
 * huérfana y desalineada; acá elegimos el ancho de fila que reparte exacto.
 */
function columnsFor(threshold: number): number {
  if (threshold <= 6) return threshold
  for (const cols of [5, 4, 6]) {
    if (threshold % cols === 0) return cols
  }
  return 5
}

function StampGrid({
  current,
  threshold,
  icon,
}: {
  current: number
  threshold: number
  icon: string | null
}) {
  const cols = columnsFor(threshold)
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      role="img"
      aria-label={`${current} de ${threshold} sellos completados`}
    >
      {Array.from({ length: threshold }, (_, i) => i < current).map((filled, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: los sellos son una progresión visual de tamaño fijo; el índice es estable
          key={i}
          aria-hidden="true"
          className={cn(
            'grid aspect-square w-full max-w-9 place-items-center justify-self-center rounded-full transition-colors duration-[var(--duration-base)]',
            filled
              ? 'bg-(--brand-accent) text-(--brand-accent-foreground) shadow-sm'
              : 'border border-dashed border-border bg-secondary/40 text-muted-foreground/45',
          )}
        >
          {filled ? (
            <LucideByName name={icon} fallback={Check} className="size-4" />
          ) : (
            <LucideByName name={icon} fallback={Stamp} className="size-3.5 opacity-45" />
          )}
        </span>
      ))}
    </div>
  )
}

/**
 * La tarjeta existe pero es de otra categoría. La frase cambia según si ya tenía
 * sellos: al que bajó de nivel no se le dice "todavía no la podés usar" cuando
 * ya juntó 3 — se le dice que sus sellos siguen ahí. No perdió nada.
 */
function lockedLine(card: PunchCard, tiers: string): string {
  const prize = card.rewardLabel ?? card.rewardName
  if (card.currentStamps > 0) {
    return `Tus ${card.currentStamps} sellos te esperan. Volvé a ${tiers} para seguir sumando.`
  }
  return prize
    ? `Es exclusiva de ${tiers}. Llegá a ese nivel y empezás a sumar para ${prize}.`
    : `Es exclusiva de ${tiers}. Llegá a ese nivel para empezar a sellarla.`
}

/** La frase que pidió el dueño: dónde estás y cuánto falta, en criollo. */
function progressLine(card: PunchCard): string {
  const prize = card.rewardLabel ?? card.rewardName
  if (card.completed) {
    return prize ? `¡Tarjeta completa! Ya podés retirar ${prize}.` : '¡Tarjeta completa!'
  }
  if (card.currentStamps === 0) {
    return prize
      ? `Todavía no tenés sellos: con ${card.threshold} te llevás ${prize}.`
      : `Sumá ${card.threshold} sellos para completarla.`
  }
  const falta = card.remaining === 1 ? 'te falta 1' : `te faltan ${card.remaining}`
  return prize
    ? `Ya sumaste ${card.currentStamps} de ${card.threshold} — ${falta} para ${prize}.`
    : `Ya sumaste ${card.currentStamps} de ${card.threshold} — ${falta}.`
}

function PunchCardRow({
  card,
  qrToken,
  blocked,
  onIssued,
}: {
  card: PunchCard
  qrToken: string
  blocked: boolean
  onIssued: (ticket: WalletTicket) => void
}) {
  const [busy, startClaim] = useTransition()
  const pendingId = card.pendingRedemptionId
  const locked = card.lockedByTier === true
  // Una tarjeta bloqueada no se canjea aunque esté completa: los sellos son de
  // cuando sí tenía el nivel.
  const claimable = !locked && card.completed && pendingId !== null
  const requiredTiers = formatRequiredTiers(card.requiredTierNames ?? [])

  const onClaim = () => {
    if (!pendingId) return
    startClaim(async () => {
      const r = await claimPendingRedemption({ qrToken, redemptionId: pendingId })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      onIssued(r.ticket)
    })
  }

  return (
    <article
      className={cn(
        'rounded-2xl border bg-card p-4 transition-colors',
        locked
          ? 'border-dashed border-border/70 bg-secondary/25'
          : card.completed
            ? 'border-(--brand-accent)/45 shadow-md'
            : 'card-hairline border-border/70',
      )}
    >
      {locked && requiredTiers ? (
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-(--brand-accent)/10 px-2.5 py-1 text-[11px] font-semibold text-(--brand-accent)">
          <Lock className="size-3" aria-hidden="true" />
          Exclusiva {requiredTiers}
        </p>
      ) : null}

      <div className={cn('flex items-center gap-3', locked && 'opacity-60')}>
        <div className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-(--cream-tint)">
          {card.imageUrl ? (
            <StorageImage src={card.imageUrl} sizes="44px">
              <LucideByName
                name={card.stampIcon}
                fallback={Stamp}
                className="size-5 text-muted-foreground"
              />
            </StorageImage>
          ) : (
            <LucideByName
              name={card.stampIcon}
              fallback={Stamp}
              className="size-5 text-(--brand-accent)"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-tight">{card.templateName}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {card.description ?? `${card.currentStamps} de ${card.threshold} sellos`}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {card.currentStamps}/{card.threshold}
        </span>
      </div>

      {/* Los sellos se muestran igual aunque esté bloqueada: ver el premio y
          cuánto cuesta es justo lo que da ganas de subir de nivel. */}
      <div className={cn('mt-3', locked && 'opacity-45 saturate-50')}>
        <StampGrid current={card.currentStamps} threshold={card.threshold} icon={card.stampIcon} />
      </div>

      <p
        className={cn(
          'mt-3 text-xs text-balance',
          locked
            ? 'text-muted-foreground'
            : card.completed
              ? 'font-semibold text-(--brand-accent)'
              : 'text-muted-foreground',
        )}
      >
        {!locked && card.completed ? (
          <PartyPopper className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
        ) : null}
        {locked && requiredTiers ? lockedLine(card, requiredTiers) : progressLine(card)}
      </p>

      {claimable ? (
        <button
          type="button"
          onClick={onClaim}
          disabled={busy || blocked}
          title={blocked ? 'Primero usá o cancelá el canje que ya tenés abierto' : undefined}
          className="press-lift mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-(--brand-accent) px-4 text-sm font-semibold text-(--brand-accent-foreground) outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-50"
        >
          <QrCode className="size-4" aria-hidden="true" />
          {busy ? 'Generando código…' : 'Canjear'}
        </button>
      ) : !locked && card.completed ? (
        <p className="mt-3 rounded-xl bg-(--cream-tint) px-3 py-2 text-center text-xs text-muted-foreground">
          Pedilo en la caja y te lo entregan.
        </p>
      ) : null}
    </article>
  )
}

export function PunchCards({
  cards,
  tenantName,
  qrToken,
  blocked,
  onIssued,
}: {
  cards: PunchCard[]
  tenantName: string
  qrToken: string
  /** Ya hay un canje activo: la RPC permite uno solo por vez. */
  blocked: boolean
  onIssued: (ticket: WalletTicket) => void
}): React.JSX.Element | null {
  if (cards.length === 0) return null

  return (
    <section aria-labelledby="punch-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="punch-heading" className="font-display text-lg font-semibold tracking-tight">
          Tus tarjetas de {tenantName}
        </h2>
        <p className="text-xs text-muted-foreground">
          Cada vez que venís te sellamos. Completá la tarjeta y el premio es tuyo.
        </p>
      </div>
      <div className="space-y-3">
        {cards.map((card) => (
          <PunchCardRow
            key={card.templateId}
            card={card}
            qrToken={qrToken}
            blocked={blocked}
            onIssued={onIssued}
          />
        ))}
      </div>
    </section>
  )
}
