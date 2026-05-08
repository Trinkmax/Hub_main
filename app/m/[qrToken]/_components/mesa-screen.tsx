'use client'

import { Receipt, Sparkles, UserCircle2 } from 'lucide-react'
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
      <div className="mx-auto max-w-md space-y-4 px-4 py-10 text-center">
        <h1 className="font-display text-2xl font-semibold">No pudimos abrir tu mesa</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
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
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <header className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {tenantName}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{tableLabel}</h1>
      </header>

      {state && !state.customer_id && (
        <button
          type="button"
          className="card-hairline flex w-full items-center justify-between gap-2 rounded-2xl border bg-card/90 p-4 text-left text-sm shadow-sm hover:bg-card/95"
          onClick={() => setShowRegister(true)}
        >
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Sumá puntos en cada pedido
          </span>
          <span className="text-xs text-muted-foreground">Registrarme →</span>
        </button>
      )}

      {state?.customer_id && (
        <div className="card-hairline flex items-center gap-2 rounded-2xl border bg-card/90 p-3 text-sm shadow-sm">
          <UserCircle2 className="size-4 text-primary" />
          <span>Sumando puntos en {tenantName}</span>
        </div>
      )}

      <Tabs defaultValue="menu" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="menu">Carta</TabsTrigger>
          <TabsTrigger value="orders">
            Mis órdenes
            {state && state.my_tickets.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {state.my_tickets.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="menu" className="mt-4">
          {state ? (
            <MenuList categories={state.menu} onAdd={addToCart} />
          ) : (
            <p className="text-center text-sm text-muted-foreground">Cargando carta…</p>
          )}
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
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

      {state && (
        <div className="sticky bottom-3 z-10 flex gap-2">
          <Button
            variant="outline"
            onClick={handleRequestBill}
            disabled={billPending}
            className="flex-1"
          >
            <Receipt className="mr-1.5 size-4" />
            Pedir la cuenta
          </Button>
          <Button onClick={() => setShowCart(true)} disabled={cart.length === 0} className="flex-1">
            Carrito ({cart.length}) ${(cartTotalCents / 100).toFixed(2)}
          </Button>
        </div>
      )}

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
