import {
  AlarmClock,
  CalendarCheck,
  CalendarDays,
  FilePlus2,
  FileText,
  HandCoins,
  Info,
  Receipt,
  Undo2,
} from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { BlockError, PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { closesByDay, missingDays } from '@/components/administracion/cajas-ventas/closes'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { MonthStepper, RangeFilter } from '@/components/administracion/cajas-ventas/period-filters'
import {
  firstParam,
  hrefWith,
  type PageSearchParams,
  periodParams,
  type RangeValue,
  resolveMonth,
  resolveRange,
} from '@/components/administracion/cajas-ventas/periods'
import { ActionButton, QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { SectionNav } from '@/components/administracion/section-nav'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { StatCard } from '@/components/ui/stat-card'
import { getNetByMethod, getSalesSummary } from '@/lib/accounting/queries/books'
import { listDocuments } from '@/lib/accounting/queries/documents'
import { CHANNEL_LABELS, exportHref, SALES_INVOICE_KINDS } from '@/lib/accounting/queries/labels'
import { listParties } from '@/lib/accounting/queries/parties'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { CHANNELS } from '@/lib/accounting/types'
import {
  addDays,
  formatDayMonth,
  monthOf,
  serviceDayInCordoba,
  todayInCordoba,
  weekdayName,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { ClosesCalendar } from './_components/closes-calendar'
import { SalesDocumentsList } from './_components/documents-list'
import { NetByMethod } from './_components/net-by-method'
import { type ReceivableFilter, ReceivablesFilters } from './_components/receivables-filters'
import { ReceivablesList } from './_components/receivables-list'
import { VentasHeaderActions } from './_components/ventas-header-actions'

export const metadata = { title: 'Ventas y clientes' }

const TABS = ['cierres', 'clientes', 'cobros', 'neto-por-medio', 'facturas'] as const
type Tab = (typeof TABS)[number]

function parseTab(value: string | null): Tab {
  return (TABS as readonly string[]).includes(value ?? '') ? (value as Tab) : 'cierres'
}

type TabProps = {
  tenantId: string
  tenantSlug: string
  base: string
  today: string
  sp: PageSearchParams
  canWrite: boolean
}

export default async function VentasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<PageSearchParams>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const tab = parseTab(firstParam(sp.tab))
  const { access, canWrite } = await requireAdminPage(
    tenantSlug,
    tab === 'cierres' ? `${base}/ventas` : `${base}/ventas?tab=${tab}`,
  )
  const props: TabProps = {
    tenantId: access.tenant.id,
    tenantSlug,
    base,
    today: todayInCordoba(),
    sp,
    canWrite,
  }
  const tabHref = (value: Tab) =>
    value === 'cierres' ? `${base}/ventas` : `${base}/ventas?tab=${value}`

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title={
          <>
            Ventas y clientes <ReadOnlyBadge />
          </>
        }
        description="Lo vendido cada día, quién te debe y cuánto llega de verdad después de los descuentos."
        actions={<VentasHeaderActions base={base} />}
      />

      <SectionNav
        label="Secciones de Ventas y clientes"
        active={tab}
        items={[
          {
            value: 'cierres',
            label: 'Cierres del día',
            shortLabel: 'Cierres',
            href: tabHref('cierres'),
          },
          {
            value: 'clientes',
            label: 'Clientes y plataformas',
            shortLabel: 'Clientes',
            href: tabHref('clientes'),
          },
          { value: 'cobros', label: 'Cobros', href: tabHref('cobros') },
          {
            value: 'neto-por-medio',
            label: 'Neto por medio',
            shortLabel: 'Neto',
            href: tabHref('neto-por-medio'),
          },
          { value: 'facturas', label: 'Facturas', href: tabHref('facturas') },
        ]}
      />

      {tab === 'cierres' ? <CierresTab {...props} /> : null}
      {tab === 'clientes' ? <ClientesTab {...props} /> : null}
      {tab === 'cobros' ? <CobrosTab {...props} /> : null}
      {tab === 'neto-por-medio' ? <NetoTab {...props} /> : null}
      {tab === 'facturas' ? <FacturasTab {...props} /> : null}

      <QuickActionsBar />
    </PageShell>
  )
}

// ─── Cierres del día ─────────────────────────────────────────────────────────

async function CierresTab({ tenantId, tenantSlug, base, today, sp, canWrite }: TabProps) {
  const month = resolveMonth(sp, today)
  const settings = await settleQuery(getAccountingSettings(tenantId))
  const booksStart = settings.ok && settings.data ? settings.data.booksStartDate : today
  const minMonth = monthOf(booksStart)
  if (!month.ok) {
    return (
      <div className="space-y-6">
        <MonthStepper month={monthOf(today)} today={today} minMonth={minMonth} />
        <PeriodError message={month.message} />
      </div>
    )
  }

  const serviceDay = serviceDayInCordoba()
  const windowFrom = addDays(serviceDay, -31)
  const [docs, recent, summary] = await Promise.all([
    settleQuery(
      listDocuments(tenantId, {
        from: month.from,
        to: month.to,
        kinds: ['sales_close'],
        status: 'posted',
        limit: 200,
      }),
    ),
    // Los últimos 30 días (pueden caer en el mes anterior): para «Cargar el de…».
    settleQuery(
      listDocuments(tenantId, {
        from: windowFrom,
        to: serviceDay,
        kinds: ['sales_close'],
        status: 'posted',
        limit: 200,
      }),
    ),
    settleQuery(getSalesSummary(tenantId, { from: month.from, to: month.to })),
  ])
  if (!docs.ok) {
    return (
      <div className="space-y-6">
        <MonthStepper month={month.month} today={today} minMonth={minMonth} />
        <BlockError message={docs.message} />
      </div>
    )
  }

  const closes = closesByDay(docs.data.rows)
  const sold = docs.data.rows.reduce((acc, d) => acc + d.totalCents, 0)
  const missing = recent.ok
    ? missingDays({
        closedDays: new Set(recent.data.rows.map((d) => d.accountingDate)),
        booksStart,
        serviceDay,
      })
    : []
  const firstMissing = missing[0] ?? null

  // Lo vendido por canal, facturado y sin factura (F.12), si la base ya lo tiene.
  const channels = summary.ok
    ? CHANNELS.map((channel) => {
        const rows = summary.data.filter((r) => r.channel === channel)
        return {
          channel,
          soldCents: rows.reduce((acc, r) => acc + r.soldCents, 0),
          invoicedNetCents: rows.reduce((acc, r) => acc + r.invoicedNetCents, 0),
          vatCents: rows.reduce((acc, r) => acc + r.vatCents, 0),
          uninvoicedCents: rows.reduce((acc, r) => acc + r.uninvoicedCents, 0),
        }
      })
    : null
  const invoiced = channels?.reduce((acc, c) => acc + c.invoicedNetCents + c.vatCents, 0) ?? null
  const uninvoiced = channels?.reduce((acc, c) => acc + c.uninvoicedCents, 0) ?? null
  const channelHint = channels
    ? channels
        .map((c) => `${CHANNEL_LABELS[c.channel]} ${formatCentsShort(c.soldCents)}`)
        .join(' · ')
    : null
  const loadedDays = closes.size
  const isCurrentMonth = month.month === monthOf(today)
  const nothingYet =
    docs.data.rows.length === 0 &&
    isCurrentMonth &&
    (recent.ok ? recent.data.rows.length === 0 : true)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthStepper month={month.month} today={today} minMonth={minMonth} />
        {canWrite && firstMissing ? (
          <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
            <Link href={`${base}/ventas/cierre?fecha=${firstMissing}`}>
              <CalendarCheck className="size-4" aria-hidden />
              Cargar el del {weekdayName(firstMissing)} {formatDayMonth(firstMissing)}
            </Link>
          </Button>
        ) : null}
      </div>

      {nothingYet ? (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <div className="space-y-1 text-pretty">
            <p className="font-medium">Todavía no hay cierres cargados.</p>
            <p className="text-muted-foreground">
              {canWrite
                ? 'El cierre del día es copiar los números del cierre de caja de Thinkeon: por medio de cobro y lo facturado. Lleva menos de un minuto y con eso se arman las ventas, el IVA y lo que te deben las tarjetas y plataformas.'
                : 'Cuando los dueños carguen los cierres del día, vas a ver acá lo vendido de cada día.'}
            </p>
          </div>
        </div>
      ) : null}

      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Lo vendido en el mes"
      >
        <StatCard
          icon={Receipt}
          iconClassName="text-success"
          label="Vendido"
          value={formatCentsShort(sold)}
          hint={channelHint ?? month.label}
        />
        <StatCard
          icon={FileText}
          iconClassName="text-info"
          label="Facturado"
          value={invoiced === null ? '—' : formatCentsShort(invoiced)}
          hint={invoiced === null ? 'Disponible en unos minutos' : 'Con IVA'}
        />
        <StatCard
          icon={FilePlus2}
          iconClassName="text-warning"
          label="Sin factura"
          value={uninvoiced === null ? '—' : formatCentsShort(uninvoiced)}
          hint="No genera IVA débito"
        />
        <StatCard
          icon={CalendarDays}
          iconClassName="text-primary"
          label="Días cargados"
          value={String(loadedDays)}
          hint={
            missing.length > 0
              ? `Faltan ${missing.length} de los últimos 30 días`
              : 'No falta ninguno'
          }
        />
      </section>

      <ClosesCalendar
        month={month.month}
        closes={closes}
        booksStart={booksStart}
        serviceDay={serviceDay}
        today={today}
        base={base}
        canWrite={canWrite}
        exportHref={exportHref(tenantSlug, 'subdiario-ventas', {
          desde: month.from,
          hasta: month.to,
        })}
        exportFileName={`administracion-${tenantSlug}-subdiario-ventas-${month.month}.csv`}
      />

      {channels?.some((c) => c.soldCents !== 0 || c.invoicedNetCents !== 0) ? (
        <DataTableShell>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="max-w-2xl">
              <h2 className="font-serif text-lg font-semibold tracking-tight">Por canal</h2>
              <p className="text-xs text-muted-foreground text-pretty">
                Las ventas sin factura no generan IVA débito. Cómo se registran lo define la
                contadora.
              </p>
            </div>
            <ExportButton
              href={exportHref(tenantSlug, 'ventas-sin-factura', {
                desde: month.from,
                hasta: month.to,
              })}
              fileName={`administracion-${tenantSlug}-ventas-sin-factura-${month.month}.csv`}
              label="Exportar ventas sin factura"
              size="sm"
              className="h-11 md:h-8"
            />
          </header>
          <DataTableScroll>
            <DataTableRoot>
              <caption className="sr-only">Vendido, facturado y sin factura por canal</caption>
              <DataTableHead>
                <tr>
                  <DataTableHeader>Canal</DataTableHeader>
                  <DataTableHeader className="text-right">Vendido</DataTableHeader>
                  <DataTableHeader className="text-right">Facturado neto</DataTableHeader>
                  <DataTableHeader className="text-right">IVA débito</DataTableHeader>
                  <DataTableHeader className="text-right">Sin factura</DataTableHeader>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {channels.map((c) => (
                  <tr key={c.channel}>
                    <DataTableCell className="font-medium">
                      {CHANNEL_LABELS[c.channel]}
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={c.soldCents} />
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={c.invoicedNetCents} />
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={c.vatCents} />
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={c.uninvoicedCents} />
                    </DataTableCell>
                  </tr>
                ))}
              </DataTableBody>
            </DataTableRoot>
          </DataTableScroll>
        </DataTableShell>
      ) : null}
    </div>
  )
}

