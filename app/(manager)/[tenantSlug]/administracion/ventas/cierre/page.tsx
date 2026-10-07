import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { closesByDay, missingDays } from '@/components/administracion/cajas-ventas/closes'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import {
  firstParam,
  hrefWith,
  type PageSearchParams,
} from '@/components/administracion/cajas-ventas/periods'
import { ReadOnlyBadge, ReadOnlyNotice } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { loadPostingCatalog, loadPostingContext } from '@/lib/accounting/context'
import { listDocuments } from '@/lib/accounting/queries/documents'
import { getSalesRangeDefaults } from '@/lib/accounting/queries/forms'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { CHANNELS, type Channel } from '@/lib/accounting/types'
import {
  addDays,
  formatDayMonth,
  formatIsoDay,
  formatMonthLabel,
  formatWeekdayDayMonth,
  isRealIsoDay,
  serviceDayInCordoba,
  weekdayName,
} from '@/lib/dates'
import { formatCents } from '@/lib/money'
import {
  type CloseCustomer,
  type CloseMethod,
  type CloseRangeDefault,
  type CloseSalesPoint,
  type ExistingClose,
  SalesCloseForm,
} from './_components/sales-close-form'

export const metadata = { title: 'Cierre del día' }

/** Cuántos días que faltan se muestran arriba como atajo. */
const MISSING_SHORTCUTS = 4

function dayTitle(day: string): string {
  return `${weekdayName(day)} ${formatIsoDay(day)}`
}

/**
 * Cierre del día (H.9, `/ventas/cierre?fecha=`): el espejo del cierre de caja
 * de Thinkeon. Sin `?fecha=` abre el primer día que falta (hasta 30 días
 * atrás) o, si no falta ninguno, el día de servicio (antes de las 5:00 es
 * ayer). Un día ya cargado muestra sus cierres y deja cargar otro turno.
 */
