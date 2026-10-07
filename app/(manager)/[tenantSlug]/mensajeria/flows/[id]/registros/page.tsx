import { ChevronLeft, ChevronRight, History } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  flowLogFiltersSchema,
  hasActiveLogFilters,
  LOG_PAGE_SIZE,
  resolveLogRange,
} from '@/lib/flows/execution-log-filters'
import { listFlowExecutionEvents, listFlowLogContacts } from '@/lib/flows/execution-log-queries'
import { createClient } from '@/lib/supabase/server'
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

  const totalPages = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE))
  const filtered = hasActiveLogFilters(filters)

  return (
    <PageShell width="comfortable">
      <Link
        href={`/${tenantSlug}/mensajeria/flows`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-3" />
        Volver a automatizaciones
      </Link>

      <PageHeader
        eyebrow={flow.name}
        title="Registros de ejecución"
        description="Ver el historial y los detalles de todas las ejecuciones de esta automatización."
      />

      <FlowLogFilters contacts={contacts} desde={range.desde} hasta={range.hasta} />

      {rows.length === 0 ? (
        <EmptyState
          icon={History}
          title={filtered ? 'No hay registros con esos filtros' : 'Todavía no se ejecutó'}
          description={
            filtered
              ? 'Probá ampliar el rango de fechas o sacar algún filtro.'
              : 'Cuando un cliente entre por el disparador, cada paso va a quedar registrado acá: qué se le mandó, cuándo, y por qué se salteó algo.'
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString('es-AR')} {total === 1 ? 'registro' : 'registros'} · página{' '}
            {filters.page} de {totalPages}
          </p>
          <FlowLogTable rows={rows} tenantSlug={tenantSlug} />
        </>
      )}

      {totalPages > 1 ? (
        <Pagination
          basePath={`/${tenantSlug}/mensajeria/flows/${flow.id}/registros`}
          page={filters.page}
          totalPages={totalPages}
          sp={sp}
        />
      ) : null}
    </PageShell>
  )
}

function Pagination({
  basePath,
  page,
  totalPages,
  sp,
}: {
  basePath: string
  page: number
  totalPages: number
  sp: Record<string, string | string[] | undefined>
}) {
  const buildHref = (p: number) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === 'string') params.set(k, v)
    }
    params.set('page', String(p))
    return `${basePath}?${params.toString()}`
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        className="gap-1.5"
        asChild={page > 1}
      >
        {page > 1 ? (
          <Link href={buildHref(page - 1)}>
            <ChevronLeft className="size-3.5" />
            Anterior
          </Link>
        ) : (
          <span>
            <ChevronLeft className="size-3.5" />
            Anterior
          </span>
        )}
      </Button>
      <span className="text-xs tabular-nums text-muted-foreground">
        Página {page} de {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        className="gap-1.5"
        asChild={page < totalPages}
      >
        {page < totalPages ? (
          <Link href={buildHref(page + 1)}>
            Siguiente
            <ChevronRight className="size-3.5" />
          </Link>
        ) : (
          <span>
            Siguiente
            <ChevronRight className="size-3.5" />
          </span>
        )}
      </Button>
    </div>
  )
}
