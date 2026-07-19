import { format } from 'date-fns'
import { ChevronRight, Plus, UsersRound } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import {
  type AudienceBuilderOptions,
  getAudience,
  getAudienceBuilderOptions,
  listAudiences,
} from '@/lib/audiences/queries'
import type { AudienceFilter } from '@/lib/audiences/schemas'
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

  const audiences = await listAudiences(access.tenant.id)

  // Para resumir las condiciones en una frase necesitamos los filtros de cada
  // grupo y los nombres de niveles/etiquetas/eventos. Los grupos por bar son
  // pocos, así que el fan-out es chico.
  let summaries = new Map<string, string>()
  if (audiences.length > 0) {
    const [options, details] = await Promise.all([
      getAudienceBuilderOptions(access.tenant.id),
      Promise.all(audiences.map((a) => getAudience(access.tenant.id, a.id))),
    ])
    summaries = buildSummaries(details, options)
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Mensajería"
        title="Audiencias"
        description="Grupos de clientes (frecuentes, cumpleañeros, los que no vienen) para usar en difusiones y automatizaciones."
        actions={
          <Button asChild className="gap-2">
            <Link href={`/${tenantSlug}/mensajeria/audiencias/nueva`}>
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
          description="Las audiencias son grupos de clientes con condiciones simples (ej: 'frecuentes que no vinieron en 30 días'). Sirven para difusiones y automatizaciones."
          action={
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/mensajeria/audiencias/nueva`}>
                <Plus className="size-4" />
                Crear primera audiencia
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {audiences.map((a) => (
            <Link
              key={a.id}
              href={`/${tenantSlug}/mensajeria/audiencias/${a.id}`}
              className="group flex flex-col gap-2.5 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-secondary/30"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium group-hover:text-primary">
                  {a.name}
                </p>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground"
                  aria-hidden
                />
              </div>
              <p className="flex items-baseline gap-1.5">
                <span className="font-display text-3xl font-semibold leading-none tabular-nums">
                  {a.customer_count_cached.toLocaleString('es-AR')}
                </span>
                <span className="text-sm text-muted-foreground">
                  {a.customer_count_cached === 1 ? 'cliente' : 'clientes'}
                </span>
              </p>
              <p className="line-clamp-2 min-h-10 text-xs leading-relaxed text-muted-foreground">
                {summaries.get(a.id) ?? 'Grupo de clientes.'}
              </p>
              <p className="mt-auto text-[11px] text-muted-foreground/70">
                {a.last_calculated_at
                  ? `Calculado el ${format(new Date(a.last_calculated_at), 'dd/MM/yyyy HH:mm')}`
                  : 'Todavía no se calculó'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function buildSummaries(
  details: Awaited<ReturnType<typeof getAudience>>[],
  options: AudienceBuilderOptions,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const detail of details) {
    if (!detail) continue
    try {
      map.set(detail.id, summarizeFilter(detail.filters as unknown as AudienceFilter, options))
    } catch {
      // Filtro con forma inesperada: la card sigue mostrándose sin resumen.
    }
  }
  return map
}
