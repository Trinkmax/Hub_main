import { ChevronDown, CircleAlert } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, Suspense } from 'react'
import { Amount } from '@/components/administracion/amount'
import { PanelLink } from '@/components/administracion/kit/panel-states'
import {
  Planilla,
  PlanillaFoot,
  PRow,
  PTable,
  PTd,
  PTh,
} from '@/components/administracion/planilla'
import { Stamp } from '@/components/administracion/planilla/stamp'
import { Totalizer, type TotalizerItem } from '@/components/administracion/planilla/totalizer'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  exportHref,
  getDocument,
  getIvaBookTotals,
  getIvaPosition,
  getSalesSummary,
  type IvaBookTotals,
  type IvaPosition,
  type QueryOutcome,
  settleQuery,
  vatRateLabel,
} from '@/lib/accounting/queries'
import { formatDate, formatIsoDay, monthOf, todayInCordoba } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { BookExport, BookPage, SLIDING_SHEET } from '../_components/book-page'
import { IvaTabs } from '../_components/iva-tabs'
import { MonthPicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { loadBookContext } from '../_lib/book-context'
import { ivaExpectedFrom, ivaSummary, rateRows } from '../_lib/iva'
import { ivaHero, ivaNothingLoaded, ivaTrendRows } from '../_lib/iva-story'
import { monthNoun, monthPeriods, monthTitle } from '../_lib/months'
import { requireBooksAccess } from '../_lib/page-access'
import {
  bookHref,
  monthAvailability,
  monthAvailabilityMessage,
  resolveBookMonth,
} from '../_lib/periods'
import { RegisterSettlementButton } from './_components/register-settlement'

export const metadata = { title: 'IVA' }

/** Cuántos meses entran en «Mes a mes». */
const TREND_MONTHS = 6

/**
 * La solapa IVA: Débito · Crédito · Retenciones · A pagar, los dos libros con «Ver» y «Excel», y lo
 * que se hace con el IVA del mes (pagarlo, anotarlo, ir al cierre). Abajo, plegado, lo que no se usa
 * todos los días: la cuenta completa, la conciliación con el mayor y cómo viene mes a mes. Para la
 * contadora van abiertos: vino a eso. Los números salen de la misma posición que el exporte.
 */
export default async function PosicionIvaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const books = `${base}/libros`
  const path = `${books}/posicion-iva`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, path)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const resolved = resolveBookMonth(sp, today)
  const month = resolved.ok ? resolved : resolveBookMonth({}, today)
  if (!month.ok) throw new Error('período por defecto inválido')
  const ctx = await loadBookContext(tenantId, today)
  const availability = monthAvailability(month.month, today, ctx.settings?.booksStartDate)
  const load = resolved.ok && availability === 'ok'
  const [position, sales, purchasesBook, salesBook] = await Promise.all([
    load ? settleQuery(getIvaPosition(tenantId, month.month)) : null,
    load ? settleQuery(getSalesSummary(tenantId, { from: month.from, to: month.to })) : null,
    load
      ? settleQuery(getIvaBookTotals(tenantId, { book: 'purchases', month: month.month }))
      : null,
    load ? settleQuery(getIvaBookTotals(tenantId, { book: 'sales', month: month.month })) : null,
  ])
  const p = position?.ok ? position.data : null

  // «Pagar a ARCA» (dueño): la partida abierta del IVA anotado al cerrar el mes.
  const settlement =
    canWrite && p?.status === 'closed' && p.settlementDocumentId
      ? await settleQuery(getDocument(tenantId, p.settlementDocumentId))
      : null
  const payLine =
    settlement?.ok && settlement.data?.status === 'posted'
      ? (settlement.data.entry?.lines.find((l) => l.partyId && (l.openCents ?? 0) > 0) ?? null)
      : null

  const hasCuit = Boolean(ctx.settings?.cuit)
  const noun = monthNoun(month.month)
  const name = monthTitle(month.month)
  const hero = p ? ivaHero(p, month.month) : null
  const nothing = Boolean(p?.applies && p.isZero && ivaNothingLoaded(p))
  // Los meses con libros hasta hoy, para «Mes a mes».
  const trendMonths = monthPeriods(ctx.years.flatMap((y) => y.periods))
    .filter((period) => period.startsOn <= today)
    .map((period) => monthOf(period.month))
    .slice(-TREND_MONTHS)

  return (
    <BookPage
      title={`El IVA de ${noun}`}
      toolbar={
        <>
          <IvaTabs booksPath={books} month={month.month} active="posicion-iva" />
          <MonthPicker month={month.month} today={today} minMonth={ctx.minMonth} />
        </>
      }
      aside={
        p ? (
          p.status === 'open' ? (
            <Stamp tone="warn">Mes abierto</Stamp>
          ) : (
            <Stamp>Cerrado{p.closedAt ? ` · ${formatDate(p.closedAt)}` : ''}</Stamp>
          )
        ) : null
      }
      exports={
        hasCuit && availability === 'ok'
          ? [
              {
                href: exportHref(tenantSlug, 'posicion-iva', { mes: month.month }),
                fileName: `administracion-${tenantSlug}-posicion-iva-${month.month}.csv`,
              },
            ]
          : undefined
      }
    >
      {!resolved.ok ? <PeriodError message={resolved.message} /> : null}
      {availability !== 'ok' ? (
        <Planilla>
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {monthAvailabilityMessage(availability, month.month, ctx.settings?.booksStartDate)}{' '}
            Elegí otro mes con las flechas de arriba.
          </p>
        </Planilla>
      ) : null}
      {position && !position.ok ? (
        <QueryErrorBlock code={position.code} message={position.message} />
      ) : null}

      {p && hero && !p.applies ? (
        <Planilla>
          <div className="grid gap-1 px-3 py-6 text-center text-sm text-pretty">
            <p className="font-medium">{hero.kind === 'not_registered' ? hero.title : ''}</p>
            <p className="text-muted-foreground">
              {hero.kind === 'not_registered' ? hero.sentence : null}
            </p>
          </div>
        </Planilla>
      ) : null}

      {p?.applies && nothing && p.status === 'open' ? (
        <Planilla>
          <div className="grid justify-items-center gap-3 px-3 py-6 text-center text-sm">
            <div className="grid max-w-prose gap-1 text-pretty">
              <p className="font-medium">{name} todavía no tiene IVA</p>
              <p className="text-muted-foreground">
                Suma cuando cargás ventas con factura en el cierre del día y resta cuando cargás
                compras con Factura A. Lo que va sin factura queda registrado igual y no mueve esta
                cuenta.
              </p>
            </div>
            {canWrite ? (
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
                <Button asChild variant="outline" className="h-11 md:pointer-fine:h-9">
                  <Link href={`${base}/ventas/cierre`}>Cargar el cierre del día</Link>
                </Button>
                <PanelLink href={`${base}/compras/nueva`}>Cargar una compra que debo</PanelLink>
              </div>
            ) : null}
          </div>
        </Planilla>
      ) : null}

      {p?.applies && hero && !(nothing && p.status === 'open') ? (
        <>
          <Totalizer items={positionTotals(p)} />

          <Planilla className={SLIDING_SHEET}>
            <PTable minWidth={560} label={`Los libros de IVA de ${noun}`}>
              <thead>
                <tr>
                  <PTh>Libro</PTh>
                  <PTh align="right">Comprobantes</PTh>
                  <PTh align="right">Neto</PTh>
                  <PTh align="right">IVA</PTh>
                  <PTh>
                    <span className="sr-only">Acciones</span>
                  </PTh>
                </tr>
              </thead>
              <tbody>
                <BookRow
                  name="IVA Compras"
                  slug="iva-compras"
                  book={purchasesBook}
                  books={books}
                  month={month.month}
                  tenantSlug={tenantSlug}
                  hasCuit={hasCuit}
                />
                <BookRow
                  name="IVA Ventas"
                  slug="iva-ventas"
                  book={salesBook}
                  books={books}
                  month={month.month}
                  tenantSlug={tenantSlug}
                  hasCuit={hasCuit}
                />
              </tbody>
            </PTable>
            <PlanillaFoot>
              <MomentAction
                position={p}
                base={base}
                tenantSlug={tenantSlug}
                canWrite={canWrite}
                month={month.month}
                payLineId={payLine?.id ?? null}
              />
            </PlanillaFoot>
          </Planilla>

          {p.pendingDocumentationCents > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <p className="min-w-0 flex-1 basis-64 text-pretty">
                Te descontaron{' '}
                <span className="font-semibold tabular-nums">
                  {formatCentsShort(p.pendingDocumentationCents)}
                </span>{' '}
                de IVA en comisiones y falta la factura de la tarjeta o de la app. Se suma a tu
                favor cuando la cargás.
              </p>
              {canWrite ? (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-11 shrink-0 md:pointer-fine:h-8"
                >
                  <Link href={`${base}/compras/nueva`}>Cargar la factura</Link>
                </Button>
              ) : null}
            </div>
          ) : null}

          {!p.reconciliation.fullyExplained ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="text-pretty">
                Hay una diferencia que no explica ningún asiento (
                {formatCents(p.reconciliation.unexplainedVatCreditCents)} de crédito y{' '}
                {formatCents(p.reconciliation.unexplainedVatDebitCents)} de débito): avisanos.
              </p>
            </div>
          ) : null}

          <Fold title="La cuenta completa" open={!canWrite}>
            <Cascade position={p} month={month.month} />
          </Fold>

          <Fold
            title="Conciliación con los libros"
            open={!canWrite}
            aside={
              p.reconciliation.matches ? (
                <Stamp>Coinciden</Stamp>
              ) : (
                <Stamp tone="warn">Hay diferencias</Stamp>
              )
            }
          >
            <Reconciliation position={p} base={base} />
          </Fold>

          <Fold title="Lo que va sin factura">
            <WithoutInvoice noun={noun} sales={sales?.ok ? sales.data : null} base={base} />
          </Fold>

          {trendMonths.length >= 2 ? (
            <Fold title="Mes a mes">
              <Suspense fallback={<Skeleton className="h-24 w-full" />}>
                <Trend
                  tenantId={tenantId}
                  months={trendMonths}
                  path={path}
                  selected={month.month}
                />
              </Suspense>
            </Fold>
          ) : null}
        </>
      ) : null}
    </BookPage>
  )
}

