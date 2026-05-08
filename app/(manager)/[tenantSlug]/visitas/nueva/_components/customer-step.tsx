'use client'

import { Phone, Search, Sparkles, UserPlus } from 'lucide-react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { createCustomer } from '@/lib/customers/actions'
import { type CustomerSearchResult, searchCustomers } from '@/lib/customers/search'
import { formatPhoneForDisplay } from '@/lib/phone'
import type { WizardCustomer } from './wizard'

export function CustomerStep({
  tenantSlug,
  selected,
  onSelect,
}: {
  tenantSlug: string
  selected: WizardCustomer | null
  onSelect: (c: WizardCustomer) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [newOpen, setNewOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(async () => {
      if (query.trim().length < 2) {
        setResults([])
        return
      }
      setSearching(true)
      const data = await searchCustomers(tenantSlug, query)
      if (!cancelled) {
        setResults(data)
        setSearching(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, tenantSlug])

  const empty = query.trim().length < 2
  const noResults = !empty && !searching && results.length === 0

  return (
    <div className="card-hairline rounded-xl border bg-card p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          ¿Quién está en la mesa?
        </h2>
        <p className="text-sm text-muted-foreground">
          Buscá por nombre, apellido o teléfono. Si es nuevo, lo creás en el momento.
        </p>
      </div>

      <label className="relative mt-5 flex items-center">
        <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <input
          type="search"
          placeholder="Empezá a escribir…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: paso 1 del wizard, foco inmediato en buscador
          autoFocus
          className="h-11 w-full rounded-lg border border-border/60 bg-background/40 pl-9 pr-3 text-base shadow-none outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/40"
        />
      </label>

      <div className="mt-4 overflow-hidden rounded-lg border border-border/60 bg-background/30">
        {searching ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={`s-${i.toString()}`} className="flex items-center gap-3 px-2 py-2">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        ) : empty ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Sparkles className="size-4 text-primary" />
            Empezá a escribir para encontrar al cliente.
          </div>
        ) : noResults ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="text-sm font-medium">Sin resultados para “{query}”</p>
            <p className="text-xs text-muted-foreground">
              Creá un cliente nuevo si no está registrado.
            </p>
            <Button onClick={() => setNewOpen(true)} className="mt-2 gap-2" size="sm">
              <UserPlus className="size-3.5" />
              Crear “{query}”
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {results.map((c) => {
              const initials =
                `${c.first_name?.[0] ?? ''}${c.last_name?.[0] ?? ''}`.toUpperCase() || '?'
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary/40"
                  >
                    <Avatar className="size-9">
                      <AvatarFallback className="bg-secondary text-xs font-semibold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {c.first_name} {c.last_name}
                      </p>
                      <p className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
                        <Phone className="size-3" />
                        {formatPhoneForDisplay(c.phone)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                      {c.points_balance} pts
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => setNewOpen(true)} className="gap-2">
          <UserPlus className="size-4" />
          Nuevo cliente
        </Button>
        {selected ? (
          <span className="text-xs text-muted-foreground">
            Seleccionado: <strong className="text-foreground">{selected.first_name}</strong>
          </span>
        ) : null}
      </div>

      {newOpen ? (
        <NewCustomerDialog
          tenantSlug={tenantSlug}
          initialName={query}
          onClose={() => setNewOpen(false)}
          onCreated={(c) => {
            setNewOpen(false)
            onSelect(c)
          }}
        />
      ) : null}
    </div>
  )
}

function NewCustomerDialog({
  tenantSlug,
  initialName,
  onClose,
  onCreated,
}: {
  tenantSlug: string
  initialName: string
  onClose: () => void
  onCreated: (c: WizardCustomer) => void
}) {
  const [phone, setPhone] = useState('')
  const [first, setFirst] = useState(initialName)
  const [last, setLast] = useState('')
  const [pending, start] = useTransition()

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const fd = new FormData()
    fd.set('phone', phone)
    fd.set('first_name', first)
    fd.set('last_name', last)
    start(async () => {
      const r = await createCustomer(tenantSlug, { ok: true }, fd)
      if (r.ok && r.customerId) {
        onCreated({
          id: r.customerId,
          first_name: first,
          last_name: last,
          phone,
          points_balance: 0,
        })
      } else if (!r.ok) {
        toast.error(r.message)
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="nc-phone">Teléfono</Label>
            <Input
              id="nc-phone"
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="351 555 1234"
              autoComplete="off"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="nc-first">Nombre</Label>
              <Input
                id="nc-first"
                required
                value={first}
                onChange={(e) => setFirst(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nc-last">Apellido</Label>
              <Input id="nc-last" required value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending} type="button">
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creando…' : 'Crear y continuar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
