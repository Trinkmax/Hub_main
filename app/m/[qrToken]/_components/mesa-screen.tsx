'use client'

import { Gift, ImageOff, Receipt, ShoppingBag, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type ActiveSessionStateData,
  joinSession,
  type RegisterCustomerResult,
  refreshState,
  requestBill,
} from '@/lib/m-session/actions'
import { getOrCreateBrowserToken } from '@/lib/m-session/browser-token'
import { isCaptureSeen, markCaptureSeen } from '@/lib/m-session/capture-dismissal'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { cn } from '@/lib/utils'
import { CapturePromptCard } from './capture-prompt-card'
import { CaptureSheet } from './capture-sheet'
import { CartSheet } from './cart-sheet'
import { ClosingScreen } from './closing-screen'
import { MenuHub } from './menu-hub'
import { MyOrdersPane } from './my-orders-pane'
import { OrderConfirmation } from './order-confirmation'

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
  const router = useRouter()
  const [browserToken, setBrowserToken] = useState<string | null>(null)
  const [state, setState] = useState<ActiveSessionStateData | null>(null)
  const [showRegister, setShowRegister] = useState(false)
  const [showCart, setShowCart] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [billPending, setBillPending] = useState(false)
  const [billRequested, setBillRequested] = useState(false)
  const [paid, setPaid] = useState(false)
  const [showOrderConfirm, setShowOrderConfirm] = useState(false)
  const autoSheetTriedRef = useRef(false)
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
      if (!fresh.ok) {
        setError(fresh.message)
        return
      }
      if (!fresh.data.is_activated) {
        // La sesión se cerró entre que page.tsx renderizó y el cliente la pidió.
        // Volvemos al gate del server component.
        router.refresh()
        return
      }
      setState(fresh.data)
      sessionIdRef.current = fresh.data.session_id
    })()
    return () => {
      cancelled = true
    }
  }, [browserToken, qrToken, router])

  useEffect(() => {
    if (!state || !browserToken) return
    const sessionId = state.session_id
    const refresh = async () => {
      const r = await refreshState({ qrToken, browserToken })
      if (!r.ok) return
      if (!r.data.is_activated) {
        router.refresh()
        return
      }
      setState(r.data)
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

  // Auto-abrir el sheet de captura una sola vez por sesión, si aplica.
  useEffect(() => {
    if (!state || autoSheetTriedRef.current) return
    autoSheetTriedRef.current = true
    if (
      !state.customer_id &&
      state.capture_prompt.enabled &&
      !isCaptureSeen('sheet', state.session_id)
    ) {
      setShowRegister(true)
    }
  }, [state])

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
    if (!r.ok) return
    if (!r.data.is_activated) {
      router.refresh()
      return
    }
    setState(r.data)
  }, [browserToken, qrToken, router])

  const handleRegistered = useCallback(
    (result: Extract<RegisterCustomerResult, { ok: true }>) => {
      setShowRegister(false)
      void refreshAfterSubmit()
      if (result.welcomeReward) {
        // Toast con tu regalo de bienvenida: mensaje accionable para que el cliente
        // sepa que lo tiene que pedir al mozo (la redemption queda pending hasta entrega).
        toast.success(`¡Listo! Mostrále esto al mozo: ${result.welcomeReward.name}`, {
          duration: 6000,
        })
      } else {
        toast.success('¡Listo! Estás sumando puntos.')
      }
    },
    [refreshAfterSubmit],
  )

  // Cerrar la pantalla de confirmación descartando la card de captura:
  // mantenemos el feedback de "pedido enviado" con un toast (la card tapaba
  // ese mensaje, así que sin esto el comensal se quedaba sin confirmación).
  const dismissOrderConfirm = useCallback(() => {
    setShowOrderConfirm(false)
    toast.success('Pedido enviado. Esperando confirmación del mozo.')
  }, [])

  // Registro desde la card post-orden: callback estable (un arrow inline haría
  // re-disparar el efecto onRegistered de RegisterForm en cada render).
  const handleRegisteredPostOrder = useCallback(
    (result: Extract<RegisterCustomerResult, { ok: true }>) => {
      handleRegistered(result)
      setShowOrderConfirm(false)
    },
    [handleRegistered],
  )

  // Datos derivados del state para los heroes
  const welcomeReward = state?.welcome_reward ?? null
  const welcomeRedeemed = state?.welcome_reward_redeemed ?? null
  const tenantLogoUrl = state?.tenant_logo_url ?? null

  if (error && !state) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Receipt className="size-7" />
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
    <div className="relative min-h-[100dvh] bg-app-gradient pb-32">
      {/* Glow sutil top */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-[--forest-glow] via-[--forest-glow]/40 to-transparent"
      />

      <div className="mx-auto max-w-md px-4 pt-6">
        {/* HEADER */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="mb-5 flex flex-col items-center text-center"
        >
          {tenantLogoUrl ? (
            <div className="relative size-14 overflow-hidden rounded-full bg-card ring-2 ring-border/60 shadow-sm">
              <Image
                src={tenantLogoUrl}
                alt={tenantName}
                fill
                sizes="56px"
                className="object-cover"
                unoptimized
                priority
              />
            </div>
          ) : (
            <span
              role="img"
              aria-label={tenantName}
              className="flex size-14 items-center justify-center rounded-full bg-primary font-serif text-xl font-bold text-primary-foreground shadow-sm"
            >
              HUB
            </span>
          )}
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/80">
            {tenantName}
          </p>
          <h1 className="mt-1 font-serif text-[32px] font-semibold leading-tight tracking-tight">
            {tableLabel}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Pedí desde tu celu · pagás en la mesa
          </p>
        </motion.header>

        {/* HEROES — Welcome reward / Registered */}
        <AnimatePresence mode="wait">
          {state && !state.customer_id && welcomeReward?.enabled ? (
            <motion.button
              key="welcome-hero"
              type="button"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.25 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowRegister(true)}
              className="card-hairline group relative mb-4 flex w-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card text-left shadow-md transition-shadow hover:shadow-lg"
            >
              {/* Imagen del reward arriba si existe */}
              {welcomeReward.image_url ? (
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-secondary/40">
                  <Image
                    src={welcomeReward.image_url}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 100vw, 480px"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    unoptimized
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-card via-card/60 to-transparent"
                  />
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-warning/95 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning-foreground shadow-sm">
                    <Gift className="size-3" aria-hidden />
                    Regalo de bienvenida
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 pt-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                    <Gift className="size-5" aria-hidden />
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                    Regalo de bienvenida
                  </span>
                </div>
              )}
              <div className="flex items-end justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-lg font-semibold leading-tight tracking-tight text-balance">
                    {welcomeReward.headline}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground text-pretty">
                    {welcomeReward.subtext}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm">
                  Lo quiero
                </span>
              </div>
            </motion.button>
          ) : state && !state.customer_id ? (
            <motion.button
              key="register-cta"
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowRegister(true)}
              className="card-hairline group mb-4 flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <Sparkles className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-tight">
                  Sumá puntos en {tenantName}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Cada consumo te da beneficios. Registrate en 20s.
                </p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-primary">Sumarme →</span>
            </motion.button>
          ) : state?.customer_id ? (
            <motion.div
              key="registered"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="mb-4 space-y-2"
            >
              <div className="flex items-center gap-2.5 rounded-2xl border border-success/30 bg-success/5 px-3.5 py-2.5 shadow-sm">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
                  <Sparkles className="size-3.5" />
                </span>
                <div className="flex-1 text-sm">
                  <span className="font-medium">Sumando puntos</span>
                  <span className="text-muted-foreground"> · {tenantName}</span>
                </div>
              </div>
              {welcomeRedeemed && (
                <div className="card-hairline flex items-center gap-3 rounded-2xl border border-warning/40 bg-card p-3 shadow-sm">
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-secondary/40">
                    {welcomeRedeemed.image_url ? (
                      <Image
                        src={welcomeRedeemed.image_url}
                        alt=""
                        fill
                        sizes="48px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-warning/60">
                        <Gift className="size-5" aria-hidden />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-warning">
                      Tu regalo está esperándote
                    </p>
                    <p className="line-clamp-1 text-sm font-medium">{welcomeRedeemed.name}</p>
                    <p className="text-[11px] text-muted-foreground">Mostrále esto al mozo</p>
                  </div>
                </div>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* TABS */}
        <Tabs defaultValue="menu" className="w-full">
          <TabsList className="grid h-12 w-full grid-cols-2 rounded-xl border border-border/60 bg-card/60 p-1 shadow-sm">
            <TabsTrigger
              value="menu"
              className="rounded-lg font-serif text-sm font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Carta
            </TabsTrigger>
            <TabsTrigger
              value="orders"
              className="rounded-lg font-serif text-sm font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Mis órdenes
              {state && state.my_tickets.length > 0 ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground tabular-nums"
                >
                  {state.my_tickets.length}
                </motion.span>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="menu" className="mt-5">
            {state ? <MenuHub categories={state.menu} onAdd={addToCart} /> : <MenuSkeleton />}
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
            className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/80"
          >
            <div className="mx-auto flex max-w-md items-center gap-2">
              <Button
                variant="outline"
                onClick={handleRequestBill}
                disabled={billPending || billRequested}
                className={cn(
                  'h-12 flex-1 gap-1.5 rounded-xl text-sm font-medium',
                  billRequested &&
                    'border-success/40 bg-success/10 text-success hover:bg-success/15 hover:text-success',
                )}
              >
                <Receipt className="size-4" />
                {billRequested ? 'Avisado al mozo' : 'Pedir la cuenta'}
              </Button>
              <Button
                onClick={() => setShowCart(true)}
                disabled={cart.length === 0}
                className="h-12 flex-[1.2] gap-2 rounded-xl text-sm font-semibold"
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
        <CaptureSheet
          qrToken={qrToken}
          browserToken={browserToken}
          tenantName={tenantName}
          headline={state.capture_prompt.headline}
          subtext={state.capture_prompt.subtext}
          onClose={() => {
            setShowRegister(false)
            if (state.session_id) markCaptureSeen('sheet', state.session_id)
          }}
          onRegistered={handleRegistered}
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
            const sid = state?.session_id
            if (
              state &&
              !state.customer_id &&
              state.capture_prompt.enabled &&
              sid &&
              !isCaptureSeen('postorder', sid)
            ) {
              markCaptureSeen('postorder', sid)
              setShowOrderConfirm(true)
            } else {
              toast.success('Pedido enviado. Esperando confirmación del mozo.')
            }
            void refreshAfterSubmit()
          }}
        />
      )}

      {showOrderConfirm && state && browserToken && (
        <OrderConfirmation onClose={() => setShowOrderConfirm(false)}>
          {!state.customer_id && state.capture_prompt.enabled ? (
            <CapturePromptCard
              qrToken={qrToken}
              browserToken={browserToken}
              tenantName={tenantName}
              headline={state.capture_prompt.headline}
              subtext={state.capture_prompt.subtext}
              onDismiss={dismissOrderConfirm}
              onRegistered={handleRegisteredPostOrder}
            />
          ) : null}
        </OrderConfirmation>
      )}
    </div>
  )
}

function MenuSkeleton() {
  return (
    <div className="space-y-5">
      <span role="status" aria-live="polite" className="sr-only">
        Cargando carta…
      </span>
      {/* Sticky toolbar skeleton */}
      <div className="space-y-2.5">
        <div className="h-11 w-full animate-pulse rounded-xl bg-muted" />
        <div className="flex gap-1.5 overflow-hidden">
          {[1, 2, 3].map((k) => (
            <div
              key={`chip-${k}`}
              className="h-7 w-20 shrink-0 animate-pulse rounded-full bg-muted/70"
            />
          ))}
        </div>
      </div>
      {/* Items skeleton */}
      {['skel-1', 'skel-2'].map((k) => (
        <div key={k} className="space-y-2">
          <div className="h-5 w-32 animate-pulse rounded-md bg-muted" />
          <div className="space-y-2">
            {['a', 'b', 'c'].map((kk) => (
              <div
                key={`${k}-${kk}`}
                className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-2.5"
              >
                <div className="size-[72px] shrink-0 animate-pulse rounded-xl bg-muted">
                  <ImageOff className="m-auto mt-7 size-5 text-muted-foreground/30" aria-hidden />
                </div>
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
