import { Upload } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { plural } from '@/components/administracion/format'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { SectionNav } from '@/components/administracion/section-nav'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { exportHref, listAccountsWithBalances, settleQuery } from '@/lib/accounting/queries'
import { formatIsoDay } from '@/lib/dates'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { RetryButton } from '../_resumen/retry-button'
import { Callout } from '../ajustes/_components/form-bits'
import { ExportButton } from '../libros/_components/export-button'
import { ChartTree } from './_components/chart-tree'
import { ChartWorkspace } from './_components/chart-workspace'
import { NewAccountButton } from './_components/new-account-button'
import { SystemAccounts } from './_components/system-accounts'
import type { ChartAccount } from './_lib/tree'

export const metadata = { title: 'Plan de cuentas · Administración' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Tab = 'plan' | 'sistema'

const DESCRIPTIONS: Readonly<Record<Tab, string>> = {
  plan: 'Las cuentas de la SAS en árbol: agregá, renombrá, recodificá, mové o desactivá cualquiera.',
  // Corto a propósito: más largo empuja «Exportar» a un segundo renglón en la compu.
  sistema: 'Con qué cuenta arma el sistema cada asiento: IVA, proveedores, ventas…',
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Plan de cuentas (H.16 + #16, totalmente configurable): el árbol con el saldo de cada cuenta al
 * día, y «Cuentas del sistema» (`?tab=sistema`). El dueño con carga crea cuentas en cualquier lugar,
 * edita código, nombre, tipo y tildes, mueve grupos enteros y desactiva; quien además administra
 * los accesos importa un plan y cambia las cuentas del sistema. La contadora lo ve y lo exporta.
 */
export default async function PlanDeCuentasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const tab: Tab = first(sp.tab) === 'sistema' ? 'sistema' : 'plan'

  let access: TenantAccess
  try {
    access = await requireAccountingAccess(tenantSlug, 'read')
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(`${base}/plan-de-cuentas`)}`)
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

  const readOnly = !access.accounting.write
  const canAdmin = access.accounting.write && access.accounting.admin
  const result = await settleQuery(
    listAccountsWithBalances(access.tenant.id, { includeInactive: true }),
  )
  const cuentaParam = first(sp.cuenta)
  const initialAccountId = cuentaParam && UUID_RE.test(cuentaParam) ? cuentaParam : null

  const accounts: ChartAccount[] = result.ok
    ? result.data.rows.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        normalSide: a.normalSide,
        parentId: a.parentId,
        level: a.level,
        postable: a.postable,
        active: a.active,
        systemKey: a.systemKey,
        requiresParty: a.requiresParty,
        isTreasury: a.isTreasury,
        purchaseSelectable: a.purchaseSelectable,
        manualSelectable: a.manualSelectable,
        description: a.description,
        balanceCents: a.balanceCents,
        hasChildren: a.hasChildren,
        updatedAt: a.updatedAt,
      }))
    : []
  const postable = accounts.filter((a) => a.postable && a.active).length
  const groups = accounts.filter((a) => !a.postable && a.active).length
  const tabHref = (t: Tab) => `${base}/plan-de-cuentas${t === 'plan' ? '' : `?tab=${t}`}`

  return (
    <ChartWorkspace
      tenantSlug={tenantSlug}
      accounts={accounts}
      readOnly={readOnly}
      canAdmin={canAdmin}
      balancesAvailable={result.ok && result.data.balancesAvailable}
      initialAccountId={initialAccountId}
    >
      <PageShell>
        <PageHeader
          eyebrow="Administración"
          title={
            <>
              Plan de cuentas
              <ReadOnlyBadge />
            </>
          }
          description={
            result.ok && tab === 'plan'
              ? `${plural(postable, 'cuenta para imputar', 'cuentas para imputar')} en ${plural(groups, 'grupo', 'grupos')}${
                  result.data.balancesAvailable
                    ? ` · saldos al ${formatIsoDay(result.data.asOf)}`
                    : ''
                }.`
              : DESCRIPTIONS[tab]
          }
          actions={
            <>
              {result.ok ? <NewAccountButton /> : null}
              {result.ok && canAdmin ? (
                <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
                  <Link href={`${base}/plan-de-cuentas/importar`}>
                    <Upload className="size-4" aria-hidden />
                    Importar plan
                  </Link>
                </Button>
              ) : null}
              <ExportButton
                href={exportHref(tenantSlug, 'plan-de-cuentas')}
                fileName="plan-de-cuentas.csv"
                className="h-11 md:h-9"
              />
            </>
          }
        />

        <SectionNav
          label="Secciones del plan de cuentas"
          active={tab}
          items={[
            { value: 'plan', label: 'Cuentas', href: tabHref('plan') },
            {
              value: 'sistema',
              label: 'Cuentas del sistema',
              shortLabel: 'Del sistema',
              href: tabHref('sistema'),
            },
          ]}
        />

        {!result.ok ? (
          <Callout
            tone="error"
            title="No pudimos cargar el plan de cuentas."
            action={<RetryButton />}
          >
            {result.message}
          </Callout>
        ) : tab === 'sistema' ? (
          <SystemAccounts />
        ) : (
          <>
            {result.data.balancesAvailable ? null : (
              <Callout tone="info">
                Los saldos todavía no están disponibles: el plan se ve igual y se puede editar.
              </Callout>
            )}
            <ChartTree />
            <div className="space-y-1 text-xs text-muted-foreground text-pretty">
              <p>
                «Usada por el sistema»: el sistema arma asientos con esa cuenta y la busca por su
                uso, no por el código ni el nombre. «De control»: cada movimiento dice con qué
                proveedor, cliente u organismo es. El código es una etiqueta: cambiarlo o mover una
                cuenta de grupo no toca lo cargado.
              </p>
              {readOnly ? (
                <p>
                  Si querés cambiar algo del plan, pasale la lista a los dueños y lo cargan acá.
                </p>
              ) : null}
            </div>
          </>
        )}
      </PageShell>
    </ChartWorkspace>
  )
}
