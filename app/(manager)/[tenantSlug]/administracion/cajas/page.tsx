import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { RangeFilter } from '@/components/administracion/cajas-ventas/period-filters'
import { firstParam, resolveRange } from '@/components/administracion/cajas-ventas/periods'
import { PanelError } from '@/components/administracion/kit/panel-states'
import { PlanillaBar, SimplePage } from '@/components/administracion/planilla'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { CASH_CHART_RANGE_PARAM, resolveCashChartRange } from '@/lib/accounting/cash-daily'
import { loadPostingCatalog } from '@/lib/accounting/context'
import { getCashDaily } from '@/lib/accounting/queries/cash-flow'
import { exportHref } from '@/lib/accounting/queries/labels'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import {
  getCashFlow,
  getCashProjection,
  listTreasuryBalances,
} from '@/lib/accounting/queries/treasury'
import {
  addMonthsToYearMonth,
  formatRange,
  monthOf,
  startOfMonth,
  todayInCordoba,
} from '@/lib/dates'
import { AccountsSkeleton } from './_components/accounts-skeleton'
import { AccountsTable } from './_components/accounts-table'
import { CashMoveBlock, CashMoveSkeleton } from './_components/cash-daily-section'
import { FlowBlocks, FlowTabSkeleton } from './_components/flow-blocks'
import { MoneyButtons } from './_components/money-buttons'
import { ProjectionBlock } from './_components/projection-block'
import {
  type CajaAccountMeta,
  cajaView,
  walletHero,
  walletTones,
  walletTotals,
} from './_lib/wallet-view'

export const metadata = { title: 'Caja' }

type PageProps = {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Caja: cuánto hay en cada cuenta, en una sola tabla con su total (es lo que pidió Luciano). Arriba,
 * «Entró plata» y «Salió plata». Lo demás de la plata (mes por mes, en qué se fue, las próximas
 * semanas y cómo se movió día por día) queda en «Ver el detalle» (`?tab=flujo`), y lo de una cuenta,
 * en su panel lateral y en su ficha (`/cajas/[id]`).
 */
export default async function CajasPage({ params, searchParams }: PageProps) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const flujo = firstParam(sp.tab) === 'flujo'
  const { access, canWrite } = await requireAdminPage(
    tenantSlug,
    flujo ? `${base}/cajas?tab=flujo` : `${base}/cajas`,
  )
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  if (flujo) {
    return (
      <SimplePage>
        <div className="grid justify-items-start gap-1">
          <Link
            href={`${base}/cajas`}
            className="inline-flex min-h-10 items-center gap-1 rounded-sm text-[13px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            Cuánto hay en cada cuenta
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif text-2xl font-semibold tracking-tight">Entró y salió</h1>
            <ReadOnlyBadge />
          </div>
        </div>
        <Suspense fallback={<FlowTabSkeleton />}>
          <Detalle
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            base={base}
            today={today}
            canWrite={canWrite}
            sp={sp}
          />
        </Suspense>
      </SimplePage>
    )
  }

  return (
    <SimplePage>
      <h1 className="sr-only">Caja</h1>
      <PlanillaBar className="justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="text-[13px] text-muted-foreground">Cuánto hay en cada cuenta</p>
          <ReadOnlyBadge />
        </div>
        <MoneyButtons base={base} />
      </PlanillaBar>
      <Suspense fallback={<AccountsSkeleton />}>
        <Cuentas
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          base={base}
          today={today}
          canWrite={canWrite}
        />
      </Suspense>
    </SimplePage>
  )
}

type BlockProps = {
  tenantId: string
  tenantSlug: string
  base: string
  today: string
  canWrite: boolean
}

/**
 * Los saldos salen de su reporte; lo que falta para escribir (el `updated_at` de cada cuenta, si
 * cobra el impuesto al cheque, cómo vienen los saldos iniciales), del catálogo. Si el catálogo falla
 * la tabla sale igual, sin lo que necesita ese dato.
 */
async function Cuentas({ tenantId, tenantSlug, base, today, canWrite }: BlockProps) {
  const [balances, catalog] = await Promise.all([
    settleQuery(listTreasuryBalances(tenantId, { asOf: today })),
    settleQuery(loadPostingCatalog(tenantId)),
  ])
  if (!balances.ok) return <PanelError title="Las cuentas" message={balances.message} />

  const meta = new Map<string, CajaAccountMeta>()
  if (catalog.ok) {
    for (const t of catalog.data.treasuries) {
      meta.set(t.id, { updatedAt: t.updatedAt, chargesBankTax: t.chargesBankTax ?? null })
    }
  }
  return (
    <AccountsTable
      tenantSlug={tenantSlug}
      base={base}
      view={cajaView(balances.data, meta, catalog.ok ? catalog.data.settings : null, {
        today,
        canWrite,
        base,
      })}
      exportHref={exportHref(tenantSlug, 'cajas-y-bancos', { hasta: today })}
      exportFileName={`administracion-${tenantSlug}-cajas-y-bancos-${today}.csv`}
    />
  )
}

/** «Ver el detalle»: el flujo por mes, cómo se movió día por día y si alcanza las próximas semanas. */
async function Detalle({
  tenantId,
  tenantSlug,
  base,
  today,
  canWrite,
  sp,
}: BlockProps & { sp: Record<string, string | string[] | undefined> }) {
  // El dibujo por día se pide junto con el resto pero no se espera acá: llega en su Suspense.
  const chartRange = resolveCashChartRange(firstParam(sp[CASH_CHART_RANGE_PARAM]), today)
  const cashDaily = settleQuery(
    getCashDaily(tenantId, { from: chartRange.from, to: chartRange.to }),
  )
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
    <div className="min-w-0 space-y-6">
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
      <Suspense fallback={<CashMoveSkeleton />}>
        <CashMoveBlock
          report={cashDaily}
          range={chartRange}
          today={today}
          base={base}
          booksStartDate={settings?.booksStartDate ?? null}
          tones={walletTones(rows)}
        />
      </Suspense>
    </div>
  )
}
