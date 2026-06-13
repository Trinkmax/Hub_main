import { ChevronLeft, ChevronRight, QrCode, UserPlus, Users } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import {
  listCaptureLinks,
  listCustomerProgramaCounts,
  listCustomers,
  listTags,
  PAGE_SIZE,
} from '@/lib/customers/queries'
import { listFiltersSchema } from '@/lib/customers/schemas'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'
import { CustomersFilters } from './_components/customers-filters'
import { CustomersTable } from './_components/customers-table'

export const metadata = { title: 'Clientes' }

export default async function ClientesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  const filters = listFiltersSchema.parse({
    q: sp.q,
    tag: sp.tag,
    since: sp.since,
    programa: sp.programa,
    segment: sp.segment,
    page: sp.page ?? 1,
  })

  const [{ rows, total }, tags, links, programaCounts] = await Promise.all([
    listCustomers({ tenantId: access.tenant.id, filters }),
    listTags({ tenantId: access.tenant.id }),
    listCaptureLinks({ tenantId: access.tenant.id }),
    listCustomerProgramaCounts({ tenantId: access.tenant.id, segment: filters.segment }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasCaptureLinks = links.length > 0
  const hasFilters = Boolean(filters.q || filters.tag || filters.since)
  const isEmpty = rows.length === 0

  const segmentLabel =
    filters.segment === 'reserva' ? 'Reservas' : filters.segment === 'walkin' ? 'Walk-in' : null
  const countNoun = total === 1 ? 'cliente' : 'clientes'
  const headerDescription = segmentLabel
    ? `${segmentLabel} · ${total.toLocaleString('es-AR')} ${countNoun} · página ${filters.page} de ${totalPages}`
    : `${total.toLocaleString('es-AR')} ${total === 1 ? 'cliente registrado' : 'clientes registrados'} · página ${filters.page} de ${totalPages}`

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Personas"
        title="Clientes"
        description={headerDescription}
        actions={
          <>
            {!hasCaptureLinks ? (
              <Button asChild variant="outline" className="gap-2">
                <Link href={`/${tenantSlug}/local/captura`}>
                  <QrCode className="size-4" />
                  Crear QR de captura
                </Link>
              </Button>
            ) : null}
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/clientes/nuevo`}>
                <UserPlus className="size-4" />
                Nuevo cliente
              </Link>
            </Button>
          </>
        }
      />

      <CustomersFilters tags={tags} programaCounts={programaCounts} />

      {isEmpty ? (
        <EmptyState
          icon={Users}
          title={
            hasFilters
              ? 'Sin resultados'
              : segmentLabel === 'Reservas'
                ? 'Todavía no hay clientes de reservas'
                : segmentLabel === 'Walk-in'
                  ? 'Todavía no hay clientes walk-in'
                  : 'Todavía no hay clientes'
          }
          description={
            hasFilters
              ? 'Probá ajustar la búsqueda o quitar filtros para ver más clientes.'
              : segmentLabel === 'Reservas'
                ? 'Cuando cargues una reserva con teléfono, el cliente aparece acá automáticamente.'
                : 'Empezá registrando un cliente manualmente o imprimí un QR de captura para que se carguen solos.'
          }
          action={
            !hasFilters && !segmentLabel ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild className="gap-2">
                  <Link href={`/${tenantSlug}/clientes/nuevo`}>
                    <UserPlus className="size-4" />
                    Nuevo cliente
                  </Link>
                </Button>
                <Button asChild variant="outline" className="gap-2">
                  <Link href={`/${tenantSlug}/local/captura`}>
                    <QrCode className="size-4" />
                    Crear QR
                  </Link>
                </Button>
              </div>
            ) : null
          }
        />
      ) : (
        <CustomersTable rows={rows} total={total} tenantSlug={tenantSlug} />
      )}

      {totalPages > 1 ? (
        <Pagination tenantSlug={tenantSlug} page={filters.page} totalPages={totalPages} sp={sp} />
      ) : null}
    </div>
  )
}

function Pagination({
  tenantSlug,
  page,
  totalPages,
  sp,
}: {
  tenantSlug: string
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
    return `/${tenantSlug}/clientes?${params.toString()}`
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
