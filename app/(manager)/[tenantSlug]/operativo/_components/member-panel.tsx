'use client'

import { Check, Loader2, Sparkles, Stamp, TriangleAlert, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { formatPhoneForDisplay } from '@/lib/phone'
import type { EarnRate } from '@/lib/points/earn-rate'
import { describeEarnRate, pesosToCents, previewPoints } from '@/lib/points/preview'
import type { RecentQrAward } from '@/lib/points/queries'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { PunchStamper } from '../../acreditar/_components/punch-stamper'
import type { BoardActions } from './operativo-board'

function fmtPesos(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function fmtStamp(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Cordoba',
  }).format(new Date(iso))
}

/**
 * El socio detrás de la reserva, y el momento de sumarle puntos.
 *
 * Con socio: nivel, saldo, y si ya sumó esta noche. "Sumar puntos" abre el
 * monto en pesos con la devolución en vivo (cuántos puntos suma) y al
 * confirmar el saldo cuenta hasta el nuevo. Sin socio pero con teléfono: se
 * vincula (o se crea) con un toque. El anfitrión ve todo en lectura: los
 * puntos los suma caja (roles de la RPC).
 */
export function MemberPanel({
  tenantSlug,
  reservation: r,
  award,
  earnRate,
  canAward,
  canLink,
  actions,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  award: RecentQrAward | null
  earnRate: EarnRate | null
  canAward: boolean
  /** Puede vincular/crear el socio (STAFF); el anfitrión sí, aunque no sume puntos. */
  canLink: boolean
  actions: BoardActions
}) {
  const customer = r.customer ?? null
  const [mode, setMode] = useState<'idle' | 'amount' | 'success' | 'stamps'>('idle')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [last, setLast] = useState<{ points: number; balance: number } | null>(null)

  const cents = useMemo(() => pesosToCents(amount), [amount])
  const points = useMemo(() => previewPoints(cents ?? 0, earnRate), [cents, earnRate])
  const rateLabel = describeEarnRate(earnRate)
  const noRules = earnRate === null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customer || cents === null || busy) return
    setBusy(true)
    const res = await actions.award(r.id, customer.id, cents)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    setLast({ points: res.points, balance: res.newBalance })
    setAmount('')
    setMode('success')
  }

  // ── Sin socio ──────────────────────────────────────────────────────
  if (!customer) {
    const phone = r.guest_phone
    return (
      <section aria-label="Club" className="rounded-2xl border border-dashed border-border/80 p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Club
        </p>
        {phone ? (
          <>
            <p className="mt-1 text-sm">
              Esta reserva no está vinculada a un socio.{' '}
              <span className="text-muted-foreground">
                Con el teléfono {formatPhoneForDisplay(phone)} se busca o se crea la ficha.
              </span>
            </p>
            {canLink ? (
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-11 w-full gap-2 rounded-xl"
                disabled={linking}
                onClick={async () => {
                  setLinking(true)
                  await actions.linkCustomer(r.id)
                  setLinking(false)
                }}
              >
                {linking ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <UserPlus className="size-4" aria-hidden />
                )}
                Vincular al club
              </Button>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Lo vincula caja al cobrar.</p>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Sin teléfono no hay socio que vincular. Cargalo desde la edición completa o escaneá su
            QR en Acreditar.
          </p>
        )}
      </section>
    )
  }

  const tierColor = customer.tier?.color ?? 'var(--primary)'

  return (
    <section
      aria-label="Club"
      className="overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card to-secondary/40"
    >
      <div className="flex items-center gap-3 p-4">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold"
          style={{
            backgroundColor: `color-mix(in oklch, ${tierColor} 16%, transparent)`,
            color: tierColor,
          }}
          aria-hidden
        >
          {customer.first_name.charAt(0)}
          {customer.last_name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate font-semibold">
              {customer.first_name} {customer.last_name}
            </span>
            {customer.tier ? (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  backgroundColor: `color-mix(in oklch, ${tierColor} 16%, transparent)`,
                  color: tierColor,
                }}
              >
                {customer.tier.name}
              </span>
            ) : null}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {formatPhoneForDisplay(customer.phone)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Puntos</p>
          <p className="font-serif text-2xl font-semibold leading-none tabular-nums">
            {customer.points_balance.toLocaleString('es-AR')}
          </p>
        </div>
      </div>

      {award && mode !== 'success' ? (
        <p className="flex items-center gap-1.5 border-t border-border/60 bg-primary/5 px-4 py-2 text-xs">
          <Sparkles className="size-3.5 text-primary" aria-hidden />
          <span>
            Ya sumó <strong className="tabular-nums">+{award.points} pts</strong> a las{' '}
            <span className="font-mono tabular-nums">{fmtStamp(award.created_at)}</span>
            {award.amount_cents > 0 ? (
              <span className="text-muted-foreground"> · {fmtPesos(award.amount_cents)}</span>
            ) : null}
          </span>
        </p>
      ) : null}

      {canAward ? (
        <div className="border-t border-border/60 p-3">
          {mode === 'idle' ? (
            <div className="flex gap-2">
              <Button
                type="button"
                className="h-12 flex-1 gap-2 rounded-xl"
                onClick={() => setMode('amount')}
              >
                <Sparkles className="size-4" aria-hidden />
                {award ? 'Sumar otra consumición' : 'Sumar puntos'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-12 gap-2 rounded-xl"
                onClick={() => setMode('stamps')}
                aria-label="Sellar tarjeta"
              >
                <Stamp className="size-4" aria-hidden />
                <span className="hidden sm:inline">Sellar</span>
              </Button>
            </div>
          ) : null}

          {mode === 'amount' ? (
            <form onSubmit={submit} className="space-y-3">
              <label htmlFor={`award-${r.id}`} className="block text-sm font-semibold">
                ¿Cuánto pagó {customer.first_name}?
              </label>
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-serif text-2xl font-semibold text-muted-foreground"
                >
                  $
                </span>
                <input
                  id={`award-${r.id}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="done"
                  // biome-ignore lint/a11y/noAutofocus: el usuario acaba de tocar "Sumar puntos": el foco en el monto es lo esperado
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="0"
                  aria-describedby={`award-hint-${r.id}`}
                  className="h-14 w-full rounded-2xl border border-border/70 bg-card pl-10 pr-4 font-serif text-3xl font-semibold tabular-nums shadow-xs outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
              <p
                id={`award-hint-${r.id}`}
                aria-live="polite"
                className="flex min-h-6 items-center gap-1.5 text-sm"
              >
                {noRules ? (
                  <span className="inline-flex items-center gap-1.5 text-warning-text">
                    <TriangleAlert className="size-4 text-warning" aria-hidden />
                    Este bar todavía no configuró cómo se suman puntos.
                  </span>
                ) : points !== null && points > 0 ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                    <Sparkles className="size-4" aria-hidden />
                    Suma {points.toLocaleString('es-AR')} {points === 1 ? 'punto' : 'puntos'}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {rateLabel ?? 'Según las reglas del Club.'}
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 rounded-xl"
                  onClick={() => {
                    setMode('idle')
                    setAmount('')
                  }}
                  disabled={busy}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="h-12 flex-1 gap-2 rounded-xl"
                  disabled={busy || cents === null || noRules || !points}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  {busy
                    ? 'Sumando…'
                    : points
                      ? `Sumar ${points.toLocaleString('es-AR')} ${points === 1 ? 'punto' : 'puntos'}`
                      : 'Sumar puntos'}
                </Button>
              </div>
            </form>
          ) : null}

          {mode === 'success' && last ? (
            <div className="redeem-done relative overflow-hidden rounded-xl bg-success/10 p-4 text-center">
              <div className="relative mx-auto grid size-14 place-items-center">
                <span aria-hidden className="redeem-ring absolute inset-0 rounded-full" />
                <span
                  aria-hidden
                  className="redeem-ring redeem-ring-2 absolute inset-0 rounded-full"
                />
                <span className="redeem-disc relative grid size-12 place-items-center rounded-full">
                  <svg
                    viewBox="0 0 24 24"
                    className="size-7"
                    fill="none"
                    role="img"
                    aria-label="Puntos sumados"
                  >
                    <path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      className="redeem-check"
                      stroke="currentColor"
                      strokeWidth={2.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
              <p className="redeem-rise mt-2 font-serif text-3xl font-semibold text-success">
                +{last.points.toLocaleString('es-AR')} pts
              </p>
              <p
                className="redeem-rise text-xs text-muted-foreground"
                style={{ '--d': '80ms' } as React.CSSProperties}
              >
                Nuevo saldo:{' '}
                <strong className="tabular-nums text-foreground">
                  {last.balance.toLocaleString('es-AR')}
                </strong>
              </p>
              <div
                className="redeem-rise mt-3 flex justify-center gap-2"
                style={{ '--d': '160ms' } as React.CSSProperties}
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-10 gap-1.5 rounded-xl"
                  onClick={() => setMode('stamps')}
                >
                  <Stamp className="size-4" aria-hidden />
                  Sellar tarjeta
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 rounded-xl"
                  onClick={() => setMode('idle')}
                >
                  <Check className="size-4" aria-hidden />
                  Listo
                </Button>
              </div>
            </div>
          ) : null}

          {mode === 'stamps' ? (
            <div className="space-y-2">
              <PunchStamper
                tenantSlug={tenantSlug}
                customerId={customer.id}
                customerName={customer.first_name}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 w-full rounded-xl"
                onClick={() => setMode('idle')}
              >
                Cerrar
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
          Los puntos los suma caja al cobrar.
        </p>
      )}
    </section>
  )
}
