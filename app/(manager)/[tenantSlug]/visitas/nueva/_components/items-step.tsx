'use client'

import { ArrowLeft, ArrowRight, Minus, Plus, Receipt, Trash2, UtensilsCrossed } from 'lucide-react'
import { useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatNumber } from '@/lib/format/number-kind'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { categoryPathLabel } from '@/lib/menu/tree'
import { formatCents } from '@/lib/money/format'
import { cn } from '@/lib/utils'
import type { WizardCustomer, WizardLine } from './wizard'

/** Pesos enteros, como en la carta: «$ 1.500». */
function price(cents: number): string {
  return formatCents(cents, { decimals: 0 })
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
  // Solo categorías con ítems directos (las "contenedor" no generan pestaña vacía).
  // Etiqueta con ruta completa para ubicar subcategorías sin drill-down.
  const leafCats = categories.filter((c) => items.some((i) => i.category_id === c.id))
  const [tab, setTab] = useState<string>(leafCats[0]?.id ?? '')
  const accountTitleId = useId()

  const total = lines.reduce((acc, line) => {
    const item = items.find((i) => i.id === line.item_id)
    return acc + (item ? item.price_cents * line.quantity : 0)
  }, 0)
  const customerName = `${customer.first_name} ${customer.last_name}`.trim()

  if (leafCats.length === 0) {
    return (
      <EmptyState
        icon={UtensilsCrossed}
        title="La carta está vacía"
        description="Para sumar consumo hace falta cargar categorías e ítems en la Carta."
        action={
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            Atrás
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start">
        <Card padding="none" className="min-w-0 gap-0">
          <div className="flex items-start justify-between gap-3 p-4 sm:px-5">
            <div className="min-w-0">
              <p className="type-small text-muted-foreground">Mesa de</p>
              <h2 className="truncate type-subtitle">{customerName}</h2>
            </div>
            <Badge tone="gold" size="md" className="type-amount">
              {formatNumber(customer.points_balance)} pts
            </Badge>
          </div>

          <Tabs value={tab} onValueChange={setTab} className="gap-0">
            <TabsList aria-label="Categorías de la carta" className="px-4 sm:px-5">
              {leafCats.map((c) => (
                <TabsTrigger key={c.id} value={c.id}>
                  {categoryPathLabel(categories, c.id)}
                </TabsTrigger>
              ))}
            </TabsList>
            {leafCats.map((c) => {
              const catItems = items.filter((i) => i.category_id === c.id)
              return (
                <TabsContent key={c.id} value={c.id} className="p-4 sm:p-5">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {catItems.map((item) => {
                      const inLine = lines.find((l) => l.item_id === item.id)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onAdd(item.id)}
                          className={cn(
                            'relative flex min-h-20 flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left',
                            'transition-colors duration-(--duration-quick) ease-(--ease-ui) motion-reduce:transition-none',
                            'hover:border-input active:bg-active',
                            'outline-offset-2 outline-(--ring) focus-visible:outline-2',
                            inLine ? 'border-primary ring-1 ring-primary' : 'border-border-strong',
                          )}
                        >
                          <span
                            className={cn('type-body font-medium text-pretty', inLine && 'pe-7')}
                          >
                            <span className="sr-only">Sumar </span>
                            {item.name}
                          </span>
                          <span className="mt-auto type-body font-semibold type-amount">
                            {price(item.price_cents)}
                          </span>
                          {item.points_override !== null ? (
                            <Badge tone="gold" className="type-amount">
                              +{formatNumber(item.points_override)} pts
                            </Badge>
                          ) : null}
                          {inLine ? (
                            <span className="absolute top-2 right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 type-caption font-semibold type-amount text-primary-foreground">
                              <span className="sr-only">, en la cuenta: </span>
                              {formatNumber(inLine.quantity)}
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </TabsContent>
              )
            })}
          </Tabs>
        </Card>

        <Card
          asChild
          padding="none"
          className="gap-0 lg:sticky lg:top-[calc(var(--topbar-h)+1.5rem)] lg:max-h-[calc(100dvh-var(--topbar-h)-3rem)]"
        >
          <aside aria-labelledby={accountTitleId}>
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Receipt aria-hidden="true" className="size-4 text-muted-foreground" />
              <h3 id={accountTitleId} className="type-subtitle">
                Cuenta
              </h3>
              <span className="ms-auto type-small type-amount text-muted-foreground">
                {formatNumber(lines.length)} {lines.length === 1 ? 'ítem' : 'ítems'}
              </span>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {lines.length === 0 ? (
                <p className="px-3 py-8 text-center text-pretty type-small text-muted-foreground">
                  Tocá los ítems de la carta para sumarlos a la cuenta.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {lines.map((l) => {
                    const item = items.find((i) => i.id === l.item_id)
                    if (!item) return null
                    return (
                      <li
                        key={l.item_id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate type-body font-medium">{item.name}</p>
                          <p className="type-caption type-amount text-muted-foreground">
                            {price(item.price_cents)} c/u
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon-sm"
                            variant="secondary"
                            onClick={() => onQty(l.item_id, l.quantity - 1)}
                            aria-label={`Restar uno de ${item.name}`}
                          >
                            <Minus aria-hidden="true" />
                          </Button>
                          <span className="w-6 text-center type-body type-amount">
                            {formatNumber(l.quantity)}
                          </span>
                          <Button
                            size="icon-sm"
                            variant="secondary"
                            onClick={() => onQty(l.item_id, l.quantity + 1)}
                            aria-label={`Sumar uno de ${item.name}`}
                          >
                            <Plus aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="danger-ghost"
                            onClick={() => onRemove(l.item_id)}
                            aria-label={`Quitar ${item.name}`}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                        <span className="w-20 shrink-0 text-right type-body font-semibold type-amount">
                          {price(item.price_cents * l.quantity)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-4 border-t border-border p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="type-label text-muted-foreground">Total</span>
                <span className="text-2xl font-semibold type-amount">{price(total)}</span>
              </div>
              <Field label="Notas" optional>
                <Textarea
                  placeholder="Algo para recordar de esta mesa"
                  maxLength={300}
                  rows={2}
                  value={notes}
                  onChange={(e) => onNotes(e.target.value)}
                  className="min-h-16"
                />
              </Field>
              {/* En pantallas angostas estos botones viven en la barra fija de abajo. */}
              <div className="flex gap-2 max-lg:hidden">
                <Button variant="secondary" onClick={onBack}>
                  <ArrowLeft aria-hidden="true" />
                  Atrás
                </Button>
                <Button onClick={onNext} disabled={lines.length === 0} className="flex-1">
                  Ver resumen
                  <ArrowRight aria-hidden="true" />
                </Button>
              </div>
            </div>
          </aside>
        </Card>
      </div>

      {/* Celular y tablet: la cuenta queda abajo de la carta, así que el total y
          «Ver resumen» van en una barra fija; se carga sin bajar hasta el final. */}
      <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t border-border bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 lg:hidden">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="type-caption text-muted-foreground">
            {formatNumber(lines.length)} {lines.length === 1 ? 'ítem' : 'ítems'}
          </p>
          <p className="type-subtitle type-amount">{price(total)}</p>
        </div>
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          <span className="max-sm:sr-only">Atrás</span>
        </Button>
        <Button onClick={onNext} disabled={lines.length === 0}>
          Ver resumen
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
