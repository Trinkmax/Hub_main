import { ArrowRight, CalendarRange, ChevronDown, CircleAlert, Percent } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, Suspense, useId } from 'react'
import { Amount } from '@/components/administracion/amount'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartSilhouette, ChartTable } from '@/components/administracion/charts/chart-parts'
import { compactCents, pct } from '@/components/administracion/charts/scale'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import {
  AdmHeader,
  AdmPage,
  EmptyTeach,
  HeroPanel,
  MoneyHero,
  Panel,
  PanelLink,
  StatusPill,
} from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  exportHref,
  getDocument,
  getIvaPosition,
  getSalesSummary,
  type IvaPosition,
  settleQuery,
  vatRateLabel,
} from '@/lib/accounting/queries'
import { formatDate, formatIsoDay, monthOf, todayInCordoba } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { PERIOD_ROW } from '../_components/book-page'
import { BookSwitcher } from '../_components/book-switcher'
import { ExportButton, ExportMenuButton } from '../_components/export-button'
import { MonthPicker } from '../_components/period-picker'
import { PeriodError, QueryErrorBlock } from '../_components/report-error'
import { loadBookContext } from '../_lib/book-context'
import { ivaExpectedFrom, rateRows } from '../_lib/iva'
import {
  ivaCoverBar,
  ivaHero,
  ivaNothingLoaded,
  ivaOneSidedSentence,
  ivaTrendRows,
  ivaTrendTitle,
} from '../_lib/iva-story'
import { monthNoun, monthPeriods, monthTitle } from '../_lib/months'
import { requireBooksAccess } from '../_lib/page-access'
import {
  bookHref,
  monthAvailability,
  monthAvailabilityMessage,
  resolveBookMonth,
} from '../_lib/periods'
import { RegisterSettlementButton } from './_components/register-settlement'

export const metadata = { title: 'Posición de IVA' }

/** Cuántos meses entran en «El IVA mes a mes». */
const TREND_MONTHS = 6

