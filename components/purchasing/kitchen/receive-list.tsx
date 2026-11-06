import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { relativeDayLabel } from '@/lib/purchasing/dates'
import type { PurOrder, PurSupplier } from '@/lib/purchasing/types'
import { expectedPacks } from '@/lib/purchasing/types'
import { cn } from '@/lib/utils'

/** «¿Qué llegó?»: los pedidos en camino, los de hoy arriba. Se toca el proveedor que acaba de llegar. */
export function ReceiveList({
  slug,
  today,
  orders,
  suppliers,
  reviewerName,
}: {
  slug: string
  today: string
  orders: PurOrder[]
  suppliers: PurSupplier[]
  reviewerName: string | null
}) {
  const names = new Map(suppliers.map((s) => [s.id, s.name]))
  const dueToday = orders.filter((o) => !o.expectedDate || o.expectedDate <= today)
  const later = orders.filter((o) => o.expectedDate && o.expectedDate > today)
  const who = reviewerName?.trim() || 'Compras'

  const card = (o: PurOrder, highlight: boolean) => {
    const products = o.lines.filter((l) => expectedPacks(l) > 0).length
    const late = o.expectedDate && o.expectedDate < today
    return (
      <li key={o.id}>
        <Link
          href={`/${slug}/salon/stock/recibir/${o.id}`}
          className={cn(
            'flex items-center justify-between gap-3 rounded-3xl bg-card p-5 shadow-xs transition-transform active:scale-[0.99]',
            highlight ? 'border-2 border-primary' : 'card-hairline',
          )}
        >
          <span className="min-w-0">
            <span className="block truncate text-xl font-semibold">
              {o.supplierId ? (names.get(o.supplierId) ?? 'Proveedor') : 'Sin proveedor'}
            </span>
            <span className="mt-0.5 block text-[0.95rem] text-muted-foreground">
              {products} {products === 1 ? 'producto' : 'productos'} ·{' '}
              {o.expectedDate ? relativeDayLabel(o.expectedDate, today) : 'sin fecha'}
              {late ? ' · atrasado' : ''}
            </span>
            <span className="mt-2 flex flex-wrap gap-1.5">
              {o.kitchenNote ? (
                <span className="rounded-lg bg-pur-event-soft px-2.5 py-1 text-sm font-semibold text-pur-event">
                  Tiene una nota
                </span>
              ) : null}
              {o.status === 'sent' ? (
                <span className="rounded-lg bg-warning/15 px-2.5 py-1 text-sm font-semibold text-warning-text">
                  {who} todavía no confirmó
                </span>
              ) : null}
            </span>
          </span>
          <ChevronRight className="size-6 shrink-0 text-primary" aria-hidden />
        </Link>
      </li>
    )
  }

  return (
    <div className="mx-auto w-full max-w-xl pb-8">
      <Link
        href={`/${slug}/salon/stock`}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Inicio
      </Link>
      <h1 className="mt-1 font-serif text-[2rem] font-semibold leading-tight tracking-[-0.015em] text-primary">
        ¿Qué llegó?
      </h1>
      <p className="text-muted-foreground">Tocá el proveedor que acaba de llegar.</p>

      {orders.length === 0 ? (
        <p className="card-hairline mt-6 rounded-3xl bg-card p-5 text-muted-foreground shadow-xs">
          No hay pedidos en camino. Cuando {who === 'Compras' ? 'se manda' : `${who} manda`} un
          pedido, aparece acá.
        </p>
      ) : null}

      {dueToday.length ? (
        <section className="mt-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Hoy
          </h2>
          <ul className="mt-2 space-y-3">{dueToday.map((o) => card(o, true))}</ul>
        </section>
      ) : null}
      {later.length ? (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Próximos días
          </h2>
          <ul className="mt-2 space-y-3">{later.map((o) => card(o, false))}</ul>
        </section>
      ) : null}
    </div>
  )
}
