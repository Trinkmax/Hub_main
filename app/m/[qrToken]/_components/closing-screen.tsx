'use client'

import { CheckCircle2, PartyPopper, Sparkles, Star } from 'lucide-react'
import { motion } from 'motion/react'
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

  return (
    <div className="relative min-h-[100dvh] overflow-hidden">
      {/* Background hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-emerald-100/40 via-amber-50/30 to-transparent dark:from-emerald-950/40 dark:via-amber-950/20"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-32 -z-10 size-72 rounded-full bg-amber-300/30 blur-3xl dark:bg-amber-600/15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 top-72 -z-10 size-72 rounded-full bg-emerald-300/30 blur-3xl dark:bg-emerald-700/15"
      />

      <div className="mx-auto max-w-md space-y-6 px-5 py-10 text-center">
        {/* CHECK ANIMADO */}
        <motion.div
          initial={{ scale: 0, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.05 }}
          className="mx-auto flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-xl ring-4 ring-emerald-100 dark:ring-emerald-950/40"
        >
          <CheckCircle2 className="size-10" strokeWidth={2.5} />
        </motion.div>

        {/* TITLE */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-400">
            {tenantName}
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight">
            ¡Gracias por venir!
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            La cuenta de {tableLabel} quedó cobrada.
          </p>
        </motion.div>

        {/* RESUMEN DE LA CUENTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          className="card-hairline rounded-2xl border bg-card/95 p-5 text-left shadow-md backdrop-blur"
        >
          <div className="flex items-baseline justify-between border-b border-border/60 pb-3">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Tu cuenta</span>
            <span className="font-serif text-2xl font-semibold tabular-nums">
              {ARSFormat(myTotal)}
            </span>
          </div>
          {myItems.length > 0 ? (
            <ul className="mt-3 space-y-1.5 text-sm">
              {myItems.map((it) => (
                <li key={it.id} className="flex justify-between gap-2 text-muted-foreground">
                  <span>
                    <span className="font-medium text-foreground">{it.quantity}×</span>{' '}
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
            <div className="space-y-4 rounded-2xl border border-amber-300/50 bg-gradient-to-br from-amber-50 via-amber-50/80 to-orange-100/60 p-5 text-left shadow-md dark:from-amber-950/30 dark:via-amber-950/20 dark:to-orange-950/30">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
                    <Star className="size-4 fill-white" />
                  </span>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      Hola, {loyalty.first_name}
                    </p>
                    <p className="text-xs text-amber-900/70 dark:text-amber-200/80">
                      Acumulaste hoy
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-serif text-3xl font-semibold tabular-nums text-amber-950 dark:text-amber-100">
                    {loyalty.points_balance ?? 0}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    puntos
                  </p>
                </div>
              </div>

              {loyalty.active_cards && loyalty.active_cards.length > 0 && (
                <div className="space-y-3 border-t border-amber-300/40 pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    Tus tarjetas
                  </p>
                  {loyalty.active_cards.map((c) => {
                    const pct = Math.min(100, (c.current_stamps / c.threshold) * 100)
                    const done = c.current_stamps >= c.threshold
                    return (
                      <div key={c.card_id} className="space-y-1.5">
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-medium text-amber-950 dark:text-amber-100">
                            {c.template_name}
                          </span>
                          <span className="font-mono tabular-nums text-amber-900/70 dark:text-amber-200/80">
                            {c.current_stamps}/{c.threshold}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-amber-100/60 dark:bg-amber-900/30">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.8, delay: 0.7 }}
                            className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-400 to-orange-500'}`}
                          />
                        </div>
                        {done && (
                          <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
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
            <div className="flex items-center gap-3 rounded-2xl border border-amber-300/50 bg-amber-50/70 p-4 text-left shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30">
              <Sparkles className="size-5 text-amber-600" />
              <p className="text-sm text-amber-900 dark:text-amber-100">
                Tus puntos ya están sumados. ¡Nos vemos pronto!
              </p>
            </div>
          ) : (
            <div className="space-y-2 rounded-2xl border border-dashed border-border/70 bg-card/60 p-5 text-left shadow-sm">
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
          Te esperamos pronto en {tenantName} ✨
        </motion.p>
      </div>
    </div>
  )
}
