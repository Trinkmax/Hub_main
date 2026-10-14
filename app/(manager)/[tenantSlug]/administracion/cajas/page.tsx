import { Suspense } from 'react'
import { PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { RangeFilter } from '@/components/administracion/cajas-ventas/period-filters'
import { firstParam, resolveRange } from '@/components/administracion/cajas-ventas/periods'
import { treasuryToneSwatch } from '@/components/administracion/charts/palette'
import { AdmHeader, AdmPage, PanelError, ViewPills } from '@/components/administracion/kit'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { CASH_CHART_RANGE_PARAM, resolveCashChartRange } from '@/lib/accounting/cash-daily'
import { getSubledger } from '@/lib/accounting/queries/books'
import { getCashDaily } from '@/lib/accounting/queries/cash-flow'
import { exportHref } from '@/lib/accounting/queries/labels'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import {
  getCashFlow,
  getCashProjection,
  listTreasuryBalances,
} from '@/lib/accounting/queries/treasury'
import type { TreasuryKind } from '@/lib/accounting/types'
import {
  addDays,
  addMonthsToYearMonth,
  formatRange,
  monthOf,
  startOfMonth,
  todayInCordoba,
} from '@/lib/dates'
import { CashMoveBlock, CashMoveSkeleton } from './_components/cash-daily-section'
import { FlowBlocks } from './_components/flow-blocks'
import { ProjectionBlock } from './_components/projection-block'
import { RECENT_DAYS, RecentActivity, RecentActivitySkeleton } from './_components/recent-activity'
import { type TreasuryBalanceItem, TreasuryBalances } from './_components/treasury-balances'
import { Wallet } from './_components/wallet'
import { WalletEmpty, WalletNoTreasuries } from './_components/wallet-empty'
import { walletHero, walletTones, walletTotals, walletView } from './_lib/wallet-view'

export const metadata = { title: 'Cajas y bancos' }

type Tab = 'saldos' | 'flujo'

/**
 * Cajas y bancos, «la billetera». Dos vistas en la URL: «Lo que hay» (la de
 * siempre: el total, una tarjeta por caja, cómo se movió y los últimos
 * movimientos) y «Entró y salió» (`?tab=flujo`: mes por mes, en qué se fue y si
 * alcanza para las próximas semanas).
 */
export default async function CajasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const tab: Tab = firstParam(sp.tab) === 'flujo' ? 'flujo' : 'saldos'
  const { access, canWrite } = await requireAdminPage(
    tenantSlug,
    tab === 'flujo' ? `${base}/cajas?tab=flujo` : `${base}/cajas`,
  )
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  return (
    <AdmPage>
      <AdmHeader title="Cajas y bancos" badge={<ReadOnlyBadge />} />
      <ViewPills
        label="Secciones de Cajas y bancos"
        items={[
          { key: 'saldos', label: 'Lo que hay', href: `${base}/cajas`, active: tab === 'saldos' },
          {
            key: 'flujo',
            label: 'Entró y salió',
            href: `${base}/cajas?tab=flujo`,
            active: tab === 'flujo',
          },
        ]}
      />

      {tab === 'saldos' ? (
        <LoQueHay
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          base={base}
          today={today}
          canWrite={canWrite}
          sp={sp}
        />
      ) : (
        <EntroYSalio
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          base={base}
          today={today}
          canWrite={canWrite}
          sp={sp}
        />
      )}

      <QuickActionsBar />
    </AdmPage>
  )
}

type TabProps = {
  tenantId: string
  tenantSlug: string
  base: string
  today: string
  canWrite: boolean
  sp: Record<string, string | string[] | undefined>
}