// ─── Los totales ─────────────────────────────────────────────────────────────

/**
 * Débito · Crédito · Retenciones · A pagar. Lo que el número no dice (lo que venía a favor, las
 * percepciones) va abajo, en gris: sin eso, la resta a la vista no da.
 */
function positionTotals(p: IvaPosition): TotalizerItem[] {
  const estimate = p.status === 'open' ? ' (estimado)' : ''
  const carried = p.technicalBalancePrevCents + p.freeBalancePrevCents
  const hint = carried !== 0 ? `Con ${formatCentsShort(carried)} del mes anterior` : undefined
  return [
    { label: 'Débito fiscal', cents: p.debitFiscal.totalCents },
    { label: 'Crédito fiscal', cents: p.creditFiscal.totalCents },
    {
      label: 'Retenciones',
      cents: p.withholdingsCents + p.perceptionsCents,
      hint: p.perceptionsCents !== 0 ? 'Con las percepciones' : undefined,
    },
    p.inFavorCents > 0 && p.toPayCents === 0
      ? { label: `A favor${estimate}`, cents: p.inFavorCents, tone: 'ok', hint }
      : { label: `A pagar${estimate}`, cents: p.toPayCents, tone: 'warn', hint },
  ]
}

/** Un libro: cuántos comprobantes, su neto y su IVA, y a un toque verlo o bajarlo. */
function BookRow({
  name,
  slug,
  book,
  books,
  month,
  tenantSlug,
  hasCuit,
}: {
  name: string
  slug: 'iva-compras' | 'iva-ventas'
  book: QueryOutcome<IvaBookTotals> | null
  books: string
  month: string
  tenantSlug: string
  hasCuit: boolean
}) {
  const totals = book?.ok ? book.data : null
  const summary = totals ? ivaSummary(totals.amounts) : null
  return (
    <PRow>
      <PTd className="font-medium">{name}</PTd>
      <PTd align="right">{totals?.count ?? '—'}</PTd>
      <PTd align="right">{summary ? <Amount cents={summary.netCents} decimals={0} /> : '—'}</PTd>
      <PTd align="right">{summary ? <Amount cents={summary.vatCents} decimals={0} /> : '—'}</PTd>
      <PTd align="right">
        <span className="inline-flex items-center gap-1.5">
          <Button asChild variant="outline" size="sm" className="h-11 md:pointer-fine:h-8">
            <Link href={bookHref(`${books}/${slug}`, { mes: month })} aria-label={`Ver ${name}`}>
              Ver
            </Link>
          </Button>
          {hasCuit ? (
            <BookExport
              item={{
                href: exportHref(tenantSlug, slug, { mes: month }),
                fileName: `administracion-${tenantSlug}-${slug}-${month}.csv`,
              }}
            />
          ) : null}
        </span>
      </PTd>
    </PRow>
  )
}

