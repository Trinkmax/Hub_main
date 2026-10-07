import { History } from 'lucide-react'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Pagination } from '@/components/ui/pagination'
import {
  flowLogFiltersSchema,
  hasActiveLogFilters,
  LOG_PAGE_SIZE,
  resolveLogRange,
} from '@/lib/flows/execution-log-filters'
import { listFlowExecutionEvents, listFlowLogContacts } from '@/lib/flows/execution-log-queries'
import { createClient } from '@/lib/supabase/server'
import { makePageHref } from '@/lib/table/pagination'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { FlowLogFilters } from '../../_components/flow-log-filters'
import { FlowLogTable } from '../../_components/flow-log-table'

export const metadata = { title: 'Registros de ejecución' }
export const dynamic = 'force-dynamic'

export default async function FlowLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug, id } = await params
  const sp = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  // Una URL manoseada a mano no puede tumbar la pantalla: si los filtros no
  // parsean, caemos al default (últimos 30 días, todo).
  const parsed = flowLogFiltersSchema.safeParse({
    desde: sp.desde,
    hasta: sp.hasta,
    accion: sp.accion,
    estado: sp.estado,
    contacto: sp.contacto,
    page: sp.page ?? 1,
  })
  const filters = parsed.success ? parsed.data : flowLogFiltersSchema.parse({})

  const supabase = await createClient()
  const range = resolveLogRange(filters)
  // El flow solo se usa para el 404 y el nombre; eventos y contactos ya filtran
  // por tenant + flowId, así que los tres salen en paralelo (2 hops → 1).
  const [{ data: flow }, { rows, total }, contacts] = await Promise.all([
    supabase
      .from('flows')
      .select('id, name')
      .eq('id', id)
      .eq('tenant_id', access.tenant.id)
      .maybeSingle(),
    listFlowExecutionEvents({ tenantId: access.tenant.id, flowId: id, filters }),
    listFlowLogContacts({ tenantId: access.tenant.id, flowId: id }),
  ])
  if (!flow) notFound()

  const filtered = hasActiveLogFilters(filters)
  const basePath = `/${tenantSlug}/mensajeria/flows/${flow.id}/registros`

  return (
    <PageShell width="comfortable">
      <PageHeader
        back={{ href: `/${tenantSlug}/mensajeria/flows`, label: 'Automatizaciones' }}
        title="Registros de ejecución"
        description={`Todo lo que hizo «${flow.name}»: a quién le mandó qué, cuándo, y por qué se salteó algo.`}
      />

      <FlowLogFilters contacts={contacts} desde={range.desde} hasta={range.hasta} />

      {rows.length === 0 ? (
        <EmptyState
          icon={History}
          title={filtered ? 'No hay registros con esos filtros' : 'Todavía no se ejecutó'}
          description={
            filtered
              ? 'Probá ampliar el período o sacar algún filtro con «Limpiar filtros».'
              : 'Cuando un cliente entre por el disparador, cada paso va a quedar registrado acá: qué se le mandó, cuándo, y por qué se salteó algo.'
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <FlowLogTable rows={rows} tenantSlug={tenantSlug} />
          {/* Paginación del kit: links por URL (conserva los filtros) y los
              extremos son texto, no links muertos. */}
          <Pagination
            label="Paginación de los registros"
            page={filters.page}
            pageSize={LOG_PAGE_SIZE}
            total={total}
            hrefFor={makePageHref(basePath, sp)}
          />
        </div>
      )}
    </PageShell>
  )
}
