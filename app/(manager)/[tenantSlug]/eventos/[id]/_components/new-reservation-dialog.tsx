'use client'

import { Search } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type CustomerSearchResult, searchCustomers } from '@/lib/customers/search'
import { createReservation } from '@/lib/events/reservations'
import { formatPhoneForDisplay } from '@/lib/phone'

export function NewReservationDialog({
  tenantSlug,
  eventId,
  onClose,
}: {
  tenantSlug: string
  eventId: string
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerSearchResult[]>([])
  const [picked, setPicked] = useState<CustomerSearchResult | null>(null)
  const [guests, setGuests] = useState('1')
  const [pending, start] = useTransition()

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      if (query.trim().length < 2) {
        setResults([])
        return
      }
      const data = await searchCustomers(tenantSlug, query)
      if (!cancelled) setResults(data)
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, tenantSlug])

  const onSubmit = () => {
    if (!picked) {
      toast.error('Elegí un cliente')
      return
    }
    const g = Number.parseInt(guests, 10)
    if (Number.isNaN(g) || g < 1) {
      toast.error('Cantidad inválida')
      return
    }
    start(async () => {
      const r = await createReservation(tenantSlug, {
        event_id: eventId,
        customer_id: picked.id,
        guests: g,
      })
      if (r.ok) {
        toast.success(
          r.status === 'waitlist'
            ? `En lista de espera (posición ${r.waitlist_position})`
            : 'Reserva confirmada',
        )
        onClose()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva reserva</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="search-cust">Buscar cliente</Label>
            <label className="relative flex items-center">
              <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
              <input
                id="search-cust"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPicked(null)
                }}
                placeholder="Nombre o teléfono…"
                autoFocus
                className="h-9 w-full rounded-lg border border-border/60 bg-background/40 pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/40"
              />
            </label>
          </div>

          {!picked && results.length > 0 ? (
            <ul className="max-h-48 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/60 bg-background/30">
              {results.map((c) => {
                const initials =
                  `${c.first_name?.[0] ?? ''}${c.last_name?.[0] ?? ''}`.toUpperCase() || '?'
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(c)
                        setQuery(`${c.first_name} ${c.last_name}`)
                        setResults([])
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-secondary/40"
                    >
                      <Avatar className="size-7">
                        <AvatarFallback className="bg-secondary text-[10px] font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">
                        {c.first_name} {c.last_name}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                        {formatPhoneForDisplay(c.phone)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}

          {picked ? (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
              <span className="text-xs text-muted-foreground">Seleccionado:</span>
              <strong>
                {picked.first_name} {picked.last_name}
              </strong>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="guests">Comensales</Label>
            <Input
              id="guests"
              type="number"
              min={1}
              max={99}
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={pending || !picked}>
            {pending ? 'Reservando…' : 'Reservar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