/**
 * «El IVA del mes»: la cuenta del IVA contada para un socio. Arriba, el número
 * con su oración y, al lado, la acción del momento («Pagar a ARCA», «Ir al fin
 * de mes»); después, de dónde sale (una barra: lo que cobraste, lo que ya
 * tenías cubierto y lo que falta), lo que va sin factura y cómo viene mes a
 * mes. Al final, plegado para el dueño y abierto para la contadora, el control
 * contra los libros.
 *
 * Para la contadora es la «Posición de IVA» de siempre: ve la cascada completa
 * («Ver como tabla» abierta de entrada), la conciliación y exporta. Los números
 * salen de la misma posición que el exporte (pantalla = CSV).
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
  const [position, sales] = await Promise.all([
    load ? settleQuery(getIvaPosition(tenantId, month.month)) : null,
    load ? settleQuery(getSalesSummary(tenantId, { from: month.from, to: month.to })) : null,
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
  // Los meses con libros hasta hoy, para «El IVA mes a mes».
  const trendMonths = monthPeriods(ctx.years.flatMap((y) => y.periods))
    .filter((period) => period.startsOn <= today)
    .map((period) => monthOf(period.month))
    .slice(-TREND_MONTHS)

  const exportItem =
    hasCuit && availability === 'ok'
      ? {
          href: exportHref(tenantSlug, 'posicion-iva', { mes: month.month }),
          fileName: `administracion-${tenantSlug}-posicion-iva-${month.month}.csv`,
        }
      : null
  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={{ href: bookHref(books, { mes: month.month }), label: 'Libros' }}
        title={`El IVA de ${noun}`}
        // En el celular el lugar de «Exportar» queda vacío (8 + 16 px): se descuenta del margen.
        className={exportItem ? 'max-sm:mb-2' : undefined}
        description="Posición de IVA · es una estimación: la declaración la presenta tu contadora."
        badge={
          <>
            <ReadOnlyBadge className="ml-0" />
            {p ? (
              <StatusPill tone={p.status === 'open' ? 'info' : 'ok'}>
                {p.status === 'open'
                  ? 'Mes abierto: puede cambiar'
                  : `Cerrado${p.closedAt ? ` el ${formatDate(p.closedAt)}` : ''}`}
              </StatusPill>
            ) : null}
            {/* En el celular «Exportar» es un ícono en esta línea, como en los demás libros. */}
            {exportItem ? (
              <span className="ml-auto flex shrink-0 items-center sm:hidden">
                <ExportMenuButton items={[exportItem]} />
              </span>
            ) : null}
          </>
        }
        actions={
          exportItem ? (
            <div className="contents max-sm:hidden">
              <ExportButton href={exportItem.href} fileName={exportItem.fileName} />
            </div>
          ) : null
        }
      />

      {/* La fila «entre libros» es herramienta de la contadora: al dueño no se le suma. */}
      {canWrite ? null : (
        <BookSwitcher
          booksPath={books}
          active="posicion-iva"
          period={{ kind: 'month', month: month.month, from: month.from, to: month.to }}
        />
      )}
      <MonthPicker
        month={month.month}
        today={today}
        minMonth={ctx.minMonth}
        className={PERIOD_ROW}
      />

      {!resolved.ok ? <PeriodError message={resolved.message} /> : null}
      {availability !== 'ok' ? (
        <EmptyTeach
          icon={CalendarRange}
          title={monthAvailabilityMessage(availability, month.month, ctx.settings?.booksStartDate)}
        >
          Elegí otro mes con las flechas de arriba.
        </EmptyTeach>
      ) : null}
      {position && !position.ok ? (
        <QueryErrorBlock code={position.code} message={position.message} />
      ) : null}

      {p && hero && !p.applies ? (
        <EmptyTeach icon={Percent} title={hero.kind === 'not_registered' ? hero.title : ''}>
          {hero.kind === 'not_registered' ? hero.sentence : null}
        </EmptyTeach>
      ) : null}

      {p?.applies && nothing && p.status === 'open' ? (
        <EmptyTeach
          icon={Percent}
          title={`${name} todavía no tiene IVA`}
          illustration={<ChartSilhouette kind="split" />}
          action={
            canWrite ? (
              <Button asChild className="h-11">
                <Link href={`${base}/ventas/cierre`}>Cargar el cierre del día</Link>
              </Button>
            ) : undefined
          }
          secondary={
            canWrite ? (
              <PanelLink href={`${base}/compras/nueva`}>Cargar una compra que debo</PanelLink>
            ) : undefined
          }
        >
          Aparece solo: suma cuando cargás ventas con factura en el cierre del día y resta cuando
          cargás compras con Factura A. Lo que va sin factura queda registrado igual y no mueve esta
          cuenta.
        </EmptyTeach>
      ) : null}

      {p?.applies && hero && !(nothing && p.status === 'open') ? (
        <>
          <HeroPanel tone="crema" className="grid gap-6 lg:grid-cols-12 lg:items-center">
            <div className="space-y-3 lg:col-span-7">
              {hero.cents !== null ? (
                <MoneyHero
                  size="xl"
                  animate
                  cents={hero.cents}
                  label={hero.label}
                  sentence={hero.sentence}
                />
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    IVA de {noun}
                  </p>
                  <p className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl">
                    {hero.title}
                  </p>
                </div>
              )}
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted-foreground">
                {p.status === 'open' ? (
                  <>
                    <StatusPill tone="info">Estimado</StatusPill>
                    Lo confirma la contadora.
                  </>
                ) : (
                  <StatusPill tone="muted">Mes cerrado</StatusPill>
                )}
              </p>
            </div>
            <div className="border-t border-border/60 pt-5 lg:col-span-5 lg:border-l lg:border-t-0 lg:pt-0 lg:pl-6">
              <MomentAction
                position={p}
                base={base}
                tenantSlug={tenantSlug}
                canWrite={canWrite}
                month={month.month}
                payLineId={payLine?.id ?? null}
              />
            </div>
          </HeroPanel>

          <HowItAdds
            position={p}
            month={month.month}
            base={base}
            asTable={!canWrite}
            sales={sales?.ok ? sales.data : null}
          />

          {p.pendingDocumentationCents > 0 ? (
            <div className="card-hairline flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <p className="flex min-w-0 flex-wrap items-start gap-x-2.5 gap-y-1.5 text-sm text-pretty">
                <StatusPill tone="info">Aviso</StatusPill>
                <span className="min-w-0 flex-1 basis-64">
                  Te descontaron{' '}
                  <span className="font-semibold tabular-nums">
                    {formatCentsShort(p.pendingDocumentationCents)}
                  </span>{' '}
                  de IVA en comisiones y falta la factura de la tarjeta o de la app. Se suma a tu
                  favor cuando la cargás.
                </span>
              </p>
              {canWrite ? (
                <Button asChild variant="outline" className="h-11 shrink-0 md:pointer-fine:h-9">
                  <Link href={`${base}/compras/nueva`}>Cargar la factura</Link>
                </Button>
              ) : null}
            </div>
          ) : null}

          {trendMonths.length >= 2 ? (
            <Suspense fallback={<TrendSkeleton />}>
              <Trend tenantId={tenantId} months={trendMonths} path={path} selected={month.month} />
            </Suspense>
          ) : null}

          {!p.reconciliation.fullyExplained ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="text-pretty">
                Hay una diferencia que no explica ningún asiento (
                {formatCents(p.reconciliation.unexplainedVatCreditCents)} de crédito y{' '}
                {formatCents(p.reconciliation.unexplainedVatDebitCents)} de débito): avisanos.
              </p>
            </div>
          ) : null}

          <Reconciliation position={p} base={base} open={!canWrite} />
        </>
      ) : null}
    </AdmPage>
  )
}

