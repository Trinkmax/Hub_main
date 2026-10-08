import { Banknote, CreditCard, Info, Scale, Wallet } from 'lucide-react'
import Link from 'next/link'
import { BlockError, PeriodError } from '@/components/administracion/cajas-ventas/block-error'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { RangeFilter } from '@/components/administracion/cajas-ventas/period-filters'
import { firstParam, resolveRange } from '@/components/administracion/cajas-ventas/periods'
import { CHECK_STALE_DAYS } from '@/components/administracion/cajas-ventas/treasury-display'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { SectionNav } from '@/components/administracion/section-nav'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { StatCard } from '@/components/ui/stat-card'
import { exportHref } from '@/lib/accounting/queries/labels'
import { settleQuery } from '@/lib/accounting/queries/shared'
import {
  getCashFlow,
  getCashProjection,
  listTreasuryAccounts,
  listTreasuryBalances,
} from '@/lib/accounting/queries/treasury'
import {
  addMonthsToYearMonth,
  daysBetween,
  formatRange,
  monthOf,
  startOfMonth,
  todayInCordoba,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { CajasHeaderActions } from './_components/cajas-header-actions'
import { CashFlow, CashProjection } from './_components/cash-flow'
import { type TreasuryBalanceItem, TreasuryBalances } from './_components/treasury-balances'

export const metadata = { title: 'Cajas y bancos' }

type Tab = 'saldos' | 'flujo'

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
  const { access } = await requireAdminPage(
    tenantSlug,
    tab === 'flujo' ? `${base}/cajas?tab=flujo` : `${base}/cajas`,
  )
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title={
          <>
            Cajas y bancos <ReadOnlyBadge />
          </>
        }
        description="Cuánta plata hay en cada caja, banco y billetera, y cómo se movió."
        actions={<CajasHeaderActions base={base} />}
      />

      <SectionNav
        label="Secciones de Cajas y bancos"
        active={tab}
        items={[
          { value: 'saldos', label: 'Saldos', href: `${base}/cajas` },
          { value: 'flujo', label: 'Flujo de caja', href: `${base}/cajas?tab=flujo` },
        ]}
      />

      {tab === 'saldos' ? (
        <SaldosTab tenantId={tenantId} tenantSlug={tenantSlug} base={base} today={today} />
      ) : (
        <FlujoTab tenantId={tenantId} tenantSlug={tenantSlug} today={today} sp={sp} />
      )}

      <QuickActionsBar />
    </PageShell>
  )
}

