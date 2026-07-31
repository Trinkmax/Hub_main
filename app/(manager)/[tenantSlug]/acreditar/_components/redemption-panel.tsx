'use client'

import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Loader2,
  PackageCheck,
  RotateCcw,
  User2,
  XCircle,
} from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { StorageImage } from '@/components/media/storage-image'
import { Button } from '@/components/ui/button'
import { deliverRedemption, lookupRedemption, type RedemptionView } from '@/lib/redemptions/actions'

// Pantalla de validación de un canje: qué hay que entregar, a quién, y el botón
// de entregar. Los puntos se descuentan RECIÉN acá (lo hace la RPC), así que
// este botón es el único momento sensible del flujo.
//
// El caso "ya entregado" no va por toast: es la trampa clásica del mostrador
// (alguien vuelve con el mismo código) y tiene que gritar en rojo, con la hora y
// el nombre de quién lo entregó, para que el mozo no dude.
//
// Compartida entre la caja (/acreditar) y el salón (/salon/validar): el mozo y
// el cajero validan igual.

const DATE_FMT = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Cordoba',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : DATE_FMT.format(d).replace(', ', ' ')
}

function Frame({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: 'danger' | 'warning'
  icon: typeof AlertTriangle
  title: string
  children: React.ReactNode
}) {
  const danger = tone === 'danger'
  return (
    <div
      className={
        danger
          ? 'rounded-2xl border-2 border-destructive/60 bg-destructive/10 p-6 text-center'
          : 'rounded-2xl border-2 border-amber-500/60 bg-amber-500/10 p-6 text-center'
      }
    >
      <Icon
        className={danger ? 'mx-auto size-10 text-destructive' : 'mx-auto size-10 text-amber-600'}
        aria-hidden="true"
      />
      <h2
        className={
          danger
            ? 'mt-3 font-display text-xl font-bold uppercase tracking-wide text-destructive'
            : 'mt-3 font-display text-xl font-bold uppercase tracking-wide text-amber-700'
        }
      >
        {title}
      </h2>
      <div className="mt-2 text-sm text-foreground/80">{children}</div>
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
      <div className="space-y-4">
        <Frame tone="warning" icon={AlertTriangle} title="No pudimos leerlo">
          <p className="text-balance">{error}</p>
        </Frame>
        <Button onClick={onReset} className="h-12 w-full gap-2">
          <RotateCcw className="size-4" />
          Escanear otro código
        </Button>
      </div>
    )
  }

  if (delivered) {
    return (
      <div className="card-hairline rounded-2xl border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden="true" />
        <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">Entregado</h2>
        <p className="mt-1 text-sm text-muted-foreground text-balance">
          {delivered.rewardName ?? 'El beneficio'} para {delivered.customerName}.
        </p>
        <Button onClick={onReset} className="mt-6 h-12 w-full gap-2">
          <RotateCcw className="size-4" />
          Validar otro
        </Button>
      </div>
    )
  }

  if (!view) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed p-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Leyendo el código…
      </div>
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
    <div className="space-y-4">
      <div className="card-hairline overflow-hidden rounded-2xl border bg-card">
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-secondary/40">
          {view.rewardImageUrl ? (
            <StorageImage src={view.rewardImageUrl} sizes="(max-width: 640px) 100vw, 576px" />
          ) : (
            <div className="grid size-full place-items-center">
              <PackageCheck className="size-12 text-muted-foreground/40" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="space-y-3 p-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Hay que entregar
            </p>
            <h2 className="font-display text-xl font-semibold leading-tight tracking-tight">
              {view.rewardName ?? 'Beneficio'}
            </h2>
          </div>

          <div className="flex items-center gap-3 rounded-xl bg-secondary/40 p-3">
            <User2 className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{view.customerName}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {view.customerPointsBalance.toLocaleString('es-AR')} pts disponibles
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-card px-2.5 py-1 text-xs font-bold tabular-nums shadow-sm">
              −{view.pointsSpent.toLocaleString('es-AR')} pts
            </span>
          </div>

          {view.notes ? <p className="text-xs text-muted-foreground">{view.notes}</p> : null}
        </div>
      </div>

      {blocked === 'delivered' ? (
        <Frame tone="danger" icon={XCircle} title="Ya entregado">
          <p className="font-semibold tabular-nums">
            {view.deliveredAt ? formatWhen(view.deliveredAt) : 'Sin fecha'}
            {view.deliveredByName ? ` · por ${view.deliveredByName}` : ''}
          </p>
          <p className="mt-1 text-balance">No lo entregues de nuevo.</p>
        </Frame>
      ) : blocked === 'cancelled' ? (
        <Frame tone="warning" icon={XCircle} title="Canje cancelado">
          <p className="text-balance">El socio lo canceló. Que lo genere de nuevo si lo quiere.</p>
        </Frame>
      ) : blocked === 'expired' ? (
        <Frame tone="warning" icon={Clock3} title="Código vencido">
          <p className="text-balance">
            Pedile al socio que toque "Generar otro código" en su billetera.
          </p>
        </Frame>
      ) : (
        <Button
          type="button"
          size="xl"
          onClick={onDeliver}
          disabled={busy}
          className="h-16 w-full gap-2 text-base"
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <BadgeCheck className="size-5" aria-hidden="true" />
          )}
          {busy ? 'Entregando…' : 'Entregar'}
        </Button>
      )}

      <Button variant="ghost" onClick={onReset} className="h-11 w-full gap-2">
        <RotateCcw className="size-4" />
        Escanear otro código
      </Button>
    </div>
  )
}
