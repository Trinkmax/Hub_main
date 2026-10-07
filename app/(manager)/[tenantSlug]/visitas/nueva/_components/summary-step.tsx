'use client'

import { ArrowLeft, ArrowRight, CircleCheck, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Amount } from '@/components/ui/amount'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { Section } from '@/components/ui/section'
import { formatNumber } from '@/lib/format/number-kind'
import type { MenuItem } from '@/lib/menu/queries'
import { calculatePoints } from '@/lib/points/engine'
import type { PointsRule, VisitForEngine } from '@/lib/points/types'
import { closeTable } from '@/lib/visits/actions'
import type { WizardCustomer, WizardLine } from './wizard'

type SummaryRow = { id: string; name: string; quantity: number; totalCents: number }

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
  onRestart,
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
  /** «Cerrar otra mesa»: vuelve al paso 1 vacío. */
  onRestart: () => void
}) {
  const router = useRouter()
  const [confirmed, setConfirmed] = useState<{
    points: number
    breakdown: { description: string; points: number }[]
  } | null>(null)

  const { total, preview, rows } = useMemo(() => {
    let total = 0
    const rows: SummaryRow[] = []
    const visitItems = lines
      .map((l) => {
        const item = items.find((i) => i.id === l.item_id)
        if (!item) return null
        const lineTotal = item.price_cents * l.quantity
        total += lineTotal
        rows.push({ id: item.id, name: item.name, quantity: l.quantity, totalCents: lineTotal })
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
    return { total, preview, rows }
  }, [items, lines, rules])

  const firstName = customer.first_name
  const fullName = `${customer.first_name} ${customer.last_name}`.trim()
  const initials =
    `${customer.first_name?.[0] ?? ''}${customer.last_name?.[0] ?? ''}`.toUpperCase() || '?'

  const onSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    const result = await closeTable(tenantSlug, {
      customer_id: customer.id,
      items: lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
      notes: notes.trim().length > 0 ? notes.trim() : null,
    })
    setSubmitting(false)
    if (result.ok) {
      setConfirmed({ points: result.points_awarded, breakdown: result.breakdown })
      toast.success(`Mesa cerrada · +${formatNumber(result.points_awarded)} pts`)
    } else {
      toast.error(result.message)
    }
  }

  if (confirmed) {
    return (
      <Card padding="lg" className="items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success-text">
          <CircleCheck aria-hidden="true" className="size-6" strokeWidth={1.75} />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-[520] text-balance">Mesa cerrada</h2>
          <p className="type-body text-muted-foreground">
            <strong className="font-semibold text-foreground">{firstName}</strong> sumó{' '}
            <strong className="font-semibold text-foreground">
              {formatNumber(confirmed.points)} {confirmed.points === 1 ? 'punto' : 'puntos'}
            </strong>
            .
          </p>
        </div>

        {confirmed.breakdown.length > 0 ? (
          <ul className="flex w-full max-w-sm flex-col divide-y divide-border rounded-lg border border-border text-left">
            {confirmed.breakdown.map((b) => (
              <li
                key={`${b.description}-${b.points}`}
                className="flex items-center justify-between gap-3 px-3 py-2 type-body"
              >
                <span className="min-w-0">{b.description}</span>
                <span className="shrink-0 font-semibold type-amount text-success-text">
                  +{formatNumber(b.points)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="secondary"
            onClick={() => router.push(`/${tenantSlug}/clientes/${customer.id}`)}
          >
            Ver ficha del cliente
          </Button>
          <Button onClick={onRestart}>
            Cerrar otra mesa
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
        <Card padding="sm" className="flex-row items-center gap-3 px-4">
          <Avatar size="md">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="type-small text-muted-foreground">Cliente</p>
            <p className="truncate type-subtitle">{fullName}</p>
          </div>
          <Badge tone="gold" size="md" className="type-amount">
            {formatNumber(customer.points_balance)} pts
          </Badge>
        </Card>

        <Section title="Detalle del consumo" headingLevel={3}>
          <DataTable<SummaryRow>
            caption="Detalle del consumo"
            rows={rows}
            getRowId={(row) => row.id}
            mobile="scroll"
            columns={[
              {
                id: 'item',
                header: 'Ítem',
                cell: (row) => (
                  <>
                    <span className="text-muted-foreground type-amount">
                      {formatNumber(row.quantity)}×{' '}
                    </span>
                    {row.name}
                  </>
                ),
              },
              {
                id: 'importe',
                header: 'Importe $',
                numeric: true,
                width: '8rem',
                cell: (row) => <Amount cents={row.totalCents} decimals={0} currency={false} />,
                footer: <Amount cents={total} decimals={0} currency={false} />,
              },
            ]}
          />
        </Section>

        {notes ? (
          <Section title="Notas" headingLevel={3}>
            <p className="whitespace-pre-wrap type-body">{notes}</p>
          </Section>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4" aria-label="Puntos y confirmación">
        <Card>
          <div className="flex items-center gap-2 type-label text-muted-foreground">
            <Sparkles aria-hidden="true" className="size-4 text-success-text" />
            Puntos a dar
          </div>
          <p className="type-kpi text-success-text">+{formatNumber(preview.delta)}</p>
          {preview.breakdown.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border">
              {preview.breakdown.map((b) => (
                <li
                  key={`${b.rule_id ?? 'override'}-${b.source}-${b.points}`}
                  className="flex items-center justify-between gap-3 py-1.5 type-small"
                >
                  <span className="min-w-0 text-muted-foreground">{b.description}</span>
                  <span className="shrink-0 font-semibold type-amount text-success-text">
                    +{formatNumber(b.points)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-pretty type-small text-muted-foreground">
              Ninguna regla de puntos aplica a este consumo. Las reglas se configuran en{' '}
              <strong className="font-medium text-foreground">
                Club de beneficios › Puntos y niveles
              </strong>
              .
            </p>
          )}
        </Card>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={onBack} disabled={submitting}>
            <ArrowLeft aria-hidden="true" />
            Atrás
          </Button>
          <Button
            onClick={onSubmit}
            loading={submitting}
            loadingText="Cerrando…"
            size="lg"
            className="flex-1"
          >
            Confirmar y cobrar
          </Button>
        </div>
      </aside>
    </div>
  )
}