async function SaldosTab({
  tenantId,
  tenantSlug,
  base,
  today,
}: {
  tenantId: string
  tenantSlug: string
  base: string
  today: string
}) {
  const [balances, accounts] = await Promise.all([
    settleQuery(listTreasuryBalances(tenantId, { asOf: today })),
    settleQuery(listTreasuryAccounts(tenantId, { includeInactive: true })),
  ])
  if (!balances.ok) return <BlockError message={balances.message} />

  const detailById = new Map(
    (accounts.ok ? accounts.data : []).map((t) => [t.id, t.alias ?? t.bankName ?? null]),
  )
  const items: TreasuryBalanceItem[] = balances.data.map((t) => ({
    id: t.treasuryId,
    name: t.name,
    kind: t.kind,
    balanceCents: t.balanceCents,
    pendingWalletCents: t.pendingWalletCents,
    lastCheckedOn: t.lastCheckedOn,
    active: t.active,
    detail: detailById.get(t.treasuryId) ?? null,
  }))

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Wallet}
        title="Todavía no hay cajas ni cuentas"
        description="Agregá la caja de efectivo, el banco y las billeteras en Ajustes para empezar a cargar."
        action={
          <Button asChild>
            <Link href={`${base}/ajustes?tab=cajas`}>Ir a Ajustes</Link>
          </Button>
        }
      />
    )
  }

  const money = items.filter((t) => t.kind !== 'credit_card')
  const cards = items.filter((t) => t.kind === 'credit_card')
  const available = money.reduce((acc, t) => acc + t.balanceCents, 0)
  const pending = money.reduce((acc, t) => acc + t.pendingWalletCents, 0)
  const cardDebt = cards.reduce((acc, t) => acc + Math.max(0, -t.balanceCents), 0)
  const unchecked = items.filter(
    (t) =>
      t.active &&
      (t.lastCheckedOn === null || daysBetween(t.lastCheckedOn, today) > CHECK_STALE_DAYS),
  ).length
  // Si ninguna se contó nunca, «hace más de 7 días» no es cierto: se dice como en cada fila.
  const neverChecked = items.filter((t) => t.active && t.lastCheckedOn === null).length
  const untouched = balances.data.every((t) => t.lastMovementDate === null)

  return (
    <div className="space-y-6">
      {/* Tres tarjetas (sin tarjetas de crédito) ocupan el ancho entero, como la tabla de abajo. */}
      <section
        className={cn(
          'grid gap-4 sm:grid-cols-2',
          cards.length > 0 ? 'xl:grid-cols-4' : 'lg:grid-cols-3',
        )}
        aria-label="Resumen de cajas"
      >
        <StatCard
          icon={Banknote}
          iconClassName="text-success"
          label="Plata disponible"
          value={formatCentsShort(available)}
          hint="En cajas, bancos y billeteras"
        />
        <StatCard
          icon={Wallet}
          iconClassName="text-info"
          label="Por acreditar"
          value={formatCentsShort(pending)}
          hint={pending > 0 ? 'QR y transferencias que todavía no entraron' : 'Nada pendiente'}
        />
        {cards.length > 0 ? (
          <StatCard
            icon={CreditCard}
            iconClassName="text-warning"
            label="Deuda de tarjetas"
            value={formatCentsShort(cardDebt)}
            hint={cardDebt > 0 ? 'Lo que vas a pagar en el resumen' : 'Sin deuda'}
          />
        ) : null}
        <StatCard
          icon={Scale}
          iconClassName={unchecked > 0 ? 'text-warning' : 'text-primary'}
          label="Sin ajustar"
          value={String(unchecked)}
          hint={
            unchecked === 0
              ? 'Todas contadas esta semana'
              : neverChecked === unchecked
                ? unchecked === 1
                  ? 'Nunca se ajustó'
                  : 'Nunca se ajustaron'
                : `Hace más de ${CHECK_STALE_DAYS} días que no se cuentan`
          }
        />
      </section>

      {untouched ? (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <div className="space-y-1 text-pretty">
            <p className="font-medium">Todavía no hay movimientos.</p>
            <p className="text-muted-foreground">
              Los saldos se mueven solos cuando cargás cierres del día, gastos, cobros y pagos. Si
              no coinciden con lo que hay de verdad, usá «Ajustar saldo».
            </p>
          </div>
        </div>
      ) : null}

      <TreasuryBalances
        items={items}
        availableCents={available}
        today={today}
        base={base}
        exportHref={exportHref(tenantSlug, 'cajas-y-bancos', { hasta: today })}
        exportFileName={`administracion-${tenantSlug}-cajas-y-bancos-${today}.csv`}
      />
    </div>
  )
}

async function FlujoTab({
  tenantId,
  tenantSlug,
  today,
  sp,
}: {
  tenantId: string
  tenantSlug: string
  today: string
  sp: Record<string, string | string[] | undefined>
}) {
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

  const [flow, projection] = range.ok
    ? await Promise.all([
        settleQuery(getCashFlow(tenantId, { from: range.from, to: range.to })),
        settleQuery(getCashProjection(tenantId, { asOf: today, weeks: 4 })),
      ])
    : [null, null]

  return (
    <div className="space-y-6">
      <RangeFilter range={picker} today={today} />
      {!range.ok ? (
        <PeriodError message={range.message} />
      ) : !flow?.ok ? (
        <BlockError message={flow?.message ?? ''} />
      ) : (
        <CashFlow
          rows={flow.data}
          label={range.label}
          exportHref={exportHref(tenantSlug, 'flujo-de-caja', {
            desde: range.from,
            hasta: range.to,
          })}
          exportFileName={`administracion-${tenantSlug}-flujo-de-caja-${range.from}-${range.to}.csv`}
        />
      )}
      {/* La proyección es opcional (F.9): si la base todavía no la tiene, no se muestra. */}
      {projection?.ok && projection.data.length > 0 ? (
        <CashProjection rows={projection.data} />
      ) : null}
    </div>
  )
}
