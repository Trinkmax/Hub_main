import { ChevronRight, Plus, UsersRound } from 'lucide-react'
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
import { listAudiences } from '@/lib/audiences/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'

export const metadata = { title: 'Audiencias' }
export const dynamic = 'force-dynamic'

export default async function AudiencesPage({
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

  const audiences = await listAudiences(access.tenant.id)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Marketing"
        title="Audiencias"
        description="Definí grupos de clientes con filtros precisos para usarlos en difusiones y flows."
        actions={
          <Button asChild className="gap-2">
            <Link href={`/${tenantSlug}/audiencias/nueva`}>
              <Plus className="size-4" />
              Nueva audiencia
            </Link>
          </Button>
        }
      />

      {audiences.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="Aún no hay audiencias"
          description="Las audiencias son grupos de clientes con condiciones (ej: 'frecuentes que no vinieron en 30 días'). Sirven para difusiones y flows."
          action={
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/audiencias/nueva`}>
                <Plus className="size-4" />
                Crear primera audiencia
              </Link>
            </Button>
          }
        />
      ) : (
        <DataTableShell>
          <DataTableScroll>
            <DataTableRoot>
              <DataTableHead>
                <tr>
                  <DataTableHeader>Nombre</DataTableHeader>
                  <DataTableHeader>Clientes</DataTableHeader>
                  <DataTableHeader>Última calc.</DataTableHeader>
                  <DataTableHeader className="w-8" />
                </tr>
              </DataTableHead>
              <DataTableBody>
                {audiences.map((a) => (
                  <tr key={a.id} className="group transition-colors hover:bg-secondary/40">
                    <DataTableCell>
                      <Link
                        href={`/${tenantSlug}/audiencias/${a.id}`}
                        className="font-medium group-hover:text-primary"
                      >
                        {a.name}
                      </Link>
                    </DataTableCell>
                    <DataTableCell>
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-primary">
                        {a.customer_count_cached.toLocaleString('es-AR')}
                      </span>
                    </DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {a.last_calculated_at
                        ? new Date(a.last_calculated_at).toLocaleString('es-AR')
                        : '—'}
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground/40 group-hover:text-muted-foreground">
                      <ChevronRight className="size-4" />
                    </DataTableCell>
                  </tr>
                ))}
              </DataTableBody>
            </DataTableRoot>
          </DataTableScroll>
        </DataTableShell>
      )}
    </div>
  )
}
