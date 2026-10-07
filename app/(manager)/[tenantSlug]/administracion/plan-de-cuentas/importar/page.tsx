import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ReadOnlyBadge, ReadOnlyNotice } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { listAccounts, settleQuery } from '@/lib/accounting/queries'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { RetryButton } from '../../_resumen/retry-button'
import { Callout } from '../../ajustes/_components/form-bits'
import { ImportForm } from './_components/import-form'

export const metadata = { title: 'Importar plan de cuentas · Administración' }

/**
 * Importar un plan de cuentas (#16, `acc_import_accounts`): se pega el plan («1.1.01.01.001 CAJA»,
 * una cuenta por renglón, o dos columnas de Excel), se ve qué se crea y qué cambia, y recién
 * después se importa. Nunca se borra ni se desactiva nada. Lo hace quien carga y además administra
 * los accesos (como pide la base).
 */
export default async function ImportarPlanPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const base = `/${tenantSlug}/administracion`

  let access: TenantAccess
  try {
    access = await requireAccountingAccess(tenantSlug, 'read')
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(
        `/login?reason=session&redirectTo=${encodeURIComponent(`${base}/plan-de-cuentas/importar`)}`,
      )
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

  const back = (
    <Link
      href={`${base}/plan-de-cuentas`}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3" />
      Volver al plan de cuentas
    </Link>
  )
  const header = (
    <PageHeader
      eyebrow="Administración"
      title={
        <>
          Importar plan de cuentas <ReadOnlyBadge />
        </>
      }
      description="Pegá el plan que te pasó la contadora o el de tu sistema anterior. Antes de importar ves qué cuentas se crean y cuáles cambian. Nunca se borra nada."
    />
  )

  if (!access.accounting.write) {
    return (
      <PageShell>
        {back}
        {header}
        <ReadOnlyNotice
          description="Acá se importa un plan de cuentas. Con Contabilidad lo ves y lo exportás desde Plan de cuentas."
          href={`${base}/plan-de-cuentas`}
          linkLabel="Ir al plan de cuentas"
        />
      </PageShell>
    )
  }

  if (!access.accounting.admin) {
    return (
      <PageShell>
        {back}
        {header}
        <ReadOnlyNotice
          title="Esto lo hace quien administra los accesos"
          description="Importar un plan cambia muchas cuentas a la vez: lo hace quien administra los accesos de Administración. Las cuentas de a una las podés crear y editar en el plan."
          href={`${base}/plan-de-cuentas`}
          linkLabel="Ir al plan de cuentas"
        />
      </PageShell>
    )
  }

  const plan = await settleQuery(listAccounts(access.tenant.id, { includeInactive: true }))

  return (
    <PageShell>
      {back}
      {header}
      {plan.ok ? (
        <ImportForm
          tenantSlug={tenantSlug}
          plan={plan.data.map((a) => ({ code: a.code, name: a.name }))}
        />
      ) : (
        <Callout
          tone="error"
          title="No pudimos cargar el plan de cuentas."
          action={<RetryButton />}
        >
          {plan.message}
        </Callout>
      )}
    </PageShell>
  )
}
