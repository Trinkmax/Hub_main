import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { SectionNav, type SectionNavItem } from '@/components/administracion/section-nav'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { loadPostingCatalog } from '@/lib/accounting/context'
import {
  type ClosedPeriodCheckRow,
  getAccessOverview,
  getAccountingSettings,
  getIntegrity,
  type IntegrityCheckRow,
  listFiscalYears,
  listSalesMethods,
  listSalesPoints,
  listTreasuryAccounts,
  type QueryOutcome,
  settleQuery,
  verifyClosedPeriods,
} from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { RetryButton } from '../_resumen/retry-button'
import { AccessPanel } from './_components/access-panel'
import { Callout } from './_components/form-bits'
import { IntegrityPanel } from './_components/integrity-panel'
import { MethodsPanel } from './_components/methods-panel'
import { SalesPointsPanel } from './_components/sales-points-panel'
import { PeriodSettingsForm, SasSettingsForm } from './_components/settings-forms'
import { FiscalYearsList, PeriodSettingsView, SasSettingsView } from './_components/settings-views'
import { SystemPartiesPanel, type SystemPartyRow } from './_components/system-parties-panel'
import { TreasuriesPanel } from './_components/treasuries-panel'

export const metadata = { title: 'Ajustes · Administración' }

const TABS = [
  { value: 'sas', label: 'Datos de la SAS', shortLabel: 'SAS' },
  { value: 'ejercicio', label: 'Ejercicio y meses', shortLabel: 'Ejercicio' },
  { value: 'accesos', label: 'Accesos' },
  { value: 'medios', label: 'Medios de cobro', shortLabel: 'Medios' },
  { value: 'cajas', label: 'Cajas y cuentas', shortLabel: 'Cajas' },
  { value: 'participes', label: 'Plataformas y organismos', shortLabel: 'Plataformas' },
  { value: 'puntos-de-venta', label: 'Puntos de venta' },
  { value: 'integridad', label: 'Integridad' },
] as const
type Tab = (typeof TABS)[number]['value']

function readTab(value: string | string[] | undefined): Tab {
  const v = Array.isArray(value) ? value[0] : value
  return TABS.find((t) => t.value === v)?.value ?? 'sas'
}

function TabError({ message }: { message: string }) {
  return (
    <Callout tone="error" title="No pudimos cargar esto." action={<RetryButton />}>
      {message}
    </Callout>
  )
}

/** Partícipes del sistema que se muestran en «Plataformas y organismos» (+ los bancos). */
const PARTY_ORDER: Readonly<Record<string, number>> = {
  payment_wallet: 0,
  card_processor: 1,
  delivery_platform: 2,
  bank: 3,
  tax_agency: 4,
  payroll: 5,
  other: 6,
  supplier: 7,
  customer: 8,
}

/**
 * Ajustes de Administración (H.17): datos de la SAS, ejercicio y meses,
 * accesos, medios de cobro, cajas, plataformas y organismos, puntos de venta e
 * integridad. Cada pestaña carga solo lo suyo. La contadora ve todo en modo
 * lectura: sin campos ni botones.
 */
