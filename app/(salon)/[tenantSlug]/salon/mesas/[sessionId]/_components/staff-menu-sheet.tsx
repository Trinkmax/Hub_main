'use client'

import { ImageOff, Minus, Plus, Search, Send, ShoppingBag, Trash2, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { addStaffTicketAction } from '@/lib/sessions-waiter/actions'
import {
  buildCartLines,
  cartItemCount,
  cartTotalCents,
  indexMenuItems,
  type StaffCartEntry,
} from '@/lib/sessions-waiter/staff-cart-utils'
import type { StaffMenuCategory } from '@/lib/sessions-waiter/staff-menu-queries'
import { cn } from '@/lib/utils'

const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

function format(cents: number): string {
  return ARS.format(Math.round(cents / 100))
}

export type StaffMenuSheetGuest = {
  id: string
  display_name: string | null
  customer_id: string | null
}

export function StaffMenuSheet({
  open,
  onOpenChange,
  tenantSlug,
  sessionId,
  guests,
  onSent,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  tenantSlug: string
  sessionId: string
  guests: StaffMenuSheetGuest[]
  onSent: () => void
}) {
  const [menu, setMenu] = useState<StaffMenuCategory[] | null>(null)
  const [menuError, setMenuError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<StaffCartEntry[]>([])
  const [assignedTo, setAssignedTo] = useState<string>('shared')
  const [showNotesFor, setShowNotesFor] = useState<string | null>(null)
  const [pending, startSubmit] = useTransition()

  // Carga lazy del menú la primera vez que se abre.
  useEffect(() => {
    if (!open || menu !== null) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/menu`, {
          cache: 'no-store',
        })
        if (cancelled) return
        if (!res.ok) {
          setMenuError('No se pudo cargar la carta.')
          return
        }
        const data = (await res.json()) as { menu: StaffMenuCategory[] }
        setMenu(data.menu)
      } catch (e) {
        if (!cancelled) setMenuError(e instanceof Error ? e.message : 'Error inesperado.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, menu, sessionId])

  const itemsById = useMemo(() => indexMenuItems(menu ?? []), [menu])
  const cartLines = useMemo(() => buildCartLines(cart, itemsById), [cart, itemsById])
  const total = cartTotalCents(cartLines)
  const count = cartItemCount(cart)

  const filteredMenu = useMemo(() => {
    if (!menu) return null
    const q = search.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    if (q.length === 0) return menu
    return menu
      .map((cat) => ({
        ...cat,
        items: cat.items.filter((it) =>
          it.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.items.length > 0)
  }, [menu, search])

  const addItem = useCallback((menuItemId: string) => {
    setCart((prev) => {
      const ix = prev.findIndex((e) => e.menuItemId === menuItemId)
      if (ix < 0) return [...prev, { menuItemId, quantity: 1, notes: null }]
      const next = [...prev]
      const cur = next[ix]
      if (cur) next[ix] = { ...cur, quantity: Math.min(50, cur.quantity + 1) }
      return next
    })
  }, [])

  const setQuantity = useCallback((menuItemId: string, qty: number) => {
    setCart((prev) => {
      if (qty <= 0) return prev.filter((e) => e.menuItemId !== menuItemId)
      const clamped = Math.min(50, qty)
      return prev.map((e) => (e.menuItemId === menuItemId ? { ...e, quantity: clamped } : e))
    })
  }, [])

  const setNotes = useCallback((menuItemId: string, notes: string) => {
    const clean = notes.trim()
    setCart((prev) =>
      prev.map((e) =>
        e.menuItemId === menuItemId ? { ...e, notes: clean.length > 0 ? clean : null } : e,
      ),
    )
  }, [])

  const reset = useCallback(() => {
    setCart([])
    setAssignedTo('shared')
    setSearch('')
    setShowNotesFor(null)
  }, [])

  const handleSend = () => {
    if (cart.length === 0) return
    startSubmit(async () => {
      const result = await addStaffTicketAction(tenantSlug, {
        sessionId,
        assignedToGuestId: assignedTo === 'shared' ? null : assignedTo,
        items: cart.map((e) => ({
          menuItemId: e.menuItemId,
          quantity: e.quantity,
          notes: e.notes,
        })),
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(`Comanda enviada · ${result.totalItems} ítem(s) · ${format(result.totalCents)}`)
      reset()
      onSent()
      onOpenChange(false)
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && cart.length === 0) reset()
        onOpenChange(next)
      }}
    >
      <SheetContent side="bottom" className="flex h-[92vh] flex-col gap-0 p-0">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <ShoppingBag className="size-5 text-primary" aria-hidden />
            <h2 className="font-serif text-lg font-semibold tracking-tight">Agregar productos</h2>
            {count > 0 ? <Badge variant="secondary">{count} en carrito</Badge> : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        {/* Buscador */}
        <div className="shrink-0 border-b border-border/60 px-5 py-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              placeholder="Buscar producto"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Menú scrolleable */}
        <div className="min-h-0 grow overflow-y-auto px-5 py-4">
          {menuError ? (
            <p className="text-center text-sm text-destructive">{menuError}</p>
          ) : menu === null ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : filteredMenu === null || filteredMenu.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {search ? 'Ningún producto matchea tu búsqueda.' : 'No hay productos en la carta.'}
            </p>
          ) : (
            <div className="space-y-6">
              {filteredMenu.map((cat) => (
                <section key={cat.id}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {cat.name}
                  </h3>
                  <ul className="space-y-2">
                    {cat.items.map((it) => {
                      const inCart = cart.find((e) => e.menuItemId === it.id)
                      return (
                        <li
                          key={it.id}
                          className={cn(
                            'flex items-center gap-3 rounded-lg border border-border/70 bg-card/85 p-3 shadow-xs',
                            inCart && 'border-primary/40 bg-primary/5',
                          )}
                        >
                          <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                            {it.image_url ? (
                              <Image
                                src={it.image_url}
                                alt={it.name}
                                fill
                                sizes="48px"
                                className="object-cover"
                              />
                            ) : (
                              <ImageOff
                                className="absolute inset-0 m-auto size-5 text-muted-foreground/40"
                                aria-hidden
                              />
                            )}
                          </div>
                          <div className="min-w-0 grow">
                            <p className="truncate text-sm font-medium">{it.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(it.price_cents)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={inCart ? 'secondary' : 'outline'}
                            onClick={() => addItem(it.id)}
                            disabled={pending}
                            className="shrink-0 gap-1"
                          >
                            <Plus className="size-3.5" aria-hidden />
                            {inCart ? `+${inCart.quantity}` : 'Sumar'}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Cart sticky */}
        {cart.length > 0 ? (
          <div className="shrink-0 border-t border-border/60 bg-background px-5 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <Select value={assignedTo} onValueChange={setAssignedTo} disabled={pending}>
                <SelectTrigger className="grow text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="shared">Para toda la mesa</SelectItem>
                  {guests.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      Para {g.display_name ?? `Comensal #${g.id.slice(0, 4)}`}
                      {g.customer_id ? ' ✓' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={reset}
                disabled={pending}
                aria-label="Vaciar carrito"
              >
                <Trash2 className="size-4 text-destructive" aria-hidden />
              </Button>
            </div>

            <ul className="mb-3 max-h-40 space-y-2 overflow-y-auto">
              {cartLines.map((l) => (
                <li key={l.menuItemId} className="rounded-md bg-muted/40 px-2 py-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 grow truncate font-medium">{l.name}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setQuantity(l.menuItemId, l.quantity - 1)}
                        disabled={pending}
                        aria-label="Restar"
                        className="size-7"
                      >
                        <Minus className="size-3" aria-hidden />
                      </Button>
                      <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setQuantity(l.menuItemId, l.quantity + 1)}
                        disabled={pending}
                        aria-label="Sumar"
                        className="size-7"
                      >
                        <Plus className="size-3" aria-hidden />
                      </Button>
                    </div>
                    <span className="w-20 shrink-0 text-right tabular-nums">
                      {format(l.lineTotalCents)}
                    </span>
                  </div>
                  {showNotesFor === l.menuItemId ? (
                    <Input
                      type="text"
                      placeholder="Notas (sin azúcar, sin gluten, …)"
                      defaultValue={l.notes ?? ''}
                      onBlur={(e) => setNotes(l.menuItemId, e.target.value)}
                      maxLength={200}
                      className="mt-1.5 h-8 text-xs"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowNotesFor(l.menuItemId)}
                      className="mt-1 text-[11px] text-primary/80 hover:underline"
                    >
                      {l.notes ? `Notas: "${l.notes}"` : '+ Agregar notas'}
                    </button>
                  )}
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-3">
              <div className="grow">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total</p>
                <p className="font-serif text-xl font-semibold tabular-nums">{format(total)}</p>
              </div>
              <Button
                type="button"
                onClick={handleSend}
                disabled={pending || cart.length === 0}
                size="lg"
                className="gap-2"
              >
                <Send className="size-4" aria-hidden />
                {pending ? 'Enviando…' : 'Enviar a cocina'}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
