'use client'

import { Check, PartyPopper, Plus, Stamp } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
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
// Lo usan la caja del panel (/acreditar) y la reserva del operativo. El salón
// tiene su copia congelada en `components/legacy/loyalty`.

type Props = {
  tenantSlug: string
  customerId: string
  customerName: string
  /**
   * Default `true`: en su propia tarjeta (Acreditar). `false` cuando ya vive
   * adentro de otra superficie (el panel de la reserva): una tarjeta nunca va
   * adentro de otra.
   */
  framed?: boolean
  /** Nivel del título «Tarjetas de sellos» según dónde se monte. Default 2. */
  headingLevel?: 2 | 3 | 4
}

const HEADING_TAG = { 2: 'h2', 3: 'h3', 4: 'h4' } as const

function StampDots({
  current,
  threshold,
  justStamped,
}: {
  current: number
  threshold: number
  /** Índice del sello recién puesto → se marca al llenarse. */
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
            'grid size-6 place-items-center rounded-full',
            'transition-[scale,background-color] duration-(--duration-quick) ease-(--ease-ui) motion-reduce:transition-none',
            i < current
              ? 'bg-primary text-primary-foreground'
              : 'border border-dashed border-input bg-card',
            justStamped === i && 'scale-125',
          )}
        >
          {i < current ? <Check className="size-3.5" strokeWidth={2.5} /> : null}
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
      <li className="py-3 first:pt-0 last:pb-0">
        <div className="flex flex-col items-center gap-1 rounded-lg bg-gold-soft p-4 text-center">
          <PartyPopper className="size-5 text-gold-text" aria-hidden="true" />
          <p className="type-body font-semibold text-foreground">¡Tarjeta completa!</p>
          <p className="max-w-sm type-caption text-pretty text-muted-foreground">
            {prize ? `Ya puede retirar ${prize}.` : `Completó ${card.templateName}.`} Le aparece en
            su billetera para generar el QR.
          </p>
        </div>
      </li>
    )
  }

  return (
    <li className="flex flex-col gap-2.5 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate type-body font-medium">{card.templateName}</p>
          <p className="type-caption text-muted-foreground">
            <span className="type-amount">
              {card.currentStamps} de {card.threshold}
            </span>
            {prize ? ` · ${prize}` : ''}
          </p>
        </div>
        <Button
          type="button"
          onClick={onStamp}
          loading={busy}
          className="shrink-0"
          aria-label={`Sellar ${card.templateName}`}
        >
          <Plus aria-hidden="true" />1
        </Button>
      </div>
      <StampDots
        current={card.currentStamps}
        threshold={card.threshold}
        justStamped={justStamped}
      />
    </li>
  )
}

export function PunchStamper({
  tenantSlug,
  customerId,
  customerName,
  framed = true,
  headingLevel = 2,
}: Props): React.JSX.Element {
  const [cards, setCards] = useState<WalletPunchCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, startLoad] = useTransition()
  const titleId = useId()
  // La respuesta de un socio anterior (se escaneó otro QR en el medio) no pisa al actual.
  const requestRef = useRef(0)

  const load = useCallback(() => {
    requestRef.current += 1
    const request = requestRef.current
    startLoad(async () => {
      const r = await listCustomerCards(tenantSlug, customerId)
      if (request !== requestRef.current) return
      if (!r.ok) {
        setError(r.message)
        return
      }
      setError(null)
      setCards(r.cards)
    })
  }, [tenantSlug, customerId])

  useEffect(() => {
    load()
    return () => {
      // Al desmontar o cambiar de socio, lo que llegue tarde se descarta.
      requestRef.current += 1
    }
  }, [load])

  const onUpdate = (next: WalletPunchCard) => {
    setCards((prev) => (prev ?? []).map((c) => (c.templateId === next.templateId ? next : c)))
  }

  const Heading = HEADING_TAG[headingLevel]

  let body: React.ReactNode
  if (error) {
    body = (
      <ErrorState
        size="sm"
        title="No pudimos traer las tarjetas"
        description={error}
        onRetry={load}
        className="py-4"
      />
    )
  } else if (cards === null) {
    body = (
      <div aria-hidden="true" className="flex flex-col gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-36 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-(--control-md) w-14" />
          </div>
        ))}
      </div>
    )
  } else if (cards.length === 0) {
    body = (
      <EmptyState
        size="sm"
        icon={Stamp}
        title="Sin tarjetas de sellos"
        description="Este bar todavía no tiene tarjetas de sellos activas."
        className="py-4"
      />
    )
  } else {
    body = (
      <ul className="divide-y divide-border">
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
    )
  }

  const content = (
    <>
      <div className="flex items-center gap-2">
        <Stamp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Heading id={titleId} className="type-subtitle">
          Tarjetas de sellos
        </Heading>
        {loading ? <Spinner size={14} label={`Buscando las tarjetas de ${customerName}…`} /> : null}
      </div>
      {body}
    </>
  )

  if (framed) {
    return (
      <Card asChild>
        <section aria-labelledby={titleId}>{content}</section>
      </Card>
    )
  }
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      {content}
    </section>
  )
}
