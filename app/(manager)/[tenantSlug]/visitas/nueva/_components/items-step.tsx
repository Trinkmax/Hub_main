'use client'

import { ArrowLeft, ArrowRight, Minus, Plus, Receipt, Trash2, UtensilsCrossed } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { categoryPathLabel } from '@/lib/menu/tree'
import type { WizardCustomer, WizardLine } from './wizard'

function fmt(c: number) {
  return `$${(c / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function ItemsStep({
  customer,
  categories,
  items,
  lines,
  notes,
  onAdd,
  onRemove,
  onQty,
  onNotes,
  onBack,
  onNext,
}: {
  customer: WizardCustomer
  categories: MenuCategory[]
  items: MenuItem[]
  lines: WizardLine[]
  notes: string
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  onQty: (id: string, qty: number) => void
  onNotes: (n: string) => void
  onBack: () => void
  onNext: () => void
}) {
  // Solo categorías con ítems directos (las "contenedor" no generan tab vacío).
  // Etiqueta con ruta completa para ubicar subcategorías sin drill-down.
  const leafCats = categories.filter((c) => items.some((i) => i.category_id === c.id))
  const [tab, setTab] = useState<string>(leafCats[0]?.id ?? '')

  const total = lines.reduce((acc, line) => {
    const item = items.find((i) => i.id === line.item_id)
    return acc + (item ? item.price_cents * line.quantity : 0)
  }, 0)

  if (leafCats.length === 0) {
    return (
      <EmptyState
        icon={UtensilsCrossed}
        title="No hay menú activo"
        description="Pedile al owner que cargue categorías e ítems para empezar a cargar consumo."
      />
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="card-hairline rounded-xl border bg-card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Mesa de
            </p>
            <h2 className="font-display text-base font-semibold">
              {customer.first_name} {customer.last_name}
            </h2>
          </div>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-primary">
            {customer.points_balance} pts
          </span>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex h-auto flex-wrap gap-1 bg-secondary/40 p-1">
            {leafCats.map((c) => (
              <TabsTrigger
                key={c.id}
                value={c.id}
                className="data-[state=active]:bg-card data-[state=active]:shadow-sm"
              >
                {categoryPathLabel(categories, c.id)}
              </TabsTrigger>
            ))}
          </TabsList>
          {leafCats.map((c) => {
            const catItems = items.filter((i) => i.category_id === c.id)
            return (
              <TabsContent key={c.id} value={c.id} className="mt-4">
                {catItems.length === 0 ? (
                  <p className="rounded-lg border border-dashed bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
                    Sin ítems en esta categoría.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {catItems.map((item) => {
                      const inLine = lines.find((l) => l.item_id === item.id)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onAdd(item.id)}
                          className={`group relative flex flex-col rounded-lg border bg-background/40 p-3 text-left transition-all hover:border-primary/40 hover:bg-background/80 active:scale-[0.98] ${inLine ? 'border-primary/60 ring-1 ring-primary/30' : 'border-border/60'}`}
                        >
                          <span className="text-sm font-medium leading-tight">{item.name}</span>
                          <span className="mt-2 font-display text-base font-semibold tabular-nums">
                            {fmt(item.price_cents)}
                          </span>
                          {item.points_override !== null ? (
                            <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                              +{item.points_override} pts
                            </span>
                          ) : null}
                          {inLine ? (
                            <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold tabular-nums text-primary-foreground">
                              {inLine.quantity}
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              </TabsContent>
            )
          })}
        </Tabs>
      </div>

      <aside className="card-hairline relative flex flex-col rounded-xl border bg-card lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)]">
        <header className="flex items-center gap-2 border-b border-border/60 px-5 py-3.5">
          <Receipt className="size-4 text-primary" />
          <h3 className="font-display text-sm font-semibold">Cuenta</h3>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {lines.length} ítem{lines.length === 1 ? '' : 's'}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {lines.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              Tocá los ítems del menú para agregarlos.
            </p>
          ) : (
            <ul className="space-y-1">
              {lines.map((l) => {
                const item = items.find((i) => i.id === l.item_id)
                if (!item) return null
                return (
                  <li
                    key={l.item_id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="text-[11px] tabular-nums text-muted-foreground">
                        {fmt(item.price_cents)} c/u
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-7"
                        onClick={() => onQty(l.item_id, l.quantity - 1)}
                        aria-label="Restar"
                      >
                        <Minus className="size-3" />
                      </Button>
                      <span className="w-5 text-center text-sm tabular-nums">{l.quantity}</span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-7"
                        onClick={() => onQty(l.item_id, l.quantity + 1)}
                        aria-label="Sumar"
                      >
                        <Plus className="size-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemove(l.item_id)}
                        aria-label="Quitar"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                    <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                      {fmt(item.price_cents * l.quantity)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border/60 p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Total</span>
            <span className="font-display text-2xl font-semibold tabular-nums">{fmt(total)}</span>
          </div>
          <Textarea
            placeholder="Notas (opcional)…"
            maxLength={300}
            rows={2}
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            className="resize-none text-sm"
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack} className="gap-1.5">
              <ArrowLeft className="size-3.5" />
              Atrás
            </Button>
            <Button onClick={onNext} disabled={lines.length === 0} className="flex-1 gap-1.5">
              Resumen
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </aside>
    </div>
  )
}