export default async function CierreDelDiaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<PageSearchParams>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const { access, canWrite } = await requireAdminPage(tenantSlug, `${base}/ventas/cierre`)

  const back = (
    <Link
      href={`${base}/ventas`}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3" aria-hidden />
      Volver a ventas
    </Link>
  )
  const header = (
    <PageHeader
      eyebrow="Administración"
      title={
        <>
          Cierre del día <ReadOnlyBadge />
        </>
      }
      description="Copiá los números del cierre de caja de Thinkeon. Si un medio no tuvo ventas, dejalo vacío."
    />
  )

  if (!canWrite) {
    return (
      <PageShell width="comfortable">
        {back}
        {header}
        <ReadOnlyNotice
          description="El cierre del día lo cargan los dueños. Con Contabilidad ves cada cierre en Ventas › Cierres del día."
          href={`${base}/ventas`}
          linkLabel="Ir a Cierres del día"
        />
      </PageShell>
    )
  }

  const tenantId = access.tenant.id
  const serviceDay = serviceDayInCordoba()
  const [catalog, ctx, firstOpenDate, recent] = await Promise.all([
    loadPostingCatalog(tenantId),
    loadPostingContext(tenantId),
    loadFirstOpenDate(tenantId),
    // Los últimos 30 días (igual que el calendario de Ventas): para saber qué días faltan.
    settleQuery(
      listDocuments(tenantId, {
        from: addDays(serviceDay, -31),
        to: serviceDay,
        kinds: ['sales_close'],
        status: 'posted',
        limit: 200,
      }),
    ),
  ])
  const booksStart = catalog.settings.booksStartDate

  const missing = recent.ok
    ? missingDays({
        closedDays: new Set(closesByDay(recent.data.rows).keys()),
        booksStart,
        serviceDay,
      })
    : []
  const requested = firstParam(sp.fecha)
  const date =
    requested && isRealIsoDay(requested)
      ? requested
      : (missing[0] ?? maxDay(booksStart, serviceDay))

  const prev = addDays(date, -1)
  const next = addDays(date, 1)
  const canPrev = prev >= booksStart
  const canNext = next <= serviceDay
  // Los otros días sin cierre (el que se está mirando no se repite).
  const pending = missing.filter((d) => d !== date)
  const otherMissing = pending.slice(0, MISSING_SHORTCUTS)
  const alsoMissing = missing.includes(date)
  const missingLabel =
    pending.length === 1
      ? alsoMissing
        ? 'También falta:'
        : 'Falta:'
      : `${alsoMissing ? 'También faltan' : 'Faltan'} ${pending.length}:`

  const dayNav = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <nav
        aria-label="Día del cierre"
        className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/60 md:p-1"
      >
        <DayStep
          href={canPrev ? hrefWith(`${base}/ventas/cierre`, { fecha: prev }) : null}
          label={`Día anterior: ${dayTitle(prev)}`}
        >
          <ChevronLeft className="size-4" />
        </DayStep>
        <div className="flex items-center gap-2 px-1.5">
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          <span className="min-w-[152px] text-center text-sm font-medium tabular-nums">
            {dayTitle(date)}
          </span>
        </div>
        <DayStep
          href={canNext ? hrefWith(`${base}/ventas/cierre`, { fecha: next }) : null}
          label={`Día siguiente: ${dayTitle(next)}`}
        >
          <ChevronRight className="size-4" />
        </DayStep>
      </nav>
      {otherMissing.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{missingLabel}</span>
          {otherMissing.map((d) => (
            <Button key={d} asChild variant="outline" size="sm" className="h-11 md:h-8">
              <Link href={hrefWith(`${base}/ventas/cierre`, { fecha: d })}>
                {formatWeekdayDayMonth(d)}
              </Link>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )

  // ─── Días que no se cargan acá ─────────────────────────────────────────────
  const notice = (message: string, link: { href: string; label: string } | null) => (
    <PageShell width="comfortable">
      {back}
      {header}
      {dayNav}
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="space-y-3">
          <p className="text-pretty">{message}</p>
          {link ? (
            <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </PageShell>
  )

  if (date < booksStart) {
    return notice(
      `Administración arranca el ${formatIsoDay(booksStart)}: las ventas de antes no se cargan acá.`,
      {
        href: hrefWith(`${base}/ventas/cierre`, { fecha: maxDay(booksStart, serviceDay) }),
        label: `Ir al ${formatDayMonth(maxDay(booksStart, serviceDay))}`,
      },
    )
  }
  if (date > serviceDay) {
    return notice(
      `El ${dayTitle(date)} todavía no llegó: el cierre se carga después de la noche.`,
      {
        href: hrefWith(`${base}/ventas/cierre`, { fecha: serviceDay }),
        label: `Ir al cierre del ${weekdayName(serviceDay)} ${formatDayMonth(serviceDay)}`,
      },
    )
  }

  // Los cierres ya cargados de ese día (un día puede tener varios turnos).
  const dayCloses = await settleQuery(
    listDocuments(tenantId, {
      from: date,
      to: date,
      kinds: ['sales_close'],
      status: 'posted',
      limit: 20,
    }),
  )
  const existing: ExistingClose[] = dayCloses.ok
    ? dayCloses.data.rows.map((d) => ({
        id: d.id,
        title: d.description.trim() !== '' ? d.description : d.title,
        totalCents: d.totalCents,
      }))
    : []

  if (firstOpenDate && date < firstOpenDate) {
    const first = existing[0]
    return notice(
      `${formatMonthLabel(date)} está cerrado: no se pueden cargar ni cambiar cierres de ese mes.${
        first ? ` El de ese día suma ${formatCents(first.totalCents)}.` : ''
      }`,
      first ? { href: `${base}/comprobantes/${first.id}`, label: 'Ver el cierre' } : null,
    )
  }

  // ─── El formulario ─────────────────────────────────────────────────────────
  const methods: CloseMethod[] = catalog.methods
    .filter((m) => m.active)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'))
    .map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      channel: m.channel,
      destination: destinationOf(m, date, catalog),
      isCash:
        m.kind === 'treasury' &&
        catalog.treasuries.some((t) => t.id === m.treasuryAccountId && t.kind === 'cash'),
    }))

  const salesPoints: CloseSalesPoint[] = catalog.salesPoints
    .filter((p) => p.active)
    .sort((a, b) => a.number - b.number)
    .map((p) => ({ number: p.number, label: p.label, defaultChannel: p.defaultChannel }))

  // El último «hasta» de cada tipo y punto de venta (la base lo trae desde la #13).
  const ranges = await settleQuery(getSalesRangeDefaults(tenantId))
  const rangeDefaults: CloseRangeDefault[] = ranges.ok
    ? ranges.data
        .filter((r) => r.pointOfSale > 0 && r.lastNumberTo >= 0)
        .map((r) => ({
          voucherType: r.voucherType,
          pointOfSale: r.pointOfSale,
          channel: isChannel(r.channel) ? r.channel : null,
          lastNumberTo: r.lastNumberTo,
        }))
    : []

  const customers: CloseCustomer[] = catalog.parties
    .filter((p) => p.kind === 'customer' && p.systemKey === null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      tradeName: p.tradeName,
      taxId: p.taxId,
      ivaCondition: p.ivaCondition,
      active: p.active,
    }))

  // Después de guardar: el próximo día que falta (o la lista de cierres si no falta ninguno).
  const after = missing.find((d) => d !== date) ?? null

  return (
    <PageShell width="comfortable">
      {back}
      {header}
      {dayNav}
      {!recent.ok || !dayCloses.ok ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="text-pretty text-warning-text">
            No pudimos revisar qué días ya están cargados. Si este día ya tiene cierre, al guardar
            te avisamos.
          </p>
        </div>
      ) : null}
      <SalesCloseForm
        key={date}
        tenantSlug={tenantSlug}
        date={date}
        dayLabel={`${weekdayName(date)} ${formatDayMonth(date)}`}
        ctx={ctx}
        firstOpenDate={firstOpenDate}
        methods={methods}
        salesPoints={salesPoints}
        rangeDefaults={rangeDefaults}
        customers={customers}
        existing={existing}
        afterSaveHref={
          after
            ? hrefWith(`${base}/ventas/cierre`, { fecha: after })
            : hrefWith(`${base}/ventas`, { mes: date.slice(0, 7) })
        }
        afterSaveLabel={after ? `${weekdayName(after)} ${formatDayMonth(after)}` : null}
      />
    </PageShell>
  )
}