export default async function AjustesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`

  let access: TenantAccess
  try {
    access = await requireAccountingAccess(tenantSlug, 'read')
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(`${base}/ajustes`)}`)
    }
    if (
      error instanceof AccountingDisabledError ||
      error instanceof AccountingForbiddenError ||
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError
    ) {
      notFound()
    }
    throw error
  }

  const tab = readTab(sp.tab)
  const tenantId = access.tenant.id
  const canWrite = access.accounting.write
  const readOnly = !canWrite
  const isOwner = access.role === 'owner'
  const today = todayInCordoba()
  const tabHref = (value: Tab) => `${base}/ajustes?tab=${value}`
  const items: SectionNavItem[] = TABS.map((t) => ({ ...t, href: tabHref(t.value) }))

  let content: ReactNode = null
  switch (tab) {
    case 'sas': {
      const result = await settleQuery(getAccountingSettings(tenantId))
      if (!result.ok) content = <TabError message={result.message} />
      else if (!result.data) notFound()
      else
        content = canWrite ? (
          <SasSettingsForm
            key={result.data.updatedAt}
            tenantSlug={tenantSlug}
            settings={result.data}
            today={today}
          />
        ) : (
          <SasSettingsView settings={result.data} />
        )
      break
    }
    case 'ejercicio': {
      const [settings, years] = await Promise.all([
        settleQuery(getAccountingSettings(tenantId)),
        settleQuery(listFiscalYears(tenantId)),
      ])
      content = (
        <div className="space-y-6">
          {years.ok ? (
            <FiscalYearsList years={years.data} cierresHref={`${base}/libros/cierres`} />
          ) : (
            <TabError message={years.message} />
          )}
          {!settings.ok ? (
            <TabError message={settings.message} />
          ) : settings.data ? (
            <section className="space-y-3">
              <h3 className="font-serif text-lg font-semibold tracking-tight">
                Cómo se liquida y se cierra cada mes
              </h3>
              {canWrite ? (
                <PeriodSettingsForm
                  key={settings.data.updatedAt}
                  tenantSlug={tenantSlug}
                  settings={settings.data}
                />
              ) : (
                <PeriodSettingsView settings={settings.data} />
              )}
            </section>
          ) : null}
        </div>
      )
      break
    }
    case 'accesos': {
      const result = await settleQuery(getAccessOverview(tenantId, { includeMembers: isOwner }))
      content = result.ok ? (
        <AccessPanel
          tenantSlug={tenantSlug}
          overview={result.data}
          currentUserId={access.user.id}
          isAdmin={canWrite && access.accounting.admin}
          canWrite={canWrite}
          showMembers={isOwner}
        />
      ) : (
        <TabError message={result.message} />
      )
      break
    }
    case 'medios': {
      const [methods, catalog] = await Promise.all([
        settleQuery(listSalesMethods(tenantId, { includeInactive: true })),
        settleQuery(loadPostingCatalog(tenantId)),
      ])
      if (!methods.ok) content = <TabError message={methods.message} />
      else if (!catalog.ok) content = <TabError message={catalog.message} />
      else
        content = (
          <MethodsPanel
            tenantSlug={tenantSlug}
            methods={methods.data}
            treasuries={catalog.data.treasuries.map((t) => ({
              id: t.id,
              name: t.name,
              kind: t.kind,
              active: t.active,
            }))}
            parties={catalog.data.parties
              .filter(
                (p) =>
                  p.kind === 'card_processor' ||
                  p.kind === 'payment_wallet' ||
                  p.kind === 'delivery_platform' ||
                  p.systemKey === 'senas',
              )
              .map((p) => ({
                id: p.id,
                name: p.name,
                kind: p.kind,
                systemKey: p.systemKey,
                active: p.active,
              }))}
            readOnly={readOnly}
          />
        )
      break
    }
    case 'cajas': {
      const [rows, catalog] = await Promise.all([
        settleQuery(listTreasuryAccounts(tenantId, { includeInactive: true })),
        settleQuery(loadPostingCatalog(tenantId)),
      ])
      if (!rows.ok) content = <TabError message={rows.message} />
      else {
        const balances: Record<string, number> = {}
        if (catalog.ok) for (const t of catalog.data.treasuries) balances[t.id] = t.balanceCents
        content = (
          <TreasuriesPanel
            tenantSlug={tenantSlug}
            rows={rows.data}
            balances={balances}
            readOnly={readOnly}
          />
        )
      }
      break
    }
    case 'participes': {
      const catalog = await settleQuery(loadPostingCatalog(tenantId))
      if (!catalog.ok) content = <TabError message={catalog.message} />
      else {
        const parties: SystemPartyRow[] = catalog.data.parties
          .filter((p) => p.systemKey !== null || p.kind === 'bank')
          .sort(
            (a, b) =>
              (PARTY_ORDER[a.kind] ?? 9) - (PARTY_ORDER[b.kind] ?? 9) ||
              a.name.localeCompare(b.name, 'es'),
          )
          .map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            systemKey: p.systemKey,
            taxId: p.taxId,
            active: p.active,
            commissionVatMode: p.commissionVatMode,
            rates: p.rates,
            updatedAt: p.updatedAt,
          }))
        content = (
          <SystemPartiesPanel tenantSlug={tenantSlug} parties={parties} readOnly={readOnly} />
        )
      }
      break
    }
    case 'puntos-de-venta': {
      const result = await settleQuery(listSalesPoints(tenantId, { includeInactive: true }))
      content = result.ok ? (
        <SalesPointsPanel tenantSlug={tenantSlug} points={result.data} readOnly={readOnly} />
      ) : (
        <TabError message={result.message} />
      )
      break
    }
    case 'integridad': {
      const ran = sp.verificar === '1'
      let checks: QueryOutcome<IntegrityCheckRow[]> | null = null
      let closed: QueryOutcome<ClosedPeriodCheckRow[]> | null = null
      if (ran) {
        ;[checks, closed] = await Promise.all([
          settleQuery(getIntegrity(tenantId)),
          settleQuery(verifyClosedPeriods(tenantId)),
        ])
      }
      content = (
        <IntegrityPanel
          verifyHref={`${base}/ajustes?tab=integridad&verificar=1`}
          ran={ran}
          checks={checks}
          closed={closed}
        />
      )
      break
    }
  }

  return (
    <PageShell width="comfortable">
      <Link
        href={base}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" aria-hidden />
        Volver al Resumen
      </Link>
      <PageHeader
        eyebrow="Administración"
        title={
          <>
            Ajustes
            <ReadOnlyBadge />
          </>
        }
        description="Los datos de la SAS, quién entra y cómo se ordenan las cajas y los cobros."
      />
      <SectionNav items={items} active={tab} label="Secciones de Ajustes" />
      <div className="max-w-4xl">{content}</div>
    </PageShell>
  )
}