/** Lo que no se mira todos los días: plegado, adentro de su hoja. */
function Fold({
  title,
  open = false,
  aside,
  children,
}: {
  title: string
  open?: boolean
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <details
      open={open}
      className="group/fold overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs"
    >
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform duration-(--duration-fast) group-open/fold:rotate-0 motion-reduce:transition-none"
        />
        {title}
        {aside ? <span className="ml-auto">{aside}</span> : null}
      </summary>
      <div className="border-t border-border/60 px-3 py-3">{children}</div>
    </details>
  )
}

// ─── La acción del momento ───────────────────────────────────────────────────

/**
 * Qué se puede hacer AHORA con el IVA de este mes. Son las mismas ramas de siempre (mes cerrado o
 * abierto · se anota al cerrar o a mano · al día o viejo), una por una. La contadora no ve ningún
 * botón.
 */
function MomentAction({
  position: p,
  base,
  tenantSlug,
  canWrite,
  month,
  payLineId,
}: {
  position: IvaPosition
  base: string
  tenantSlug: string
  canWrite: boolean
  /** `yyyy-MM`. */
  month: string
  payLineId: string | null
}) {
  const noun = monthNoun(month)
  const docLink = p.settlementDocumentId ? (
    <PanelLink href={`${base}/comprobantes/${p.settlementDocumentId}`}>
      {canWrite ? 'Ver cómo quedó anotado' : 'Ver la liquidación'}
    </PanelLink>
  ) : null

  let text: string
  let primary: ReactNode = null
  let link: ReactNode = null
  // Se anotó el IVA y después se cargó algo del mes: hay que anotarlo de nuevo
  // (la base anula el viejo; si ahora da cero, solo lo anula).
  const stale = Boolean(p.settlementDocumentId) && p.settlementUpToDate === false

  if (p.status === 'closed') {
    if (p.settlementDocumentId) {
      text = 'Quedó anotado al cerrar el mes.'
      link = docLink
      primary = payLineId ? (
        <ActionButton
          action="pagar"
          params={{ partida: payLineId }}
          className="h-11 md:pointer-fine:h-8"
        >
          Pagar a ARCA
        </ActionButton>
      ) : null
    } else {
      text = `${monthTitle(month)} se cerró sin anotar IVA: dio cero o se cerró sin anotarlo.`
    }
  } else if (p.isZero && !stale) {
    text = `Por ahora ${noun} no tiene IVA para anotar.`
  } else if (p.mode === 'manual') {
    if (p.settlementDocumentId && !stale) {
      text = 'El IVA del mes ya está anotado.'
      link = docLink
    } else {
      text = !stale
        ? 'El IVA se anota a mano: cuando el mes esté completo, anotalo.'
        : p.isZero
          ? 'Lo anotado quedó viejo y ahora el mes da cero: anulalo antes de cerrar.'
          : 'Lo anotado quedó viejo: después se cargó algo del mes.'
      link = docLink
      primary = canWrite ? (
        <RegisterSettlementButton
          tenantSlug={tenantSlug}
          month={p.month}
          monthLabel={noun}
          expected={ivaExpectedFrom(p)}
          again={stale}
          zero={p.isZero}
          resultText={
            p.isZero
              ? `Se anula la liquidación anterior: el IVA de ${noun} ahora da cero.`
              : p.toPayCents > 0
                ? `Queda el asiento con IVA a pagar de ${formatCents(p.toPayCents)} a ARCA, con fecha del último día del mes.`
                : p.inFavorCents > 0
                  ? `Queda el asiento con ${formatCents(p.inFavorCents)} a favor para el mes siguiente.`
                  : 'Queda el asiento de la liquidación, sin IVA a pagar.'
          }
        />
      ) : null
    }
  } else {
    text = 'Queda anotado solo cuando cerrás el mes.'
    if (canWrite) {
      primary = (
        <Button asChild variant="outline" size="sm" className="h-11 md:pointer-fine:h-8">
          <Link href={bookHref(`${base}/libros/cierres`, { mes: month })}>
            Ir al cierre del mes
          </Link>
        </Button>
      )
    } else {
      link = docLink
    }
  }

  return (
    <>
      <p className="min-w-0 flex-1 basis-56 text-sm text-pretty">{text}</p>
      {link || primary ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {link}
          {primary}
        </div>
      ) : null}
    </>
  )
}

