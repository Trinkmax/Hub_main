'use client'

import {
  BadgeCheck,
  CircleCheck,
  Clock3,
  type LucideIcon,
  PackageCheck,
  RotateCcw,
  TriangleAlert,
  User2,
  XCircle,
} from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { StorageImage } from '@/components/media/storage-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { emptyStateParts } from '@/components/ui/empty-state'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/dates'
import { formatNumber } from '@/lib/format/number-kind'
import { deliverRedemption, lookupRedemption, type RedemptionView } from '@/lib/redemptions/actions'
import { cn } from '@/lib/utils'

// Pantalla de validación de un canje: qué hay que entregar, a quién, y el botón
// de entregar. Los puntos se descuentan RECIÉN acá (lo hace la RPC), así que
// este botón es el único momento sensible del flujo.
//
// El caso "ya entregado" no va por toast: es la trampa clásica del mostrador
// (alguien vuelve con el mismo código) y tiene que gritar en rojo, con la hora y
// el nombre de quién lo entregó, para que el que atiende no dude.
//
// La usa la caja del panel (/acreditar). El salón tiene su copia congelada en
// `components/legacy/loyalty`.

const FRAME_TONE = {
  danger: {
    box: 'border-destructive bg-destructive-soft',
    text: 'text-destructive-text',
  },
  warning: {
    box: 'border-warning bg-warning-soft',
    text: 'text-warning-text',
  },
} as const

/**
 * El cartel de un canje que no se puede entregar. Más grande que un `Callout`
 * a propósito: es el único aviso del flujo que tiene que frenar al que atiende.
 * Fondo suave + ícono + título del tono, sin mayúsculas gritonas.
 */
function Frame({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: keyof typeof FRAME_TONE
  icon: LucideIcon
  title: string
  children: React.ReactNode
}) {
  const styles = FRAME_TONE[tone]
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center rounded-xl border p-6 text-center', styles.box)}
    >
      <Icon className={cn('size-10', styles.text)} strokeWidth={1.75} aria-hidden="true" />
      <h2 className={cn('mt-3 type-section', styles.text)}>{title}</h2>
      <div className="mt-2 max-w-sm type-body text-pretty text-foreground">{children}</div>
    </div>
  )
}

