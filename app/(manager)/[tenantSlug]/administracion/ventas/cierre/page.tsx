import { ChevronLeft, ChevronRight, Info } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { closesByDay, missingDays } from '@/components/administracion/cajas-ventas/closes'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import {
  firstParam,
  hrefWith,
  type PageSearchParams,
} from '@/components/administracion/cajas-ventas/periods'
import { PillLink } from '@/components/administracion/kit/pill'
import { SimplePage } from '@/components/administracion/planilla'
import { ReadOnlyBadge, ReadOnlyNotice } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { projectionUsesPos } from '@/lib/accounting/access'
import { loadPostingCatalog, loadPostingContext } from '@/lib/accounting/context'
import { posCloseFill } from '@/lib/accounting/pos-close'
import { listDocuments } from '@/lib/accounting/queries/documents'
import { getSalesRangeDefaults } from '@/lib/accounting/queries/forms'
import { getPosCloseDay } from '@/lib/accounting/queries/projection'
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
import { mpCloseTargets } from '@/lib/imports/mercadopago/daily-close'
import { getMpImportSettings } from '@/lib/imports/server/queries'
import { importSourceHref } from '@/lib/imports/ui/labels'
import { formatCents } from '@/lib/money'
import type { CloseMercadoPago } from './_components/mp-close-fill'
import {
  type CloseCustomer,
  type CloseMethod,
  type CloseRangeDefault,
  type CloseSalesPoint,
  type ExistingClose,
  SalesCloseForm,
} from './_components/sales-close-form'
import { describeCloseMethod } from './_lib/close-view'

export const metadata = { title: 'Cierre del día' }

/** Cuántos días que faltan se muestran arriba como atajo. */
const MISSING_SHORTCUTS = 4

const TITLE = 'font-serif text-2xl font-semibold tracking-tight'

function dayTitle(day: string): string {
  return `${weekdayName(day)} ${formatIsoDay(day)}`
}

