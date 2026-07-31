'use client'

import { Check, Loader2, PartyPopper, Plus, Stamp } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { addStampAction } from '@/lib/punch-cards/actions'
import { listCustomerCards } from '@/lib/redemptions/actions'
import { cn } from '@/lib/utils'
import type { WalletPunchCard } from '@/lib/wallet/punch-cards'

// Sellar tarjetas desde la caja: un "+1" por tarjeta y listo. Es la forma de
// sellar que eligió el dueño (nada de escanear una segunda cosa).
//
// Muestra EXACTAMENTE lo mismo que ve el socio en su billetera (mismo loader),
// así no hay discusión en el mostrador: las dos pantallas dicen lo mismo.
//
// Vive acá porque /acreditar es la caja, pero la pantalla de validación del
// salón lo reusa tal cual — el mozo con celular hace lo mismo que el cajero.

type Props = {
  tenantSlug: string
  customerId: string
  customerName: string
}

function StampDots({
  current,
  threshold,
  justStamped,
}: {
  current: number
  threshold: number
  /** Índice del sello recién puesto → se anima al llenarse. */
  justStamped: number | null
}) {
  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="img"
      aria-label={`${current} de ${threshold} sellos`}
    >
      {Array.from({ length: threshold }, (_, i) => i).map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn(
            'grid size-6 place-items-center rounded-full transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]',
            i < current
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'border border-dashed border-border bg-secondary/40',
            justStamped === i && 'scale-125',
          )}
        >
          {i < current ? <Check className="size-3.5" /> : null}
        </span>
      ))}
    </div>
  )
}

function CardRow({
  tenantSlug,
  customerId,
  card,
  onUpdate,
}: {
  tenantSlug: string
  customerId: string
  card: WalletPunchCard
  onUpdate: (next: WalletPunchCard) => void
}) {
  const [busy, startStamp] = useTransition()
  const [justStamped, setJustStamped] = useState<number | null>(null)
  const prize = card.rewardLabel ?? card.rewardName

  const onStamp = () => {
    const optimisticIndex = card.currentStamps
    setJustStamped(optimisticIndex)
    startStamp(async () => {
      const r = await addStampAction(tenantSlug, customerId, card.templateId)
      if (!r.ok) {
        setJustStamped(null)
        toast.error(r.message)
        return
      }
      const stamps = Math.max(0, card.threshold - r.remaining)
      onUpdate({
        ...card,
        currentStamps: r.completed ? card.threshold : stamps,
        remaining: r.completed ? 0 : r.remaining,
        completed: r.completed,
      })
      setTimeout(() => setJustStamped(null), 450)
      if (r.completed) {
        toast.success(`¡${r.templateName} completa!`, {
          description: prize ? `Ya puede retirar ${prize}.` : undefined,
        })
      }
    })
  }

  if (card.completed) {
    return (
      <li className="rounded-xl border border-primary/45 bg-primary/8 p-4 text-center">
        <PartyPopper className="mx-auto size-6 text-primary" aria-hidden="true" />
        <p className="mt-2 text-sm font-semibold">¡Tarjeta completa!</p>
        <p className="mt-0.5 text-xs text-muted-foreground text-balance">
          {prize ? `Ya puede retirar ${prize}.` : `Completó ${card.templateName}.`} Le aparece en su
          billetera para generar el QR.
        </p>
      </li>
    )
  }

  return (
    <li className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{card.templateName}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {card.currentStamps} de {card.threshold}
            {prize ? ` · ${prize}` : ''}
          </p>
        </div>
        <Button
          type="button"
          size="lg"
          onClick={onStamp}
          disabled={busy}
          className="h-11 w-16 shrink-0 gap-1"
          aria-label={`Sellar ${card.templateName}`}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <Plus className="size-4" />1
            </>
          )}
        </Button>
      </div>
      <div className="mt-2.5">
        <StampDots
          current={card.currentStamps}
          threshold={card.threshold}
          justStamped={justStamped}
        />
      </div>
    </li>
  )
}

export function PunchStamper({ tenantSlug, customerId, customerName }: Props): React.JSX.Element {
  const [cards, setCards] = useState<WalletPunchCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, startLoad] = useTransition()

  useEffect(() => {
    let alive = true
    startLoad(async () => {
      const r = await listCustomerCards(tenantSlug, customerId)
      if (!alive) return
      if (!r.ok) {
        setError(r.message)
        return
      }
      setError(null)
      setCards(r.cards)
    })
    return () => {
      alive = false
    }
  }, [tenantSlug, customerId])

  const onUpdate = (next: WalletPunchCard) => {
    setCards((prev) => (prev ?? []).map((c) => (c.templateId === next.templateId ? next : c)))
  }

  if (error) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
        {error}
      </div>
    )
  }

  if (cards === null) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Buscando tarjetas…
      </div>
    )
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-center">
        <Stamp className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground text-balance">
          Este bar todavía no tiene tarjetas de sellos activas.
        </p>
      </div>
    )
  }

  return (
    <section aria-label={`Tarjetas de sellos de ${customerName}`} className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Stamp className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold tracking-tight">Tarjetas de sellos</h3>
        {loading ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
      </div>
      <ul className="space-y-2">
        {cards.map((card) => (
          <CardRow
            key={card.templateId}
            tenantSlug={tenantSlug}
            customerId={customerId}
            card={card}
            onUpdate={onUpdate}
          />
        ))}
      </ul>
    </section>
  )
}
