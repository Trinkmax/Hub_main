'use client'

import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { MenuItem } from '@/lib/menu/queries'
import { calculatePoints } from '@/lib/points/engine'
import type { PointsRule, VisitForEngine } from '@/lib/points/types'
import { closeTable } from '@/lib/visits/actions'
import type { WizardCustomer, WizardLine } from './wizard'

function fmt(c: number) {
  return `$${(c / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function SummaryStep({
  tenantSlug,
  customer,
  items,
  lines,
  notes,
  rules,
  submitting,
  setSubmitting,
  onBack,
}: {
  tenantSlug: string
  customer: WizardCustomer
  items: MenuItem[]
  lines: WizardLine[]
  notes: string
  rules: PointsRule[]
  submitting: boolean
  setSubmitting: (b: boolean) => void
  onBack: () => void
}) {
  const router = useRouter()
  const [confirmed, setConfirmed] = useState<{
    points: number
    breakdown: { description: string; points: number }[]
  } | null>(null)

  const { total, preview } = useMemo(() => {
    let total = 0
    const visitItems = lines
      .map((l) => {
        const item = items.find((i) => i.id === l.item_id)
        if (!item) return null
        const lineTotal = item.price_cents * l.quantity
        total += lineTotal
        return {
          menu_item_id: item.id,
          category_id: item.category_id,
          quantity: l.quantity,
          unit_price_cents: item.price_cents,
          line_total_cents: lineTotal,
          points_override: item.points_override,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    const visit: VisitForEngine = { total_amount_cents: total, items: visitItems }
    const preview = calculatePoints(visit, rules)
    return { total, preview }
  }, [items, lines, rules])

  const onSubmit = async () => {
    setSubmitting(true)
    const result = await closeTable(tenantSlug, {
      customer_id: customer.id,
      items: lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
      notes: notes.trim().length > 0 ? notes.trim() : null,
    })
    setSubmitting(false)
    if (result.ok) {
      setConfirmed({ points: result.points_awarded, breakdown: result.breakdown })
      toast.success(`Mesa cerrada · +${result.points_awarded} pts`)
    } else {
      toast.error(result.message)
    }
  }

  if (confirmed) {
    return (
      <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-8 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-success/15 blur-3xl"
        />
        <div className="relative">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="size-7" />
          </div>
          <h2 className="mt-4 font-display text-xl font-semibold tracking-tight">Mesa cerrada</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <strong className="text-foreground">{customer.first_name}</strong> sumó{' '}
            <strong className="text-foreground">{confirmed.points} puntos</strong>.
          </p>

          {confirmed.breakdown.length > 0 ? (
            <ul className="mx-auto mt-5 max-w-sm space-y-1 text-left">
              {confirmed.breakdown.map((b) => (
                <li
                  key={`${b.description}-${b.points}`}
                  className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2 text-sm"
                >
                  <span>{b.description}</span>
                  <span className="font-semibold tabular-nums text-success">+{b.points}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={() => router.push(`/${tenantSlug}/clientes/${customer.id}`)}
            >
              Ver ficha del cliente
            </Button>
            <Button onClick={() => router.push(`/${tenantSlug}/visitas/nueva`)} className="gap-1.5">
              Cerrar otra mesa
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="card-hairline rounded-xl border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Cliente</p>
              <p className="font-display text-base font-semibold">
                {customer.first_name} {customer.last_name}
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-primary">
              Balance: {customer.points_balance} pts
            </span>
          </div>
        </div>

        <div className="card-hairline overflow-hidden rounded-xl border bg-card">
          <header className="border-b border-border/60 px-5 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight">
              Detalle del consumo
            </h3>
          </header>
          <ul className="divide-y divide-border/60">
            {lines.map((l) => {
              const item = items.find((i) => i.id === l.item_id)
              if (!item) return null
              return (
                <li
                  key={l.item_id}
                  className="flex items-center justify-between px-5 py-2.5 text-sm"
                >
                  <span>
                    <span className="text-muted-foreground tabular-nums">{l.quantity}× </span>
                    {item.name}
                  </span>
                  <span className="font-medium tabular-nums">
                    {fmt(item.price_cents * l.quantity)}
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="flex items-baseline justify-between border-t border-border/60 bg-secondary/20 px-5 py-3">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Total</span>
            <span className="font-display text-xl font-semibold tabular-nums">{fmt(total)}</span>
          </div>
        </div>

        {notes ? (
          <div className="card-hairline rounded-xl border bg-card p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Notas</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{notes}</p>
          </div>
        ) : null}
      </div>

      <aside className="space-y-4">
        <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 size-32 rounded-full bg-success/15 blur-2xl"
          />
          <div className="relative">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-success">
              <Sparkles className="size-3.5" />
              Puntos a otorgar
            </div>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-success">
              +{preview.delta}
            </p>
            {preview.breakdown.length > 0 ? (
              <ul className="mt-4 space-y-1">
                {preview.breakdown.map((b) => (
                  <li
                    key={`${b.rule_id ?? 'override'}-${b.source}-${b.points}`}
                    className="flex items-center justify-between rounded-md bg-success/5 px-2.5 py-1.5 text-xs"
                  >
                    <span className="text-muted-foreground">{b.description}</span>
                    <span className="font-semibold tabular-nums text-success">+{b.points}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Sin reglas aplicables. Configurá reglas en{' '}
                <strong className="text-foreground">Puntos</strong>.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} disabled={submitting} className="gap-1.5">
            <ArrowLeft className="size-3.5" />
            Atrás
          </Button>
          <Button onClick={onSubmit} disabled={submitting} size="lg" className="flex-1">
            {submitting ? 'Cerrando…' : 'Confirmar y cobrar'}
          </Button>
        </div>
      </aside>
    </div>
  )
}
