import { QrCode, UserPlus, Users } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DataTableToolbar } from '@/components/ui/data-table'
import { PageHeader } from '@/components/ui/page-header'
import { ListEmptyState, ListTemplate } from '@/components/ui/page-templates'
import { Pagination } from '@/components/ui/pagination'
import {
  listCustomerProgramaCounts,
  listCustomers,
  listTags,
  PAGE_SIZE,
} from '@/lib/customers/queries'
import { listFiltersSchema } from '@/lib/customers/schemas'
import { formatNumber } from '@/lib/format/number-kind'
import { makePageHref } from '@/lib/table/pagination'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
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
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
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

  const [{ rows, total }, tags, programaCounts] = await Promise.all([
    listCustomers({ tenantId: access.tenant.id, filters }),
    listTags({ tenantId: access.tenant.id }),
    listCustomerProgramaCounts({ tenantId: access.tenant.id, segment: filters.segment }),
  ])

  const basePath = `/${tenantSlug}/clientes`
  const hasFilters = Boolean(
    filters.q || filters.tag || filters.since || filters.programa !== 'all',
  )
  // «Limpiar filtros» no saca el segmento del menú (Reservas, Walk-in).
  const clearHref = filters.segment ? `${basePath}?segment=${filters.segment}` : basePath

  const segmentLabel =
    filters.segment === 'reserva' ? 'Reservas' : filters.segment === 'walkin' ? 'Walk-in' : null
  const totalLabel = formatNumber(total)
  const headerDescription = segmentLabel
    ? `${segmentLabel} · ${totalLabel} ${total === 1 ? 'cliente' : 'clientes'}`
    : `${totalLabel} ${total === 1 ? 'cliente registrado' : 'clientes registrados'}`

  const newCustomerButton = (
    <Button asChild>
      <Link href={`${basePath}/nuevo`}>
        <UserPlus aria-hidden="true" />
        Nuevo cliente
      </Link>
    </Button>
  )
  const clubQrButton = (
    <Button asChild variant="secondary">
      <Link href={`/${tenantSlug}/local/captura`}>
        <QrCode aria-hidden="true" />
        QR del club
      </Link>
    </Button>
  )

  return (
    <ListTemplate
      header={
        <PageHeader
          title="Clientes"
          description={headerDescription}
          actions={
            <>
              {clubQrButton}
              {newCustomerButton}
            </>
          }
        />
      }
    >
      <CustomersTable
        rows={rows}
        tenantSlug={tenantSlug}
        toolbar={
          <DataTableToolbar>
            <CustomersFilters tags={tags} programaCounts={programaCounts} />
          </DataTableToolbar>
        }
        empty={
          <ListEmptyState
            filtered={hasFilters}
            clearHref={clearHref}
            icon={Users}
            title={
              segmentLabel === 'Reservas'
                ? 'Todavía no hay clientes de reservas'
                : segmentLabel === 'Walk-in'
                  ? 'Todavía no hay clientes walk-in'
                  : 'Todavía no hay clientes'
            }
            description={
              segmentLabel === 'Reservas'
                ? 'Cuando cargues una reserva con teléfono, el cliente aparece acá solo.'
                : 'Cargá el primero a mano o imprimí el QR del club para que se sumen solos.'
            }
            action={segmentLabel ? undefined : newCustomerButton}
            secondaryAction={segmentLabel ? undefined : clubQrButton}
          />
        }
        pagination={
          total > PAGE_SIZE ? (
            <Pagination
              page={filters.page}
              pageSize={PAGE_SIZE}
              total={total}
              hrefFor={makePageHref(basePath, sp)}
              label="Paginación de clientes"
            />
          ) : null
        }
      />
    </ListTemplate>
  )
}