/**
 * Cierre del día (H.9, `/ventas/cierre?fecha=`): la tarea de todos los días.
 * Sin `?fecha=` abre el primer día que falta (hasta 30 días atrás) o, si no
 * falta ninguno, el día de servicio (antes de las 5:00 es ayer). Un día ya
 * cargado muestra sus cierres y deja cargar otro turno.
 *
 * La página arma el marco (el título con el día, sus flechas y los días que
 * faltan) y le pasa al formulario los medios ya «vestidos»: a qué grupo va
 * cada uno, a dónde entra la plata y cuándo. Lo que se guarda lo decide el
 * formulario, igual que siempre.
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
      className="inline-flex min-h-8 items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
    >
      <ChevronLeft className="size-4" aria-hidden />
      Ventas
    </Link>
  )

  if (!canWrite) {
    return (
      <SimplePage>
        <div className="flex flex-wrap items-center gap-3">
          {back}
          <ReadOnlyBadge />
        </div>
        <h1 className={TITLE}>Cierre del día</h1>
        <ReadOnlyNotice
          description="El cierre del día lo cargan los dueños. Con Contabilidad ves cada cierre en Ventas, tocando «Ver cierre» en la planilla."
          href={`${base}/ventas`}
          linkLabel="Ir a la planilla"
        />
      </SimplePage>
    )
  }

  const tenantId = access.tenant.id
  const serviceDay = serviceDayInCordoba()
  const [catalog, ctx, firstOpenDate, recent, mp] = await Promise.all([
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
    // Para «Completar con Mercado Pago»: el medio de cada cobro y qué día cuenta.
    settleQuery(getMpImportSettings(tenantId)),
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
  // Los que no entran como atajo se dicen igual: «y 3 más».
  const moreMissing = pending.length - otherMissing.length

  // La primera fila: volver, los días que faltan y las flechas. Abajo, el título con el día.
  const frame = (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {back}
        {otherMissing.length > 0 ? (
          // En el celular, UNA fila que se desliza de costado: son atajos, no pueden ocupar más que
          // el primer campo.
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto text-sm whitespace-nowrap [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:whitespace-normal">
            <span className="text-muted-foreground">{missingLabel}</span>
            {otherMissing.map((d) => (
              // En ámbar: «falta» es un estado, y lo dice la palabra de al lado.
              <PillLink
                key={d}
                href={hrefWith(`${base}/ventas/cierre`, { fecha: d })}
                className="h-11 border-warning/30 bg-warning/15 text-warning-text hover:bg-warning/25 md:pointer-fine:h-8"
              >
                {formatWeekdayDayMonth(d)}
              </PillLink>
            ))}
            {moreMissing > 0 ? (
              <span className="text-muted-foreground">y {moreMissing} más</span>
            ) : null}
          </div>
        ) : null}
        <nav aria-label="Día del cierre" className="ml-auto flex items-center gap-1">
          <DayStep
            href={canPrev ? hrefWith(`${base}/ventas/cierre`, { fecha: prev }) : null}
            label={`Día anterior: ${dayTitle(prev)}`}
          >
            <ChevronLeft className="size-4" />
          </DayStep>
          <DayStep
            href={canNext ? hrefWith(`${base}/ventas/cierre`, { fecha: next }) : null}
            label={`Día siguiente: ${dayTitle(next)}`}
          >
            <ChevronRight className="size-4" />
          </DayStep>
        </nav>
      </div>
      <h1 className={TITLE}>
        Cierre del {weekdayName(date)} {formatDayMonth(date)}
      </h1>
    </>
  )

  // ─── Días que no se cargan acá ─────────────────────────────────────────────
  const notice = (message: string, link: { href: string; label: string } | null) => (
    <SimplePage>
      {frame}
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="space-y-3">
          <p className="text-pretty">{message}</p>
          {link ? (
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </SimplePage>
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

  // Ya se sabe qué día es: lo de ese día se pide junto (antes iba una lectura atrás de la otra).
  const [dayCloses, ranges, posDay] = await Promise.all([
    // Los cierres ya cargados de ese día (un día puede tener varios turnos).
    settleQuery(
      listDocuments(tenantId, {
        from: date,
        to: date,
        kinds: ['sales_close'],
        status: 'posted',
        limit: 20,
      }),
    ),
    // El último «hasta» de cada tipo y punto de venta (la base lo trae desde la #13).
    settleQuery(getSalesRangeDefaults(tenantId)),
    // En un bar con punto de venta: lo que cobró ese día, para que el cierre arranque precargado.
    projectionUsesPos(access) ? getPosCloseDay(tenantId, date) : null,
  ])
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
  const mercadoPago = mp.ok ? closeMercadoPago(mp.data, catalog, tenantSlug) : null
  const mpScope = mercadoPagoScope(mp.ok ? mp.data : null, catalog)

  const methods: CloseMethod[] = catalog.methods
    .filter((m) => m.active)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'))
    .map((m) => {
      const isCash =
        m.kind === 'treasury' &&
        catalog.treasuries.some((t) => t.id === m.treasuryAccountId && t.kind === 'cash')
      const treasury = catalog.treasuries.find((t) => t.id === m.treasuryAccountId) ?? null
      const party = catalog.parties.find((p) => p.id === m.partyId) ?? null
      // Es de Mercado Pago el medio que completa su reporte (QR y transferencias) y lo que
      // entra a su billetera. Una app de delivery que paga Mercado Pago sigue siendo delivery.
      const isMercadoPago =
        m.id === mercadoPago?.qrMethodId ||
        m.id === mercadoPago?.transferMethodId ||
        (m.channel !== 'delivery' &&
          ((party !== null && party.id === mpScope.partyId) ||
            (treasury !== null && mpScope.treasuryIds.includes(treasury.id))))
      const view = describeCloseMethod(m, date, {
        treasury: treasury ? { id: treasury.id, name: treasury.name, kind: treasury.kind } : null,
        party: party ? { id: party.id, name: party.tradeName ?? party.name } : null,
        isCash,
        mercadoPago: isMercadoPago,
      })
      return {
        id: m.id,
        name: m.name,
        kind: m.kind,
        channel: m.channel,
        entersTo: view.entersTo,
        destination: view.destination,
        isCash,
        group: view.group,
        payer: view.payer,
        mercadoPago: isMercadoPago,
      }
    })

  const salesPoints: CloseSalesPoint[] = catalog.salesPoints
    .filter((p) => p.active)
    .sort((a, b) => a.number - b.number)
    .map((p) => ({ number: p.number, label: p.label, defaultChannel: p.defaultChannel }))

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

  // El primer cierre del día arranca con lo que cobró el punto de venta. Con un cierre ya cargado no:
  // lo del punto de venta es del día entero, y precargarlo en un segundo turno lo contaría dos veces.
  const posFill =
    posDay && dayCloses.ok && existing.length === 0
      ? posCloseFill(
          posDay,
          catalog.methods
            .filter((m) => m.active)
            .map((m) => ({ id: m.id, name: m.name, systemKey: m.systemKey, channel: m.channel })),
        )
      : null

  // Después de guardar: el próximo día que falta (o la lista de cierres si no falta ninguno).
  const after = missing.find((d) => d !== date) ?? null

  return (
    <SimplePage>
      {frame}
      {!recent.ok || !dayCloses.ok ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm"
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
        mercadoPago={mercadoPago}
        pos={posFill ? { ...posFill, dayHref: `/${tenantSlug}/local/hoy?dia=${date}` } : null}
      />
    </SimplePage>
  )
}

function maxDay(a: string, b: string): string {
  return a > b ? a : b
}

/**
 * Qué medio del cierre es QR y cuál transferencia (lo elegido en Importar ›
 * Mercado Pago o el medio de fábrica, nunca por el nombre) y el corte del día
 * que usa el importador, para que ambos cuenten el mismo día.
 */
