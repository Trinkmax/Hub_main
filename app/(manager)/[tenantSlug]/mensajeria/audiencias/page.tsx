import { Plus, UsersRound } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  type AudienceBuilderOptions,
  type AudienceListRow,
  getAudienceBuilderOptions,
  listAudiences,
} from '@/lib/audiences/queries'
import type { AudienceFilter } from '@/lib/audiences/schemas'
import { formatDateTime } from '@/lib/dates'
import { formatNumber } from '@/lib/format/number-kind'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { summarizeFilter } from './_components/condition-copy'

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

  // Para resumir las condiciones en una frase necesitamos los filtros de cada
  // grupo y los nombres de niveles/etiquetas/eventos. `filters` ya viene en el
  // listado (antes: 1 getAudience por fila = N+1) y las opciones no dependen de
  // nada, así que todo sale en un solo hop.
  const [audiences, options] = await Promise.all([
    listAudiences(access.tenant.id),
    getAudienceBuilderOptions(access.tenant.id),
  ])
  const summaries = buildSummaries(audiences, options)
  const newHref = `/${tenantSlug}/mensajeria/audiencias/nueva`

  return (
    <PageShell width="comfortable">
      <PageHeader
        title="Audiencias"
        description="Grupos de clientes (frecuentes, cumpleañeros, los que no vienen) para usar en difusiones y automatizaciones."
        actions={
          audiences.length > 0 ? (
            <Button asChild>
              <Link href={newHref}>
                <Plus aria-hidden />
                Nueva audiencia
              </Link>
            </Button>
          ) : null
        }
      />

      {audiences.length === 0 ? (
        <EmptyState
          size="lg"
          icon={UsersRound}
          title="Todavía no armaste audiencias"
          description="Una audiencia es un grupo de clientes con condiciones simples, como «frecuentes que no vinieron en 30 días». Después la usás para mandar difusiones o automatizaciones."
          action={
            <Button asChild>
              <Link href={newHref}>
                <Plus aria-hidden />
                Armar la primera audiencia
              </Link>
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="Audiencias"
          rows={audiences}
          getRowId={(a) => a.id}
          rowHref={(a) => `/${tenantSlug}/mensajeria/audiencias/${a.id}`}
          rowLabel={(a) => a.name}
          columns={[
            {
              id: 'name',
              header: 'Audiencia',
              cell: (a) => (
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate">{a.name}</span>
                  <span className="line-clamp-2 type-small font-normal text-muted-foreground">
                    {summaries.get(a.id) ?? 'Grupo de clientes.'}
                  </span>
                </span>
              ),
            },
            {
              id: 'customers',
              header: 'Clientes',
              numeric: true,
              width: '8rem',
              cell: (a) => formatNumber(a.customer_count_cached),
            },
            {
              id: 'calculated',
              header: 'Último conteo',
              width: '11rem',
              mobile: 'meta',
              cell: (a) => (
                <span className="type-small text-muted-foreground">
                  {a.last_calculated_at
                    ? formatDateTime(a.last_calculated_at)
                    : 'Todavía no se calculó'}
                </span>
              ),
            },
          ]}
        />
      )}
    </PageShell>
  )
}

function buildSummaries(
  details: AudienceListRow[],
  options: AudienceBuilderOptions,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const detail of details) {
    try {
      map.set(detail.id, summarizeFilter(detail.filters as unknown as AudienceFilter, options))
    } catch {
      // Filtro con forma inesperada: la fila sigue mostrándose sin resumen.
    }
  }
  return map
}