// ─── La acción del momento ───────────────────────────────────────────────────

/**
 * Qué se puede hacer AHORA con el IVA de este mes. Son las mismas ramas de
 * siempre (mes cerrado o abierto · se anota al cerrar o a mano · al día o
 * viejo), una por una; cambian las palabras y que el botón va al lado del
 * número. La contadora no ve ningún botón.
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
      <ArrowRight className="size-3.5" aria-hidden />
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
          className="h-12 w-full px-5 text-base sm:w-auto"
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
        <Button asChild variant="outline" className="h-12 w-full gap-2 px-5 text-base sm:w-auto">
          <Link href={bookHref(`${base}/libros/cierres`, { mes: month })}>
            Ir al fin de mes
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      )
    } else {
      link = docLink
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Qué hacer ahora
      </p>
      <p className="text-sm leading-relaxed text-pretty">{text}</p>
      {primary}
      {link}
    </div>
  )
}

// ─── «¿Cómo se calcula?» ─────────────────────────────────────────────────────

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
        <td colSpan={3} className="px-1 py-4 text-sm font-medium">
          Sin IVA para pagar ni a favor.
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground text-pretty">
        Primero el saldo técnico, después los pagos a cuenta y la libre disponibilidad (art. 24).
      </p>
      <table className="w-full max-w-2xl text-sm">
        <caption className="sr-only">Posición de IVA de {monthNoun(month)}</caption>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={cn(row.strong && 'border-t border-border/60 first:border-t-0')}
            >
              <td
                aria-hidden
                className="w-6 py-2 pl-1 text-center text-muted-foreground tabular-nums"
              >
                {row.op ?? ''}
              </td>
              <td
                className={cn('py-2 pr-3', row.sub ? 'pl-4 text-muted-foreground' : 'font-medium')}
              >
                {row.opText ? <span className="sr-only">{row.opText} </span> : null}
                {row.label}
              </td>
              <td
                className={cn(
                  'py-2 pr-1 text-right',
                  row.sub ? 'text-muted-foreground' : 'font-medium',
                )}
              >
                <Amount cents={row.cents} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-[3px] border-double border-border">{result}</tfoot>
      </table>
    </div>
  )
}

function ResultRow({ label, cents, hint }: { label: string; cents: number; hint?: string }) {
  return (
    <tr>
      {/* Arriba y con el alto de línea del título: el «=» va con «A favor», no entre las dos líneas. */}
      <td
        aria-hidden
        className="w-6 py-4 pl-1 text-center align-top leading-7 text-muted-foreground"
      >
        =
      </td>
      <td className="py-4 pr-3 align-top">
        <span className="block font-serif text-xl font-semibold leading-7 tracking-tight">
          {label}
        </span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </td>
      <td className="py-4 pr-1 text-right align-top">
        <Amount cents={cents} className="font-serif text-2xl font-semibold tracking-tight" />
      </td>
    </tr>
  )
}

/**
 * De dónde sale el número: la barra para el dueño y la cascada para la
 * contadora, con «Ver como tabla» para pasar de una a otra. Si la barra no se
 * puede dibujar sin mentir (la cuenta simple no cierra, o un lado es cero), va
 * directo la cascada con una oración que lo dice.
 */
