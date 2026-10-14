import { BookText, ListTree, Tags, Upload } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { plural } from '@/components/administracion/format'
import { AdmHeader, AdmPage, PanelError, ViewPills } from '@/components/administracion/kit'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
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
import { Callout } from '../ajustes/_components/form-bits'
import { ExportButton } from '../libros/_components/export-button'
import { CategoryList, NewCategoryButton } from './_components/category-list'
import { ChartTree } from './_components/chart-tree'
import { ChartWorkspace } from './_components/chart-workspace'
import { NewAccountButton } from './_components/new-account-button'
import { SystemAccounts } from './_components/system-accounts'
import type { ChartAccount } from './_lib/tree'

export const metadata = { title: 'Plan de cuentas · Administración' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Tab = 'categorias' | 'plan' | 'sistema'

const TABS: readonly Tab[] = ['categorias', 'plan', 'sistema']

const DESCRIPTIONS: Readonly<Record<Tab, string>> = {
  // La tarjeta de abajo ya dice dónde aparecen: acá no se repite.
  categorias: 'Dónde se anota cada gasto y cada compra del bar.',
  plan: 'Las cuentas del bar en árbol: agregá, renombrá, recodificá, mové o desactivá cualquiera.',
  // Corto a propósito: más largo empuja «Exportar» a un segundo renglón en la compu.
  sistema: 'Con qué cuenta arma el sistema cada asiento: IVA, proveedores, ventas…',
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Plan de cuentas (H.16 + #16), con tres vistas en la URL (`?tab=`):
 *
 * - **Tus categorías** (`categorias`): lo que ve un socio. La lista de «¿En qué se gastó?», en
 *   los mismos grupos que el selector de los gastos, con un buscador y el alta corta.
 * - **Plan completo** (`plan`): el árbol con el saldo de cada cuenta al día. Es la vista de la
 *   contadora; quien carga crea cuentas en cualquier lugar, edita código, nombre, tipo y tildes,
 *   mueve grupos enteros y desactiva.
 * - **Cuentas del sistema** (`sistema`): con qué cuenta arma el sistema cada asiento.
 *
 * Sin `?tab=`: el dueño cae en «Tus categorías» y la contadora en «Plan completo». Un link viejo
 * con `?cuenta=` (y sin `?tab=`) sigue abriendo la hoja sobre el árbol. Quien además administra
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
  const rawTab = first(sp.tab)
  const tab: Tab = TABS.includes(rawTab as Tab)
    ? (rawTab as Tab)
    : // Los links de siempre a una cuenta (`?cuenta=`) la abren sobre el árbol.
      readOnly || initialAccountId
      ? 'plan'
      : 'categorias'

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
  const tabHref = (t: Tab) => `${base}/plan-de-cuentas?tab=${t}`
  const exportButton = (
    <ExportButton
      href={exportHref(tenantSlug, 'plan-de-cuentas')}
      fileName="plan-de-cuentas.csv"
      className="h-11 md:pointer-fine:h-9"
    />
  )

  return (
    <ChartWorkspace
      tenantSlug={tenantSlug}
      accounts={accounts}
      readOnly={readOnly}
      canAdmin={canAdmin}
      balancesAvailable={result.ok && result.data.balancesAvailable}
      initialAccountId={initialAccountId}
    >
      <AdmPage>
        <AdmHeader
          title="Plan de cuentas"
          badge={<ReadOnlyBadge className="ml-0" />}
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
            !result.ok ? null : tab === 'categorias' ? (
              <NewCategoryButton />
            ) : tab === 'plan' ? (
              <>
                <NewAccountButton />
                {canAdmin ? (
                  <Button asChild variant="outline" className="h-11 gap-2 md:pointer-fine:h-9">
                    <Link href={`${base}/plan-de-cuentas/importar`}>
                      <Upload className="size-4" aria-hidden />
                      Importar plan
                    </Link>
                  </Button>
                ) : null}
                {exportButton}
              </>
            ) : (
              exportButton
            )
          }
        />

        <ViewPills
          label="Vistas del plan de cuentas"
          items={[
            {
              key: 'categorias',
              label: 'Tus categorías',
              shortLabel: 'Categorías',
              href: tabHref('categorias'),
              icon: Tags,
              active: tab === 'categorias',
            },
            {
              key: 'plan',
              label: 'Plan completo',
              shortLabel: 'Plan',
              href: tabHref('plan'),
              icon: ListTree,
              active: tab === 'plan',
            },
            {
              key: 'sistema',
              label: 'Cuentas del sistema',
              shortLabel: 'Del sistema',
              href: tabHref('sistema'),
              icon: BookText,
              active: tab === 'sistema',
            },
          ]}
        />

        {!result.ok ? (
          <PanelError title="No pudimos cargar el plan de cuentas" message={result.message} />
        ) : tab === 'sistema' ? (
          <SystemAccounts />
        ) : tab === 'categorias' ? (
          <CategoryList suppliersHref={`${base}/compras?tab=proveedores&filtro=sin-clasificar`} />
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
      </AdmPage>
    </ChartWorkspace>
  )
}