// ─── Clientes y plataformas ──────────────────────────────────────────────────

function parseFilter(value: string | null): ReceivableFilter {
  return value === 'con-deuda' || value === 'atrasados' || value === 'a-favor' ? value : 'todos'
}

async function ClientesTab({ tenantId, tenantSlug, base, today, sp, canWrite }: TabProps) {
  const q = firstParam(sp.q)
  const filter = parseFilter(firstParam(sp.filtro))
  const list = await settleQuery(listParties(tenantId, { group: 'receivables', q, filter: 'all' }))
  if (!list.ok) return <BlockError message={list.message} />

  const { rows: all, totals } = list.data
  const counts: Record<ReceivableFilter, number> = {
    todos: all.length,
    'con-deuda': all.filter((r) => r.debtCents > 0).length,
    atrasados: all.filter((r) => r.overdueCents > 0).length,
    'a-favor': all.filter((r) => r.creditCents > 0).length,
  }
  const rows = all.filter((r) =>
    filter === 'con-deuda'
      ? r.debtCents > 0
      : filter === 'atrasados'
        ? r.overdueCents > 0
        : filter === 'a-favor'
          ? r.creditCents > 0
          : true,
  )
  const brandNew = totals.debtCents === 0 && totals.creditCents === 0 && !q

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Lo que te deben">
        <StatCard
          icon={HandCoins}
          iconClassName="text-primary"
          label="Te deben"
          value={formatCentsShort(totals.debtCents)}
          hint="Tarjetas, billeteras, plataformas y clientes"
        />
        <StatCard
          icon={AlarmClock}
          iconClassName={totals.overdueCents > 0 ? 'text-destructive' : 'text-success'}
          label="Atrasado"
          value={formatCentsShort(totals.overdueCents)}
          hint={totals.overdueCents > 0 ? 'Ya se tendría que haber acreditado' : 'Nada atrasado'}
        />
        <StatCard
          icon={CalendarDays}
          iconClassName="text-info"
          label="Se acredita en 7 días"
          value={formatCentsShort(totals.dueSoonCents)}
        />
        <StatCard
          icon={Undo2}
          iconClassName="text-warning"
          label="A favor"
          value={formatCentsShort(totals.creditCents)}
          hint="Anticipos de clientes y lo que les debemos a las plataformas"
        />
      </section>

      {brandNew ? (
        <EmptyState
          icon={HandCoins}
          title="Todavía nadie te debe"
          description="Cuando cargues cierres del día con tarjetas, plataformas o cuenta corriente, acá vas a ver quién te debe y cuándo te paga."
          action={
            canWrite ? (
              <Button asChild className="gap-2">
                <Link href={`${base}/ventas/cierre`}>
                  <CalendarCheck className="size-4" aria-hidden />
                  Cargar cierre
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <ReceivablesFilters active={filter} counts={counts} />
          <div className="flex justify-end">
            <ExportButton
              href={exportHref(tenantSlug, 'saldos-clientes', { hasta: today })}
              fileName={`administracion-${tenantSlug}-saldos-clientes-${today}.csv`}
              className="h-11 md:h-9"
            />
          </div>
          {rows.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title="Sin resultados"
              description="Probá con otro filtro o buscá por otro nombre o CUIT."
            />
          ) : (
            <ReceivablesList rows={rows} total={all.length} base={base} />
          )}
        </>
      )}
    </div>
  )
}