// ─── La cuenta completa ──────────────────────────────────────────────────────

type CascadeRow = {
  key: string
  op?: '−' | '='
  label: string
  /** Para lectores: «menos», «da». */
  opText?: string
  cents: number
  sub?: boolean
  strong?: boolean
}

/** La cascada completa de la posición: es la vista de la contadora. */
function Cascade({ position: p, month }: { position: IvaPosition; month: string }) {
  const tech = p.technicalBalanceCents
  const rows: CascadeRow[] = [
    { key: 'df', label: 'Débito fiscal', cents: p.debitFiscal.totalCents, strong: true },
    ...rateRows(p.debitFiscal.byRate).map((r) => ({
      key: `df-${r.bp}`,
      label: `IVA ${vatRateLabel(r.bp)}`,
      cents: r.cents,
      sub: true,
    })),
    {
      key: 'cf',
      op: '−',
      opText: 'menos',
      label: 'Crédito fiscal',
      cents: p.creditFiscal.totalCents,
      strong: true,
    },
    ...rateRows(p.creditFiscal.byRate).map((r) => ({
      key: `cf-${r.bp}`,
      label: `IVA ${vatRateLabel(r.bp)}`,
      cents: r.cents,
      sub: true,
    })),
  ]
  if (p.technicalBalancePrevCents !== 0) {
    rows.push({
      key: 'st0',
      op: '−',
      opText: 'menos',
      label: 'Saldo técnico a favor del mes anterior',
      cents: p.technicalBalancePrevCents,
    })
  }
  rows.push({
    key: 'tech',
    op: '=',
    opText: 'da',
    label: tech < 0 ? 'Saldo técnico a favor' : 'Saldo técnico',
    cents: Math.abs(tech),
    strong: true,
  })
  if (p.perceptionsCents !== 0) {
    rows.push({
      key: 'perc',
      op: '−',
      opText: 'menos',
      label: 'Percepciones de IVA',
      cents: p.perceptionsCents,
    })
  }
  if (p.withholdingsCents !== 0) {
    rows.push({
      key: 'ret',
      op: '−',
      opText: 'menos',
      label: 'Retenciones de IVA',
      cents: p.withholdingsCents,
    })
  }
  if (p.freeBalancePrevCents !== 0) {
    rows.push({
      key: 'ld0',
      op: '−',
      opText: 'menos',
      label: 'Libre disponibilidad del mes anterior',
      cents: p.freeBalancePrevCents,
    })
  }

  let result: ReactNode
  if (p.toPayCents > 0) {
    result = (
      <ResultRow label="A pagar" cents={p.toPayCents} hint="A ARCA, con la declaración jurada." />
    )
  } else if (p.inFavorCents > 0) {
    const parts = [
      p.technicalBalanceNewCents > 0
        ? `saldo técnico ${formatCents(p.technicalBalanceNewCents)}`
        : null,
      p.freeBalanceNewCents > 0
        ? `libre disponibilidad ${formatCents(p.freeBalanceNewCents)}`
        : null,
    ].filter(Boolean)
    result = (
      <ResultRow
        label="A favor"
        cents={p.inFavorCents}
        hint={parts.length > 0 ? `Queda para el mes siguiente: ${parts.join(' · ')}.` : undefined}
      />
    )
  } else {
    result = (
      <tr>
        <td colSpan={3} className="px-1 py-3 text-sm font-medium">
          Sin IVA para pagar ni a favor.
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground text-pretty">
        Primero el saldo técnico, después los pagos a cuenta y la libre disponibilidad (art. 24). Es
        una estimación: la declaración la presenta la contadora.
      </p>
      <table className="w-full max-w-2xl text-sm tabular-nums">
        <caption className="sr-only">Posición de IVA de {monthNoun(month)}</caption>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={cn(row.strong && 'border-t border-border/60 first:border-t-0')}
            >
              <td aria-hidden className="w-6 py-1.5 pl-1 text-center text-muted-foreground">
                {row.op ?? ''}
              </td>
              <td
                className={cn(
                  'py-1.5 pr-3',
                  row.sub ? 'pl-4 text-muted-foreground' : 'font-medium',
                )}
              >
                {row.opText ? <span className="sr-only">{row.opText} </span> : null}
                {row.label}
              </td>
              <td
                className={cn(
                  'py-1.5 pr-1 text-right',
                  row.sub ? 'text-muted-foreground' : 'font-medium',
                )}
              >
                <Amount cents={row.cents} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="adm-double-rule">{result}</tfoot>
      </table>
    </div>
  )
}

function ResultRow({ label, cents, hint }: { label: string; cents: number; hint?: string }) {
  return (
    <tr>
      <td aria-hidden className="w-6 py-2.5 pl-1 text-center align-top text-muted-foreground">
        =
      </td>
      <td className="py-2.5 pr-3 align-top">
        <span className="block font-semibold">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </td>
      <td className="py-2.5 pr-1 text-right align-top">
        <Amount cents={cents} className="font-semibold" />
      </td>
    </tr>
  )
}

function Money({ cents }: { cents: number }) {
  return (
    <span className="whitespace-nowrap font-medium tabular-nums text-foreground">
      {formatCentsShort(cents)}
    </span>
  )
}

// ─── Lo que va sin factura ───────────────────────────────────────────────────

function WithoutInvoice({
  noun,
  sales,
  base,
}: {
  noun: string
  sales: ReadonlyArray<{ soldCents: number; uninvoicedCents: number }> | null
  base: string
}) {
  const sold = sales ? sales.reduce((sum, r) => sum + r.soldCents, 0) : 0
  const uninvoiced = sales ? sales.reduce((sum, r) => sum + r.uninvoicedCents, 0) : 0
  const invoiced = sold - uninvoiced
  return (
    <div className="max-w-prose space-y-2 text-sm leading-relaxed text-muted-foreground text-pretty">
      {sold > 0 ? (
        <p>
          En {noun} vendiste <Money cents={sold} />, contando las facturas cargadas aparte:{' '}
          {uninvoiced <= 0 ? (
            'todo con factura.'
          ) : invoiced <= 0 ? (
            'todo sin factura.'
          ) : (
            <>
              <Money cents={invoiced} /> con factura y <Money cents={uninvoiced} /> sin factura.
            </>
          )}{' '}
          Lo que va sin factura queda registrado igual en los libros y no suma IVA a esta cuenta.
        </p>
      ) : null}
      <p>
        De tus compras, solo las de Factura A restan IVA. Las de Factura B o C, los tiques y lo que
        va sin factura quedan registrados igual, sin IVA para recuperar.
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <PanelLink href={`${base}/ventas?tab=facturas`}>Ver las ventas con y sin factura</PanelLink>
        <PanelLink href={`${base}/guias/con-y-sin-factura`}>
          Guía: con factura y sin factura
        </PanelLink>
      </div>
    </div>
  )
}

// ─── Mes a mes ───────────────────────────────────────────────────────────────

/** Un renglón por mes, en orden. Tocar un mes abre su cuenta. */
async function Trend({
  tenantId,
  months,
  path,
  selected,
}: {
  tenantId: string
  months: readonly string[]
  path: string
  selected: string
}) {
  const positions = await Promise.all(
    months.map(async (month) => {
      const result = await settleQuery(getIvaPosition(tenantId, month))
      return { month, position: result.ok ? result.data : null }
    }),
  )
  const rows = ivaTrendRows(positions)
  if (rows.length === 0) return null
  return (
    <PTable minWidth={520} label="El IVA mes a mes">
      <thead>
        <tr>
          <PTh>Mes</PTh>
          <PTh align="right">Débito fiscal</PTh>
          <PTh align="right">Crédito fiscal</PTh>
          <PTh align="right">A pagar o a favor</PTh>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <PRow key={row.month} className={row.month === selected ? 'bg-secondary/50' : undefined}>
            <PTd>
              <Link
                href={bookHref(path, { mes: row.month })}
                aria-current={row.month === selected ? 'true' : undefined}
                className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:inline-block pointer-coarse:py-1.5"
              >
                {row.label}
              </Link>
              <span className="ml-1.5 text-xs text-muted-foreground">{row.stateWord}</span>
            </PTd>
            <PTd align="right">{formatCentsShort(row.debitCents)}</PTd>
            <PTd align="right">{formatCentsShort(row.creditCents)}</PTd>
            <PTd align="right">{row.text}</PTd>
          </PRow>
        ))}
      </tbody>
    </PTable>
  )
}

