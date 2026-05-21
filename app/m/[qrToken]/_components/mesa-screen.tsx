'use client'

import { Receipt, ShoppingBag, Sparkles, Star, UserCircle2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  joinSession,
  refreshState,
  requestBill,
  type SessionStateData,
} from '@/lib/m-session/actions'
import { getOrCreateBrowserToken } from '@/lib/m-session/browser-token'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { cn } from '@/lib/utils'
import { CartSheet } from './cart-sheet'
import { ClosingScreen } from './closing-screen'
import { MenuList } from './menu-list'
import { MyOrdersPane } from './my-orders-pane'
import { RegisterDialog } from './register-dialog'

export type CartItem = {
  menuItemId: string
  name: string
  unitPriceCents: number
  quantity: number
  notes: string | null
}

function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

export function MesaScreen({
  qrToken,
  tableLabel,
  tenantName,
}: {
  qrToken: string
  tableLabel: string
  tenantName: string
}) {
  const [browserToken, setBrowserToken] = useState<string | null>(null)
  const [state, setState] = useState<SessionStateData | null>(null)
  const [showRegister, setShowRegister] = useState(false)
  const [showCart, setShowCart] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [billPending, setBillPending] = useState(false)
  const [billRequested, setBillRequested] = useState(false)
  const [paid, setPaid] = useState(false)
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    setBrowserToken(getOrCreateBrowserToken())
  }, [])

  useEffect(() => {
    if (!browserToken) return
    let cancelled = false
    void (async () => {
      const join = await joinSession({ qrToken, browserToken, displayName: null })
      if (cancelled) return
      if (!join.ok) {
        setError(join.message)
        toast.error(join.message)
        return
      }
      const fresh = await refreshState({ qrToken, browserToken })
      if (cancelled) return
      if (fresh.ok) {
        setState(fresh.data)
        sessionIdRef.current = fresh.data.session_id
      } else {
        setError(fresh.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [browserToken, qrToken])

  useEffect(() => {
    if (!state || !browserToken) return
    const sessionId = state.session_id
    const refresh = async () => {
      const r = await refreshState({ qrToken, browserToken })
      if (r.ok) setState(r.data)
    }
    const cleanup = subscribeChanges({
      channel: `m-${sessionId}`,
      events: [
        {
          event: '*',
          table: 'tickets',
          filter: `session_id=eq.${sessionId}`,
          onChange: () => void refresh(),
        },
        { event: '*', table: 'ticket_items', onChange: () => void refresh() },
        {
          event: 'UPDATE',
          table: 'table_sessions',
          filter: `id=eq.${sessionId}`,
          onChange: (payload: unknown) => {
            const p = payload as { new?: { status?: string } } | null
            if (p?.new?.status === 'paid') setPaid(true)
          },
        },
      ],
    })
    return cleanup
  }, [state, browserToken, qrToken])

  const addToCart = useCallback((item: CartItem) => {
    setCart((prev) => {
      const ix = prev.findIndex((c) => c.menuItemId === item.menuItemId && c.notes === item.notes)
      if (ix >= 0) {
        const next = [...prev]
        const cur = next[ix]
        if (cur) next[ix] = { ...cur, quantity: cur.quantity + item.quantity }
        return next
      }
      return [...prev, item]
    })
    toast.success(`Agregado: ${item.name}`)
  }, [])

  const updateCartItem = useCallback((index: number, patch: Partial<CartItem>) => {
    setCart((prev) => {
      const next = [...prev]
      const cur = next[index]
      if (!cur) return prev
      const updated = { ...cur, ...patch }
      if (updated.quantity <= 0) {
        next.splice(index, 1)
      } else {
        next[index] = updated
      }
      return next
    })
  }, [])

  const cartCount = cart.reduce((acc, c) => acc + c.quantity, 0)
  const cartTotalCents = useMemo(
    () => cart.reduce((sum, c) => sum + c.unitPriceCents * c.quantity, 0),
    [cart],
  )

  const handleRequestBill = useCallback(async () => {
    if (!browserToken) return
    setBillPending(true)
    const r = await requestBill({ qrToken, browserToken })
    setBillPending(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    setBillRequested(true)
    if (r.alreadyRequested) {
      toast.info('Ya le avisaste al mozo. Vamos en camino.')
    } else {
      toast.success('Listo, el mozo viene con la cuenta.')
    }
  }, [browserToken, qrToken])

  const refreshAfterSubmit = useCallback(async () => {
    if (!browserToken) return
    const r = await refreshState({ qrToken, browserToken })
    if (r.ok) setState(r.data)
  }, [browserToken, qrToken])

  if (error && !state) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
          <span className="text-3xl">😕</span>
        </div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">
          No pudimos abrir tu mesa
        </h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        <p className="mt-4 text-xs text-muted-foreground">
          Pedile al mozo que te ayude o escaneá el QR otra vez.
        </p>
      </div>
    )
  }

  if (paid) {
    return (
      <ClosingScreen
        qrToken={qrToken}
        browserToken={browserToken}
        tenantName={tenantName}
        tableLabel={tableLabel}
        state={state}
      />
    )
  }

  return (
    <div className="relative min-h-[100dvh] pb-32">
      {/* Hero gradient background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-primary/15 via-primary/5 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-12 -z-10 size-64 rounded-full bg-[--cream-tint] opacity-50 blur-3xl"
      />

      <div className="mx-auto max-w-md px-4 pt-6">
        {/* HEADER */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="mb-5 text-center"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/80">
            {tenantName}
          </p>
          <h1 className="mt-1.5 font-serif text-[28px] font-semibold leading-tight tracking-tight">
            {tableLabel}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Pedí desde tu celu · pagás en la mesa
          </p>
        </motion.header>

        {/* CTA / STATUS de puntos */}
        <AnimatePresence mode="wait">
          {state && !state.customer_id ? (
            <motion.button
              key="cta"
              type="button"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.25 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowRegister(true)}
              className="group relative mb-4 flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-amber-300/40 bg-gradient-to-br from-amber-50 via-amber-50/80 to-orange-100/60 p-4 text-left shadow-sm transition-shadow hover:shadow-md dark:from-amber-950/30 dark:via-amber-950/20 dark:to-orange-950/30"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-amber-200/40 blur-2xl dark:bg-amber-700/20"
              />
              <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md ring-2 ring-white/60 dark:ring-amber-900/40">
                <Star className="size-5 fill-white" />
              </span>
              <div className="relative min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-tight text-amber-950 dark:text-amber-100">
                  Sumá puntos en {tenantName}
                </p>
                <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/80">
                  Cada consumo te da beneficios. Registrate en 20s.
                </p>
              </div>
              <span className="relative text-xs font-semibold text-amber-900 dark:text-amber-200">
                Sumarme →
              </span>
            </motion.button>
          ) : state?.customer_id ? (
            <motion.div
              key="registered"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="mb-4 flex items-center gap-2.5 rounded-2xl border border-emerald-300/50 bg-emerald-50/70 px-3.5 py-2.5 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/30"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                <UserCircle2 className="size-4" />
              </span>
              <div className="flex-1 text-sm">
                <span className="font-medium text-emerald-900 dark:text-emerald-100">
                  Sumando puntos
                </span>
                <span className="text-emerald-700/70 dark:text-emerald-300/70">
                  {' '}
                  · {tenantName}
                </span>
              </div>
              <Sparkles className="size-4 text-emerald-600 dark:text-emerald-400" />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* TABS */}
        <Tabs defaultValue="menu" className="w-full">
          <TabsList className="grid h-12 w-full grid-cols-2 rounded-xl border bg-card/60 p-1 shadow-sm">
            <TabsTrigger
              value="menu"
              className="rounded-lg text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Carta
            </TabsTrigger>
            <TabsTrigger
              value="orders"
              className="rounded-lg text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Mis órdenes
              {state && state.my_tickets.length > 0 ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground"
                >
                  {state.my_tickets.length}
                </motion.span>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="menu" className="mt-5">
            {state ? <MenuList categories={state.menu} onAdd={addToCart} /> : <MenuSkeleton />}
          </TabsContent>

          <TabsContent value="orders" className="mt-5">
            {state && browserToken ? (
              <MyOrdersPane
                tickets={state.my_tickets}
                browserToken={browserToken}
                onCancelled={refreshAfterSubmit}
              />
            ) : (
              <p className="text-center text-sm text-muted-foreground">Cargando…</p>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* BOTTOM ACTION BAR */}
      <AnimatePresence>
        {state && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75"
          >
            <div className="mx-auto flex max-w-md items-center gap-2">
              <Button
                variant="outline"
                onClick={handleRequestBill}
                disabled={billPending || billRequested}
                className={cn(
                  'h-12 flex-1 gap-1.5 text-sm font-medium',
                  billRequested &&
                    'border-emerald-500/40 bg-emerald-50/50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
                )}
              >
                <Receipt className="size-4" />
                {billRequested ? 'Avisado al mozo' : 'Pedir la cuenta'}
              </Button>
              <Button
                onClick={() => setShowCart(true)}
                disabled={cart.length === 0}
                className="h-12 flex-[1.2] gap-2 text-sm font-semibold"
              >
                <ShoppingBag className="size-4" />
                {cart.length === 0 ? (
                  <span>Carrito</span>
                ) : (
                  <>
                    <span className="rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[11px] tabular-nums">
                      {cartCount}
                    </span>
                    <span className="tabular-nums">{ARSFormat(cartTotalCents)}</span>
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DIALOGS */}
      {state && showRegister && browserToken && (
        <RegisterDialog
          qrToken={qrToken}
          browserToken={browserToken}
          tenantName={tenantName}
          onClose={() => setShowRegister(false)}
          onRegistered={() => {
            setShowRegister(false)
            void refreshAfterSubmit()
            toast.success('¡Listo! Estás sumando puntos.')
          }}
        />
      )}

      {state && showCart && browserToken && (
        <CartSheet
          qrToken={qrToken}
          browserToken={browserToken}
          cart={cart}
          onUpdate={updateCartItem}
          onClose={() => setShowCart(false)}
          onSubmitted={() => {
            setCart([])
            setShowCart(false)
            void refreshAfterSubmit()
            toast.success('Pedido enviado. Esperando confirmación del mozo.')
          }}
        />
      )}
    </div>
  )
}

function MenuSkeleton() {
  return (
    <div className="space-y-5">
      {['skel-1', 'skel-2'].map((k) => (
        <div key={k} className="space-y-2">
          <div className="h-5 w-32 animate-pulse rounded-md bg-muted" />
          <div className="space-y-2">
            {['a', 'b', 'c'].map((kk) => (
              <div
                key={`${k}-${kk}`}
                className="flex items-center gap-3 rounded-xl border bg-card/40 p-3"
              >
                <div className="size-14 shrink-0 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted/70" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
