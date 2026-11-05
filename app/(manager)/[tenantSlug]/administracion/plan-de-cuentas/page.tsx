import { Upload } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PanelError } from '@/components/administracion/kit'
import { SimplePage } from '@/components/administracion/planilla'
import { Button } from '@/components/ui/button'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import {
  exportHref,
  getAccountingSettings,
  getAccountsWithMovement,
  listAccountsWithBalances,
  settleQuery,
} from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { BackLink, BookExport } from '../libros/_components/book-page'
import { SegLinks } from '../libros/_components/seg'
import { CategoryList, NewCategoryButton } from './_components/category-list'
import { ChartMoreMenu } from './_components/chart-more-menu'
import { ChartTree } from './_components/chart-tree'
import { ChartWorkspace } from './_components/chart-workspace'
import { NewAccountButton } from './_components/new-account-button'
import { SystemAccounts } from './_components/system-accounts'
import type { ChartAccount } from './_lib/tree'

export const metadata = { title: 'Plan de cuentas · Administración' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TITLE = 'font-serif text-2xl font-semibold tracking-tight'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Plan de cuentas: una sola tabla jerárquica, Código · Cuenta · Saldo, con **Plan simple** (por defecto:
 * lo que se usa) y **Todas** (`?ver=todas`, el árbol entero). Reunión del 29/10: «¿y el plan de cuentas
 * es esto?», «¿las categorías o no?»: las categorías son estas mismas cuentas.
 *
 * Nada de lo que había se perdió, solo dejó de ser una pestaña: «Cuentas del sistema» (`?tab=sistema`)
 * y la lista por categorías (`?tab=categorias`, con su alta corta) quedan en el «⋯» de la barra, y un
 * link viejo con `?tab=plan` o `?cuenta=` sigue andando. La contadora ve y exporta todo; escribir el
 * plan sigue siendo de quien carga, e importar y reasignar, de quien además administra los accesos.
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
  const path = `${base}/plan-de-cuentas`

  let access: TenantAccess
  try {
    access = await requireAccountingAccess(tenantSlug, 'read')
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(path)}`)
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

  const tenantId = access.tenant.id
  const readOnly = !access.accounting.write
  const canAdmin = access.accounting.write && access.accounting.admin
  const rawTab = first(sp.tab)
  const cuentaParam = first(sp.cuenta)
  const initialAccountId = cuentaParam && UUID_RE.test(cuentaParam) ? cuentaParam : null
  const today = todayInCordoba()

  const [result, settings] = await Promise.all([
    settleQuery(listAccountsWithBalances(tenantId, { includeInactive: true })),
    settleQuery(getAccountingSettings(tenantId)),
  ])
  // Lo que se movió desde que arrancaron los libros. Si no se pudo leer, el Plan simple se arma con
  // los saldos, las compras y las cajas: se ve menos, pero «Todas» sigue ahí.
  const movedResult =
    settings.ok && settings.data
      ? await settleQuery(
          getAccountsWithMovement(tenantId, { from: settings.data.booksStartDate, to: today }),
        )
      : null
  const moved: ReadonlySet<string> = movedResult?.ok ? movedResult.data : new Set<string>()

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

  const workspace = (children: React.ReactNode) => (
    <ChartWorkspace
      tenantSlug={tenantSlug}
      accounts={accounts}
      readOnly={readOnly}
      canAdmin={canAdmin}
      balancesAvailable={result.ok && result.data.balancesAvailable}
      initialAccountId={initialAccountId}
    >
      {children}
    </ChartWorkspace>
  )

  // Las dos vistas que dejaron de ser pestañas: se llega por el «⋯» y por los links de siempre.
  if (rawTab === 'sistema' || rawTab === 'categorias') {
    const system = rawTab === 'sistema'
    return workspace(
      <SimplePage>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <BackLink href={path}>Plan de cuentas</BackLink>
            <h1 className={TITLE}>{system ? 'Cuentas del sistema' : 'Por categorías'}</h1>
          </div>
          {system ? null : <NewCategoryButton />}
        </div>
        {!result.ok ? (
          <PanelError title="No pudimos cargar el plan de cuentas" message={result.message} />
        ) : system ? (
          <SystemAccounts />
        ) : (
          <CategoryList suppliersHref={`${base}/compras?tab=proveedores&filtro=sin-clasificar`} />
        )}
      </SimplePage>,
    )
  }

  const all = first(sp.ver) === 'todas' || rawTab === 'plan'
  const exportItem = {
    href: exportHref(tenantSlug, 'plan-de-cuentas'),
    fileName: 'plan-de-cuentas.csv',
    label: 'Exportar',
  }

  return workspace(
    <SimplePage>
      <h1 className="sr-only">Plan de cuentas</h1>
      {!result.ok ? (
        <PanelError title="No pudimos cargar el plan de cuentas" message={result.message} />
      ) : (
        <>
          <ChartTree
            mode={all ? 'all' : 'simple'}
            moved={moved}
            segment={
              <SegLinks
                label="Qué cuentas se ven"
                items={[
                  { key: 'simple', label: 'Plan simple', href: path, active: !all },
                  { key: 'todas', label: 'Todas', href: `${path}?ver=todas`, active: all },
                ]}
              />
            }
            actions={
              <>
                {canAdmin ? (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-11 gap-1.5 md:pointer-fine:h-8"
                  >
                    <Link href={`${path}/importar`}>
                      <Upload className="size-3.5" aria-hidden />
                      Importar
                    </Link>
                  </Button>
                ) : null}
                <BookExport item={exportItem} />
                <NewAccountButton />
                <ChartMoreMenu path={path} />
              </>
            }
          />
          {result.data.balancesAvailable ? null : (
            <p className="text-xs text-muted-foreground text-pretty">
              Los saldos todavía no están disponibles: el plan se ve igual y se puede editar.
            </p>
          )}
        </>
      )}
    </SimplePage>,
  )
}