async function LoQueHay({ tenantId, tenantSlug, base, today, canWrite, sp }: TabProps) {
  // El dibujo se pide junto con los saldos pero no se espera acá: llega en su
  // propio Suspense. `settleQuery` nunca rechaza.
  const chartRange = resolveCashChartRange(firstParam(sp[CASH_CHART_RANGE_PARAM]), today)
  const cashDaily = settleQuery(
    getCashDaily(tenantId, { from: chartRange.from, to: chartRange.to }),
  )
  const [balances, settingsResult] = await Promise.all([
    settleQuery(listTreasuryBalances(tenantId, { asOf: today })),
    settleQuery(getAccountingSettings(tenantId)),
  ])
  if (!balances.ok) return <PanelError title="Lo que hay" message={balances.message} />

  const rows = balances.data
  const settings = settingsResult.ok ? settingsResult.data : null
  const view = walletView(rows, settings, { today, canWrite, base })

  if (view.kind === 'no_treasuries') return <WalletNoTreasuries view={view} />
  if (view.kind === 'opening_pending') return <WalletEmpty view={view} canWrite={canWrite} />

  const tones = walletTones(rows)
  const swatches: Record<string, string> = {}
  const kinds: Record<string, TreasuryKind> = {}
  for (const row of rows) {
    swatches[row.treasuryId] = treasuryToneSwatch(tones[row.treasuryId] ?? null)
    kinds[row.treasuryId] = row.kind
  }

  // «Últimos movimientos» mira dos semanas: si ninguna caja se movió en ese
  // tiempo, la lectura no se pide.
  const recentFrom = addDays(today, -(RECENT_DAYS - 1))
  const recent =
    view.lastMovementDate !== null && view.lastMovementDate >= recentFrom
      ? settleQuery(getSubledger(tenantId, { kind: 'treasury', from: recentFrom, to: today }))
      : null

  const items: TreasuryBalanceItem[] = rows.map((t) => ({
    id: t.treasuryId,
    name: t.name,
    kind: t.kind,
    balanceCents: t.balanceCents,
    pendingWalletCents: t.pendingWalletCents,
    lastCheckedOn: t.lastCheckedOn,
    lastMovementDate: t.lastMovementDate,
    active: t.active,
    detail: t.alias ?? t.bankName ?? null,
  }))

  return (
    <div className="space-y-8">
      <Wallet
        view={view}
        base={base}
        canWrite={canWrite}
        table={
          <TreasuryBalances
            items={items}
            availableCents={walletTotals(rows).availableCents}
            today={today}
            since={settings?.booksStartDate ?? null}
            base={base}
            exportHref={exportHref(tenantSlug, 'cajas-y-bancos', { hasta: today })}
            exportFileName={`administracion-${tenantSlug}-cajas-y-bancos-${today}.csv`}
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <Suspense fallback={<CashMoveSkeleton className="lg:col-span-8" />}>
          <CashMoveBlock
            report={cashDaily}
            range={chartRange}
            today={today}
            base={base}
            booksStartDate={settings?.booksStartDate ?? null}
            tones={tones}
            className="min-w-0 lg:col-span-8"
          />
        </Suspense>
        <Suspense fallback={<RecentActivitySkeleton className="lg:col-span-4" />}>
          <RecentActivity
            page={recent}
            base={base}
            today={today}
            swatches={swatches}
            kinds={kinds}
            lastMovementDate={view.lastMovementDate}
            className="min-w-0 lg:col-span-4"
          />
        </Suspense>
      </div>
    </div>
  )
}

async function EntroYSalio({ tenantId, tenantSlug, base, today, canWrite, sp }: TabProps) {
  // Por defecto, los últimos tres meses (con el actual).
  const fallbackFrom = startOfMonth(addMonthsToYearMonth(monthOf(today), -2))
  const range = resolveRange(sp, today, { kind: 'range', from: fallbackFrom, to: today })
  const picker = range.ok
    ? range
    : ({
        kind: 'range',
        month: null,
        from: fallbackFrom,
        to: today,
        label: formatRange(fallbackFrom, today),
      } as const)

  // Los saldos y la configuración dicen si «la plata de hoy» es un dato (la
  // proyección no estima nada sobre un cero que no lo es).
  const [flow, projection, balances, settingsResult] = await Promise.all([
    range.ok ? settleQuery(getCashFlow(tenantId, { from: range.from, to: range.to })) : null,
    settleQuery(getCashProjection(tenantId, { asOf: today, weeks: 4 })),
    settleQuery(listTreasuryBalances(tenantId, { asOf: today })),
    settleQuery(getAccountingSettings(tenantId)),
  ])
  const rows = balances.ok ? balances.data : []
  const settings = settingsResult.ok ? settingsResult.data : null
  const known = balances.ok && walletHero(rows, settings, { canWrite, base }).kind === 'normal'
  const everMoved = rows.some((r) => r.lastMovementDate !== null)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeFilter range={picker} today={today} />
        {range.ok ? (
          <ExportButton
            href={exportHref(tenantSlug, 'flujo-de-caja', { desde: range.from, hasta: range.to })}
            fileName={`administracion-${tenantSlug}-flujo-de-caja-${range.from}-${range.to}.csv`}
            className="h-11 md:h-9"
          />
        ) : null}
      </div>
      {!range.ok ? (
        <PeriodError message={range.message} />
      ) : !flow?.ok ? (
        <PanelError title="Entró y salió" message={flow?.message ?? ''} />
      ) : (
        <FlowBlocks
          rows={flow.data}
          label={range.label}
          tableFirst={!canWrite}
          everMoved={everMoved}
        />
      )}
      <ProjectionBlock
        // Sin los saldos no hay «plata de hoy» de la que partir: es un error, no un vacío.
        projection={balances.ok ? projection : balances}
        availableCents={walletTotals(rows).availableCents}
        known={known}
        today={today}
        base={base}
        canWrite={canWrite}
      />
    </div>
  )
}