function maxDay(a: string, b: string): string {
  return a > b ? a : b
}

function isChannel(value: string | null): value is Channel {
  return value !== null && (CHANNELS as readonly string[]).includes(value)
}

/** Adónde va lo cobrado con cada medio, en palabras («Caja», «Posnet · se acredita el 06/10»). */
function destinationOf(
  method: {
    kind: CloseMethod['kind']
    treasuryAccountId: string | null
    partyId: string | null
    settlementDays: number
  },
  date: string,
  catalog: Awaited<ReturnType<typeof loadPostingCatalog>>,
): string {
  const treasury = catalog.treasuries.find((t) => t.id === method.treasuryAccountId)
  const party = catalog.parties.find((p) => p.id === method.partyId)
  const partyName = party ? (party.tradeName ?? party.name) : null
  switch (method.kind) {
    case 'treasury':
      return treasury ? treasury.name : 'Caja'
    case 'settled_now':
      return `${partyName ?? treasury?.name ?? 'Mercado Pago'} (a acreditar)`
    case 'receivable': {
      const when = addDays(date, Math.max(0, method.settlementDays))
      return `${partyName ?? 'A cobrar'} · se acredita el ${formatDayMonth(when)}`
    }
    case 'customer_account':
      return 'Cuenta corriente de cada cliente'
    case 'advance':
      return 'Se descuenta de las señas'
  }
}

function DayStep({
  href,
  label,
  children,
}: {
  href: string | null
  label: string
  children: ReactNode
}) {
  if (!href) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 md:size-9"
        aria-label={label}
        disabled
      >
        {children}
      </Button>
    )
  }
  return (
    <Button asChild variant="ghost" size="icon" className="size-11 md:size-9">
      <Link href={href} aria-label={label}>
        {children}
      </Link>
    </Button>
  )
}