export function RedemptionPanel({
  tenantSlug,
  redeemToken,
  onReset,
}: {
  tenantSlug: string
  redeemToken: string
  /** Volver al escáner (limpia el token de la pantalla). */
  onReset: () => void
}): React.JSX.Element {
  const [view, setView] = useState<RedemptionView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [delivered, setDelivered] = useState<{
    customerName: string
    rewardName: string | null
  } | null>(null)
  const [busy, startDeliver] = useTransition()

  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await lookupRedemption(tenantSlug, redeemToken)
      if (!alive) return
      if (!r.ok) {
        setError(r.message)
        return
      }
      setError(null)
      setView(r.redemption)
    })()
    return () => {
      alive = false
    }
  }, [tenantSlug, redeemToken])

  const onDeliver = () => {
    startDeliver(async () => {
      const r = await deliverRedemption(tenantSlug, redeemToken)
      if (!r.ok) {
        toast.error(r.message)
        // Releemos: si falló porque alguien lo entregó en el medio, la pantalla
        // tiene que pasar al cartel rojo y no quedar ofreciendo el botón.
        const again = await lookupRedemption(tenantSlug, redeemToken)
        if (again.ok) setView(again.redemption)
        return
      }
      setDelivered({ customerName: r.customerName, rewardName: r.rewardName })
    })
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <Frame tone="warning" icon={TriangleAlert} title="No pudimos leerlo">
          <p>{error}</p>
        </Frame>
        <Button size="lg" onClick={onReset} className="w-full">
          <RotateCcw aria-hidden="true" />
          Escanear otro código
        </Button>
      </div>
    )
  }

  if (delivered) {
    return (
      <Card padding="lg" className="items-center text-center" role="status">
        <div className={cn(emptyStateParts.disc, 'mb-0 bg-success-soft text-success-text')}>
          <CircleCheck className={emptyStateParts.icon} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className={emptyStateParts.title}>Entregado</h2>
          <p className="max-w-sm type-body text-pretty text-muted-foreground">
            {delivered.rewardName ?? 'El beneficio'} para {delivered.customerName}.
          </p>
        </div>
        <Button size="lg" onClick={onReset} className="w-full">
          <RotateCcw aria-hidden="true" />
          Validar otro
        </Button>
      </Card>
    )
  }

  if (!view) {
    return (
      <Card padding="none" className="gap-0 overflow-hidden" aria-busy="true">
        <span role="status" className="sr-only">
          Leyendo el código…
        </span>
        <Skeleton aria-hidden="true" className="aspect-video w-full rounded-none" />
        <div aria-hidden="true" className="flex flex-col gap-3 p-4 sm:p-6">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-6 w-56 max-w-full" />
          <SkeletonText lines={2} />
        </div>
      </Card>
    )
  }

  const blocked =
    view.status === 'delivered' || view.status === 'cancelled' || view.expired
      ? view.status === 'delivered'
        ? 'delivered'
        : view.status === 'cancelled'
          ? 'cancelled'
          : 'expired'
      : null

  return (
    <div className="flex flex-col gap-4">
      <Card padding="none" className="gap-0 overflow-hidden">
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          {view.rewardImageUrl ? (
            <StorageImage src={view.rewardImageUrl} sizes="(max-width: 640px) 100vw, 576px" />
          ) : (
            <div className="grid size-full place-items-center">
              <PackageCheck
                className="size-12 text-subtle-foreground"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 p-4 sm:p-6">
          <div className="flex flex-col gap-1">
            <p className="type-label text-muted-foreground">Hay que entregar</p>
            <h2 className="type-section text-balance">{view.rewardName ?? 'Beneficio'}</h2>
          </div>

          <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
            <User2 className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate type-body font-medium">{view.customerName}</p>
              <p className="type-caption text-muted-foreground">
                <span className="type-amount">{formatNumber(view.customerPointsBalance)}</span> pts
                disponibles
              </p>
            </div>
            <Badge tone="gold" size="md" className="type-amount">
              −{formatNumber(view.pointsSpent)} pts
            </Badge>
          </div>

          {view.notes ? (
            <p className="type-small text-pretty text-muted-foreground">{view.notes}</p>
          ) : null}
        </div>
      </Card>

      {blocked === 'delivered' ? (
        <Frame tone="danger" icon={XCircle} title="Ya entregado">
          <p className="font-semibold">
            <span className="type-amount">
              {view.deliveredAt ? formatDateTime(view.deliveredAt) || 'Sin fecha' : 'Sin fecha'}
            </span>
            {view.deliveredByName ? ` · por ${view.deliveredByName}` : ''}
          </p>
          <p className="mt-1">No lo entregues de nuevo.</p>
        </Frame>
      ) : blocked === 'cancelled' ? (
        <Frame tone="warning" icon={XCircle} title="Canje cancelado">
          <p>El socio lo canceló. Que lo genere de nuevo si lo quiere.</p>
        </Frame>
      ) : blocked === 'expired' ? (
        <Frame tone="warning" icon={Clock3} title="Código vencido">
          <p>Pedile al socio que toque «Generar otro código» en su billetera.</p>
        </Frame>
      ) : (
        <Button
          type="button"
          size="lg"
          onClick={onDeliver}
          loading={busy}
          loadingText="Entregando…"
          className="w-full"
        >
          <BadgeCheck aria-hidden="true" />
          Entregar
        </Button>
      )}

      <Button variant="ghost" onClick={onReset} className="w-full">
        <RotateCcw aria-hidden="true" />
        Escanear otro código
      </Button>
    </div>
  )
}
