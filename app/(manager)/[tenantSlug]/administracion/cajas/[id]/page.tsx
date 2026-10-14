import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { RangeFilter } from '@/components/administracion/cajas-ventas/period-filters'
import {
  firstParam,
  hrefWith,
  periodParams,
  type RangeValue,
  resolveRange,
} from '@/components/administracion/cajas-ventas/periods'
import { BalanceArea, BalanceAreaTable } from '@/components/administracion/charts/balance-area'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { InOutBars } from '@/components/administracion/charts/in-out-bars'
import { treasuryToneSwatch } from '@/components/administracion/charts/palette'
import { AdmHeader, AdmPage, Panel, PanelError, StatusPill } from '@/components/administracion/kit'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { type StatementRow, StatementTable } from '@/components/administracion/statement-table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  buildCashDailySeries,
  CASH_DAILY_LABELS,
  CASH_DAILY_MAX_DAYS,
  type CashDailyReport,
  cashDailySummary,
} from '@/lib/accounting/cash-daily'
import { balancePoints, balanceTrend, weekBuckets } from '@/lib/accounting/home'
import { getCashDaily } from '@/lib/accounting/queries/cash-flow'
import { getTreasuryCheck } from '@/lib/accounting/queries/forms'
import { exportHref } from '@/lib/accounting/queries/labels'
import { getAccountingSettings, listSalesMethods } from '@/lib/accounting/queries/settings'
import { type QueryOutcome, settleQuery } from '@/lib/accounting/queries/shared'
import {
  getTreasuryAccount,
  getTreasuryMovements,
  listTreasuryBalances,
  type TreasuryAccountRow,
} from '@/lib/accounting/queries/treasury'
import { daysBetween, formatDayMonth, formatIsoDay, todayInCordoba } from '@/lib/dates'
import { SAME_AXIS } from '../_components/cash-move-panel'
import { activityFromMovement, groupByDay, movementFromTreasuryRow } from '../_lib/activity'
import {
  dayBuckets,
  type MoveFrame,
  moveTitle,
  OPENING_DAY_NOTE,
  OPENING_NOTE,
  restoreOpeningDay,
} from '../_lib/move-view'
import {
  type CajaPeriod,
  cajaHero,
  type OpeningMoves,
  openingMoves,
  periodName,
  treasuryCountStatus,
  treasuryMoney,
  walletTones,
} from '../_lib/wallet-view'
import { CajaActivity, CajaActivityEmpty } from './_components/caja-activity'
import { CajaHero } from './_components/caja-hero'
import { PendingBlock, PendingSkeleton } from './_components/pending-block'

export const metadata = { title: 'Movimientos de una caja' }

/** Cuántos movimientos entran en una página (el tope de la base). */
const PAGE_LIMIT = 500
/** Hasta cuántos días se dibuja lo que entró y salió día por día; después, por semana. */
const DAILY_BARS_MAX = 31
/** Hasta cuántos días se dibuja por semana; con más, solo el saldo. */
const WEEKLY_BARS_MAX = 92

/**
 * El detalle sin repetir el comprobante: con «Gasto», la descripción
 * «Gasto · Hielo» queda en «Hielo» (y si es igual al comprobante, no va).
 */
function detailText(description: string | null, label: string): string | null {
  if (!description || description === label) return null
  const prefix = `${label} · `
  return description.startsWith(prefix) ? description.slice(prefix.length) || null : description
}

/** «Movimientos de octubre» · «Movimientos del 01/08 al 13/10». */
function movementsTitle(range: RangeValue): string {
  if (range.kind === 'month' && range.month) return `Movimientos de ${periodName(range)}`
  if (range.from === range.to) return `Movimientos del ${formatDayMonth(range.from)}`
  return `Movimientos del ${formatDayMonth(range.from)} al ${formatDayMonth(range.to)}`
}

/**
 * La ficha de una caja: «la tarjeta abierta». Arriba, la tarjeta en grande con
 * lo que hay, si coincide con lo que hay de verdad y el botón para contarla;
 * debajo, cómo se movió y lo que pasó día por día, en palabras. La tabla Debe /
 * Haber de siempre queda en «Ver como tabla» (la contadora la ve de entrada).
 */