// ─── La conciliación ─────────────────────────────────────────────────────────

/** Los libros IVA contra el mayor. */
function Reconciliation({ position: p, base }: { position: IvaPosition; base: string }) {
  const r = p.reconciliation
  const rows = [
    {
      key: 'cf',
      label: 'Crédito fiscal',
      book: r.purchasesBookVatComputableCents,
      bookLabel: 'Libro IVA compras (computable)',
      journal: r.journalVatCreditCents,
    },
    {
      key: 'df',
      label: 'Débito fiscal',
      book: r.salesBookVatCents,
      bookLabel: 'Libro IVA ventas',
      journal: r.journalVatDebitCents,
    },
  ]
  return (
    <div className="space-y-3">
      <PTable minWidth={520} label="Lo que dicen los libros IVA contra lo que quedó en el mayor">
        <thead>
          <tr>
            <PTh>Cuenta</PTh>
            <PTh>Libro</PTh>
            <PTh align="right">Importe</PTh>
            <PTh align="right">Mayor</PTh>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PRow key={row.key}>
              <PTd className="font-medium">{row.label}</PTd>
              <PTd className="text-muted-foreground">{row.bookLabel}</PTd>
              <PTd align="right">
                <Amount cents={row.book} />
              </PTd>
              <PTd align="right">
                <Amount cents={row.journal} />
              </PTd>
            </PRow>
          ))}
        </tbody>
      </PTable>
      {r.differences.length > 0 ? (
        <div>
          <p className="mb-1 text-sm font-medium">Asientos que movieron IVA sin comprobante</p>
          <ul className="divide-y divide-border/60 text-sm">
            {r.differences.map((d, i) => (
              <li
                key={`${d.entryId ?? d.documentId ?? 'dif'}-${i.toString()}`}
                className="flex flex-col gap-1 py-1.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0">
                  {d.entryId ? (
                    <Link
                      href={`${base}/asientos/${d.entryId}`}
                      className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {d.label || 'Asiento'}
                    </Link>
                  ) : (
                    <span className="font-medium">{d.label || 'Asiento'}</span>
                  )}
                  {d.entryDate ? (
                    <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                      {formatIsoDay(d.entryDate)}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 gap-4 text-xs text-muted-foreground">
                  {d.vatCreditCents !== 0 ? (
                    <span>
                      Crédito <Amount cents={d.vatCreditCents} className="text-foreground" />
                    </span>
                  ) : null}
                  {d.vatDebitCents !== 0 ? (
                    <span>
                      Débito <Amount cents={d.vatDebitCents} className="text-foreground" />
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {r.differencesCount > r.differences.length ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Y {r.differencesCount - r.differences.length} asientos más: están en el libro diario.
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground text-pretty">
        {r.matches
          ? 'Los libros de IVA dicen lo mismo que el mayor.'
          : r.fullyExplained
            ? 'La diferencia la explican los asientos que movieron IVA sin un comprobante.'
            : 'Parte de la diferencia no la explica ningún asiento.'}
      </p>
    </div>
  )
}
