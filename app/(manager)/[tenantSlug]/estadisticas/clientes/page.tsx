import { ArrowDownToLine, Users } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { formatCentsShort } from '@/lib/money/format'
import { getChurnRisk, getTopCustomersBySpent } from '@/lib/stats/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ChurnCard } from '../_components/churn-card'

export const metadata = { title: 'Clientes · Estadísticas' }
export const dynamic = 'force-dynamic'

/**
 * Estadísticas › Clientes: quiénes consumen más y quiénes dejaron de venir. Era una solapa adentro de
 * «Resumen» (una segunda fila de pestañas); ahora es una pestaña de la sección.
 */
export default async function EstadisticasClientesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const [ranking, churn] = await Promise.all([
    getTopCustomersBySpent(access.tenant.id, 50),
    getChurnRisk(access.tenant.id, 200),
  ])
  // Quien nunca tuvo un consumo cargado no es «de los que más consumen»: en un bar que recién
  // empieza a sumar puntos la lista se llenaba de ceros.
  const top = ranking.filter((customer) => customer.total_visits > 0)
  const exportHref = (type: 'top_customers' | 'churn_risk') =>
    `/api/stats/export?slug=${encodeURIComponent(tenantSlug)}&type=${type}`

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Clientes"
        description="Quiénes consumen más y quiénes venían seguido y dejaron de venir, según los consumos con puntos."
      />

      <DataTableShell>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div>
            <h2 className="font-serif text-lg font-semibold tracking-tight">
              Los que más consumen
            </h2>
            <p className="text-xs text-muted-foreground">
              Los 50 con más consumo cargado, sumando toda su historia.
            </p>
          </div>
          {top.length > 0 ? (
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a href={exportHref('top_customers')} download>
                <ArrowDownToLine className="size-3.5" aria-hidden />
                Bajar la lista
              </a>
            </Button>
          ) : null}
        </header>
        {top.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Todavía no hay consumos cargados"
            description="Cuando le sumes puntos a alguien por lo que consumió, acá aparece el ranking."
            className="m-3 border-0 bg-transparent"
          />
        ) : (
          <DataTableScroll>
            <DataTableRoot>
              <DataTableHead>
                <tr>
                  <DataTableHeader>Cliente</DataTableHeader>
                  <DataTableHeader>Consumos</DataTableHeader>
                  <DataTableHeader>Consumo total</DataTableHeader>
                  <DataTableHeader>Promedio</DataTableHeader>
                  <DataTableHeader>Última vez</DataTableHeader>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {top.map((customer) => (
                  <tr
                    key={customer.customer_id}
                    className="transition-colors hover:bg-secondary/40"
                  >
                    <DataTableCell>
                      <Link
                        href={`/${tenantSlug}/clientes/${customer.customer_id}`}
                        className="font-medium hover:text-primary"
                      >
                        {customer.first_name} {customer.last_name}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">{customer.total_visits}</DataTableCell>
                    <DataTableCell className="font-display font-semibold tabular-nums">
                      {formatCentsShort(customer.total_spent_cents)}
                    </DataTableCell>
                    <DataTableCell className="tabular-nums text-muted-foreground">
                      {formatCentsShort(customer.avg_ticket_cents)}
                    </DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {customer.last_visit_at
                        ? new Date(customer.last_visit_at).toLocaleDateString('es-AR', {
                            timeZone: 'America/Argentina/Cordoba',
                          })
                        : '—'}
                    </DataTableCell>
                  </tr>
                ))}
              </DataTableBody>
            </DataTableRoot>
          </DataTableScroll>
        )}
      </DataTableShell>

      <ChurnCard rows={churn} tenantSlug={tenantSlug} exportHref={exportHref('churn_risk')} />
    </div>
  )
}
