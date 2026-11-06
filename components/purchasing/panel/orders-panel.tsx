import { ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  addDays,
  capitalizeFirst,
  formatDayMonth,
  isoDayInCordoba,
  WEEKDAY_NAMES,
  weekdayOf,
} from '@/lib/dates'
import { relativeDayLabel } from '@/lib/purchasing/dates'
import type { PanelData } from '@/lib/purchasing/queries'
import { COUNT_KIND_LABELS, expectedPacks, type PurOrder } from '@/lib/purchasing/types'
import { cn } from '@/lib/utils'
import { DataIssues } from './data-issues'
import { DifferencesCard } from './differences-card'
import { DraftCard } from './draft-card'
import { PanelActions } from './panel-actions'
import { SentCard } from './sent-card'
import { UpcomingEvents } from './upcoming-events'

function Metric({
  href,
  value,
  label,
  hint,
  tone,
}: {
  href: string
  value: number
  label: string
  hint?: string
  tone: 'primary' | 'plain' | 'alert'
}) {
  return (
    <a
      href={href}
      className={cn(
        'rounded-2xl p-4 shadow-xs transition-transform active:scale-[0.99] sm:p-5',
        tone === 'primary' && 'bg-primary text-primary-foreground',
        tone === 'plain' && 'card-hairline bg-card',
        tone === 'alert' && 'border border-destructive/35 bg-destructive/10',
      )}
    >
      <span
        className={cn(
          'block font-serif text-4xl font-semibold leading-none tabular-nums',
          tone === 'alert' && 'text-destructive',
        )}
      >
        {value}
      </span>
      <span
        className={cn(
          'mt-2 block text-sm',
          tone === 'primary' ? 'text-primary-foreground/85' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      {hint ? (
        <span
          className={cn(
            'block text-xs',
            tone === 'primary' ? 'text-primary-foreground/70' : 'text-muted-foreground',
          )}
        >
          {hint}
        </span>
      ) : null}
    </a>
  )
}

function SectionTitle({
  n,
  title,
  hint,
  id,
}: {
  n: number
  title: string
  hint: string
  id: string
}) {
  return (
    <div
      id={id}
      className="flex scroll-mt-24 flex-col gap-1 pt-2 md:flex-row md:items-end md:justify-between"
    >
      <h2 className="font-serif text-2xl font-semibold leading-tight">
        <span className="text-muted-foreground">{n} ·</span> {title}
      </h2>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border px-5 py-4 text-sm text-muted-foreground">
      {children}
    </p>
  )
}

/** El panel de quien compra: un pedido por proveedor, en cuatro estados, y lo que falta corregir. */
export function OrdersPanel({
  slug,
  tenantName,
  data,
}: {
  slug: string
  tenantName: string
  data: PanelData
}) {
  const { catalog, today } = data
  const suppliers = new Map(catalog.suppliers.map((s) => [s.id, s]))
  const activeSuppliers = catalog.suppliers.filter((s) => s.active)
  const activeItems = catalog.items.filter((i) => i.active)
  const senderName = catalog.settings.senderName ?? tenantName
  const supplierOf = (o: PurOrder) => (o.supplierId ? (suppliers.get(o.supplierId) ?? null) : null)
  const byName = (a: PurOrder, b: PurOrder) => {
    const an = supplierOf(a)?.name
    const bn = supplierOf(b)?.name
    if (!an) return 1
    if (!bn) return -1
    return an.localeCompare(bn, 'es')
  }
  const drafts = [...data.drafts].sort(byName)
  const draftProducts = drafts.reduce(
    (n, o) => n + o.lines.filter((l) => (l.orderedPacks ?? 1) > 0).length,
    0,
  )
  const week = data.upcoming.filter((e) => e.event.date <= addDays(today, 6))
  const count = data.openCount

  return (
    <PageShell className="space-y-7">
      <PageHeader
        eyebrow="Compras · Pedidos"
        title={`${capitalizeFirst(WEEKDAY_NAMES[weekdayOf(today)] ?? '')} ${formatDayMonth(today)}`}
        description="La cocina cuenta, el sistema calcula cuánto pedir y vos revisás y mandás cada pedido."
        actions={
          <>
            <PanelActions slug={slug} settings={catalog.settings} tenantName={tenantName} />
            <Link
              href={`/${slug}/salon/stock`}
              target="_blank"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-3.5 text-sm font-medium shadow-xs hover:bg-muted"
            >
              <ExternalLink className="size-4" aria-hidden />
              Abrir la cocina
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          href="#pur-drafts"
          value={drafts.length}
          label="para revisar y mandar"
          hint={
            draftProducts
              ? `${draftProducts} ${draftProducts === 1 ? 'producto' : 'productos'}`
              : undefined
          }
          tone={drafts.length ? 'primary' : 'plain'}
        />
        <Metric
          href="#pur-sent"
          value={data.sent.length}
          label="enviados, falta confirmar"
          tone="plain"
        />
        <Metric href="#pur-coming" value={data.confirmed.length} label="por llegar" tone="plain" />
        <Metric
          href="#pur-diffs"
          value={data.differences.length}
          label="llegaron con diferencias"
          tone={data.differences.length ? 'alert' : 'plain'}
        />
      </div>

      {count ? (
        <p className="rounded-2xl bg-pur-event-soft px-5 py-3 text-[0.95rem] text-pur-event">
          La cocina está contando: {COUNT_KIND_LABELS[count.kind]} ·{' '}
          {relativeDayLabel(count.countDate, today)} · {count.countedByName}. Cuando lo mande, el
          pedido aparece acá.
        </p>
      ) : null}

      <section id="pur-upcoming" className="scroll-mt-24 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Próximos 7 días
        </h2>
        <UpcomingEvents slug={slug} today={today} events={week} />
      </section>

      <DataIssues slug={slug} issues={data.issues} />

      <section className="space-y-3">
        <SectionTitle
          id="pur-drafts"
          n={1}
          title="Para revisar y mandar"
          hint="El sistema calculó cuánto pedir. Cambiá solo lo que no te cierre."
        />
        {drafts.length ? (
          drafts.map((o, i) => (
            <DraftCard
              key={o.id}
              slug={slug}
              today={today}
              order={o}
              supplier={supplierOf(o)}
              suppliers={activeSuppliers}
              items={activeItems}
              zones={catalog.zones}
              senderName={senderName}
              defaultOpen={i === 0}
            />
          ))
        ) : (
          <Empty>
            Nada para revisar. Cuando la cocina mande un conteo, cada proveedor aparece acá con su
            pedido.
          </Empty>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle
          id="pur-sent"
          n={2}
          title="Enviados: confirmá con el proveedor"
          hint="Cuando te contesta, confirmás acá. Recién ahí le aparece a la cocina sin aviso."
        />
        {data.sent.length ? (
          [...data.sent]
            .sort(byName)
            .map((o) => (
              <SentCard key={o.id} slug={slug} today={today} order={o} supplier={supplierOf(o)} />
            ))
        ) : (
          <Empty>No hay pedidos esperando respuesta.</Empty>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle
          id="pur-coming"
          n={3}
          title="Por llegar"
          hint="No tenés que hacer nada: la cocina los recibe desde el celular."
        />
        {data.confirmed.length ? (
          <div className="card-hairline overflow-hidden rounded-2xl bg-card shadow-xs">
            <div className="hidden grid-cols-[8rem_minmax(0,1.2fr)_6rem_minmax(0,2fr)] gap-4 border-b border-border/70 px-5 py-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:grid">
              <span>Entrega</span>
              <span>Proveedor</span>
              <span className="text-right">Productos</span>
              <span>Nota para cocina</span>
            </div>
            <ul className="divide-y divide-border/70">
              {data.confirmed.map((o) => {
                const late = o.expectedDate != null && o.expectedDate < today
                const products = o.lines.filter((l) => expectedPacks(l) > 0).length
                return (
                  <li
                    key={o.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-3 md:grid-cols-[8rem_minmax(0,1.2fr)_6rem_minmax(0,2fr)]"
                  >
                    <span className="font-semibold first-letter:uppercase md:order-none">
                      {o.expectedDate ? relativeDayLabel(o.expectedDate, today) : 'Sin fecha'}
                      {late ? (
                        <span className="ml-2 rounded-md bg-warning/15 px-1.5 py-0.5 text-xs text-warning-text">
                          atrasado
                        </span>
                      ) : null}
                    </span>
                    <span className="text-right md:text-left">
                      {supplierOf(o)?.name ?? 'Sin proveedor'}
                    </span>
                    <span className="text-sm text-muted-foreground md:text-right md:text-base md:text-foreground">
                      {products}{' '}
                      <span className="md:hidden">{products === 1 ? 'producto' : 'productos'}</span>
                    </span>
                    <span className="col-span-2 text-sm text-muted-foreground md:col-span-1">
                      {o.kitchenNote ??
                        (o.confirmedWithChanges ? 'Con cambios del proveedor' : '–')}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <Empty>No hay pedidos confirmados por llegar.</Empty>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle
          id="pur-diffs"
          n={4}
          title="Llegaron con diferencias"
          hint="Lo que faltó vuelve solo en el próximo pedido sugerido."
        />
        {data.differences.length ? (
          data.differences.map((o) => (
            <DifferencesCard
              key={o.id}
              slug={slug}
              order={o}
              supplier={supplierOf(o)}
              senderName={senderName}
            />
          ))
        ) : (
          <Empty>Todo lo que llegó, llegó bien.</Empty>
        )}
      </section>

      {data.closed.length ? (
        <details className="card-hairline rounded-2xl bg-card shadow-xs">
          <summary className="cursor-pointer list-none px-5 py-4 font-semibold">
            Historial de los últimos 14 días{' '}
            <span className="font-normal text-muted-foreground">· {data.closed.length}</span>
          </summary>
          <ul className="divide-y divide-border/70 border-t border-border/70">
            {data.closed.map((o) => {
              const day = isoDayInCordoba(o.closedAt ?? o.discardedAt ?? o.createdAt)
              return (
                <li
                  key={o.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-5 py-3 text-[0.95rem]"
                >
                  <span className="font-medium">{supplierOf(o)?.name ?? 'Sin proveedor'}</span>
                  <span className="text-sm text-muted-foreground">
                    {o.status === 'completed'
                      ? `Completado${o.receivedByName ? ` · recibió ${o.receivedByName}` : ''}`
                      : o.discardReason === 'superseded'
                        ? 'Reemplazado por un conteo más nuevo'
                        : 'Hoy no se pidió'}
                    {day ? ` · ${formatDayMonth(day)}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </details>
      ) : null}
    </PageShell>
  )
}