// ─── Cobros, neto por medio y facturas (con período) ─────────────────────────

/** El período de la pestaña: el de la URL o el mes en curso. */
function rangeOrError(sp: PageSearchParams, today: string) {
  const range = resolveRange(sp, today)
  const picker: RangeValue = range.ok
    ? range
    : { kind: 'month', month: monthOf(today), from: today, to: today, label: '' }
  return { range, picker }
}

function Pager({
  path,
  range,
  extra,
  nextCursor,
  isFirst,
}: {
  path: string
  range: RangeValue
  extra: Record<string, string | null>
  nextCursor: string | null
  isFirst: boolean
}) {
  if (!nextCursor && isFirst) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {!isFirst ? (
        <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
          <Link href={hrefWith(path, { ...extra, ...periodParams(range) })}>
            Volver al principio
          </Link>
        </Button>
      ) : (
        <span />
      )}
      {nextCursor ? (
        <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
          <Link href={hrefWith(path, { ...extra, ...periodParams(range), despues: nextCursor })}>
            Ver los siguientes
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

async function CobrosTab({ tenantId, tenantSlug, base, today, sp }: TabProps) {
  const { range, picker } = rangeOrError(sp, today)
  const after = firstParam(sp.despues)
  const page = range.ok
    ? await settleQuery(
        listDocuments(tenantId, {
          from: range.from,
          to: range.to,
          kinds: ['collection'],
          status: 'all',
          after,
        }),
      )
    : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeFilter range={picker} today={today} />
        {range.ok ? (
          <ExportButton
            href={exportHref(tenantSlug, 'subdiario-cobranzas', {
              desde: range.from,
              hasta: range.to,
            })}
            fileName={`administracion-${tenantSlug}-subdiario-cobranzas-${range.from}-${range.to}.csv`}
            className="h-11 md:h-9"
          />
        ) : null}
      </div>
      {!range.ok ? (
        <PeriodError message={range.message} />
      ) : !page?.ok ? (
        <BlockError message={page?.message ?? ''} />
      ) : page.data.rows.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="No hay cobros en este período"
          description="Las liquidaciones de tarjetas y plataformas, y lo que te pagan los clientes, se registran con «Registrar un cobro». Mercado Pago se acredita con «Ajustar saldo»."
          action={
            <ActionButton action="cobrar" className="gap-2">
              <HandCoins className="size-4" aria-hidden />
              Registrar un cobro
            </ActionButton>
          }
        />
      ) : (
        <>
          <SalesDocumentsList
            mode="collections"
            rows={page.data.rows}
            total={page.data.totalRows}
            base={base}
            today={today}
          />
          <Pager
            path={`${base}/ventas`}
            range={range}
            extra={{ tab: 'cobros' }}
            nextCursor={page.data.nextCursor}
            isFirst={after === null}
          />
        </>
      )}
    </div>
  )
}

async function NetoTab({ tenantId, tenantSlug, today, sp }: TabProps) {
  const { range, picker } = rangeOrError(sp, today)
  const rows = range.ok
    ? await settleQuery(getNetByMethod(tenantId, { from: range.from, to: range.to }))
    : null
  return (
    <div className="space-y-6">
      <RangeFilter range={picker} today={today} />
      {!range.ok ? (
        <PeriodError message={range.message} />
      ) : !rows?.ok ? (
        <BlockError message={rows?.message ?? ''} />
      ) : (
        <NetByMethod
          rows={rows.data}
          label={range.label}
          exportHref={exportHref(tenantSlug, 'neto-por-medio', {
            desde: range.from,
            hasta: range.to,
          })}
          exportFileName={`administracion-${tenantSlug}-neto-por-medio-${range.from}-${range.to}.csv`}
        />
      )}
    </div>
  )
}

async function FacturasTab({ tenantId, base, today, sp, canWrite }: TabProps) {
  const { range, picker } = rangeOrError(sp, today)
  const after = firstParam(sp.despues)
  const page = range.ok
    ? await settleQuery(
        listDocuments(tenantId, {
          from: range.from,
          to: range.to,
          kinds: SALES_INVOICE_KINDS,
          status: 'all',
          after,
        }),
      )
    : null
  const newInvoice = canWrite ? (
    <Button asChild className="gap-2">
      <Link href={`${base}/ventas/nueva-factura`}>
        <FilePlus2 className="size-4" aria-hidden />
        Factura de venta
      </Link>
    </Button>
  ) : null

  return (
    <div className="space-y-6">
      <RangeFilter range={picker} today={today} />
      {!range.ok ? (
        <PeriodError message={range.message} />
      ) : !page?.ok ? (
        <BlockError message={page?.message ?? ''} />
      ) : page.data.rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No hay facturas sueltas en este período"
          description="Lo del salón y el delivery va en el cierre del día. Acá van las ventas que se facturan aparte: eventos, catering o sponsoreo."
          action={newInvoice}
        />
      ) : (
        <>
          <SalesDocumentsList
            mode="invoices"
            rows={page.data.rows}
            total={page.data.totalRows}
            base={base}
            today={today}
          />
          <Pager
            path={`${base}/ventas`}
            range={range}
            extra={{ tab: 'facturas' }}
            nextCursor={page.data.nextCursor}
            isFirst={after === null}
          />
        </>
      )}
    </div>
  )
}