function HowItAdds({
  position: p,
  month,
  base,
  asTable,
  sales,
}: {
  position: IvaPosition
  month: string
  base: string
  asTable: boolean
  sales: ReadonlyArray<{ soldCents: number; uninvoicedCents: number }> | null
}) {
  const withoutId = useId()
  const bar = ivaCoverBar(p)
  const oneSided = ivaOneSidedSentence(p, month)
  const cascade = <Cascade position={p} month={month} />
  const noun = monthNoun(month)

  const sold = sales ? sales.reduce((sum, r) => sum + r.soldCents, 0) : 0
  const uninvoiced = sales ? sales.reduce((sum, r) => sum + r.uninvoicedCents, 0) : 0
  const invoiced = sold - uninvoiced
  const salesSentence =
    sales && sold > 0 ? (
      <>
        {/* «Contando las facturas cargadas aparte»: por eso este total puede ser mayor que el
            «Vendido en los cierres del día» del papel de Fin de mes. */}
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
      </>
    ) : null

  return (
    <Panel>
      {/* Compu: la cuenta a la izquierda y «Lo que va sin factura» al lado (la leyenda y la
          cascada no pasan de media pantalla: abajo dejaban la mitad derecha vacía). Celular: una
          debajo de la otra, separadas por una raya. */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          {bar ? (
            <ChartFrame
              headingLevel="h2"
              title={bar.title}
              sentence={bar.sentence}
              defaultView={asTable ? 'table' : 'chart'}
              chart={
                <SplitBar
                  segments={bar.segments}
                  height={16}
                  totalLabel={bar.totalLabel}
                  ariaLabel={`${bar.title}. ${bar.sentence}`}
                />
              }
              table={cascade}
              footer="En los libros: lo que cobraste de IVA es el débito fiscal; lo de tus compras con Factura A, el crédito fiscal."
            />
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <h2 className="font-serif text-lg font-semibold leading-snug tracking-tight">
                  ¿Cómo se calcula?
                </h2>
                {oneSided ? (
                  <p className="max-w-prose text-sm text-muted-foreground text-pretty">
                    {oneSided}
                  </p>
                ) : null}
              </div>
              {cascade}
            </div>
          )}
        </div>

        <section
          aria-labelledby={withoutId}
          className="min-w-0 border-t border-border/60 pt-4 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8"
        >
          <h3 id={withoutId} className="text-sm font-semibold leading-snug">
            Lo que va sin factura
          </h3>
          <div className="mt-2 max-w-prose space-y-2 text-sm leading-relaxed text-muted-foreground text-pretty">
            {salesSentence ? <p>{salesSentence}</p> : null}
            <p>
              De tus compras, solo las de Factura A restan IVA. Las de Factura B o C, los tiques y
              lo que va sin factura quedan registrados igual, sin IVA para recuperar.
            </p>
            <p>Cómo se trata cada cosa lo define tu contadora.</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
            <PanelLink href={`${base}/ventas?tab=facturas`}>
              Ver las ventas con y sin factura
              <ArrowRight className="size-3.5" aria-hidden />
            </PanelLink>
            <PanelLink href={`${base}/guias/con-y-sin-factura`}>
              Guía: con factura y sin factura
              <ArrowRight className="size-3.5" aria-hidden />
            </PanelLink>
          </div>
        </section>
      </div>
    </Panel>
  )
}

function Money({ cents }: { cents: number }) {
  return (
    <span className="whitespace-nowrap font-medium tabular-nums text-foreground">
      {formatCentsShort(cents)}
    </span>
  )
}

// ─── «El IVA mes a mes» ──────────────────────────────────────────────────────

function TrendSkeleton() {
  return (
    <div className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
      <Skeleton className="h-6 w-96 max-w-full" />
      {['a', 'b'].map((k) => (
        <div key={k} className="flex items-center gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-2.5 flex-1" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
    </div>
  )
}

/**
 * «¿Este número es normal?»: un renglón por mes, en orden, con una barra del
 * largo de lo que hay que pagar. Un mes a favor va sin barra y lo dice con
 * palabras. No lleva porcentajes: comparar un mes contra la suma de seis no
 * dice nada. Tocar un mes abre su cuenta.
 */
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
  const title = ivaTrendTitle(rows, compactCents)
  if (rows.length < 2 || !title) return null
  const max = Math.max(...rows.map((r) => r.toPayCents))

  return (
    <Panel>
      <ChartFrame
        headingLevel="h2"
        title={title}
        sentence="El IVA mes a mes: lo que hubo que pagar en cada uno."
        chart={
          <ul className="-mx-2">
            {rows.map((row) => (
              <li key={row.month}>
                <Link
                  href={bookHref(path, { mes: row.month })}
                  aria-current={row.month === selected ? 'true' : undefined}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2 outline-none transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]',
                    row.month === selected && 'bg-secondary/50',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{row.label}</span>
                    <span className="block text-xs text-muted-foreground">{row.stateWord}</span>
                  </span>
                  <span className="text-right text-sm font-medium whitespace-nowrap tabular-nums sm:order-3">
                    {row.text}
                  </span>
                  <span
                    aria-hidden
                    className="relative col-span-2 block h-2.5 sm:order-2 sm:col-span-1"
                  >
                    {row.toPayCents > 0 && max > 0 ? (
                      <span
                        className="rail-grow absolute inset-y-0 left-0 block min-w-[2px] rounded-r-[4px] bg-adm-s2"
                        style={{ width: `${pct(row.toPayCents, max)}%` }}
                      />
                    ) : (
                      <span className="absolute inset-x-0 top-1/2 block border-t border-dashed border-border" />
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        }
        table={
          <ChartTable
            caption="El IVA mes a mes"
            columns={[
              { key: 'mes', label: 'Mes' },
              { key: 'ventas', label: 'IVA de tus ventas', align: 'right' },
              { key: 'compras', label: 'IVA de tus compras', align: 'right' },
              { key: 'resultado', label: 'A pagar o a favor', align: 'right' },
            ]}
            rows={rows.map((row) => ({
              key: row.month,
              cells: [
                `${row.label} (${row.stateWord})`,
                formatCentsShort(row.debitCents),
                formatCentsShort(row.creditCents),
                row.text,
              ],
            }))}
          />
        }
      />
    </Panel>
  )
}

// ─── «Para la contadora» ─────────────────────────────────────────────────────

/** La conciliación de los libros IVA contra el mayor: plegada para el dueño, abierta para ella. */
function Reconciliation({
  position: p,
  base,
  open,
}: {
  position: IvaPosition
  base: string
  open: boolean
}) {
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
    <details open={open} className="group/rec card-hairline rounded-2xl border bg-card shadow-xs">
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform duration-(--duration-fast) group-open/rec:rotate-0 motion-reduce:transition-none"
        />
        <h2 className="font-serif text-lg font-semibold leading-snug tracking-tight">
          Para la contadora
        </h2>
        <span className="text-sm text-muted-foreground">Conciliación con los libros</span>
        <span className="ml-auto">
          {r.matches ? (
            <StatusPill tone="ok">Coinciden</StatusPill>
          ) : (
            <StatusPill tone="warn">Hay diferencias</StatusPill>
          )}
        </span>
      </summary>
      <div className="px-4 pb-5 sm:px-5">
        <p className="text-xs text-muted-foreground">
          Lo que dicen los libros IVA contra lo que quedó en el mayor.
        </p>
        <div className="mt-2 divide-y divide-border/60">
          {rows.map((row) => (
            <div key={row.key} className="grid gap-1 py-3 text-sm sm:grid-cols-3 sm:items-center">
              <span className="font-medium">{row.label}</span>
              <span className="flex justify-between gap-2 sm:block sm:text-right">
                <span className="text-xs text-muted-foreground sm:block">{row.bookLabel}</span>
                <Amount cents={row.book} />
              </span>
              <span className="flex justify-between gap-2 sm:block sm:text-right">
                <span className="text-xs text-muted-foreground sm:block">Mayor</span>
                <Amount cents={row.journal} />
              </span>
            </div>
          ))}
        </div>
        {r.differences.length > 0 ? (
          <div className="border-t border-border/60 pt-4">
            <p className="mb-2 text-sm font-medium">Asientos que movieron IVA sin comprobante</p>
            <ul className="divide-y divide-border/60 text-sm">
              {r.differences.map((d, i) => (
                <li
                  key={`${d.entryId ?? d.documentId ?? 'dif'}-${i.toString()}`}
                  className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
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
              <p className="mt-2 text-xs text-muted-foreground">
                Y {r.differencesCount - r.differences.length} asientos más: están en el libro
                diario.
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground text-pretty">
          {r.matches
            ? 'Los libros de IVA dicen lo mismo que el mayor.'
            : r.fullyExplained
              ? 'La diferencia la explican los asientos que movieron IVA sin un comprobante.'
              : 'Parte de la diferencia no la explica ningún asiento.'}
        </p>
      </div>
    </details>
  )
}
