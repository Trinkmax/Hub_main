'use client'

import { Check, Clock3, Copy, QrCode, RefreshCw, X } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cancelRedemption, claimPendingRedemption } from '@/lib/wallet/actions'
import { formatCountdown, formatPoints } from './wallet-format'

// El canje pedido, con su QR vivo. Va arriba de todo en la wallet: mientras esté
// abierto es LO ÚNICO que el socio tiene que hacer (mostrarlo).
//
// Los puntos se descuentan cuando el mozo valida, no ahora: por eso el código
// vence y hay un solo canje activo por vez. El vencimiento se cuenta en el
// cliente (el server ya mandó `expiresAt`), y cuando cae mostramos "volver a
// generar" en vez de dejar un QR muerto en pantalla — `claim_pending_redemption`
// es idempotente y le devuelve un token nuevo al MISMO canje pendiente.

export type WalletTicket = {
  redemptionId: string
  rewardName: string
  imageUrl?: string | null
  costPoints: number
  redeemToken: string
  expiresAt: string
  qrDataUrl: string
}

/** Token en grupos de 4 → dictable por teléfono sin perder el renglón. */
function groupToken(token: string): string {
  return (token.match(/.{1,4}/g) ?? [token]).join(' ')
}

export function RedemptionTicket({
  ticket,
  qrToken,
  onCleared,
  onReissued,
}: {
  ticket: WalletTicket
  qrToken: string
  /** El canje dejó de estar activo (cancelado por el socio). */
  onCleared: (redemptionId: string) => void
  /** Se regeneró el código (vencido) → hay ticket nuevo. */
  onReissued: (ticket: WalletTicket) => void
}): React.JSX.Element {
  // `null` hasta montar: el countdown depende de Date.now() y renderizarlo en el
  // server rompería la hidratación con un valor distinto.
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, startAction] = useTransition()

  useEffect(() => {
    const target = new Date(ticket.expiresAt).getTime()
    const tick = () => setRemainingMs(target - Date.now())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [ticket.expiresAt])

  const expired = remainingMs !== null && remainingMs <= 0

  const onCancel = () => {
    startAction(async () => {
      const r = await cancelRedemption({ qrToken, redemptionId: ticket.redemptionId })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success('Cancelamos el canje. Tus puntos siguen intactos.')
      onCleared(ticket.redemptionId)
    })
  }

  const onRegenerate = () => {
    startAction(async () => {
      const r = await claimPendingRedemption({ qrToken, redemptionId: ticket.redemptionId })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      onReissued(r.ticket)
    })
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(ticket.redeemToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('No pudimos copiarlo. Mostrale la pantalla al mozo.')
    }
  }

  return (
    <section
      aria-labelledby="ticket-heading"
      className="overflow-hidden rounded-2xl bg-(--brand-accent) p-5 text-(--brand-accent-foreground) shadow-glow"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <QrCode className="size-5 shrink-0" aria-hidden="true" />
            <h2 id="ticket-heading" className="font-display text-lg font-semibold tracking-tight">
              Tu canje está listo
            </h2>
          </div>
          <p className="mt-1 truncate text-sm font-medium opacity-90">{ticket.rewardName}</p>
        </div>
        {ticket.costPoints > 0 ? (
          <span className="shrink-0 rounded-full bg-(--brand-accent-foreground)/15 px-2.5 py-1 text-[11px] font-bold tabular-nums">
            {formatPoints(ticket.costPoints)} pts
          </span>
        ) : null}
      </div>

      {expired ? (
        <div className="mt-4 rounded-2xl bg-(--brand-accent-foreground)/10 p-5 text-center">
          <Clock3 className="mx-auto size-7 opacity-80" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold">El código venció</p>
          <p className="mt-1 text-xs opacity-85">
            No perdiste nada: tus puntos se descuentan recién cuando te lo entregan.
          </p>
          <Button
            type="button"
            onClick={onRegenerate}
            disabled={busy}
            variant="secondary"
            size="lg"
            className="mt-4 h-12 w-full gap-2"
          >
            <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
            Generar otro código
          </Button>
        </div>
      ) : (
        <>
          <div className="mx-auto mt-4 w-full max-w-[15rem] rounded-2xl bg-white p-3 shadow-sm">
            <Image
              src={ticket.qrDataUrl}
              alt={`Código QR para retirar ${ticket.rewardName}`}
              width={240}
              height={240}
              className="size-full"
              unoptimized
              priority
            />
          </div>

          <p className="mt-3 text-center text-sm font-medium">Mostrale este código al mozo</p>

          <div className="mt-3 rounded-xl bg-(--brand-accent-foreground)/10 p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] opacity-75">
              Si la cámara falla
            </p>
            <p className="mt-1 select-all break-all font-mono text-[15px] font-semibold leading-snug tracking-wide">
              {groupToken(ticket.redeemToken)}
            </p>
            <button
              type="button"
              onClick={onCopy}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-(--brand-accent-foreground)"
            >
              {copied ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              {copied ? 'Copiado' : 'Copiar código'}
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p
              className="inline-flex items-center gap-1.5 text-xs font-medium tabular-nums opacity-90"
              aria-live="off"
            >
              <Clock3 className="size-3.5" aria-hidden="true" />
              {remainingMs === null
                ? 'Vence en unos minutos'
                : `Vence en ${formatCountdown(remainingMs)}`}
            </p>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-(--brand-accent-foreground) disabled:opacity-60"
            >
              <X className="size-3.5" aria-hidden="true" />
              Cancelar canje
            </button>
          </div>
        </>
      )}
    </section>
  )
}
