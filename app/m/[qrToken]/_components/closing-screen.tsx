'use client'

import { CheckCircle2, Gift, PartyPopper, Sparkles, Star } from 'lucide-react'
import { motion } from 'motion/react'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { getLoyaltyState, type LoyaltyState, type SessionStateData } from '@/lib/m-session/actions'

function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

export function ClosingScreen({
  qrToken,
  browserToken,
  tenantName,
  tableLabel,
  state,
}: {
  qrToken: string
  browserToken: string | null
  tenantName: string
  tableLabel: string
  state: SessionStateData | null
}) {
  const [loyalty, setLoyalty] = useState<LoyaltyState | null>(null)

  useEffect(() => {
    if (!browserToken || !state?.customer_id) return
    let cancelled = false
    void (async () => {
      const r = await getLoyaltyState({ qrToken, browserToken })
      if (!cancelled && r.ok) setLoyalty(r.data)
    })()
    return () => {
      cancelled = true
    }
  }, [browserToken, qrToken, state?.customer_id])

  const myTotal = state
    ? state.my_tickets
        .filter((t) => t.status !== 'cancelled')
        .reduce((sum, t) => sum + t.total_cents, 0)
    : 0

  const isRegistered = Boolean(state?.customer_id)
  const myItems = (state?.my_tickets ?? [])
    .filter((t) => t.status !== 'cancelled')
    .flatMap((t) => t.items)
    .filter((it) => !it.cancelled_at)

  const welcomeRedeemed = state?.welcome_reward_redeemed ?? null

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-app-gradient">
      {/* Glows decorativos sutiles */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-32 -z-10 size-72 rounded-full bg-[--forest-glow] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 top-72 -z-10 size-72 rounded-full bg-warning/10 blur-3xl"
      />

      <div className="mx-auto max-w-md space-y-6 px-5 py-10 text-center">
        {/* CHECK ANIMADO */}
        <motion.div
          initial={{ scale: 0, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.05 }}
          className="mx-auto flex size-20 items-center justify-center rounded-full bg-success text-success-foreground shadow-lg ring-4 ring-success/15"
        >
          <CheckCircle2 className="size-10" strokeWidth={2.5} />
        </motion.div>

        {/* TITLE */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary">
            {tenantName}
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight">
            ¡Gracias por venir!
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            La cuenta de {tableLabel} quedó cobrada.
          </p>
        </motion.div>

        {/* WELCOME REWARD REDEEMED — muy visible si aplica */}
        {welcomeRedeemed && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.28 }}
            className="card-hairline overflow-hidden rounded-2xl border border-warning/40 bg-card text-left shadow-md"
          >
            <div className="relative aspect-[16/9] w-full overflow-hidden bg-secondary/40">
              {welcomeRedeemed.image_url ? (
                <Image
                  src={welcomeRedeemed.image_url}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 480px"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                  <Gift className="size-12" aria-hidden />
                </div>
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-card via-card/85 to-transparent"
              />
              <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-warning/95 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning-foreground shadow-sm">
                <Gift className="size-3" aria-hidden />
                Tu regalo
              </span>
            </div>
            <div className="px-5 pt-3 pb-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-warning">
                Regalo de bienvenida
              </p>
              <h2 className="mt-1 font-serif text-xl font-semibold leading-tight tracking-tight">
                {welcomeRedeemed.name}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Mostrále esto al mozo cuando te vayas para que te lo prepare.
              </p>
            </div>
          </motion.div>
        )}

        {/* RESUMEN DE LA CUENTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          className="card-hairline rounded-2xl border border-border/60 bg-card p-5 text-left shadow-md"
        >
          <div className="flex items-baseline justify-between border-b border-border/60 pb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tu cuenta
            </span>
            <span className="font-serif text-2xl font-semibold tabular-nums">
              {ARSFormat(myTotal)}
            </span>
          </div>
          {myItems.length > 0 ? (
            <ul className="mt-3 space-y-1.5 text-sm">
              {myItems.map((it) => (
                <li key={it.id} className="flex justify-between gap-2 text-muted-foreground">
                  <span>
                    <span className="font-medium text-foreground tabular-nums">{it.quantity}×</span>{' '}
                    {it.menu_item_name ?? 'Ítem'}
                  </span>
                  <span className="tabular-nums">{ARSFormat(it.line_total_cents)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Sin consumo registrado a tu nombre.
            </p>
          )}
        </motion.div>

        {/* LOYALTY */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
        >
          {isRegistered && loyalty?.registered ? (
            <div className="card-hairline space-y-4 rounded-2xl border border-border/60 bg-card p-5 text-left shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                    <Star className="size-4 fill-current" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Hola, {loyalty.first_name}
                    </p>
                    <p className="text-xs text-muted-foreground">Tu saldo de puntos</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-serif text-3xl font-semibold tabular-nums leading-none">
                    {loyalty.points_balance ?? 0}
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    puntos
                  </p>
                </div>
              </div>

              {loyalty.active_cards && loyalty.active_cards.length > 0 && (
                <div className="space-y-3 border-t border-border/60 pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Tus tarjetas
                  </p>
                  {loyalty.active_cards.map((c) => {
                    const pct = Math.min(100, (c.current_stamps / c.threshold) * 100)
                    const done = c.current_stamps >= c.threshold
                    return (
                      <div key={c.card_id} className="space-y-1.5">
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-medium">{c.template_name}</span>
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {c.current_stamps}/{c.threshold}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-secondary/80">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.8, delay: 0.7 }}
                            className={
                              done
                                ? 'h-full rounded-full bg-success'
                                : 'h-full rounded-full bg-primary'
                            }
                          />
                        </div>
                        {done && (
                          <p className="flex items-center gap-1 text-[11px] font-medium text-success">
                            <PartyPopper className="size-3" /> Completaste · te ganaste:{' '}
                            <span className="font-semibold">{c.reward_name}</span>
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : isRegistered ? (
            <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-4 text-left shadow-sm">
              <span className="flex size-9 items-center justify-center rounded-full bg-success/15 text-success">
                <Sparkles className="size-4" />
              </span>
              <p className="text-sm">Tus puntos ya están sumados. ¡Nos vemos pronto!</p>
            </div>
          ) : welcomeRedeemed ? null : (
            <div className="space-y-2 rounded-2xl border border-dashed border-border/60 bg-card/60 p-5 text-left shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-muted-foreground" />
                La próxima podés sumar puntos
              </div>
              <p className="text-xs text-muted-foreground">
                Si te registrás antes de pedir, cada consumo te suma. Pedile el QR al mozo o escaneá
                el de tu mesa.
              </p>
            </div>
          )}
        </motion.div>

        {/* OUTRO */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.85 }}
          className="pt-2 text-xs text-muted-foreground"
        >
          Te esperamos pronto en {tenantName}.
        </motion.p>
      </div>
    </div>
  )
}