export default async function CajaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug, id } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const { access, canWrite } = await requireAdminPage(tenantSlug, `${base}/cajas/${id}`)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const treasury = await getTreasuryAccount(tenantId, id)
  if (!treasury) notFound()

  const range = resolveRange(sp, today)
  const after = firstParam(sp.despues)
  const [page, balances, settingsResult] = await Promise.all([
    range.ok
      ? settleQuery(
          getTreasuryMovements(tenantId, {
            treasuryId: treasury.id,
            from: range.from,
            to: range.to,
            after,
            limit: PAGE_LIMIT,
          }),
        )
      : null,
    settleQuery(listTreasuryBalances(tenantId, { asOf: today })),
    settleQuery(getAccountingSettings(tenantId)),
  ])
  const settings = settingsResult.ok ? settingsResult.data : null
  const since = settings?.booksStartDate ?? null
  const balanceRows = balances.ok ? balances.data : []
  const balance = balanceRows.find((r) => r.treasuryId === treasury.id) ?? null
  const tone = treasury.active ? (walletTones(balanceRows)[treasury.id] ?? null) : null
  const everMoved = balance ? balance.lastMovementDate !== null : true
  const pendingCents =
    treasury.kind === 'wallet' && balance ? Math.max(0, balance.pendingWalletCents) : 0

  const isCard = treasury.kind === 'credit_card'
  // En la tarjeta de la empresa el saldo es una deuda: se lee como la de un proveedor.
  const sign = isCard ? -1 : 1
  const data = page?.ok ? page.data : null
  const lines = (data?.rows ?? []).filter((r) => r.rowKind === 'line')
  const rows: StatementRow[] = lines.map((r, index) => {
    const label = r.documentLabel ?? r.description ?? 'Movimiento'
    const detail = [detailText(r.description, label), r.counterpart].filter(Boolean).join(' · ')
    return {
      id: `${r.entryId ?? 'linea'}-${index}`,
      date: r.entryDate ?? (range.ok ? range.from : today),
      voucher: label,
      href: r.documentId ? `${base}/comprobantes/${r.documentId}` : null,
      detail: detail || null,
      debitCents: r.inCents > 0 ? r.inCents : null,
      creditCents: r.outCents > 0 ? r.outCents : null,
      balanceCents: sign * r.balanceCents,
    }
  })
  const firstPage = after === null
  // Lo que había al arrancar no es plata que entró: la tarjeta lo dice aparte y el dibujo lo
  // descuenta. Los saldos iniciales son lo primero del período, así que están en la primera
  // página; en las siguientes no se sabe, y queda todo como venía.
  const opening = firstPage ? openingMoves(lines) : null
  // El mes en curso termina después de hoy: si no hay nada cargado con fecha
  // posterior (las filas vienen en orden y esta es la última página), el saldo
  // del cierre es el de hoy. «Saldo al 31/10» un 7 de octubre parece una proyección.
  const lastDate = rows.at(-1)?.date ?? null
  const closingDay = !range.ok
    ? today
    : range.to > today &&
        range.from <= today &&
        data !== null &&
        !data.nextCursor &&
        (lastDate === null || lastDate <= today)
      ? today
      : range.to
  const period: CajaPeriod | null = range.ok
    ? { kind: range.kind, month: range.month, from: range.from, to: range.to }
    : null

  // Lo más nuevo arriba cuando el período entra en una página (lo normal); si
  // hay que paginar, del más viejo al más nuevo, que es como pagina la base.
  const onePage = firstPage && data !== null && !data.nextCursor
  const days = groupByDay(
    lines
      .map((r, index) => movementFromTreasuryRow(r, index, treasury))
      .filter((m) => m !== null)
      .map((m) => activityFromMovement(m, { view: 'one', kindOf: () => treasury.kind })),
    { today, newestFirst: onePage },
  )

  const detail = [treasury.bankName, treasury.alias ? `Alias ${treasury.alias}` : null]
    .filter(Boolean)
    .join(' · ')
  const fileName = range.ok
    ? `administracion-${tenantSlug}-${treasury.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${range.from}-${range.to}.csv`
    : 'administracion.csv'

  // El dibujo va hasta hoy (lo que falta del mes no pasó) y hasta un año.
  const chartTo = range.ok && range.to > today ? today : range.ok ? range.to : today
  const chartDays = range.ok && range.from <= chartTo ? daysBetween(range.from, chartTo) + 1 : 0
  const cashDaily =
    range.ok && chartDays > 0 && chartDays <= CASH_DAILY_MAX_DAYS
      ? settleQuery(getCashDaily(tenantId, { from: range.from, to: chartTo }))
      : null
  const walletCheck =
    treasury.kind === 'wallet' && treasury.bankPartyId !== null && pendingCents > 0
      ? settleQuery(getTreasuryCheck(tenantId, { treasuryId: treasury.id, asOf: today }))
      : null
  // Solo para decir qué entra sola a una caja de efectivo que todavía no se movió.
  const methods =
    !everMoved && treasury.kind === 'cash' ? await settleQuery(listSalesMethods(tenantId)) : null
  const methodNames = (methods?.ok ? methods.data : [])
    .filter((m) => m.active && m.treasuryAccountId === treasury.id)
    .map((m) => m.name)

  const money = balance ? treasuryMoney(treasury.kind, balance.balanceCents) : null
  // Faltan los saldos iniciales y esta caja nunca se movió: su «$ 0» no es un dato (como en la
  // billetera). Arriba se dice y el botón de la pantalla es «Cargar lo que había».
  const openingUnknown =
    settings?.openingStatus === 'pending' && !everMoved && treasury.active && balance !== null

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={{ href: `${base}/cajas`, label: 'Cajas y bancos' }}
        title={treasury.name}
        badge={
          <>
            {treasury.active ? null : <StatusPill tone="muted">Desactivada</StatusPill>}
            <ReadOnlyBadge />
          </>
        }
        description={detail || undefined}
      />

      <CajaHero
        treasuryId={treasury.id}
        name={treasury.name}
        kind={treasury.kind}
        tone={tone}
        active={treasury.active}
        hero={
          data && period
            ? cajaHero({
                kind: treasury.kind,
                period,
                openingCents: data.openingCents,
                inCents: data.inCents,
                outCents: data.outCents,
                closingCents: data.closingCents,
                closingDay,
                today,
                opening,
              })
            : null
        }
        fallback={
          balance && money
            ? {
                label: money.label ? `${money.label} hoy` : isCard ? 'Debés hoy' : 'Hay hoy',
                cents: Math.abs(balance.balanceCents),
              }
            : null
        }
        count={treasuryCountStatus(
          {
            kind: treasury.kind,
            active: treasury.active,
            lastCheckedOn: treasury.lastCheckedOn,
            hasMovements: everMoved,
          },
          { today, since },
        )}
        pendingCents={pendingCents}
        opening={openingUnknown ? { href: `${base}/configurar` } : null}
        base={base}
        canWrite={canWrite}
      />

      {walletCheck ? (
        <Suspense fallback={<PendingSkeleton />}>
          <PendingBlock
            check={walletCheck}
            name={treasury.name}
            balanceCents={balance?.balanceCents ?? 0}
            pendingCents={pendingCents}
            swatch={treasuryToneSwatch(tone)}
            base={base}
            canWrite={canWrite}
          />
        </Suspense>
      ) : null}

      {range.ok && everMoved ? (
        cashDaily ? (
          <Suspense fallback={<HowItMovedSkeleton />}>
            <HowItMoved
              report={cashDaily}
              treasury={treasury}
              range={range}
              to={chartTo}
              today={today}
              booksStartDate={since}
              opening={opening}
              base={base}
            />
          </Suspense>
        ) : chartDays > CASH_DAILY_MAX_DAYS ? (
          <Panel title="Cómo se movió">
            <p className="text-sm text-muted-foreground">
              El período es muy largo para dibujarlo: elegí hasta un año.
            </p>
          </Panel>
        ) : null
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeFilter
          range={
            range.ok
              ? range
              : { kind: 'month', month: today.slice(0, 7), from: today, to: today, label: '' }
          }
          today={today}
        />
        {range.ok ? (
          <ExportButton
            href={exportHref(tenantSlug, 'subdiario-disponibilidades', {
              caja: treasury.id,
              desde: range.from,
              hasta: range.to,
            })}
            fileName={fileName}
            className="h-11 md:h-9"
          />
        ) : null}
      </div>

      {!range.ok ? (
        <PeriodError message={range.message} />
      ) : !page?.ok || !data ? (
        <PanelError title={movementsTitle(range)} message={page && !page.ok ? page.message : ''} />
      ) : (
        <>
          <Panel>
            <ChartFrame
              headingLevel="h2"
              title={movementsTitle(range)}
              defaultView={canWrite ? 'chart' : 'table'}
              sentence={
                rows.length === 0
                  ? undefined
                  : !onePage || data.totalRows > rows.length
                    ? `Mostrando ${rows.length} de ${data.totalRows} movimientos, del más viejo al más nuevo.`
                    : rows.length === 1
                      ? '1 movimiento.'
                      : `${rows.length} movimientos. Lo más nuevo, arriba.`
              }
              chart={
                <CajaActivity
                  label={`Movimientos de ${treasury.name}`}
                  days={days}
                  base={base}
                  mode={isCard ? 'card' : 'money'}
                  empty={
                    <CajaActivityEmpty
                      treasury={{ id: treasury.id, name: treasury.name, kind: treasury.kind }}
                      everMoved={everMoved}
                      lastMovementDate={balance?.lastMovementDate ?? null}
                      period={{
                        kind: range.kind,
                        month: range.month,
                        from: range.from,
                        to: range.to,
                      }}
                      methods={methodNames}
                      openingPending={settings?.openingStatus === 'pending'}
                      base={base}
                      // «Cargar lo que había» ya es el botón de arriba: acá no se repite.
                      canWrite={canWrite && !openingUnknown}
                    />
                  }
                />
              }
              table={
                <StatementTable
                  rows={rows}
                  caption={`Movimientos de ${treasury.name}, ${range.label}`}
                  balanceMode={isCard ? 'payable' : 'treasury'}
                  columnLabels={
                    isCard
                      ? { debit: 'Pagos', credit: 'Consumos' }
                      : { debit: 'Entró', credit: 'Salió' }
                  }
                  opening={firstPage ? { balanceCents: sign * data.openingCents } : null}
                  totals={
                    firstPage && !data.nextCursor
                      ? { debitCents: data.inCents, creditCents: data.outCents }
                      : null
                  }
                  closing={
                    !data.nextCursor
                      ? {
                          label: `Saldo al ${formatIsoDay(closingDay)}`,
                          balanceCents: sign * data.closingCents,
                        }
                      : null
                  }
                  emptyText="No hubo movimientos en este período."
                  footnote={
                    data.totalRows > rows.length
                      ? `Mostrando ${rows.length} de ${data.totalRows} movimientos del período.`
                      : undefined
                  }
                />
              }
            />
          </Panel>
          {data.nextCursor || !firstPage ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {!firstPage ? (
                <Button asChild variant="outline" size="sm" className="h-11 md:h-9">
                  <Link href={hrefWith(`${base}/cajas/${treasury.id}`, periodParams(range))}>
                    Volver al principio
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              {data.nextCursor ? (
                <Button asChild variant="outline" size="sm" className="h-11 md:h-9">
                  <Link
                    href={hrefWith(`${base}/cajas/${treasury.id}`, {
                      ...periodParams(range),
                      despues: data.nextCursor,
                    })}
                  >
                    Ver los siguientes
                  </Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <QuickActionsBar />
    </AdmPage>
  )
}

/**
 * «Cómo se movió» esta caja en el período: lo que había al final de cada día y
 * lo que entró y salió (por día hasta un mes; por semana hasta tres; con más,
 * solo el saldo). Espera el reporte en su propio Suspense.
 */
async function HowItMoved({
  report,
  treasury,
  range,
  to,
  today,
  booksStartDate,
  opening,
  base,
}: {
  report: Promise<QueryOutcome<CashDailyReport>>
  treasury: TreasuryAccountRow
  range: RangeValue
  /** Hasta dónde se dibuja: el fin del período o, si todavía no terminó, hoy. */
  to: string
  today: string
  booksStartDate: string | null
  /** Lo que había al arrancar, si cae en este período: no se dibuja como plata que entró. */
  opening: OpeningMoves | null
  base: string
}) {
  const outcome = await report
  if (!outcome.ok) return <PanelError title="Cómo se movió" message={outcome.message} />
  const account = outcome.data.accounts.find((a) => a.treasuryId === treasury.id)
  if (!account) return null

  const opts = { from: range.from, to, booksStartDate }
  const series = buildCashDailySeries(account, { from: range.from, to })
  // Sin movimientos en el período no hay nada que dibujar: lo dice la lista de abajo.
  if (!series.hasMovements) return null

  const endsToday = to === today
  const card = series.mode === 'card'
  const labels = CASH_DAILY_LABELS[series.mode]
  const trend = balanceTrend(account, opts)
  const tooNew = trend.kind === 'too_new'
  const frame: MoveFrame =
    range.kind === 'month' && range.month
      ? endsToday && range.to > today
        ? { kind: 'month_to_date', month: range.month }
        : { kind: 'past_month', month: range.month }
      : { kind: 'range', endsToday }
  const points = balancePoints(account, opts).map((p) => ({
    ...p,
    href: hrefWith(`${base}/cajas/${treasury.id}`, { desde: p.date, hasta: p.date }),
  }))
  const days = daysBetween(range.from, to) + 1
  const daily = days <= DAILY_BARS_MAX ? dayBuckets(series, { booksStartDate, opening }) : null
  const weeks =
    daily === null && days <= WEEKLY_BARS_MAX
      ? weekBuckets(account.days, { from: range.from, to, booksStartDate })
      : null
  // La semana en que arrancan los libros recupera lo demás de ese día (ver `restoreOpeningDay`).
  const weekly = weeks
    ? restoreOpeningDay(
        weeks,
        account.days.find((d) => d.day === booksStartDate),
        opening,
      )
    : null
  const note =
    daily?.note ??
    (weekly?.some((w) => w.openingSkipped) ? (opening ? OPENING_NOTE : OPENING_DAY_NOTE) : null)
  const inLabel = card ? 'Pagos' : 'Entró'
  const outLabel = card ? 'Consumos' : 'Salió'
  const todayIndex = endsToday ? points.length - 1 : null

  return (
    <Panel>
      <ChartFrame
        headingLevel="h2"
        title={moveTitle({ series, frame, tooNew, subject: treasury.name })}
        sentence={tooNew ? trend.sentence : cashDailySummary(series, { endsToday })}
        chart={
          <div className={`space-y-5 ${daily ? SAME_AXIS : ''}`}>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {card ? 'Lo que debías al final de cada día' : 'Lo que había al final de cada día'}
              </p>
              <BalanceArea
                points={points}
                todayIndex={todayIndex}
                label={labels.balance}
                showLegend={false}
              />
            </div>
            {daily || weekly ? (
              // La leyenda, a todo el ancho del dibujo (como en la portada): los importes
              // terminan donde terminan las barras, no a media tarjeta.
              <div className="space-y-1 [&_table]:max-w-none">
                <p className="text-xs font-medium text-muted-foreground">
                  {card ? 'Los pagos y los consumos' : 'Lo que entró y lo que salió'}{' '}
                  {daily ? 'cada día' : 'cada semana'}
                </p>
                <InOutBars
                  buckets={daily ? daily.buckets : (weekly ?? [])}
                  inLabel={inLabel}
                  outLabel={outLabel}
                  emptyHint={note ?? 'En este período no entró ni salió plata.'}
                />
              </div>
            ) : null}
            {/* Lo que habla del dibujo va con el dibujo: en «Ver como tabla» no se ve. */}
            <div className="space-y-0.5 text-xs leading-snug text-muted-foreground">
              {note ? <p>{note}</p> : null}
              <p>Tocá un día del dibujo para ver qué pasó ese día.</p>
            </div>
          </div>
        }
        table={
          <BalanceAreaTable
            points={points}
            todayIndex={todayIndex}
            label={labels.balance}
            caption={`${labels.balance} de ${treasury.name} al cierre de cada día, ${range.label}`}
          />
        }
        footer={card ? <p>Es una deuda: sube con los consumos y baja con los pagos.</p> : undefined}
      />
    </Panel>
  )
}

/** Con la forma real del bloque: el título, la escalera del saldo y las barras. */
function HowItMovedSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="space-y-2">
        <Skeleton className="h-6 w-80 max-w-full" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-40 w-full sm:h-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}