function closeMercadoPago(
  settings: Awaited<ReturnType<typeof getMpImportSettings>>,
  catalog: Awaited<ReturnType<typeof loadPostingCatalog>>,
  tenantSlug: string,
): CloseMercadoPago {
  const conn = settings.connection
  const { partyId: mpPartyId, treasuryIds: mpTreasuryIds } = mercadoPagoScope(settings, catalog)
  const targets = mpCloseTargets({
    methods: catalog.methods
      .filter((m) => m.active)
      .map((m) => ({
        id: m.id,
        kind: m.kind,
        systemKey: m.systemKey,
        partyId: m.partyId,
        treasuryAccountId: m.treasuryAccountId,
      })),
    configured: conn?.channelMethods ?? {},
    mpPartyId,
    mpTreasuryIds,
  })
  return {
    qrMethodId: targets.qr,
    transferMethodId: targets.transfer_in,
    cutoffHour: conn?.dayCutoffHour ?? 0,
    sasCuit: catalog.settings.cuit,
    settingsHref: importSourceHref(tenantSlug, 'mp_release'),
  }
}

/**
 * Quién es Mercado Pago en este bar: el partícipe y sus billeteras (lo conectado
 * en Importar › Mercado Pago o, si no hay conexión, el de fábrica). Lo usan
 * «Completar con el reporte» y el agrupado de los medios, para que coincidan.
 */
function mercadoPagoScope(
  settings: Awaited<ReturnType<typeof getMpImportSettings>> | null,
  catalog: Awaited<ReturnType<typeof loadPostingCatalog>>,
): { partyId: string | null; treasuryIds: string[] } {
  const conn = settings?.connection
  const partyId =
    conn?.partyId ?? catalog.parties.find((p) => p.systemKey === 'mercado_pago')?.id ?? null
  const treasuryIds = catalog.treasuries
    .filter(
      (t) =>
        t.id === conn?.treasuryAccountId ||
        (t.kind === 'wallet' && partyId !== null && t.bankPartyId === partyId),
    )
    .map((t) => t.id)
  return { partyId, treasuryIds }
}

function isChannel(value: string | null): value is Channel {
  return value !== null && (CHANNELS as readonly string[]).includes(value)
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
        className="size-11 md:pointer-fine:size-9"
        aria-label={label}
        disabled
      >
        {children}
      </Button>
    )
  }
  return (
    <Button asChild variant="ghost" size="icon" className="size-11 md:pointer-fine:size-9">
      <Link href={href} aria-label={label}>
        {children}
      </Link>
    </Button>
  )
}
