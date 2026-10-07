import { notFound, redirect } from 'next/navigation'
import { plural } from '@/components/administracion/format'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
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
import type { ChartAccount } from './_lib/tree'

export const metadata = { title: 'Plan de cuentas · Administración' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Plan de cuentas (H.16): el árbol con el saldo de cada cuenta al día. El
 * dueño agrega cuentas y edita nombre, «Para qué se usa», en compras y
 * activa; la contadora lo ve y lo exporta.
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
  const result = await settleQuery(
    listAccountsWithBalances(access.tenant.id, { includeInactive: true }),
  )
  const cuentaParam = Array.isArray(sp.cuenta) ? sp.cuenta[0] : sp.cuenta
  const initialAccountId = cuentaParam && UUID_RE.test(cuentaParam) ? cuentaParam : null

  const accounts: ChartAccount[] = result.ok
    ? result.data.rows.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
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

  return (
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
          result.ok
            ? `${plural(postable, 'cuenta para imputar', 'cuentas para imputar')} · saldos al ${formatIsoDay(result.data.asOf)}`
            : 'Las cuentas de la SAS, en árbol.'
        }
        actions={
          <ExportButton
            href={exportHref(tenantSlug, 'plan-de-cuentas')}
            fileName="plan-de-cuentas.csv"
            label="Exportar plan de cuentas"
            className="h-11 md:h-9"
          />
        }
      />

      {!result.ok ? (
        <Callout
          tone="error"
          title="No pudimos cargar el plan de cuentas."
          action={<RetryButton />}
        >
          {result.message}
        </Callout>
      ) : (
        <>
          {result.data.balancesAvailable ? null : (
            <Callout tone="info">
              Los saldos todavía no están disponibles: el plan se ve igual y se puede editar.
            </Callout>
          )}
          <ChartTree
            tenantSlug={tenantSlug}
            accounts={accounts}
            readOnly={readOnly}
            balancesAvailable={result.data.balancesAvailable}
            initialAccountId={initialAccountId}
          />
          <div className="space-y-1 text-xs text-muted-foreground text-pretty">
            <p>
              «Sistema»: la usa el sistema para armar asientos. Se puede renombrar; no se puede
              desactivar. «De control»: cada movimiento dice con qué proveedor o cliente es.
            </p>
            {readOnly ? (
              <p>
                Los códigos son una propuesta: si querés cambiar algo, pasale la lista a los dueños
                y lo cargan acá.
              </p>
            ) : null}
          </div>
        </>
      )}
    </PageShell>
  )
}
