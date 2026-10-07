import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { FormTemplate } from '@/components/ui/page-templates'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { NewCustomerForm } from './new-customer-form'

export const metadata = { title: 'Nuevo cliente' }

export default async function NuevoClientePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  try {
    const access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  return (
    <FormTemplate
      header={
        <PageHeader
          back={{ href: `/${tenantSlug}/clientes`, label: 'Clientes' }}
          title="Nuevo cliente"
          description="Cargá los datos básicos. El teléfono lo acomodamos solo al formato internacional."
        />
      }
    >
      <NewCustomerForm tenantSlug={tenantSlug} />
    </FormTemplate>
  )
}
